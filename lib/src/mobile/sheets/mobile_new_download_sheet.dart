import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../bindings/bindings.dart';
import '../../i18n/locale_provider.dart';
import '../../models/download_controller.dart';
import '../../models/settings_provider.dart';
import '../../theme/app_colors.dart';
import '../mobile_ui.dart';

/// UA 预设（与桌面新建下载对话框一致）
const _uaPresets = <String, String>{
  'default': '',
  'chrome':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'firefox':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) '
      'Gecko/20100101 Firefox/147.0',
  'netdisk': 'netdisk',
};

/// 新建下载底部弹层
Future<void> showMobileNewDownloadSheet(
  BuildContext context, {
  required DownloadController controller,
  required SettingsProvider settings,
  String initialUrl = '',
}) {
  return showMobileSheet<void>(
    context,
    builder: (ctx) => _NewDownloadSheet(
      controller: controller,
      settings: settings,
      initialUrl: initialUrl,
      rootContext: context,
    ),
  );
}

class _NewDownloadSheet extends StatefulWidget {
  final DownloadController controller;
  final SettingsProvider settings;
  final String initialUrl;

  /// 弹层关闭后仍存活的外层 context（用于 Toast）
  final BuildContext rootContext;

  const _NewDownloadSheet({
    required this.controller,
    required this.settings,
    required this.initialUrl,
    required this.rootContext,
  });

  @override
  State<_NewDownloadSheet> createState() => _NewDownloadSheetState();
}

class _NewDownloadSheetState extends State<_NewDownloadSheet> {
  late final TextEditingController _urlController;
  late final TextEditingController _dirController;
  late final TextEditingController _cookieController;
  late final TextEditingController _checksumController;

  late String _threads; // 'auto' | '4' | '8' | '16' | '32'
  late String _queueId;
  String _uaPreset = 'default';
  bool _advancedOpen = false;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(text: widget.initialUrl);
    _dirController = TextEditingController(
      text: widget.settings.effectiveDefaultSaveDir,
    );
    _cookieController = TextEditingController();
    _checksumController = TextEditingController();
    final last = widget.settings.lastDialogThreads;
    _threads = const {'4', '8', '16', '32'}.contains(last) ? last : 'auto';
    _queueId = widget.settings.defaultQueueId;
    // 默认队列被删除后回退
    if (_queueId.isNotEmpty &&
        !widget.controller.queues.any((q) => q.queueId == _queueId)) {
      _queueId = '';
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    _dirController.dispose();
    _cookieController.dispose();
    _checksumController.dispose();
    super.dispose();
  }

  Future<void> _pasteFromClipboard() async {
    final s = LocaleScope.of(context);
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim() ?? '';
    if (!mounted) return;
    if (text.isEmpty) {
      showMobileToast(context, s.mobileClipboardEmpty);
      return;
    }
    final existing = _urlController.text.trimRight();
    _urlController.text = existing.isEmpty ? text : '$existing\n$text';
    showMobileToast(context, s.mobilePasted);
  }

  void _start() {
    final s = LocaleScope.of(context);
    final urls = _urlController.text
        .split('\n')
        .map((l) => l.trim())
        .where((l) => l.isNotEmpty)
        .toList();
    if (urls.isEmpty) {
      showMobileToast(context, s.mobileEnterUrl);
      return;
    }

    final saveDir = _dirController.text.trim();
    widget.settings.recordLastSaveDir(saveDir);

    final segments = int.tryParse(_threads) ?? 0;
    widget.settings.setLastDialogThreads(segments > 0 ? _threads : 'auto');

    final userAgent = _uaPresets[_uaPreset] ?? '';
    final cookies = _cookieController.text.trim();
    final checksum = _checksumController.text.trim();

    if (urls.length == 1) {
      widget.controller.createTask(
        url: urls.first,
        saveDir: saveDir,
        segments: segments,
        cookies: cookies,
        userAgent: userAgent,
        queueId: _queueId,
        checksum: checksum,
      );
    } else {
      // 批量下载共享目录/线程/UA，校验值仅单任务支持
      widget.controller.batchCreateTask(
        entries: [
          for (final url in urls)
            UrlEntry(url: url, fileName: '', checksum: ''),
        ],
        saveDir: saveDir,
        segments: segments,
        userAgent: userAgent,
        queueId: _queueId,
        cookies: cookies,
      );
    }

    Navigator.of(context).pop();
    showMobileToast(widget.rootContext, s.mobileDownloadStarted);
  }

  @override
  Widget build(BuildContext context) {
    final s = LocaleScope.of(context);
    final c = AppColors.of(context);
    return MobileSheetContainer(
      title: s.newDownload,
      footer: MobilePrimaryButton(
        label: s.startDownload,
        icon: LucideIcons.download,
        onTap: _start,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MobileFieldLabel(s.mobileUrlHint),
          Stack(
            children: [
              ShadInput(
                controller: _urlController,
                maxLines: 3,
                placeholder: const Text('https://\nmagnet:?xt=urn:btih:…'),
              ),
              Positioned(
                right: 8,
                bottom: 8,
                child: GestureDetector(
                  onTap: _pasteFromClipboard,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: c.surface1,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: c.border),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          LucideIcons.clipboard,
                          size: 12,
                          color: c.textSecondary,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          s.mobilePaste,
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                            color: c.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          MobileFieldLabel(s.mobileSaveTo),
          ShadInput(
            controller: _dirController,
            placeholder: Text(s.selectSaveDir),
          ),
          MobileFieldLabel(s.threads),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final t in const ['auto', '4', '8', '16', '32'])
                MobileChip(
                  label: t == 'auto' ? s.auto : t,
                  selected: _threads == t,
                  onTap: () => setState(() => _threads = t),
                ),
            ],
          ),
          MobileFieldLabel(s.taskQueueLabel),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              MobileChip(
                label: s.defaultQueue,
                selected: _queueId.isEmpty,
                onTap: () => setState(() => _queueId = ''),
              ),
              for (final q in widget.controller.queues)
                MobileChip(
                  label: q.name,
                  selected: _queueId == q.queueId,
                  onTap: () => setState(() => _queueId = q.queueId),
                ),
            ],
          ),
          // 高级选项
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => setState(() => _advancedOpen = !_advancedOpen),
            child: Padding(
              padding: const EdgeInsets.only(top: 16, bottom: 2),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      s.mobileAdvancedOptions,
                      style: TextStyle(fontSize: 13, color: c.textSecondary),
                    ),
                  ),
                  Icon(
                    _advancedOpen
                        ? LucideIcons.chevronUp
                        : LucideIcons.chevronDown,
                    size: 15,
                    color: c.textSecondary,
                  ),
                ],
              ),
            ),
          ),
          if (_advancedOpen) ...[
            const MobileFieldLabel('User-Agent'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                MobileChip(
                  label: s.queueUaInheritGlobal,
                  selected: _uaPreset == 'default',
                  onTap: () => setState(() => _uaPreset = 'default'),
                ),
                MobileChip(
                  label: 'Chrome',
                  selected: _uaPreset == 'chrome',
                  onTap: () => setState(() => _uaPreset = 'chrome'),
                ),
                MobileChip(
                  label: 'Firefox',
                  selected: _uaPreset == 'firefox',
                  onTap: () => setState(() => _uaPreset = 'firefox'),
                ),
                MobileChip(
                  label: s.userAgentPresetNetdisk,
                  selected: _uaPreset == 'netdisk',
                  onTap: () => setState(() => _uaPreset = 'netdisk'),
                ),
              ],
            ),
            MobileFieldLabel(s.taskCookie),
            ShadInput(
              controller: _cookieController,
              maxLines: 2,
              placeholder: Text(s.taskCookiePlaceholder),
            ),
            MobileFieldLabel(s.taskChecksum),
            ShadInput(
              controller: _checksumController,
              placeholder: const Text('sha256=e3b0c44298fc1c…'),
            ),
          ],
        ],
      ),
    );
  }
}
