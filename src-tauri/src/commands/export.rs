//! `export` commands: Markdown notes, JSON backup / import, daily backup, data folder.
//! Ports `src/main/ipc/export.ts`, `export/markdown.ts` and `export/backup.ts`.
//! The backup file format is shared with the Electron build: rows are stored as the database
//! has them (snake_case columns), ink strokes keep their blob as base64.

use crate::error::{AppError, AppResult};
use crate::models::{require_book, BookRow};
use crate::paths;
use crate::state::AppState;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub const BACKUP_VERSION: i64 = 1;
const VERSION_MSG: &str = "This backup was made by a newer version of PageTurn.";
const NOT_BACKUP_MSG: &str = "That file is not a PageTurn backup.";

// ---------------------------------------------------------------- markdown

struct MdHighlight {
    id: String,
    page: i64,
    text: String,
    color: String,
    note_id: Option<String>,
    created_at: i64,
}

struct MdNote {
    id: String,
    page: i64,
    highlight_id: Option<String>,
    body: String,
    created_at: i64,
}

struct MdBookmark {
    page: i64,
    label: Option<String>,
}

struct ExportInput {
    title: String,
    highlights: Vec<MdHighlight>,
    notes: Vec<MdNote>,
    ink_pages: Vec<i64>,
    bookmarks: Vec<MdBookmark>,
}

fn split_lines(text: &str) -> Vec<&str> {
    text.split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect()
}

/// Every line prefixed with "> " so multi-line passages stay one quote.
fn quote_block(text: &str) -> String {
    split_lines(text)
        .iter()
        .map(|l| format!("> {l}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn escape_line(l: &str) -> String {
    let rest = l.trim_start();
    let ws = &l[..l.len() - rest.len()];
    if let Some(c) = rest.chars().next() {
        if matches!(c, '#' | '>' | '+' | '-') {
            return format!("{ws}\\{rest}");
        }
    }
    let digits = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
    if digits > 0 && rest[digits..].starts_with('.') {
        return format!("{ws}{}\\.{}", &rest[..digits], &rest[digits + 1..]);
    }
    l.to_string()
}

/// Escapes Markdown block syntax at line starts so notes render as written.
fn escape_line_start(text: &str) -> String {
    split_lines(text)
        .iter()
        .map(|l| escape_line(l))
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_markdown(a: &ExportInput) -> String {
    let notes_by_id: HashMap<&str, &MdNote> = a.notes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut attached: HashSet<&str> = HashSet::new();
    for h in &a.highlights {
        if let Some(id) = &h.note_id {
            if !id.is_empty() {
                attached.insert(id.as_str());
            }
        }
    }
    for n in &a.notes {
        if n.highlight_id.as_deref().is_some_and(|s| !s.is_empty()) {
            attached.insert(n.id.as_str());
        }
    }

    let mut pages: BTreeSet<i64> = BTreeSet::new();
    pages.extend(a.highlights.iter().map(|h| h.page));
    pages.extend(
        a.notes
            .iter()
            .filter(|n| !attached.contains(n.id.as_str()))
            .map(|n| n.page),
    );
    pages.extend(a.bookmarks.iter().map(|b| b.page));
    pages.extend(a.ink_pages.iter().copied());
    if pages.is_empty() {
        return format!("# {}\n\n_No highlights or notes yet._\n", a.title);
    }

    let mut blocks: Vec<String> = vec![format!("# {}", a.title)];
    for page in pages {
        let mut parts: Vec<String> = Vec::new();
        for b in a.bookmarks.iter().filter(|b| b.page == page) {
            match b.label.as_deref().filter(|l| !l.is_empty()) {
                Some(l) => parts.push(format!("🔖 Bookmark: {}", escape_line_start(l))),
                None => parts.push("🔖 Bookmark".into()),
            }
        }
        let mut hls: Vec<&MdHighlight> = a.highlights.iter().filter(|h| h.page == page).collect();
        hls.sort_by_key(|h| h.created_at);
        for h in hls {
            parts.push(format!("{} — *{}*", quote_block(&h.text), h.color));
            let n = h
                .note_id
                .as_deref()
                .and_then(|id| notes_by_id.get(id).copied())
                .or_else(|| {
                    a.notes
                        .iter()
                        .find(|x| x.highlight_id.as_deref() == Some(h.id.as_str()))
                });
            if let Some(n) = n {
                if !n.body.trim().is_empty() {
                    parts.push(escape_line_start(n.body.trim()));
                }
            }
        }
        let mut free: Vec<&MdNote> = a
            .notes
            .iter()
            .filter(|n| {
                n.page == page && !attached.contains(n.id.as_str()) && !n.body.trim().is_empty()
            })
            .collect();
        free.sort_by_key(|n| n.created_at);
        for n in free {
            parts.push(format!("📝 {}", escape_line_start(n.body.trim())));
        }
        if a.ink_pages.contains(&page) {
            parts.push(format!("Page {page} — handwritten notes"));
        }
        if !parts.is_empty() {
            blocks.push(format!("## Page {page}"));
            blocks.extend(parts);
        }
    }
    format!("{}\n", blocks.join("\n\n"))
}

fn title_of(row: &BookRow) -> String {
    match row
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        Some(t) => t.to_string(),
        None => Path::new(&row.path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}

fn safe_file_name(s: &str) -> String {
    let mut out = String::new();
    let mut in_run = false;
    for c in s.chars() {
        if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            if !in_run {
                out.push(' ');
                in_run = true;
            }
        } else {
            in_run = false;
            out.push(c);
        }
    }
    let t = out.trim();
    if t.is_empty() {
        "notes".into()
    } else {
        t.to_string()
    }
}

/// (markdown, title) for a book.
fn markdown_for(conn: &Connection, book_id: &str) -> AppResult<(String, String)> {
    let row = require_book(conn, book_id)?;
    let title = title_of(&row);

    let highlights = conn
        .prepare("SELECT id, page, text, color, note_id, created_at FROM highlights WHERE book_id = ?1 ORDER BY page, created_at, rowid")?
        .query_map([book_id], |r| {
            Ok(MdHighlight {
                id: r.get(0)?,
                page: r.get(1)?,
                text: r.get(2)?,
                color: r.get(3)?,
                note_id: r.get(4)?,
                created_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let raw_notes = conn
        .prepare("SELECT id, page, anchor_json, body, created_at FROM notes WHERE book_id = ?1 ORDER BY page, created_at, rowid")?
        .query_map([book_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let notes = raw_notes
        .into_iter()
        .map(|(id, page, anchor, body, created_at)| {
            let highlight_id = serde_json::from_str::<Value>(&anchor).ok().and_then(|v| {
                v.get("highlightId")
                    .and_then(|h| h.as_str().map(String::from))
            });
            MdNote {
                id,
                page,
                highlight_id,
                body,
                created_at,
            }
        })
        .collect();

    let bookmarks = conn
        .prepare(
            "SELECT page, label FROM bookmarks WHERE book_id = ?1 ORDER BY page, created_at, rowid",
        )?
        .query_map([book_id], |r| {
            Ok(MdBookmark {
                page: r.get(0)?,
                label: r.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let ink_pages = conn
        .prepare("SELECT DISTINCT page FROM ink_strokes WHERE book_id = ?1")?
        .query_map([book_id], |r| r.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let md = render_markdown(&ExportInput {
        title: title.clone(),
        highlights,
        notes,
        ink_pages,
        bookmarks,
    });
    Ok((md, title))
}

// ---------------------------------------------------------------- backup

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupBook {
    pub id: String,
    pub path: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub num_pages: Option<i64>,
    pub last_page: Option<i64>,
    pub added_at: Option<i64>,
    pub last_opened_at: Option<i64>,
    #[serde(default)]
    pub removed_at: Option<i64>,
    #[serde(default)]
    pub liked: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupHighlight {
    pub id: String,
    pub book_id: String,
    pub page: i64,
    pub rects_json: String,
    pub text: String,
    pub color: String,
    #[serde(default)]
    pub style: Option<String>,
    pub note_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupNote {
    pub id: String,
    pub book_id: String,
    pub page: i64,
    pub anchor_json: String,
    pub body: String,
    #[serde(default)]
    pub tags_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupInk {
    pub id: String,
    pub book_id: String,
    pub page: i64,
    pub points_b64: String,
    pub color: String,
    pub width: f64,
    pub tool: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupBookmark {
    pub id: String,
    pub book_id: String,
    pub page: i64,
    pub label: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub version: i64,
    pub created_at: i64,
    pub books: Vec<BackupBook>,
    pub highlights: Vec<BackupHighlight>,
    pub notes: Vec<BackupNote>,
    pub ink: Vec<BackupInk>,
    pub bookmarks: Vec<BackupBookmark>,
    pub settings: serde_json::Map<String, Value>,
}

#[derive(Debug)]
enum BackupError {
    Version,
    Other(#[allow(dead_code)] String),
}

impl BackupError {
    fn message(&self) -> String {
        match self {
            BackupError::Version => VERSION_MSG.into(),
            BackupError::Other(_) => NOT_BACKUP_MSG.into(),
        }
    }
}

/// Everything in the library database. API keys are never in it.
fn create_backup(conn: &Connection) -> AppResult<Backup> {
    let mut settings = serde_json::Map::new();
    let mut st = conn.prepare("SELECT key, value_json FROM settings")?;
    for r in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = r?;
        settings.insert(k, serde_json::from_str(&v)?);
    }

    let books = conn
        .prepare("SELECT id, path, title, author, num_pages, last_page, added_at, last_opened_at, removed_at, liked FROM books")?
        .query_map([], |r| {
            Ok(BackupBook {
                id: r.get(0)?,
                path: r.get(1)?,
                title: r.get(2)?,
                author: r.get(3)?,
                num_pages: r.get(4)?,
                last_page: r.get(5)?,
                added_at: r.get(6)?,
                last_opened_at: r.get(7)?,
                removed_at: r.get(8)?,
                liked: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let highlights = conn
        .prepare("SELECT id, book_id, page, rects_json, text, color, style, note_id, created_at, updated_at FROM highlights")?
        .query_map([], |r| {
            Ok(BackupHighlight {
                id: r.get(0)?,
                book_id: r.get(1)?,
                page: r.get(2)?,
                rects_json: r.get(3)?,
                text: r.get(4)?,
                color: r.get(5)?,
                style: r.get(6)?,
                note_id: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let notes = conn
        .prepare("SELECT id, book_id, page, anchor_json, body, tags_json, created_at, updated_at FROM notes")?
        .query_map([], |r| {
            Ok(BackupNote {
                id: r.get(0)?,
                book_id: r.get(1)?,
                page: r.get(2)?,
                anchor_json: r.get(3)?,
                body: r.get(4)?,
                tags_json: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let b64 = base64::engine::general_purpose::STANDARD;
    let ink = conn
        .prepare("SELECT id, book_id, page, points_blob, color, width, tool, created_at FROM ink_strokes")?
        .query_map([], |r| {
            let blob: Vec<u8> = r.get(3)?;
            Ok(BackupInk {
                id: r.get(0)?,
                book_id: r.get(1)?,
                page: r.get(2)?,
                points_b64: b64.encode(blob),
                color: r.get(4)?,
                width: r.get(5)?,
                tool: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let bookmarks = conn
        .prepare("SELECT id, book_id, page, label, created_at FROM bookmarks")?
        .query_map([], |r| {
            Ok(BackupBookmark {
                id: r.get(0)?,
                book_id: r.get(1)?,
                page: r.get(2)?,
                label: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Backup {
        version: BACKUP_VERSION,
        created_at: crate::models::now_ms(),
        books,
        highlights,
        notes,
        ink,
        bookmarks,
        settings,
    })
}

/// Validates a backup file. A version this app does not know is refused.
fn parse_backup(json: &str) -> Result<Backup, BackupError> {
    let raw: Value = serde_json::from_str(json).map_err(|e| BackupError::Other(e.to_string()))?;
    if raw.get("version").and_then(Value::as_i64) != Some(BACKUP_VERSION) {
        return Err(BackupError::Version);
    }
    serde_json::from_value(raw).map_err(|e| BackupError::Other(e.to_string()))
}

/// JSON text like JS `JSON.stringify(v, null, 1)` (pretty) or `JSON.stringify(v)`.
fn to_json(b: &Backup, pretty: bool) -> AppResult<String> {
    if !pretty {
        return Ok(serde_json::to_string(b)?);
    }
    let mut buf = Vec::new();
    let fmt = serde_json::ser::PrettyFormatter::with_indent(b" ");
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, fmt);
    b.serialize(&mut ser)?;
    String::from_utf8(buf).map_err(|e| AppError::Msg(e.to_string()))
}

#[derive(Debug, Default, Serialize, PartialEq)]
pub struct MergeResult {
    pub added: i64,
    pub updated: i64,
    pub skipped: i64,
}

fn exists(conn: &Connection, table: &str, id: &str) -> rusqlite::Result<Option<i64>> {
    let col = if table == "highlights" || table == "notes" {
        "updated_at"
    } else {
        "0"
    };
    conn.query_row(
        &format!("SELECT {col} AS ts FROM {table} WHERE id = ?1"),
        [id],
        |r| r.get(0),
    )
    .optional()
}

/// Merges a backup into the library in one transaction. Rows are matched by id; an existing
/// highlight or note is replaced only when the backup's copy was updated more recently.
fn merge_backup(conn: &Connection, b: &Backup) -> rusqlite::Result<MergeResult> {
    let mut m = MergeResult::default();
    let tx = conn.unchecked_transaction()?;

    for r in &b.books {
        let cur: Option<Option<i64>> = tx
            .query_row(
                "SELECT last_opened_at FROM books WHERE id = ?1",
                [&r.id],
                |x| x.get(0),
            )
            .optional()?;
        match cur {
            None => {
                tx.execute(
                    "INSERT INTO books (id, path, title, author, num_pages, last_page, added_at, last_opened_at, removed_at, liked)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        r.id,
                        r.path,
                        r.title,
                        r.author,
                        r.num_pages,
                        r.last_page,
                        r.added_at,
                        r.last_opened_at,
                        r.removed_at,
                        r.liked.unwrap_or(0)
                    ],
                )?;
                m.added += 1;
            }
            Some(cur_opened) => {
                if r.last_opened_at.unwrap_or(0) > cur_opened.unwrap_or(0) {
                    tx.execute(
                        "UPDATE books SET last_page = ?1, last_opened_at = ?2 WHERE id = ?3",
                        params![r.last_page, r.last_opened_at, r.id],
                    )?;
                    m.updated += 1;
                } else {
                    m.skipped += 1;
                }
            }
        }
    }

    for r in &b.highlights {
        let insert = |tx: &Connection| {
            tx.execute(
                "INSERT INTO highlights (id, book_id, page, rects_json, text, color, style, note_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    r.id,
                    r.book_id,
                    r.page,
                    r.rects_json,
                    r.text,
                    r.color,
                    r.style.as_deref().unwrap_or("highlight"),
                    r.note_id,
                    r.created_at,
                    r.updated_at
                ],
            )
        };
        match exists(&tx, "highlights", &r.id)? {
            None => {
                insert(&tx)?;
                m.added += 1;
            }
            Some(ts) if r.updated_at > ts => {
                tx.execute("DELETE FROM highlights WHERE id = ?1", [&r.id])?;
                insert(&tx)?;
                m.updated += 1;
            }
            Some(_) => m.skipped += 1,
        }
    }

    for r in &b.notes {
        let insert = |tx: &Connection| {
            tx.execute(
                "INSERT INTO notes (id, book_id, page, anchor_json, body, tags_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    r.id,
                    r.book_id,
                    r.page,
                    r.anchor_json,
                    r.body,
                    r.tags_json.as_deref().unwrap_or("[]"),
                    r.created_at,
                    r.updated_at
                ],
            )
        };
        match exists(&tx, "notes", &r.id)? {
            None => {
                insert(&tx)?;
                m.added += 1;
            }
            Some(ts) if r.updated_at > ts => {
                tx.execute("DELETE FROM notes WHERE id = ?1", [&r.id])?;
                insert(&tx)?;
                m.updated += 1;
            }
            Some(_) => m.skipped += 1,
        }
    }

    // Strokes and bookmarks never change once made: add the missing ones.
    let b64 = base64::engine::general_purpose::STANDARD;
    for r in &b.ink {
        if exists(&tx, "ink_strokes", &r.id)?.is_some() {
            m.skipped += 1;
            continue;
        }
        let blob = b64
            .decode(&r.points_b64)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        tx.execute(
            "INSERT INTO ink_strokes (id, book_id, page, points_blob, color, width, tool, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![r.id, r.book_id, r.page, blob, r.color, r.width, r.tool, r.created_at],
        )?;
        m.added += 1;
    }
    for r in &b.bookmarks {
        if exists(&tx, "bookmarks", &r.id)?.is_some() {
            m.skipped += 1;
            continue;
        }
        tx.execute(
            "INSERT INTO bookmarks (id, book_id, page, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![r.id, r.book_id, r.page, r.label, r.created_at],
        )?;
        m.added += 1;
    }

    // Preferences: fill in what this install has not set; never overwrite current choices.
    for (k, v) in &b.settings {
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value_json) VALUES (?1, ?2)",
            params![
                k,
                serde_json::to_string(v).unwrap_or_else(|_| "null".into())
            ],
        )?;
    }
    tx.commit()?;
    Ok(m)
}

fn import_backup_file(conn: &Connection, path: &Path) -> Result<MergeResult, String> {
    let run = || -> Result<MergeResult, BackupError> {
        let text = std::fs::read_to_string(path).map_err(|e| BackupError::Other(e.to_string()))?;
        let backup = parse_backup(&text)?;
        merge_backup(conn, &backup).map_err(|e| BackupError::Other(e.to_string()))
    };
    run().map_err(|e| e.message())
}

// ---------------------------------------------------------------- daily backup

fn is_backup_file(name: &str) -> bool {
    // pageturn-YYYY-MM-DD.json
    let b = name.as_bytes();
    b.len() == 24
        && name.starts_with("pageturn-")
        && name.ends_with(".json")
        && b[9..13].iter().all(u8::is_ascii_digit)
        && b[13] == b'-'
        && b[14..16].iter().all(u8::is_ascii_digit)
        && b[16] == b'-'
        && b[17..19].iter().all(u8::is_ascii_digit)
}

/// Deletes the oldest dated backups beyond `keep`. Other files are left alone.
fn rotate_backups(dir: &Path, keep: usize) -> std::io::Result<()> {
    let mut files: Vec<String> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|f| is_backup_file(f))
        .collect();
    files.sort();
    let extra = files.len().saturating_sub(keep);
    for f in files.iter().take(extra) {
        std::fs::remove_file(dir.join(f))?;
    }
    Ok(())
}

/// Writes today's backup (pageturn-YYYY-MM-DD.json) if there is none yet. Returns whether it wrote.
fn write_daily_backup(conn: &Connection, dir: &Path, day: &str) -> AppResult<bool> {
    std::fs::create_dir_all(dir)?;
    let file = dir.join(format!("pageturn-{day}.json"));
    if file.exists() {
        return Ok(false);
    }
    std::fs::write(&file, to_json(&create_backup(conn)?, false)?)?;
    rotate_backups(dir, 7)?;
    Ok(true)
}

/// Daily JSON backup into `<data>/backups`, keeping the last 7. Runs once now, then every 24 h
/// on its own thread with its OWN database connection, so the app's mutex is never held.
#[allow(dead_code)] // called from lib.rs setup by the integrator
pub fn schedule_daily_backup(data_dir: PathBuf) {
    std::thread::spawn(move || loop {
        let run = || -> AppResult<()> {
            let conn = Connection::open(paths::db_path(&data_dir))?;
            conn.busy_timeout(std::time::Duration::from_secs(5))?;
            let day = chrono::Local::now().format("%Y-%m-%d").to_string();
            write_daily_backup(&conn, &paths::backups_dir(&data_dir), &day)?;
            Ok(())
        };
        if let Err(e) = run() {
            log::error!("Daily backup failed: {e}");
        }
        std::thread::sleep(std::time::Duration::from_secs(24 * 3600));
    });
}

// ---------------------------------------------------------------- commands

/// Where to save: PAGETURN_SAVE_PATH (tests, scripts) or the dialog's choice. None if cancelled.
async fn choose_save_path(
    app: &AppHandle,
    default_name: String,
    filter_name: &'static str,
    ext: &'static str,
) -> AppResult<Option<PathBuf>> {
    if let Ok(p) = std::env::var("PAGETURN_SAVE_PATH") {
        if !p.is_empty() {
            return Ok(Some(PathBuf::from(p)));
        }
    }
    let app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(default_name)
            .add_filter(filter_name, &[ext])
            .blocking_save_file()
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?;
    match picked {
        Some(p) => Ok(Some(
            p.into_path().map_err(|e| AppError::Msg(e.to_string()))?,
        )),
        None => Ok(None),
    }
}

async fn choose_open_path(app: &AppHandle) -> AppResult<Option<PathBuf>> {
    for var in ["PAGETURN_OPEN_PATH", "PAGETURN_SAVE_PATH"] {
        if let Ok(p) = std::env::var(var) {
            if !p.is_empty() {
                return Ok(Some(PathBuf::from(p)));
            }
        }
    }
    let app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("PageTurn backup", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?;
    match picked {
        Some(p) => Ok(Some(
            p.into_path().map_err(|e| AppError::Msg(e.to_string()))?,
        )),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn export_markdown(
    app: AppHandle,
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<Value> {
    let (md, title) = state.with_db(|c| markdown_for(c, &book_id))?;
    let name = format!("{}-notes.md", safe_file_name(&title));
    let Some(path) = choose_save_path(&app, name, "Markdown", "md").await? else {
        return Ok(serde_json::json!({ "saved": false }));
    };
    std::fs::write(&path, md)?;
    Ok(serde_json::json!({ "saved": true, "path": path.to_string_lossy() }))
}

#[tauri::command]
pub async fn export_markdown_text(
    _app: AppHandle,
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<String> {
    state
        .with_db(|c| markdown_for(c, &book_id))
        .map(|(md, _)| md)
}

#[tauri::command]
pub async fn export_backup(app: AppHandle, state: State<'_, AppState>) -> AppResult<Value> {
    let name = format!(
        "pageturn-backup-{}.json",
        chrono::Utc::now().format("%Y-%m-%d")
    );
    let Some(path) = choose_save_path(&app, name, "PageTurn backup", "json").await? else {
        return Ok(serde_json::json!({ "saved": false }));
    };
    let json = state.with_db(|c| to_json(&create_backup(c)?, true))?;
    std::fs::write(&path, json)?;
    Ok(serde_json::json!({ "saved": true, "path": path.to_string_lossy() }))
}

#[tauri::command]
pub async fn export_import_backup(app: AppHandle, state: State<'_, AppState>) -> AppResult<Value> {
    let Some(path) = choose_open_path(&app).await? else {
        return Ok(serde_json::json!({ "error": "cancelled" }));
    };
    match state.with_db(|c| Ok(import_backup_file(c, &path)))? {
        Ok(r) => {
            let _ = app.emit("library:changed", ());
            Ok(serde_json::to_value(r)?)
        }
        Err(msg) => Ok(serde_json::json!({ "error": msg })),
    }
}

#[tauri::command]
pub async fn export_open_data_folder(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    app.opener()
        .open_path(state.data_dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Msg(e.to_string()))
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn hl(
        id: &str,
        page: i64,
        text: &str,
        color: &str,
        note: Option<&str>,
        at: i64,
    ) -> MdHighlight {
        MdHighlight {
            id: id.into(),
            page,
            text: text.into(),
            color: color.into(),
            note_id: note.map(Into::into),
            created_at: at,
        }
    }
    fn note(id: &str, page: i64, hid: Option<&str>, body: &str) -> MdNote {
        MdNote {
            id: id.into(),
            page,
            highlight_id: hid.map(Into::into),
            body: body.into(),
            created_at: 1,
        }
    }
    fn input() -> ExportInput {
        ExportInput {
            title: "My Book".into(),
            highlights: vec![],
            notes: vec![],
            ink_pages: vec![],
            bookmarks: vec![],
        }
    }

    #[test]
    fn empty_book_says_so() {
        assert_eq!(
            render_markdown(&input()),
            "# My Book\n\n_No highlights or notes yet._\n"
        );
    }

    #[test]
    fn renders_pages_in_order() {
        let mut i = input();
        i.highlights = vec![
            hl("h2", 3, "second on page", "blue", None, 5),
            hl("h1", 3, "first on page", "yellow", Some("n1"), 2),
        ];
        i.notes = vec![
            note("n1", 3, Some("h1"), "why this matters"),
            note("n2", 7, None, "free note"),
        ];
        i.bookmarks = vec![MdBookmark {
            page: 7,
            label: Some("Proof".into()),
        }];
        i.ink_pages = vec![7];
        assert_eq!(
            render_markdown(&i),
            "# My Book\n\n## Page 3\n\n> first on page — *yellow*\n\nwhy this matters\n\n> second on page — *blue*\n\n## Page 7\n\n🔖 Bookmark: Proof\n\n📝 free note\n\nPage 7 — handwritten notes\n"
        );
    }

    #[test]
    fn multiline_quotes_and_escapes_and_numeric_page_order() {
        let mut i = input();
        i.highlights = vec![hl("h1", 3, "line one\nline two", "yellow", Some("n1"), 1)];
        i.notes = vec![note("n1", 3, Some("h1"), "# not heading\n> not quote")];
        let md = render_markdown(&i);
        assert!(md.contains("> line one\n> line two — *yellow*"));
        assert!(md.contains("\\# not heading\n\\> not quote"));

        let mut j = input();
        j.highlights = vec![
            hl("a", 10, "x", "yellow", None, 1),
            hl("b", 9, "y", "yellow", None, 1),
        ];
        let md = render_markdown(&j);
        assert!(md.find("## Page 9").unwrap() < md.find("## Page 10").unwrap());
    }

    #[test]
    fn helpers() {
        assert_eq!(quote_block("a\nb"), "> a\n> b");
        assert_eq!(
            escape_line_start("# h\n- item\n+ plus\n1. one\nmid # ok"),
            "\\# h\n\\- item\n\\+ plus\n1\\. one\nmid # ok"
        );
        assert_eq!(safe_file_name("A: B/C"), "A  B C");
        assert_eq!(safe_file_name("???"), "notes");
    }

    fn seed(conn: &Connection) {
        conn.execute_batch(&format!(
            "INSERT INTO books (id, path, title, added_at, last_page, last_opened_at) VALUES ('{B}', 'C:/x/book.pdf', NULL, 1, 4, 100);
             INSERT INTO highlights (id, book_id, page, rects_json, text, color, note_id, created_at, updated_at)
               VALUES ('h1', '{B}', 3, '[]', 'quoted', 'yellow', NULL, 1, 10);
             INSERT INTO notes (id, book_id, page, anchor_json, body, created_at, updated_at)
               VALUES ('n1', '{B}', 3, '{{\"highlightId\":\"h1\"}}', 'my note', 1, 10);
             INSERT INTO bookmarks (id, book_id, page, label, created_at) VALUES ('m1', '{B}', 2, NULL, 1);
             INSERT INTO settings (key, value_json) VALUES ('theme', '\"dark\"');"
        ))
        .unwrap();
        conn.execute(
            "INSERT INTO ink_strokes (id, book_id, page, points_blob, color, width, tool, created_at)
             VALUES ('s1', ?1, 5, ?2, '#1f1f1f', 0.005, 'pen', 1)",
            params![B, vec![0u8, 1, 2, 255, 128]],
        )
        .unwrap();
    }

    #[test]
    fn markdown_for_uses_filename_title_and_db_rows() {
        let conn = open_in_memory().unwrap();
        seed(&conn);
        let (md, title) = markdown_for(&conn, B).unwrap();
        assert_eq!(title, "book");
        assert!(md.contains("## Page 2\n\n🔖 Bookmark"));
        assert!(md.contains("> quoted — *yellow*\n\nmy note"));
        assert!(md.contains("Page 5 — handwritten notes"));
    }

    /// Shaped exactly as backup.ts writes it (JSON.stringify(createBackup(db), null, 1)).
    const TS_FIXTURE: &str = r##"{
 "version": 1,
 "createdAt": 1700000000000,
 "books": [
  {
   "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
   "path": "C:\\Books\\a.pdf",
   "title": "A",
   "author": null,
   "num_pages": 10,
   "last_page": 3,
   "added_at": 1,
   "last_opened_at": 50,
   "removed_at": null,
   "liked": 1
  }
 ],
 "highlights": [
  {
   "id": "h1",
   "book_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
   "page": 2,
   "rects_json": "[{\"x\":0.1,\"y\":0.2,\"w\":0.3,\"h\":0.04}]",
   "text": "hello",
   "color": "green",
   "style": "underline",
   "note_id": null,
   "created_at": 5,
   "updated_at": 6
  }
 ],
 "notes": [
  {
   "id": "n1",
   "book_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
   "page": 2,
   "anchor_json": "{\"highlightId\":\"h1\"}",
   "body": "note",
   "tags_json": "[]",
   "created_at": 5,
   "updated_at": 6
  }
 ],
 "ink": [
  {
   "id": "s1",
   "book_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
   "page": 1,
   "points_b64": "AAEC/4A=",
   "color": "#d0342c",
   "width": 0.005,
   "tool": "pen",
   "created_at": 7
  }
 ],
 "bookmarks": [
  {
   "id": "m1",
   "book_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
   "page": 4,
   "label": "Proof",
   "created_at": 8
  }
 ],
 "settings": {
  "theme": "dark",
  "penWidth": 0.005
 }
}"##;

    fn import_text(conn: &Connection, text: &str) -> Result<MergeResult, String> {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("b.json");
        std::fs::write(&p, text).unwrap();
        import_backup_file(conn, &p)
    }

    #[test]
    fn imports_a_backup_written_by_the_typescript_build() {
        let conn = open_in_memory().unwrap();
        let b = parse_backup(TS_FIXTURE).unwrap();
        let r = merge_backup(&conn, &b).unwrap();
        assert_eq!(
            r,
            MergeResult {
                added: 5,
                updated: 0,
                skipped: 0
            }
        );
        let blob: Vec<u8> = conn
            .query_row(
                "SELECT points_blob FROM ink_strokes WHERE id='s1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(blob, vec![0, 1, 2, 255, 128]);
        let style: String = conn
            .query_row("SELECT style FROM highlights WHERE id='h1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(style, "underline");
        let theme: String = conn
            .query_row(
                "SELECT value_json FROM settings WHERE key='theme'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(theme, "\"dark\"");
        let r2 = merge_backup(&conn, &b).unwrap();
        assert_eq!(
            r2,
            MergeResult {
                added: 0,
                updated: 0,
                skipped: 5
            }
        );
    }

    #[test]
    fn backup_roundtrip_is_exact_and_has_ts_keys() {
        let a = open_in_memory().unwrap();
        seed(&a);
        let backup = create_backup(&a).unwrap();
        let text = to_json(&backup, true).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        for k in [
            "version",
            "createdAt",
            "books",
            "highlights",
            "notes",
            "ink",
            "bookmarks",
            "settings",
        ] {
            assert!(v.get(k).is_some(), "missing {k}");
        }
        assert_eq!(v["ink"][0]["points_b64"], "AAEC/4A=");
        assert_eq!(v["settings"]["theme"], "dark");
        assert!(text.starts_with("{\n \"version\": 1,"));

        let b = open_in_memory().unwrap();
        let r = import_text(&b, &text).unwrap();
        assert_eq!(r.added, 5);
        let again = create_backup(&b).unwrap();
        assert_eq!(again.ink, backup.ink);
        assert_eq!(again.highlights, backup.highlights);
        assert_eq!(again.books, backup.books);
        assert_eq!(again.settings, backup.settings);
    }

    #[test]
    fn newer_copies_win_and_settings_are_not_overwritten() {
        let conn = open_in_memory().unwrap();
        let mut b = parse_backup(TS_FIXTURE).unwrap();
        merge_backup(&conn, &b).unwrap();
        conn.execute(
            "UPDATE settings SET value_json='\"light\"' WHERE key='theme'",
            [],
        )
        .unwrap();
        b.highlights[0].text = "newer".into();
        b.highlights[0].updated_at = 99;
        b.notes[0].updated_at = 1; // older: skipped
        b.books[0].last_opened_at = Some(500);
        b.books[0].last_page = Some(9);
        let r = merge_backup(&conn, &b).unwrap();
        assert_eq!(
            r,
            MergeResult {
                added: 0,
                updated: 2,
                skipped: 3
            }
        );
        let text: String = conn
            .query_row("SELECT text FROM highlights WHERE id='h1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(text, "newer");
        let lp: i64 = conn
            .query_row("SELECT last_page FROM books WHERE id=?1", [B], |r| r.get(0))
            .unwrap();
        assert_eq!(lp, 9);
        let theme: String = conn
            .query_row(
                "SELECT value_json FROM settings WHERE key='theme'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(theme, "\"light\"");
    }

    #[test]
    fn rejects_bad_files_and_newer_versions() {
        let conn = open_in_memory().unwrap();
        assert_eq!(import_text(&conn, "not json").unwrap_err(), NOT_BACKUP_MSG);
        assert_eq!(
            import_text(&conn, r#"{"version":2}"#).unwrap_err(),
            VERSION_MSG
        );
        assert_eq!(
            import_text(&conn, r#"{"version":1,"books":5}"#).unwrap_err(),
            NOT_BACKUP_MSG
        );
    }

    #[test]
    fn rotation_keeps_the_newest_seven_and_other_files() {
        let dir = tempfile::tempdir().unwrap();
        for d in 1..=9 {
            std::fs::write(dir.path().join(format!("pageturn-2025-01-0{d}.json")), "{}").unwrap();
        }
        std::fs::write(dir.path().join("notes.txt"), "x").unwrap();
        rotate_backups(dir.path(), 7).unwrap();
        let mut names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(names.len(), 8);
        assert!(!names.contains(&"pageturn-2025-01-01.json".to_string()));
        assert!(names.contains(&"notes.txt".to_string()));
    }

    #[test]
    fn daily_backup_writes_once_per_day() {
        let conn = open_in_memory().unwrap();
        seed(&conn);
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("backups");
        assert!(write_daily_backup(&conn, &sub, "2025-02-03").unwrap());
        assert!(!write_daily_backup(&conn, &sub, "2025-02-03").unwrap());
        let text = std::fs::read_to_string(sub.join("pageturn-2025-02-03.json")).unwrap();
        assert!(parse_backup(&text).is_ok());
    }
}
