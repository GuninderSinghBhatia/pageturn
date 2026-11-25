//! `library` commands. STUB: each body returns NotImplemented until the module is built.
//! Keep every command's NAME and its argument NAMES: the UI shim (src/renderer/platform/tauriApi.ts)
//! calls them by name with camelCase keys. You may sharpen the types (e.g. replace `serde_json::Value`).
#![allow(unused_variables)]
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn library_list(app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<crate::models::Book>> {
    Err(AppError::NotImplemented("library_list"))
}

#[tauri::command]
pub async fn library_import(app: AppHandle, state: State<'_, AppState>, paths: Vec<String>) -> AppResult<Vec<crate::models::Book>> {
    Err(AppError::NotImplemented("library_import"))
}

#[tauri::command]
pub async fn library_open_dialog(app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<crate::models::Book>> {
    Err(AppError::NotImplemented("library_open_dialog"))
}

#[tauri::command]
pub async fn library_remove(app: AppHandle, state: State<'_, AppState>, book_id: String, delete_annotations: bool) -> AppResult<()> {
    Err(AppError::NotImplemented("library_remove"))
}

#[tauri::command]
pub async fn library_relocate(app: AppHandle, state: State<'_, AppState>, book_id: String) -> AppResult<Option<crate::models::Book>> {
    Err(AppError::NotImplemented("library_relocate"))
}

#[tauri::command]
pub async fn library_get_file(app: AppHandle, state: State<'_, AppState>, book_id: String) -> AppResult<tauri::ipc::Response> {
    Err(AppError::NotImplemented("library_get_file"))
}

#[tauri::command]
pub async fn library_save_thumbnail(app: AppHandle, state: State<'_, AppState>, book_id: String, png_base64: String) -> AppResult<String> {
    Err(AppError::NotImplemented("library_save_thumbnail"))
}

#[tauri::command]
pub async fn library_update_meta(app: AppHandle, state: State<'_, AppState>, book_id: String, meta: serde_json::Value) -> AppResult<()> {
    Err(AppError::NotImplemented("library_update_meta"))
}

#[tauri::command]
pub async fn library_set_liked(app: AppHandle, state: State<'_, AppState>, book_id: String, liked: bool) -> AppResult<()> {
    Err(AppError::NotImplemented("library_set_liked"))
}

#[tauri::command]
pub async fn reader_save_progress(app: AppHandle, state: State<'_, AppState>, book_id: String, page: i64) -> AppResult<()> {
    Err(AppError::NotImplemented("reader_save_progress"))
}
