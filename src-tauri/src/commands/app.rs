//! `app` commands. STUB: each body returns NotImplemented until the module is built.
//! Keep every command's NAME and its argument NAMES: the UI shim (src/renderer/platform/tauriApi.ts)
//! calls them by name with camelCase keys. You may sharpen the types (e.g. replace `serde_json::Value`).
#![allow(unused_variables)]
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn app_set_unsaved(app: AppHandle, state: State<'_, AppState>, count: i64) -> AppResult<()> {
    Err(AppError::NotImplemented("app_set_unsaved"))
}

#[tauri::command]
pub async fn app_report_error(app: AppHandle, state: State<'_, AppState>, message: String, stack: Option<String>) -> AppResult<()> {
    Err(AppError::NotImplemented("app_report_error"))
}

#[tauri::command]
pub async fn app_version(app: AppHandle, state: State<'_, AppState>) -> AppResult<String> {
    Err(AppError::NotImplemented("app_version"))
}

#[tauri::command]
pub async fn app_check_for_updates(app: AppHandle, state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("app_check_for_updates"))
}

#[tauri::command]
pub async fn app_install_update(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    Err(AppError::NotImplemented("app_install_update"))
}

#[tauri::command]
pub async fn app_open_logs(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    Err(AppError::NotImplemented("app_open_logs"))
}
