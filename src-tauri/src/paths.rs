//! Where PageTurn keeps its data. Same folder as PageTurn 1.x (`%APPDATA%\PageTurn`),
//! NOT Tauri's default (`%APPDATA%\com.pageturn.app`), so existing libraries carry over.

use std::path::PathBuf;

/// The app data folder. `PAGETURN_USER_DATA` overrides it (tests, power users).
pub fn data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("PAGETURN_USER_DATA") {
        if !custom.is_empty() {
            return PathBuf::from(custom);
        }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("PageTurn");
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".config").join("PageTurn")
}

pub fn db_path(data: &std::path::Path) -> PathBuf {
    data.join("pageturn.db")
}

pub fn thumb_dir(data: &std::path::Path) -> PathBuf {
    data.join("thumbnails")
}

pub fn logs_dir(data: &std::path::Path) -> PathBuf {
    data.join("logs")
}

pub fn backups_dir(data: &std::path::Path) -> PathBuf {
    data.join("backups")
}
