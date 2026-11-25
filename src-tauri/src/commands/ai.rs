//! `ai` commands. STUB: each body returns NotImplemented until the module is built.
//! Keep every command's NAME and its argument NAMES: the UI shim (src/renderer/platform/tauriApi.ts)
//! calls them by name with camelCase keys. You may sharpen the types (e.g. replace `serde_json::Value`).
#![allow(unused_variables)]
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn ai_test_key(app: AppHandle, state: State<'_, AppState>, provider: String) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("ai_test_key"))
}

#[tauri::command]
pub async fn ai_list_models(app: AppHandle, state: State<'_, AppState>, provider: String) -> AppResult<Vec<String>> {
    Err(AppError::NotImplemented("ai_list_models"))
}

#[tauri::command]
pub async fn ai_explain(app: AppHandle, state: State<'_, AppState>, request_id: String, req: serde_json::Value) -> AppResult<()> {
    Err(AppError::NotImplemented("ai_explain"))
}

#[tauri::command]
pub async fn ai_follow_up(app: AppHandle, state: State<'_, AppState>, request_id: String, text: String) -> AppResult<()> {
    Err(AppError::NotImplemented("ai_follow_up"))
}

#[tauri::command]
pub async fn ai_cancel(app: AppHandle, state: State<'_, AppState>, request_id: String) -> AppResult<()> {
    Err(AppError::NotImplemented("ai_cancel"))
}
