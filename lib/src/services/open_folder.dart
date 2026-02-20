import 'dart:io';

import 'package:url_launcher/url_launcher.dart';

/// 在系统默认文件管理器中打开文件所在目录。
/// 兼容 Windows / macOS / Linux，尊重用户注册的默认文件管理器。
Future<void> openFolder(String filePath) async {
  final dir = File(filePath).parent.path;
  if (Platform.isWindows) {
    // url_launcher 的 file:// URI 在 Windows 上会被硬编码路由给 explorer.exe，
    // 绕过用户注册的第三方文件管理器（如 OneCommander）。
    // 改用 cmd /c start，走 ShellExecute "open" 操作，
    // 会正确查找 HKCR\Directory\shell\open\command 中注册的默认文件管理器。
    await Process.run('cmd', ['/c', 'start', '', dir]);
  } else {
    await launchUrl(Uri.file(dir));
  }
}

/// 用系统默认程序打开文件。
/// 兼容 Windows / macOS / Linux。
Future<void> openFile(String filePath) async {
  if (Platform.isWindows) {
    await Process.run('cmd', ['/c', 'start', '', filePath]);
  } else {
    await launchUrl(Uri.file(filePath));
  }
}
