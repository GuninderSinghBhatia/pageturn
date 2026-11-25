//! State shared by every command: the database and the data folder.

use crate::error::AppResult;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub data_dir: PathBuf,
}

impl AppState {
    /// Runs `f` with the database locked. Keep `f` short: no awaits, no network.
    pub fn with_db<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let conn = self.db.lock().unwrap_or_else(|e| e.into_inner());
        f(&conn)
    }

    pub fn thumb_dir(&self) -> PathBuf {
        crate::paths::thumb_dir(&self.data_dir)
    }
}
