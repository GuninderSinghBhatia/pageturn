//! `window` commands. STUB: each body returns NotImplemented until the module is built.
//! Keep every command's NAME and its argument NAMES: the UI shim (src/renderer/platform/tauriApi.ts)
//! calls them by name with camelCase keys. You may sharpen the types (e.g. replace `serde_json::Value`).
#![allow(unused_variables)]
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn window_fit_aspect(app: AppHandle, state: State<'_, AppState>, aspect: f64) -> AppResult<()> {
    Err(AppError::NotImplemented("window_fit_aspect"))
}

#[tauri::command]
pub async fn window_control(app: AppHandle, state: State<'_, AppState>, action: String) -> AppResult<()> {
    Err(AppError::NotImplemented("window_control"))
}

#[tauri::command]
pub async fn window_get_state(app: AppHandle, state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("window_get_state"))
}
