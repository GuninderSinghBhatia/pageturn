//! `library` commands: import, list, remove, relocate, file bytes, covers, metadata, progress.
//! Ported from src/main/ipc/library.ts, library/import.ts, library/hash.ts,
//! db/repositories/books.ts, ipc/reader.ts and firstRun.ts. The UI shim
//! (src/renderer/platform/tauriApi.ts) calls these by name with camelCase argument keys.
use crate::error::{invalid, AppError, AppResult};
use crate::models::{
    book_from_row, check_book_id, get_book_row, now_ms, require_book, thumbnail_path, to_book,
    Book, BookRow, BOOK_COLUMNS,
};
use crate::state::AppState;
use base64::Engine;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const HEAD_BYTES: u64 = 1024 * 1024;
const SAMPLE: &str = "Welcome-to-PageTurn.pdf";

// ---------------------------------------------------------------- core (plain functions)

/// bookId = SHA-256 hex of (first 1 MB of file bytes + file size as decimal string).
pub fn compute_book_id(path: &Path) -> std::io::Result<String> {
    let file = std::fs::File::open(path)?;
    let size = file.metadata()?.len();
    let mut head = Vec::new();
    file.take(HEAD_BYTES).read_to_end(&mut head)?;
    let mut h = Sha256::new();
    h.update(&head);
    h.update(size.to_string().as_bytes());
    Ok(hex::encode(h.finalize()))
}

/// Mirrors `PathsSchema`: a non-empty list of `.pdf` paths.
fn check_paths(paths: &[String]) -> AppResult<()> {
    if paths.is_empty()
        || paths
            .iter()
            .any(|p| !p.to_ascii_lowercase().ends_with(".pdf"))
    {
        return Err(invalid("paths"));
    }
    Ok(())
}

/// Inserts a new book, or updates the path of an existing one (and un-hides it).
fn upsert_book(conn: &Connection, id: &str, path: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO books (id, path, title, author, num_pages, last_page, added_at)
         VALUES (?1, ?2, NULL, NULL, NULL, 1, ?3)
         ON CONFLICT(id) DO UPDATE SET
           path = excluded.path,
           removed_at = NULL,
           title = COALESCE(excluded.title, title),
           author = COALESCE(excluded.author, author),
           num_pages = COALESCE(excluded.num_pages, num_pages)",
        params![id, path, now_ms()],
    )?;
    Ok(())
}

/// Stores already-hashed files; one row per distinct id, in first-seen order.
fn store_imports(conn: &Connection, hashed: &[(String, String)]) -> AppResult<Vec<BookRow>> {
    let mut out: Vec<BookRow> = Vec::new();
    for (id, path) in hashed {
        upsert_book(conn, id, path)?;
        let row = get_book_row(conn, id)?.ok_or(AppError::UnknownBook)?;
        match out.iter_mut().find(|r| r.id == row.id) {
            Some(slot) => *slot = row,
            None => out.push(row),
        }
    }
    Ok(out)
}

/// Imports PDFs by content hash (blocking; tests and first run).
fn import_files_sync(conn: &Connection, paths: &[String]) -> AppResult<Vec<BookRow>> {
    check_paths(paths)?;
    let hashed = paths
        .iter()
        .map(|p| Ok((compute_book_id(Path::new(p))?, p.clone())))
        .collect::<AppResult<Vec<_>>>()?;
    store_imports(conn, &hashed)
}

/// (id, path) of every book in the library, for indexing.
pub fn library_books(conn: &Connection) -> AppResult<Vec<(String, String)>> {
    Ok(list_rows(conn)?
        .into_iter()
        .map(|r| (r.id, r.path))
        .collect())
}

fn list_rows(conn: &Connection) -> AppResult<Vec<BookRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {BOOK_COLUMNS} FROM books WHERE removed_at IS NULL
         ORDER BY last_opened_at DESC NULLS LAST, added_at DESC"
    ))?;
    let rows = stmt
        .query_map([], book_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Hides the book (annotations kept) or deletes it with its annotations (cascade).
fn remove_book(conn: &Connection, id: &str, delete_annotations: bool) -> AppResult<()> {
    let row = require_book(conn, id)?;
    if delete_annotations {
        conn.execute("DELETE FROM books WHERE id = ?1", [&row.id])?;
    } else {
        conn.execute(
            "UPDATE books SET removed_at = ?1 WHERE id = ?2",
            params![now_ms(), row.id],
        )?;
    }
    Ok(())
}

#[derive(Debug, PartialEq)]
enum Relocation {
    Ok,
    Mismatch,
}

/// Points a book at a new file, but only if its content hash matches.
fn relocate_to(conn: &Connection, id: &str, new_path: &Path) -> AppResult<Relocation> {
    if compute_book_id(new_path)? != id {
        return Ok(Relocation::Mismatch);
    }
    set_path(conn, id, new_path)?;
    Ok(Relocation::Ok)
}

fn set_path(conn: &Connection, id: &str, path: &Path) -> AppResult<()> {
    conn.execute(
        "UPDATE books SET path = ?1 WHERE id = ?2",
        params![path.to_string_lossy(), id],
    )?;
    Ok(())
}

fn set_liked(conn: &Connection, id: &str, liked: bool) -> AppResult<()> {
    let row = require_book(conn, id)?;
    conn.execute(
        "UPDATE books SET liked = ?1 WHERE id = ?2",
        params![liked as i64, row.id],
    )?;
    Ok(())
}

fn save_progress(conn: &Connection, id: &str, page: i64) -> AppResult<()> {
    check_book_id(id)?;
    if page < 1 {
        return Err(invalid("page"));
    }
    conn.execute(
        "UPDATE books SET last_page = ?1, last_opened_at = ?2 WHERE id = ?3",
        params![page, now_ms(), id],
    )?;
    Ok(())
}

/// `BookMetaSchema`: title/author may be absent (keep), null (clear) or a string; numPages int >= 1.
fn update_meta(conn: &Connection, id: &str, meta: &serde_json::Value) -> AppResult<()> {
    let cur = require_book(conn, id)?;
    let obj = meta.as_object().ok_or_else(|| invalid("meta"))?;
    let num_pages = obj
        .get("numPages")
        .and_then(|v| v.as_i64())
        .filter(|n| *n >= 1)
        .ok_or_else(|| invalid("numPages"))?;
    let field = |name: &str, current: Option<String>| -> AppResult<Option<String>> {
        match obj.get(name) {
            None => Ok(current),
            Some(serde_json::Value::Null) => Ok(None),
            Some(serde_json::Value::String(s)) => Ok(Some(s.clone())),
            Some(_) => Err(invalid(name)),
        }
    };
    let title = field("title", cur.title)?;
    let author = field("author", cur.author)?;
    conn.execute(
        "UPDATE books SET title = ?1, author = ?2, num_pages = ?3 WHERE id = ?4",
        params![title, author, num_pages, cur.id],
    )?;
    Ok(())
}

fn write_thumbnail(thumb_dir: &Path, id: &str, png_base64: &str) -> AppResult<String> {
    let engine = base64::engine::general_purpose::STANDARD;
    let bytes = engine.decode(png_base64).map_err(|_| invalid("png"))?;
    std::fs::create_dir_all(thumb_dir)?;
    std::fs::write(thumbnail_path(thumb_dir, id), &bytes)?;
    Ok(format!("data:image/png;base64,{}", engine.encode(bytes)))
}

fn remove_thumbnail(thumb_dir: &Path, id: &str) {
    let _ = std::fs::remove_file(thumbnail_path(thumb_dir, id));
}

fn notify_changed(app: &AppHandle) {
    let _ = app.emit("library:changed", ());
}

// ---------------------------------------------------------------- shared async helpers

/// Imports files (hashing off the async runtime), emits `library:changed`, returns the books.
/// Also used for "Open with" / command-line PDFs.
pub async fn import_paths(
    app: &AppHandle,
    state: &AppState,
    paths: Vec<String>,
) -> AppResult<Vec<Book>> {
    check_paths(&paths)?;
    let hashed = tokio::task::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|p| Ok((compute_book_id(Path::new(&p))?, p)))
            .collect::<AppResult<Vec<_>>>()
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))??;
    let rows = state.with_db(|c| store_imports(c, &hashed))?;
    notify_changed(app);
    // Every added book is indexed for Ask in the background.
    crate::commands::rag::index_in_background(
        app,
        rows.iter()
            .map(|r| (r.id.clone(), r.path.clone()))
            .collect(),
    );
    let dir = state.thumb_dir();
    Ok(rows.into_iter().map(|r| to_book(r, &dir)).collect())
}

fn sample_path(app: &AppHandle) -> Option<PathBuf> {
    let rel = format!("sample/{SAMPLE}");
    let packaged = app
        .path()
        .resolve(&rel, tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists());
    packaged.or_else(|| {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../resources/sample")
            .join(SAMPLE);
        dev.exists().then_some(dev)
    })
}

fn set_flags(conn: &Connection, flags: &[&str]) -> AppResult<()> {
    for key in flags {
        conn.execute(
            "INSERT INTO settings (key, value_json) VALUES (?1, 'true')
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            [key],
        )?;
    }
    Ok(())
}

fn flag_is_true(conn: &Connection, key: &str) -> bool {
    let v: Option<String> = conn
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .ok();
    v.as_deref() == Some("true")
}

/// Runs once per install: a brand-new library gets the Welcome book and the tour; an
/// existing library is left alone, without the tour. `PAGETURN_SKIP_ONBOARDING=1` opts out.
/// Returns true when the Welcome book was imported.
fn first_run(conn: &Connection, sample: Option<PathBuf>, skip: bool) -> AppResult<bool> {
    if flag_is_true(conn, "sampleImported") {
        return Ok(false);
    }
    let fresh = list_rows(conn)?.is_empty();
    if skip || !fresh {
        set_flags(conn, &["sampleImported", "onboardingDone"])?;
        return Ok(false);
    }
    let mut imported = false;
    if let Some(file) = sample {
        match import_files_sync(conn, &[file.to_string_lossy().into_owned()]) {
            Ok(_) => imported = true,
            Err(e) => log::error!("Could not add the Welcome book: {e}"),
        }
    }
    set_flags(conn, &["sampleImported"])?;
    Ok(imported)
}

/// Port of `setUpFirstRun` (src/main/firstRun.ts). Call once at startup.
pub fn set_up_first_run(app: &AppHandle, state: &AppState) -> AppResult<()> {
    let skip = std::env::var("PAGETURN_SKIP_ONBOARDING").as_deref() == Ok("1");
    let sample = sample_path(app);
    let imported = state.with_db(|c| first_run(c, sample, skip))?;
    if imported {
        notify_changed(app);
    }
    Ok(())
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub async fn library_list(_app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<Book>> {
    let rows = state.with_db(list_rows)?;
    let dir = state.thumb_dir();
    Ok(rows.into_iter().map(|r| to_book(r, &dir)).collect())
}

#[tauri::command]
pub async fn library_import(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> AppResult<Vec<Book>> {
    import_paths(&app, &state, paths).await
}

/// Shows the PDF picker; returns the chosen paths (empty when cancelled).
async fn pick_pdfs(app: &AppHandle, title: Option<&'static str>, multiple: bool) -> Vec<String> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut dlg = app.dialog().file().add_filter("PDF", &["pdf"]);
        if let Some(t) = title {
            dlg = dlg.set_title(t);
        }
        if let Some(w) = app.get_webview_window("main") {
            dlg = dlg.set_parent(&w);
        }
        let picked = if multiple {
            dlg.blocking_pick_files().unwrap_or_default()
        } else {
            dlg.blocking_pick_file().into_iter().collect()
        };
        picked
            .into_iter()
            .filter_map(|f| f.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn library_open_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<Book>> {
    let paths = pick_pdfs(&app, None, true).await;
    if paths.is_empty() {
        return Ok(vec![]);
    }
    import_paths(&app, &state, paths).await
}

#[tauri::command]
pub async fn library_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    book_id: String,
    delete_annotations: bool,
) -> AppResult<()> {
    state.with_db(|c| remove_book(c, &book_id, delete_annotations))?;
    remove_thumbnail(&state.thumb_dir(), &book_id);
    notify_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn library_relocate(
    app: AppHandle,
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<Option<Book>> {
    let row = state.with_db(|c| require_book(c, &book_id))?;
    let Some(chosen) = pick_pdfs(&app, Some("Locate the moved PDF"), false)
        .await
        .into_iter()
        .next()
    else {
        return Ok(None);
    };
    let hashed = tokio::task::spawn_blocking({
        let chosen = chosen.clone();
        move || compute_book_id(Path::new(&chosen))
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))??;
    if hashed != row.id {
        let app2 = app.clone();
        let _ = tokio::task::spawn_blocking(move || {
            let mut dlg = app2
                .dialog()
                .message(
                    "That file is a different PDF.\n\nChoose the same document that was originally imported.",
                )
                .kind(MessageDialogKind::Warning);
            if let Some(w) = app2.get_webview_window("main") {
                dlg = dlg.parent(&w);
            }
            dlg.blocking_show()
        })
        .await;
        return Ok(None);
    }
    let row = state.with_db(|c| {
        set_path(c, &row.id, Path::new(&chosen))?;
        require_book(c, &row.id)
    })?;
    notify_changed(&app);
    Ok(Some(to_book(row, &state.thumb_dir())))
}

#[tauri::command]
pub async fn library_get_file(
    _app: AppHandle,
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<tauri::ipc::Response> {
    let row = state.with_db(|c| require_book(c, &book_id))?;
    match tokio::fs::read(&row.path).await {
        Ok(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(AppError::BookMissing(row.id)),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn library_save_thumbnail(
    _app: AppHandle,
    state: State<'_, AppState>,
    book_id: String,
    png_base64: String,
) -> AppResult<String> {
    let row = state.with_db(|c| require_book(c, &book_id))?;
    let dir = state.thumb_dir();
    tokio::task::spawn_blocking(move || write_thumbnail(&dir, &row.id, &png_base64))
        .await
        .map_err(|e| AppError::Msg(e.to_string()))?
}

#[tauri::command]
pub async fn library_update_meta(
    _app: AppHandle,
    state: State<'_, AppState>,
    book_id: String,
    meta: serde_json::Value,
) -> AppResult<()> {
    state.with_db(|c| update_meta(c, &book_id, &meta))
}

#[tauri::command]
pub async fn library_set_liked(
    _app: AppHandle,
    state: State<'_, AppState>,
    book_id: String,
    liked: bool,
) -> AppResult<()> {
    state.with_db(|c| set_liked(c, &book_id, liked))
}

#[tauri::command]
pub async fn reader_save_progress(
    _app: AppHandle,
    state: State<'_, AppState>,
    book_id: String,
    page: i64,
) -> AppResult<()> {
    state.with_db(|c| save_progress(c, &book_id, page))
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn pdf(dir: &Path, name: &str, body: &str) -> String {
        let p = dir.join(name);
        std::fs::write(&p, format!("%PDF-1.4 {body}")).unwrap();
        p.to_string_lossy().into_owned()
    }

    fn one(conn: &Connection, p: &str) -> BookRow {
        import_files_sync(conn, &[p.to_string()]).unwrap().remove(0)
    }

    #[test]
    fn hash_matches_sha256_of_content_plus_size() {
        let dir = tempfile::tempdir().unwrap();
        let p = pdf(dir.path(), "a.pdf", "hello");
        let content = std::fs::read(&p).unwrap();
        let mut h = Sha256::new();
        h.update(&content);
        h.update(content.len().to_string().as_bytes());
        assert_eq!(
            compute_book_id(Path::new(&p)).unwrap(),
            hex::encode(h.finalize())
        );
    }

    #[test]
    fn import_dedupes_by_content_and_rename_updates_path() {
        let conn = open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let a = pdf(dir.path(), "a.pdf", "same");
        let b = pdf(dir.path(), "b.pdf", "same");
        let rows = import_files_sync(&conn, &[a.clone(), b.clone()]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].path, b);
        assert_eq!(list_rows(&conn).unwrap().len(), 1);
        let c = pdf(dir.path(), "c.pdf", "same");
        assert_eq!(one(&conn, &c).path, c);
    }

    #[test]
    fn import_rejects_non_pdf_and_empty() {
        let conn = open_in_memory().unwrap();
        assert!(import_files_sync(&conn, &[]).is_err());
        assert!(import_files_sync(&conn, &["x.txt".into()]).is_err());
    }

    #[test]
    fn hide_keeps_annotations_and_reimport_restores_purge_deletes() {
        let conn = open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let p = pdf(dir.path(), "a.pdf", "one");
        let id = one(&conn, &p).id;
        conn.execute(
            "INSERT INTO notes (id, book_id, page, anchor_json, body, created_at, updated_at)
             VALUES ('n', ?1, 1, '{}', 'x', 1, 1)",
            [&id],
        )
        .unwrap();
        remove_book(&conn, &id, false).unwrap();
        assert!(list_rows(&conn).unwrap().is_empty());
        let notes = |c: &Connection| -> i64 {
            c.query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(notes(&conn), 1);
        one(&conn, &p);
        assert_eq!(list_rows(&conn).unwrap().len(), 1);
        remove_book(&conn, &id, true).unwrap();
        assert!(get_book_row(&conn, &id).unwrap().is_none());
        assert_eq!(notes(&conn), 0);
    }

    #[test]
    fn relocate_accepts_same_content_and_rejects_other() {
        let conn = open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let p = pdf(dir.path(), "a.pdf", "orig");
        let id = one(&conn, &p).id;
        let moved = pdf(dir.path(), "moved.pdf", "orig");
        assert_eq!(
            relocate_to(&conn, &id, Path::new(&moved)).unwrap(),
            Relocation::Ok
        );
        assert_eq!(get_book_row(&conn, &id).unwrap().unwrap().path, moved);
        let other = pdf(dir.path(), "other.pdf", "different");
        assert_eq!(
            relocate_to(&conn, &id, Path::new(&other)).unwrap(),
            Relocation::Mismatch
        );
        assert_eq!(get_book_row(&conn, &id).unwrap().unwrap().path, moved);
    }

    #[test]
    fn progress_liked_and_meta() {
        let conn = open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let id = one(&conn, &pdf(dir.path(), "a.pdf", "p")).id;
        save_progress(&conn, &id, 7).unwrap();
        let r = get_book_row(&conn, &id).unwrap().unwrap();
        assert_eq!(r.last_page, 7);
        assert!(r.last_opened_at.is_some());
        assert!(save_progress(&conn, &id, 0).is_err());
        assert!(save_progress(&conn, "nope", 1).is_err());

        set_liked(&conn, &id, true).unwrap();
        assert!(get_book_row(&conn, &id).unwrap().unwrap().liked);
        set_liked(&conn, &id, false).unwrap();
        assert!(!get_book_row(&conn, &id).unwrap().unwrap().liked);
        assert!(set_liked(&conn, &"a".repeat(64), true).is_err());

        update_meta(
            &conn,
            &id,
            &serde_json::json!({"title": "T", "author": "A", "numPages": 12}),
        )
        .unwrap();
        update_meta(
            &conn,
            &id,
            &serde_json::json!({"author": null, "numPages": 13}),
        )
        .unwrap();
        let r = get_book_row(&conn, &id).unwrap().unwrap();
        assert_eq!(
            (r.title.as_deref(), r.author, r.num_pages),
            (Some("T"), None, Some(13))
        );
        assert!(update_meta(&conn, &id, &serde_json::json!({"numPages": 0})).is_err());
    }

    #[test]
    fn thumbnail_is_written_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        let id = "a".repeat(64);
        let b64 = base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3]);
        let url = write_thumbnail(dir.path(), &id, &b64).unwrap();
        assert_eq!(url, format!("data:image/png;base64,{b64}"));
        assert_eq!(
            std::fs::read(thumbnail_path(dir.path(), &id)).unwrap(),
            vec![1, 2, 3]
        );
        remove_thumbnail(dir.path(), &id);
        assert!(!thumbnail_path(dir.path(), &id).exists());
        assert!(write_thumbnail(dir.path(), &id, "!!!").is_err());
    }

    #[test]
    fn first_run_imports_sample_once_and_skips_existing_libraries() {
        let dir = tempfile::tempdir().unwrap();
        let sample = pdf(dir.path(), SAMPLE, "welcome");
        let conn = open_in_memory().unwrap();
        assert!(first_run(&conn, Some(PathBuf::from(&sample)), false).unwrap());
        assert_eq!(list_rows(&conn).unwrap().len(), 1);
        assert!(flag_is_true(&conn, "sampleImported"));
        assert!(!flag_is_true(&conn, "onboardingDone"));
        assert!(!first_run(&conn, Some(PathBuf::from(&sample)), false).unwrap());

        let existing = open_in_memory().unwrap();
        one(&existing, &pdf(dir.path(), "x.pdf", "x"));
        assert!(!first_run(&existing, Some(PathBuf::from(&sample)), false).unwrap());
        assert!(flag_is_true(&existing, "onboardingDone"));
        assert_eq!(list_rows(&existing).unwrap().len(), 1);
    }
}
