//! `app` commands, logging and the quit warning. Port of `src/main/logging.ts`, the app part
//! of `src/main/ipc/index.ts` and `src/main/updater.ts`.
use crate::error::{AppError, AppResult};
use crate::paths;
use crate::state::AppState;
use log::{Level, LevelFilter, Log, Metadata, Record};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const MAX_UNSAVED: i64 = 100_000;

/// Number of changes that could not be saved yet (set by the UI).
static UNSAVED: AtomicU32 = AtomicU32::new(0);

// ---------------------------------------------------------------- logging

struct FileLogger {
    path: PathBuf,
    max_bytes: u64,
    lock: Mutex<()>,
}

impl Log for FileLogger {
    fn enabled(&self, m: &Metadata) -> bool {
        m.level() <= Level::Info
    }
    fn log(&self, r: &Record) {
        if !self.enabled(r.metadata()) {
            return;
        }
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        append_line(
            &self.path,
            self.max_bytes,
            &format_line(r.level(), &r.args().to_string()),
        );
        if r.level() <= Level::Warn {
            eprintln!("[{}] {}", r.level(), r.args());
        }
    }
    fn flush(&self) {}
}

fn format_line(level: Level, msg: &str) -> String {
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    format!("[{ts}] [{}] {msg}\n", level.as_str().to_lowercase())
}

/// Move `main.log` to `main.old.log` once it reaches `max_bytes` (like electron-log).
pub fn rotate_if_needed(path: &Path, max_bytes: u64) {
    if fs::metadata(path)
        .map(|m| m.len() >= max_bytes)
        .unwrap_or(false)
    {
        let old = path.with_file_name("main.old.log");
        let _ = fs::remove_file(&old);
        let _ = fs::rename(path, old);
    }
}

fn append_line(path: &Path, max_bytes: u64, line: &str) {
    rotate_if_needed(path, max_bytes);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Logs go to `<data_dir>/logs/main.log` (rotated at 5 MB). Nothing is sent anywhere.
/// After this, `log::info!` / `warn!` / `error!` work everywhere. Panics are logged too.
pub fn init_logging(data_dir: &Path) {
    let dir = paths::logs_dir(data_dir);
    let _ = fs::create_dir_all(&dir);
    let logger = Box::leak(Box::new(FileLogger {
        path: dir.join("main.log"),
        max_bytes: MAX_LOG_BYTES,
        lock: Mutex::new(()),
    }));
    if log::set_logger(logger).is_ok() {
        log::set_max_level(LevelFilter::Info);
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("Uncaught panic: {info}");
        previous(info);
    }));
}

// ---------------------------------------------------------------- quit warning

/// Same range check as the TS (`z.number().int().min(0).max(100_000)`).
pub fn validate_unsaved(count: i64) -> AppResult<u32> {
    if (0..=MAX_UNSAVED).contains(&count) {
        Ok(count as u32)
    } else {
        Err(AppError::Msg("Invalid unsaved count".into()))
    }
}

pub fn unsaved_count() -> u32 {
    UNSAVED.load(Ordering::Relaxed)
}

/// True when closing must be stopped: changes are unsaved and the user chose Cancel.
pub fn should_prevent_close(app: &AppHandle) -> bool {
    if unsaved_count() == 0 {
        return false;
    }
    let quit = app
        .dialog()
        .message("Your latest highlights or notes may be lost.")
        .title("Some changes couldn't be saved. Quit anyway?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit anyway".into(),
            "Cancel".into(),
        ))
        .blocking_show();
    !quit
}

/// For the integrator: call from `WindowEvent::CloseRequested { api, .. }`.
pub fn on_close_requested(app: &AppHandle, api: &tauri::CloseRequestApi) {
    if should_prevent_close(app) {
        api.prevent_close();
    }
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub async fn app_set_unsaved(count: i64) -> AppResult<()> {
    UNSAVED.store(validate_unsaved(count)?, Ordering::Relaxed);
    Ok(())
}

/// Cut a string to at most `max` characters.
fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

#[tauri::command]
pub async fn app_report_error(message: String, stack: Option<String>) -> AppResult<()> {
    if message.chars().count() > 5000 {
        return Err(AppError::Msg("Error message too long".into()));
    }
    let stack = stack
        .map(|s| truncate_chars(&s, 10_000))
        .unwrap_or_default();
    log::error!("Renderer error {message} {stack}");
    Ok(())
}

#[tauri::command]
pub async fn app_version(app: AppHandle) -> AppResult<String> {
    // From tauri.conf.json (the same version the updater compares against).
    Ok(app.package_info().version.to_string())
}

/// Checks for a newer signed version. `{status:'dev'}` while developing, like the Electron build.
#[tauri::command]
pub async fn app_check_for_updates(app: AppHandle) -> AppResult<serde_json::Value> {
    Ok(crate::updater::check(&app).await.to_json())
}

/// Installs the downloaded update and restarts into it.
#[tauri::command]
pub async fn app_install_update(app: AppHandle) -> AppResult<()> {
    crate::updater::install(&app).map_err(AppError::Msg)
}

#[tauri::command]
pub async fn app_open_logs(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let dir = paths::logs_dir(&state.data_dir);
    fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Msg(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsaved_validation() {
        assert_eq!(validate_unsaved(0).unwrap(), 0);
        assert_eq!(validate_unsaved(100_000).unwrap(), 100_000);
        assert!(validate_unsaved(-1).is_err());
        assert!(validate_unsaved(100_001).is_err());
    }

    #[test]
    fn rotation_moves_big_log_aside() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("main.log");
        fs::write(&log, vec![b'x'; 100]).unwrap();
        append_line(&log, 50, "fresh\n");
        assert_eq!(
            fs::read(dir.path().join("main.old.log")).unwrap().len(),
            100
        );
        assert_eq!(fs::read_to_string(&log).unwrap(), "fresh\n");
    }

    #[test]
    fn small_log_is_appended_not_rotated() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("main.log");
        append_line(&log, 1000, "a\n");
        append_line(&log, 1000, "b\n");
        assert_eq!(fs::read_to_string(&log).unwrap(), "a\nb\n");
        assert!(!dir.path().join("main.old.log").exists());
    }

    #[test]
    fn line_format_has_level() {
        let l = format_line(Level::Error, "boom");
        assert!(l.contains("[error] boom") && l.ends_with('\n'));
    }

    #[test]
    fn truncation_counts_characters() {
        assert_eq!(truncate_chars("héllo", 2), "hé");
    }
}
