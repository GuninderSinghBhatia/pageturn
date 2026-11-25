//! `rag` commands. STUB: each body returns NotImplemented until the module is built.
//! Keep every command's NAME and its argument NAMES: the UI shim (src/renderer/platform/tauriApi.ts)
//! calls them by name with camelCase keys. You may sharpen the types (e.g. replace `serde_json::Value`).
#![allow(unused_variables)]
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn rag_health(app: AppHandle, state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("rag_health"))
}

#[tauri::command]
pub async fn rag_ask(app: AppHandle, state: State<'_, AppState>, question: String, current_page: i64) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("rag_ask"))
}

#[tauri::command]
pub async fn rag_who(app: AppHandle, state: State<'_, AppState>, name: String, current_page: i64) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("rag_who"))
}
