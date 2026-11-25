//! `settings` commands. STUB: each body returns NotImplemented until the module is built.
//! Keep every command's NAME and its argument NAMES: the UI shim (src/renderer/platform/tauriApi.ts)
//! calls them by name with camelCase keys. You may sharpen the types (e.g. replace `serde_json::Value`).
#![allow(unused_variables)]
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn settings_get(app: AppHandle, state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("settings_get"))
}

#[tauri::command]
pub async fn settings_set(app: AppHandle, state: State<'_, AppState>, partial: serde_json::Value) -> AppResult<serde_json::Value> {
    Err(AppError::NotImplemented("settings_set"))
}

#[tauri::command]
pub async fn settings_set_api_key(app: AppHandle, state: State<'_, AppState>, provider: String, key: String) -> AppResult<()> {
    Err(AppError::NotImplemented("settings_set_api_key"))
}

#[tauri::command]
pub async fn settings_has_api_key(app: AppHandle, state: State<'_, AppState>, provider: String) -> AppResult<bool> {
    Err(AppError::NotImplemented("settings_has_api_key"))
}

#[tauri::command]
pub async fn settings_clear_api_key(app: AppHandle, state: State<'_, AppState>, provider: String) -> AppResult<()> {
    Err(AppError::NotImplemented("settings_clear_api_key"))
}

/// The saved API key for a provider ("anthropic" | "openai" | "gemini"), or None.
/// Used by the AI module. STUB until the settings module is built; keep this signature.
pub fn api_key(state: &AppState, provider: &str) -> AppResult<Option<String>> {
    Err(AppError::NotImplemented("settings::api_key"))
}
