# FluxDown 推广渠道提交物料

本目录是各推广/生态渠道的**可提交实物**，已按各平台官方规范核实生成。
下方每节说明：资格校验结论、当前进展、**哪些动作必须你本人做**。

## 资格校验（已核实的事实）

| 项 | 结论 | 依据 |
|---|---|---|
| 仓库公开 | ✅ `zerx-lab/FluxDown`（public） | GitHub API |
| 开源协议 | ✅ AGPL-3.0（SPDX `AGPL-3.0`） | `LICENSE` |
| 首个 release | ✅ v0.0.1 @ 2026-02-10（>4 个月） | git tag |
| headless Web UI | ✅ `fluxdown_server`，端口 17800 | `docker/docker-compose.yml` |
| 公共镜像 | ✅ `ghcr.io/zerx-lab/fluxdown-server:{version|latest}` | `.github/workflows/release.yml` |
| MCP 端点 | ✅ `POST /mcp`，9 个工具 | `native/api/src/mcp.rs` |

**镜像架构现状**：release 的 docker job 仅构建 `linux/amd64`。模板据实只声明 amd64。
若要覆盖 NAS 上大量的 ARM 设备（群晖 arm、树莓派），需在 release.yml 的 `build-push-action`
增加 `platforms: linux/amd64,linux/arm64`——**这是提升 NAS 覆盖率的最高优先技术项**。

---

## 1. CasaOS / ZimaOS 应用商店 → `casaos/`

**最省事，直击 NAS。** 两种提交方式：

- **自建第三方商店（推荐，自己掌控）**：把 `casaos/` 内容放到一个可公开访问的仓库/分支，
  按 `store-config.json` 配好，用官方 `build_appstore.py` + GitHub Actions 构建到 gh-pages。
  用户在 ZimaOS「应用商店 → 添加来源」填你的 URL 即可一键装。
- **进官方商店**：Fork `IceWhaleTech/CasaOS-AppStore`，把 `Apps/FluxDown/` 拷进去，
  本地跑 `python3 scripts/build_appstore.py` 验证通过后提 PR（附安装成功 + WebUI 可达截图）。

发新版时同步更新 `docker-compose.yml` 里的 `image` 版本号与 `x-casaos.version`/`update_at`。

## 2. Unraid Community Applications → `unraid/`

✅ **独立模板仓库已创建并推送**：https://github.com/zerx-lab/unraid-templates
（`ca_profile.xml` 根目录 + `FluxDown/fluxdown.xml`，已通过 CA live scan 的两处修正）。

- **两处扫描错误已修**：`ca_profile.xml` 根元素改为 `<Maintainer>`/`<Profile>`；
  模板迁出主仓库到独立干净仓库，消除 `not_unraid_application` 警告。
- **你要做**：到 **https://ca.unraid.net/submit** 填仓库地址 `zerx-lab/unraid-templates`
  重新扫描（应全绿），确认后提交。
- 非阻塞建议：`<Icon>` 现用 SVG，CA 界面对 SVG 支持不稳，建议改 256×256 PNG。

## 3. MCP 生态 → `mcp/`

FluxDown 的 `/mcp` 是**用户各自本地自托管的端点**（默认仅 `127.0.0.1:17800`，
需开 `local_server_mcp_enabled` 并用管理 token 鉴权），不是中心化公网服务。

**官方 MCP Registry 不适用**：其 `remotes` 类型要求公网可达 URL（拒绝 localhost），
`packages` 类型要求发布可安装包——都不匹配"每个用户连自己本地实例"的模型。
已用 `mcp-publisher validate` 实测确认 registry 拒收 `127.0.0.1` remote URL。

**改走社区清单**（不要求公网端点，同样获得 AI 客户端曝光）：
- ✅ **已提交** `punkpeye/awesome-mcp-servers`（90k star）：
  PR https://github.com/punkpeye/awesome-mcp-servers/pull/9304
  （该仓库允许 agent PR，标题带 `🤖🤖🤖` 走快速通道）。
- 可继续提 `appcypher/awesome-mcp-servers`、`wong2/awesome-mcp-servers` 等其他清单。

`mcp/server.json` 保留作 FluxDown 官方 MCP 描述（工具清单 + 本地端点 + 鉴权说明），
供文档 / AI 客户端配置参考，非 registry 提交物。

## 4. awesome-selfhosted → `awesome-selfhosted/`

条目 `fluxdown.yml` 已按官方范本（pyload/qbittorrent）生成，只含必填字段
（star/commit 历史由该项目 CI 自动补），description 236 字符（<250 上限），
标签 `File Transfer - Peer-to-peer Filesharing` 为合法标签。

> **⚠️ 必须你本人手动提交。** `awesome-selfhosted-data` 的 CONTRIBUTING 明文规定：
> *"Machine/LLM-generated contributions ... will result in a ban."* 由 AI 代理用你的身份
> 直接提 PR 会导致封禁——得不偿失。做法：把 `fluxdown.yml` 复制到
> `awesome-selfhosted-data` 的 `software/fluxdown.yml`，你本人 review 后提 PR。

---

## 进展与待办汇总

| 渠道 | 我已产出 | 状态 | 你要做 |
|---|---|---|---|
| CasaOS | compose + store-config | 物料就绪 | 建源仓库 / 提官方 PR + 截图 |
| Unraid | 独立仓库 zerx-lab/unraid-templates | ✅ 已推送 | ca.unraid.net 填仓库地址提交 |
| MCP（awesome-mcp-servers）| PR #9304 | ✅ 已提交 | 等合并（agent PR 快速通道）|
| awesome-selfhosted | fluxdown.yml | 物料就绪 | 手动提 PR（禁 AI 代提）|

## 后续可加渠道（投入产出比排序）
- **appcypher / wong2 的 awesome-mcp-servers**：同样 PR 加一行。
- **AriaNg / Motrix 兼容宣传**：验证 `/jsonrpc` 兼容度后标注「可连 FluxDown」。
- **winget / Scoop / Homebrew**：桌面版包管理器上架。
- **yt-dlp `--external-downloader`**：写对接文档，复刻 aria2c 的引流路径。
