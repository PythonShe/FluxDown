//! Application data directory resolution.
//!
//! Determines where FluxDown stores persistent data (database, logs, NMH manifests).
//!
//! ## Strategy
//!
//! | Platform        | Mode      | Directory                                      |
//! |-----------------|-----------|-------------------------------------------------|
//! | Windows         | Portable  | `<exe_dir>/`  (data travels with the app)       |
//! | Windows         | Installed | `%LOCALAPPDATA%\FluxDown\`                      |
//! | Linux           | —         | `$XDG_DATA_HOME/fluxdown/`                      |
//! | macOS           | —         | `~/Library/Application Support/fluxdown/`        |
//! | Android         | —         | `/data/data/<package>/files/fluxdown/`           |
//!
//! ### Portable detection (Windows only)
//!
//! A `portable` marker file next to the executable signals portable mode.
//! This is consistent with the existing check in `updater.rs` and the Dart-side
//! `_isPortableMode()` in `windows_toast_helper.dart`.

use std::path::{Path, PathBuf};

/// Marker file name — a zero-byte file placed next to the exe by the portable
/// ZIP distribution.  Matches `updater::PORTABLE_MARKER` and the Dart-side
/// `_portableMarker` constant.
#[cfg(target_os = "windows")]
const PORTABLE_MARKER: &str = "portable";

/// Errors that can occur while resolving the application data directory.
#[derive(Debug, thiserror::Error)]
pub enum DataDirError {
    /// Failed to create the resolved directory (or one of its ancestors).
    #[error("failed to create data directory {path}: {source}")]
    CreateDir {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

/// Resolve the application data directory (for DB, logs, NMH manifests, etc.).
///
/// `explicit` overrides auto-detection when set (e.g. a CLI `--data-dir` flag
/// or a Server per-tenant directory); pass `None` to fall back to the
/// platform-specific auto-detection below (portable marker / `LOCALAPPDATA` /
/// XDG / macOS Application Support).
///
/// The returned path is guaranteed to exist (created if necessary).
///
/// # Examples
///
/// ```
/// use fluxdown_engine::data_dir::resolve_data_dir;
///
/// // Auto-detect the platform data directory.
/// let dir = resolve_data_dir(None).expect("data dir should be creatable");
/// assert!(dir.is_absolute() || dir.as_os_str() == ".");
/// ```
pub fn resolve_data_dir(explicit: Option<&Path>) -> Result<PathBuf, DataDirError> {
    let dir = match explicit {
        Some(path) => path.to_path_buf(),
        None => resolve_data_dir_inner(),
    };
    std::fs::create_dir_all(&dir).map_err(|source| DataDirError::CreateDir {
        path: dir.clone(),
        source,
    })?;
    Ok(dir)
}

fn resolve_data_dir_inner() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                PathBuf::from(home).join(".local").join("share")
            });
        base.join("fluxdown")
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("fluxdown")
    }

    #[cfg(target_os = "windows")]
    {
        if is_portable() {
            // Portable mode: data lives next to the exe.
            return exe_dir();
        }
        // Installed mode: use %LOCALAPPDATA%\FluxDown (always user-writable).
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            return PathBuf::from(local).join("FluxDown");
        }
        // Fallback: %APPDATA%\FluxDown
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return PathBuf::from(appdata).join("FluxDown");
        }
        // Last resort: exe directory (may fail on write, but better than ".").
        exe_dir()
    }

    // Android: 应用内部存储 `/data/data/<package>/files/fluxdown`。
    // 包名 = 进程名（`/proc/self/cmdline` 首个 NUL 之前的内容）。
    // 该目录无需任何存储权限即可读写，与 Dart 侧 `resolveDataDir()` 保持一致。
    #[cfg(target_os = "android")]
    {
        match android_package_name() {
            Some(pkg) => PathBuf::from(format!("/data/data/{pkg}/files/fluxdown")),
            None => exe_dir(),
        }
    }

    // Catch-all for other platforms (e.g. iOS stubs) — should never
    // be reached in practice.
    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "windows",
        target_os = "android"
    )))]
    {
        exe_dir()
    }
}

/// Android：从 `/proc/self/cmdline` 读取当前进程名（= 应用包名）。
/// 进程名可能带 `:subprocess` 后缀，取冒号前部分。
///
/// 供宿主（hub）拼接应用专属外部目录等 Android 路径使用。
///
/// # Examples
///
/// ```ignore
/// // 仅在 Android 目标上可用
/// if let Some(pkg) = fluxdown_engine::data_dir::android_package_name() {
///     let dir = format!("/storage/emulated/0/Android/data/{pkg}/files/Download");
/// }
/// ```
#[cfg(target_os = "android")]
pub fn android_package_name() -> Option<String> {
    let raw = std::fs::read("/proc/self/cmdline").ok()?;
    let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
    let name = std::str::from_utf8(&raw[..end]).ok()?;
    let name = name.split(':').next().unwrap_or(name).trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// Windows portable detection: `portable` marker file exists next to the exe.
#[cfg(target_os = "windows")]
fn is_portable() -> bool {
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        return dir.join(PORTABLE_MARKER).exists();
    }
    false
}

/// Returns the exe's parent directory, falling back to CWD or ".".
#[allow(dead_code)]
fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}
