import Cocoa
import FlutterMacOS
import LaunchAtLogin

class MainFlutterWindow: NSWindow {
    override func awakeFromNib() {
        let flutterViewController = FlutterViewController()
        let windowFrame = self.frame
        self.contentViewController = flutterViewController
        self.setFrame(windowFrame, display: true)

        // launch_at_startup plugin requires platform channel bridging on macOS.
        // See: https://pub.dev/packages/launch_at_startup#macos-support
        FlutterMethodChannel(
            name: "launch_at_startup",
            binaryMessenger: flutterViewController.engine.binaryMessenger
        ).setMethodCallHandler { (_ call: FlutterMethodCall, result: @escaping FlutterResult) in
            switch call.method {
            case "launchAtStartupIsEnabled":
                result(LaunchAtLogin.isEnabled)
            case "launchAtStartupSetEnabled":
                if let arguments = call.arguments as? [String: Any],
                    let setEnabledValue = arguments["setEnabledValue"] as? Bool
                {
                    LaunchAtLogin.isEnabled = setEnabledValue
                }
                result(nil)
            default:
                result(FlutterMethodNotImplemented)
            }
        }

        RegisterGeneratedPlugins(registry: flutterViewController)

        super.awakeFromNib()
    }
}
