//! `lookup` commands. STUB: each body returns NotImplemented until the module is built.
//! Keep every command's NAME and its argument NAMES: the UI shim (src/renderer/platform/tauriApi.ts)
//! calls them by name with camelCase keys. You may sharpen the types (e.g. replace `serde_json::Value`).
#![allow(unused_variables)]
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn lookup_wikipedia(app: AppHandle, state: State<'_, AppState>, query: String, lang: String) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("lookup_wikipedia"))
}

#[tauri::command]
pub async fn lookup_open(app: AppHandle, state: State<'_, AppState>, url: String, r#where: String) -> AppResult<()> {
    Err(AppError::NotImplemented("lookup_open"))
}
