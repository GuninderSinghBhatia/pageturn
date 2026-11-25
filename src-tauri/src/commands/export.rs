//! `export` commands. STUB: each body returns NotImplemented until the module is built.
//! Keep every command's NAME and its argument NAMES: the UI shim (src/renderer/platform/tauriApi.ts)
//! calls them by name with camelCase keys. You may sharpen the types (e.g. replace `serde_json::Value`).
#![allow(unused_variables)]
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn export_markdown(app: AppHandle, state: State<'_, AppState>, book_id: String) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("export_markdown"))
}

#[tauri::command]
pub async fn export_markdown_text(app: AppHandle, state: State<'_, AppState>, book_id: String) -> AppResult<String> {
    Err(AppError::NotImplemented("export_markdown_text"))
}

#[tauri::command]
pub async fn export_backup(app: AppHandle, state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("export_backup"))
}

#[tauri::command]
pub async fn export_import_backup(app: AppHandle, state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("export_import_backup"))
}

#[tauri::command]
pub async fn export_open_data_folder(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    Err(AppError::NotImplemented("export_open_data_folder"))
}
