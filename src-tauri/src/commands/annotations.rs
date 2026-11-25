//! `annotations` commands. STUB: each body returns NotImplemented until the module is built.
//! Keep every command's NAME and its argument NAMES: the UI shim (src/renderer/platform/tauriApi.ts)
//! calls them by name with camelCase keys. You may sharpen the types (e.g. replace `serde_json::Value`).
#![allow(unused_variables)]
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn annotations_list_for_book(app: AppHandle, state: State<'_, AppState>, book_id: String) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("annotations_list_for_book"))
}

#[tauri::command]
pub async fn annotations_upsert_highlight(app: AppHandle, state: State<'_, AppState>, h: serde_json::Value) -> AppResult<()> {
    Err(AppError::NotImplemented("annotations_upsert_highlight"))
}

#[tauri::command]
pub async fn annotations_delete_highlight(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    Err(AppError::NotImplemented("annotations_delete_highlight"))
}

#[tauri::command]
pub async fn annotations_upsert_note(app: AppHandle, state: State<'_, AppState>, n: serde_json::Value) -> AppResult<()> {
    Err(AppError::NotImplemented("annotations_upsert_note"))
}

#[tauri::command]
pub async fn annotations_delete_note(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    Err(AppError::NotImplemented("annotations_delete_note"))
}

#[tauri::command]
pub async fn annotations_set_note_tags(app: AppHandle, state: State<'_, AppState>, id: String, tags: serde_json::Value) -> AppResult<()> {
    Err(AppError::NotImplemented("annotations_set_note_tags"))
}

#[tauri::command]
pub async fn annotations_add_ink(app: AppHandle, state: State<'_, AppState>, strokes: serde_json::Value) -> AppResult<()> {
    Err(AppError::NotImplemented("annotations_add_ink"))
}

#[tauri::command]
pub async fn annotations_delete_ink(app: AppHandle, state: State<'_, AppState>, ids: serde_json::Value) -> AppResult<()> {
    Err(AppError::NotImplemented("annotations_delete_ink"))
}

#[tauri::command]
pub async fn annotations_toggle_bookmark(app: AppHandle, state: State<'_, AppState>, book_id: String, page: i64, label: Option<String>, id: Option<String>) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("annotations_toggle_bookmark"))
}

#[tauri::command]
pub async fn annotations_rename_bookmark(app: AppHandle, state: State<'_, AppState>, id: String, label: Option<String>) -> AppResult<()> {
    Err(AppError::NotImplemented("annotations_rename_bookmark"))
}

#[tauri::command]
pub async fn annotations_list_all_notes(app: AppHandle, state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("annotations_list_all_notes"))
}
