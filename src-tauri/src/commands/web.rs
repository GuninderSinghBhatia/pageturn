//! `web` commands. STUB: each body returns NotImplemented until the module is built.
//! Keep every command's NAME and its argument NAMES: the UI shim (src/renderer/platform/tauriApi.ts)
//! calls them by name with camelCase keys. You may sharpen the types (e.g. replace `serde_json::Value`).
#![allow(unused_variables)]
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn web_show(app: AppHandle, state: State<'_, AppState>, query: String, bounds: serde_json::Value, book_title: Option<String>) -> AppResult<()> {
    Err(AppError::NotImplemented("web_show"))
}

#[tauri::command]
pub async fn web_reveal(app: AppHandle, state: State<'_, AppState>, bounds: serde_json::Value) -> AppResult<()> {
    Err(AppError::NotImplemented("web_reveal"))
}

#[tauri::command]
pub async fn web_set_bounds(app: AppHandle, state: State<'_, AppState>, bounds: serde_json::Value) -> AppResult<()> {
    Err(AppError::NotImplemented("web_set_bounds"))
}

#[tauri::command]
pub async fn web_hide(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    Err(AppError::NotImplemented("web_hide"))
}

#[tauri::command]
pub async fn web_back(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    Err(AppError::NotImplemented("web_back"))
}

#[tauri::command]
pub async fn web_forward(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    Err(AppError::NotImplemented("web_forward"))
}

#[tauri::command]
pub async fn web_reload(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    Err(AppError::NotImplemented("web_reload"))
}

#[tauri::command]
pub async fn web_open_external(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    Err(AppError::NotImplemented("web_open_external"))
}
