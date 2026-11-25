//! PageTurn (Tauri build): the Rust side of the app. The React UI is unchanged; it reaches
//! these commands through `window.api` (see src/renderer/platform/tauriApi.ts).

mod commands;
mod db;
mod error;
mod models;
mod paths;
mod state;

use state::AppState;
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let data_dir = paths::data_dir();
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&paths::db_path(&data_dir))?;
            app.manage(AppState { db: Mutex::new(conn), data_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
        commands::library::library_list,
        commands::library::library_import,
        commands::library::library_open_dialog,
        commands::library::library_remove,
        commands::library::library_relocate,
        commands::library::library_get_file,
        commands::library::library_save_thumbnail,
        commands::library::library_update_meta,
        commands::library::library_set_liked,
        commands::library::reader_save_progress,
        commands::annotations::annotations_list_for_book,
        commands::annotations::annotations_upsert_highlight,
        commands::annotations::annotations_delete_highlight,
        commands::annotations::annotations_upsert_note,
        commands::annotations::annotations_delete_note,
        commands::annotations::annotations_set_note_tags,
        commands::annotations::annotations_add_ink,
        commands::annotations::annotations_delete_ink,
        commands::annotations::annotations_toggle_bookmark,
        commands::annotations::annotations_rename_bookmark,
        commands::annotations::annotations_list_all_notes,
        commands::settings::settings_get,
        commands::settings::settings_set,
        commands::settings::settings_set_api_key,
        commands::settings::settings_has_api_key,
        commands::settings::settings_clear_api_key,
        commands::export::export_markdown,
        commands::export::export_markdown_text,
        commands::export::export_backup,
        commands::export::export_import_backup,
        commands::export::export_open_data_folder,
        commands::ai::ai_test_key,
        commands::ai::ai_list_models,
        commands::ai::ai_explain,
        commands::ai::ai_follow_up,
        commands::ai::ai_cancel,
        commands::lookup::lookup_wikipedia,
        commands::lookup::lookup_open,
        commands::rag::rag_health,
        commands::rag::rag_ask,
        commands::rag::rag_who,
        commands::window::window_fit_aspect,
        commands::window::window_control,
        commands::window::window_get_state,
        commands::app::app_set_unsaved,
        commands::app::app_report_error,
        commands::app::app_version,
        commands::app::app_check_for_updates,
        commands::app::app_install_update,
        commands::app::app_open_logs,
        commands::web::web_show,
        commands::web::web_reveal,
        commands::web::web_set_bounds,
        commands::web::web_hide,
        commands::web::web_back,
        commands::web::web_forward,
        commands::web::web_reload,
        commands::web::web_open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running PageTurn");
}
