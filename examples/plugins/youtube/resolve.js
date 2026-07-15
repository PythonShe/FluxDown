// FluxDown 插件：YouTube 视频解析（classic script，入口挂 globalThis）。
//
// 原理：调用宿主自带的 yt-dlp 组件（flux.ytdlp），以 `-J`（--dump-single-json）
// 提取选定格式的 googlevideo 直链，交回引擎做多段并发下载 + 断点续传。yt-dlp
// 自身负责客户端伪装 / 签名解密 / 格式选择——远比手写 Innertube 稳健且覆盖更多
// 站点，本插件只做「画质设置 → yt-dlp 格式选择器」的映射与直链回填。
//
// 抗 bot 风控（"Sign in to confirm you're not a bot"，IP 级间歇性风控）：
//   1. 多 player_client 回退：一次调用内令 yt-dlp 轮询 tv/android_vr/ios/web，
//      任一通过即用（比多次进程调用省）；
//   2. cookie：登录态 cookie 是绕过风控的唯一可靠手段。来源优先级
//      任务级 ctx.cookies > 已续期 cookie（flux.storage）> 插件设置 cookies。
//      经 `flux.fs.writeFile('cookies.txt', …)` 写入插件工作区（= yt-dlp cwd 同根），
//      以相对名注入 `--cookies cookies.txt`，用完即删（`--cookies-from-browser`
//      被 bridge 拒）。ctx.cookies 为 "k=v; k2=v2" 头格式，本地转 Netscape；
//      设置项若已是 Netscape 文件内容则原样透传。
//   3. cookie 自续期：Google 会话的 __Secure-*PSIDTS token 由浏览器约每 30 分钟
//      轮换、旧值随即作废，静态导出的快照很快失效。而 yt-dlp 每次运行结束会把
//      服务端 Set-Cookie 下发的新 token 重写回 --cookies 文件——本插件在删除前
//      回读该文件，解析成功后经 flux.storage 持久化（cookieRotated），下次优先
//      使用，令 cookie 链与浏览器脱钩、自我延续。用户更新设置项（seedHash 变化）
//      时自动重播种；续期 cookie 解析失败时自动作废回退设置项。
//
// 依赖 JS 运行时（重要）：yt-dlp 2026 起将 YouTube n-sig 挑战求解外部化（EJS），
// 必须有一个 JS 运行时（推荐 Node.js ≥ 22，或 Deno ≥ 2.3）安装在系统 PATH 中，
// 否则所有格式直链缺失、只能拿到缩略图（视频无法下载）。默认用 node；「JS 运行时」
// 设置项可切换。bridge 安全策略只允许裸名（不能填绝对路径），故运行时须在 PATH。
//
// yt-dlp 组件可在 App「组件」页安装；宿主会自动注入 `--ffmpeg-location`（合并/
// remux 依赖 ffmpeg，插件自带的 --ffmpeg-location 会被 bridge 拒绝）。
//
// 返回值约定（ResolveResult）：
//   url / audioUrl / fileName / totalBytes / extraHeaders / ephemeral / rangeSupported
//   （详见各字段回填处注释）。

// 一次调用内让 yt-dlp 轮询的 player_client 顺序（任一通过即用）。
var PLAYER_CLIENTS = 'default,tv,android_vr,ios,web_safari';

// Windows/Unix 通用的文件名净化。
function sanitizeFileName(name) {
  return (
    (name || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'youtube-video'
  );
}

// 画质设置 → yt-dlp 格式选择器。
function buildFormat(quality, preferMp4) {
  if (quality === 'audio') {
    return preferMp4 ? 'bestaudio[ext=m4a]/bestaudio' : 'bestaudio';
  }
  var heightClause = '';
  var m = /^(\d+)p$/.exec(quality);
  if (m) heightClause = '[height<=' + m[1] + ']';
  if (preferMp4) {
    return (
      'bestvideo' + heightClause + '[ext=mp4]+bestaudio[ext=m4a]/' +
      'bestvideo' + heightClause + '+bestaudio/' +
      'best' + heightClause + '/best'
    );
  }
  return (
    'bestvideo' + heightClause + '+bestaudio/' +
    'best' + heightClause + '/best'
  );
}

function sizeOf(f) {
  if (!f) return 0;
  var n = Number(f.filesize);
  if (n > 0) return n;
  var a = Number(f.filesize_approx);
  return a > 0 ? a : 0;
}

function extOf(f, info, hasVideo) {
  var e = (f && f.ext) || info.ext || '';
  if (e) return '.' + e;
  return hasVideo ? '.mp4' : '.m4a';
}

// yt-dlp http_headers → extraHeaders（键为标准 HTTP 头名）。
function headersOf(f, info) {
  var h = (f && f.http_headers) || info.http_headers;
  if (!h || typeof h !== 'object') return null;
  var out = {};
  var keys = Object.keys(h);
  for (var i = 0; i < keys.length; i++) {
    var v = h[keys[i]];
    if (v != null) out[keys[i]] = String(v);
  }
  return keys.length ? out : null;
}

// 判定一段文本是否已是 Netscape cookie 文件（原样透传，不转换）。
function looksNetscape(text) {
  var t = text.replace(/^\uFEFF/, '').trimStart();
  if (/^#\s*(Netscape|HTTP Cookie File)/i.test(t)) return true;
  // 无表头但含 TAB 分隔的行（yt-dlp 也接受）。
  return /\t/.test(text);
}

// "k=v; k2=v2" HTTP Cookie 头 → Netscape 文件内容（域固定 .youtube.com）。
// 会员/年龄限制视频需登录 cookie；此转换让浏览器扩展直传的头格式可用。
function cookieHeaderToNetscape(header) {
  var lines = ['# Netscape HTTP Cookie File'];
  var parts = header.split(';');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].trim();
    if (!kv) continue;
    var eq = kv.indexOf('=');
    if (eq <= 0) continue;
    var name = kv.slice(0, eq).trim();
    var value = kv.slice(eq + 1).trim();
    if (!name) continue;
    // domain \t includeSubdomains \t path \t secure \t expiry \t name \t value
    lines.push(['.youtube.com', 'TRUE', '/', 'TRUE', '0', name, value].join('\t'));
  }
  return lines.length > 1 ? lines.join('\n') + '\n' : '';
}

// FNV-1a 32-bit 哈希（hex）——标记 cookie 设置项版本，检测用户是否更新过设置。
function fnv1a(s) {
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// 组装 cookie 上下文：任务级 ctx.cookies（头格式）优先；否则设置项 cookies，
// 且若 flux.storage 中存有同一设置版本（seedHash 匹配）的续期副本则优先用它
// （更新鲜）。均空 → text=null（不注入 --cookies）。
// 返回 { text, rotatable, usedRotated, seedHash }：rotatable = 来源为设置项，
// 成功后可回存续期副本；usedRotated = 本次用的是续期副本（失败时须作废）。
async function buildCookieContext(ctx) {
  var task = (ctx.cookies || '').trim();
  if (task) {
    return { text: cookieHeaderToNetscape(task), rotatable: false, usedRotated: false, seedHash: '' };
  }
  var setting = (flux.settings.cookies || '').trim();
  if (!setting) return { text: null, rotatable: false, usedRotated: false, seedHash: '' };
  var seed = looksNetscape(setting) ? setting : cookieHeaderToNetscape(setting);
  var seedHash = fnv1a(seed);
  try {
    if ((await flux.storage.get('cookieSeedHash')) === seedHash) {
      var rotated = await flux.storage.get('cookieRotated');
      if (rotated && looksNetscape(rotated)) {
        return { text: rotated, rotatable: true, usedRotated: true, seedHash: seedHash };
      }
    }
  } catch (e) {
    // storage 读失败不致命，退回设置项。
  }
  return { text: seed, rotatable: true, usedRotated: false, seedHash: seedHash };
}

// 从 yt-dlp stderr 提取用户可读的失败原因（友好错误）。
function friendlyError(url, r, cookiesUsed) {
  var stderr = (r.stderr || '').trim();
  // 缺 JS 运行时的典型症状：n-sig 求解失败 / 只有缩略图 / 无 JS runtime。
  if (/n challenge solving failed|Only images are available|No supported JavaScript runtime|nsig extraction failed/i.test(stderr)) {
    return (
      '缺少 JS 运行时，无法解出视频直链。请安装 Node.js（≥ 22）或 Deno（≥ 2.3）并确保其在系统 PATH 中' +
      (flux.settings.jsRuntime && flux.settings.jsRuntime !== 'node'
        ? '（当前设置的运行时为「' + flux.settings.jsRuntime + '」，请确认已安装）'
        : '') +
      '。详见 https://github.com/yt-dlp/yt-dlp/wiki/EJS 。原始信息: ' + stderr.slice(-200)
    );
  }
  if (/confirm you.?re not a bot|Sign in to confirm/i.test(stderr)) {
    return (
      'YouTube 要求验证「你不是机器人」（IP 级风控）。' +
      (cookiesUsed
        ? '当前 cookie 未能通过，请在浏览器登录 YouTube 后重新导出 cookie 填入任务或插件设置。'
        : '请在浏览器登录 YouTube 后导出 cookie，填入新建下载的 Cookie 字段或插件「Cookie」设置项。') +
      ' 原始信息: ' + stderr.slice(-300)
    );
  }
  if (/Video unavailable|Private video|members-only|age.?restricted/i.test(stderr)) {
    return '视频不可用（私有/会员/年龄限制）：' + stderr.slice(-300) + '。会员视频需填入登录 cookie。';
  }
  if (stderr) return 'yt-dlp 解析失败: ' + stderr.slice(-400);
  return 'yt-dlp 未返回可用数据（可能被风控拦截），请尝试填入登录 cookie';
}

globalThis.resolve = async (ctx) => {
  var verbose = flux.settings.verbose;

  if (!flux.ytdlp) {
    throw new Error('flux.ytdlp 门面不可用（manifest 需声明 permissions:["ytdlp"]）');
  }
  var avail = await flux.ytdlp.available();
  if (!avail || !avail.available) {
    throw new Error('yt-dlp 未安装或不可用，请在 App「组件」页安装 yt-dlp 组件');
  }

  var fmt = buildFormat(flux.settings.quality, flux.settings.preferMp4);
  var ck = await buildCookieContext(ctx);
  var cookiesText = ck.text;
  var args = [
    '-J',
    '--no-warnings',
    '--extractor-args', 'youtube:player_client=' + PLAYER_CLIENTS,
    '-f', fmt,
  ];
  // JS 运行时：yt-dlp 2026 起把 YouTube 的 n-sig 挑战求解强制外部化（EJS），
  // 缺运行时则所有格式 URL 缺失、只剩 storyboard（下不了）。宿主自动注入的
  // --ffmpeg-location 不含 JS 运行时，故须显式指定。bridge 校验器拒绝含盘符/
  // 绝对路径的参数，因此只能传裸名（如 'node'），运行时须在 PATH 中。默认 node，
  // 设置项可切 deno/quickjs 或 none（none = 不注入，靠 nsig 缓存，多数视频会失败）。
  var jsRuntime = (flux.settings.jsRuntime || 'node').trim();
  if (jsRuntime && jsRuntime !== 'none') {
    args.push('--js-runtimes', jsRuntime);
  }
  // cookie 经 flux.fs 物化进插件工作区（= yt-dlp cwd），以相对名注入 --cookies；
  // 用完即删（敏感数据不长驻）。取代旧 spec.cookiesText 字段——通用文件能力。
  if (cookiesText) {
    await flux.fs.writeFile('cookies.txt', cookiesText);
    args.push('--cookies', 'cookies.txt');
  }
  args.push(ctx.url);

  if (verbose) {
    flux.logger.info(
      '[youtube] yt-dlp -f', fmt,
      'clients=' + PLAYER_CLIENTS,
      cookiesText ? 'with-cookies' : 'no-cookies',
      ctx.url
    );
  }

  var r;
  var rotatedBack = null;
  try {
    r = await flux.ytdlp.run({
      args: args,
      timeoutMs: 20 * 1000,
    });
  } catch (e) {
    throw new Error('yt-dlp 调用异常: ' + String(e));
  } finally {
    if (cookiesText) {
      // yt-dlp 运行结束会把轮换后的新 token 重写回 cookies.txt——删除前回读，
      // 解析成功后持久化（cookie 自续期，见文件头注释第 3 点）。
      if (ck.rotatable) {
        try {
          rotatedBack = await flux.fs.readFile('cookies.txt');
        } catch (e) {
          rotatedBack = null;
        }
      }
      try {
        await flux.fs.remove('cookies.txt');
      } catch (e) {
        // 清理失败不致命（工作区隔离、下次覆盖写）。
      }
    }
  }

  if (r.timedOut) throw new Error('yt-dlp 解析超时（20s）: ' + ctx.url);

  // 关键：yt-dlp 遇 bot 风控时退出码可能为 0 但 stdout 输出 "null"/空。
  // 不能只看 r.code——须校验 stdout 为合法非空对象，否则给出友好错误。
  var raw = (r.stdout || '').trim();
  if (r.code !== 0 || !raw || raw === 'null') {
    // 用续期副本失败 → 作废之，下次回退到设置项重新播种。
    if (ck.usedRotated) {
      try {
        await flux.storage.set('cookieRotated', '');
      } catch (e) {}
    }
    throw new Error(friendlyError(ctx.url, r, !!cookiesText));
  }

  var info;
  try {
    info = JSON.parse(raw);
  } catch (e) {
    throw new Error('yt-dlp 输出非法 JSON: ' + String(e) + ' | ' + raw.slice(0, 200));
  }
  if (!info || typeof info !== 'object') {
    throw new Error(friendlyError(ctx.url, r, !!cookiesText));
  }

  // 解析成功且 cookie 来自设置项 → 持久化 yt-dlp 回写的续期副本。
  if (ck.rotatable && rotatedBack && looksNetscape(rotatedBack)) {
    try {
      await flux.storage.set('cookieRotated', rotatedBack);
      await flux.storage.set('cookieSeedHash', ck.seedHash);
    } catch (e) {
      // 回存失败不致命，仅失去续期加成。
    }
  }

  var title = info.title || info.id || 'youtube-video';
  var base = sanitizeFileName(title);
  var reqs = Array.isArray(info.requested_formats) ? info.requested_formats : null;

  // 情形 A：requested_formats（音视频分离或选定单流）。
  if (reqs && reqs.length >= 1) {
    var vf = null;
    var af = null;
    for (var i = 0; i < reqs.length; i++) {
      var f = reqs[i];
      var hasV = f.vcodec && f.vcodec !== 'none';
      var hasA = f.acodec && f.acodec !== 'none';
      if (hasV && !vf) vf = f;
      else if (hasA && !hasV && !af) af = f;
      else if (hasA && !af) af = f;
    }

    if (flux.settings.quality === 'audio') {
      var a = af || reqs[0];
      if (!a || !a.url) throw new Error('yt-dlp 未返回音频直链: ' + ctx.url);
      if (verbose) flux.logger.info('[youtube] audio', a.format_id, a.ext);
      return {
        url: a.url,
        fileName: base + extOf(a, info, false),
        totalBytes: sizeOf(a) || null,
        extraHeaders: headersOf(a, info),
        ephemeral: true,
        rangeSupported: true,
      };
    }

    if (vf && vf.url) {
      var result = {
        url: vf.url,
        fileName: base + extOf(vf, info, true),
        totalBytes: (sizeOf(vf) + sizeOf(af)) || null,
        extraHeaders: headersOf(vf, info),
        ephemeral: true,
        rangeSupported: true,
      };
      if (af && af.url) result.audioUrl = af.url;
      if (verbose) {
        flux.logger.info(
          '[youtube] video', vf.format_id, vf.ext,
          af ? 'audio ' + af.format_id : 'muxed'
        );
      }
      return result;
    }
  }

  // 情形 B：单一 muxed 流（顶层 url）。
  if (info.url) {
    var hasVideo = flux.settings.quality !== 'audio';
    if (verbose) flux.logger.info('[youtube] muxed single', info.format_id, info.ext);
    return {
      url: info.url,
      fileName: base + extOf(info, info, hasVideo),
      totalBytes: sizeOf(info) || null,
      extraHeaders: headersOf(null, info),
      ephemeral: true,
      rangeSupported: true,
    };
  }

  throw new Error('yt-dlp 未返回可用直链: ' + ctx.url + '（格式选择器可能过严，可调整画质设置）');
};
