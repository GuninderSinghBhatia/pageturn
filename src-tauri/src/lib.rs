//! PageTurn (Tauri build): the Rust side of the app. The React UI is unchanged; it reaches
//! these commands through `window.api` (see src/renderer/platform/tauriApi.ts).

mod commands;
mod db;
mod error;
mod llm;
mod models;
mod paths;
mod rag;
mod state;
mod updater;

/// `pageturn --pageturn-extract-pdf <path>`: the PDF-reading helper Ask starts (rag/pdf.rs).
pub const PDF_HELPER_FLAG: &str = rag::pdf::EXTRACT_FLAG;

pub fn run_pdf_helper(path: &str) -> i32 {
    rag::pdf::run_helper(path)
}

use state::AppState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// `.pdf` paths among the command-line arguments ("Open with" / file association).
fn pdf_args(argv: &[String]) -> Vec<String> {
    argv.iter()
        .skip(1)
        .filter(|a| a.to_lowercase().ends_with(".pdf") && std::path::Path::new(a).exists())
        .cloned()
        .collect()
}

/// Imports the given PDFs and tells the UI to open the last one (like PageTurn 1.x).
/// `wait_ms` gives the webview time to load its listeners when the app is only just starting.
fn open_from_args(app: &tauri::AppHandle, argv: Vec<String>, wait_ms: u64) {
    let paths = pdf_args(&argv);
    if paths.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if wait_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;
        }
        let state = app.state::<AppState>();
        match commands::library::import_paths(&app, &state, paths).await {
            Ok(books) => {
                if let Some(last) = books.last() {
                    let _ = app.emit("library:openRequest", last);
                }
            }
            Err(e) => log::error!("Failed to open file from arguments: {e}"),
        }
    });
}

/// `PAGETURN_DISABLE_WEBGL=1` forces the slide-transition fallback (tests, GPU troubleshooting),
/// like PageTurn 1.x. Must run before the webview is created.
fn apply_webgl_switch() {
    if std::env::var("PAGETURN_DISABLE_WEBGL").as_deref() != Ok("1") {
        return;
    }
    let key = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    let current = std::env::var(key).unwrap_or_default();
    std::env::set_var(
        key,
        format!("{current} --disable-gpu --disable-webgl --disable-3d-apis"),
    );
}

pub fn run() {
    apply_webgl_switch();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            open_from_args(app, argv, 0);
        }))
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    commands::app::on_close_requested(window.app_handle(), api);
                }
            }
        })
        .setup(|app| {
            let data_dir = paths::data_dir();
            std::fs::create_dir_all(&data_dir)?;
            commands::app::init_logging(&data_dir);
            let conn = db::open(&paths::db_path(&data_dir))?;
            app.manage(AppState {
                db: Mutex::new(conn),
                data_dir: data_dir.clone(),
            });

            if let Err(e) =
                commands::library::set_up_first_run(app.handle(), &app.state::<AppState>())
            {
                log::error!("First-run setup failed: {e}");
            }
            // Ask's models ship in the installer's `models` folder (scripts/fetch-models.mjs).
            if let Ok(dir) = app.path().resource_dir() {
                rag::models::set_bundled_dir(dir.join("models"));
            }
            commands::rag_service::start(app.handle(), paths::logs_dir(&data_dir));
            commands::export::schedule_daily_backup(data_dir);
            commands::window::setup(app.handle());
            updater::start(app.handle().clone());

            let argv: Vec<String> = std::env::args().collect();
            open_from_args(app.handle(), argv, 1500);
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
            commands::ai::ai_claude_status,
            commands::ai::ai_claude_login,
            commands::ai::ai_chatgpt_status,
            commands::ai::ai_chatgpt_login,
            commands::ai::ai_chatgpt_logout,
            commands::ai::ai_chatgpt_models,
            commands::ai::ai_chatgpt_welcomed,
            commands::ai::ai_chatgpt_open_usage,
            commands::rag::rag_index_status,
            commands::rag::rag_index_book,
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
            commands::web::web_open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PageTurn");
}
