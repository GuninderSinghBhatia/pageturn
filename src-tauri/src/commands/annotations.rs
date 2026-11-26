//! `annotations` commands: highlights, notes, bookmarks and ink strokes.
//! Port of `src/main/ipc/annotations.ts` and the annotations / ink repositories. The database
//! layout is shared with PageTurn 1.x, so JSON columns and the ink blob are byte-compatible.
//! The logic lives in plain functions over `&Connection` (tests use `db::open_in_memory`).
use crate::error::{invalid, AppResult};
use crate::models::{check_book_id, check_uuid, now_ms, require_book, to_book, Book, BOOK_COLUMNS};
use crate::state::AppState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

const NOTE_TAGS: [&str; 3] = ["important", "idea", "review"];
const HIGHLIGHT_COLORS: [&str; 5] = ["yellow", "green", "blue", "pink", "purple"];
const HIGHLIGHT_STYLES: [&str; 4] = ["highlight", "underline", "wavy", "note"];
const INK_COLORS: [&str; 6] = [
    "#1f1f1f", "#d0342c", "#2a62c9", "#2e8b57", "#e07b00", "#7b3fb5",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Highlight {
    pub id: String,
    pub book_id: String,
    pub page: i64,
    pub rects: Vec<Rect>,
    pub text: String,
    pub color: String,
    pub style: String,
    pub note_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Anchor {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub point: Option<Point>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Note {
    pub id: String,
    pub book_id: String,
    pub page: i64,
    pub anchor: Anchor,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InkStroke {
    pub id: String,
    pub book_id: String,
    pub page: i64,
    pub points: Vec<[f64; 3]>,
    pub color: String,
    pub width: f64,
    pub tool: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub book_id: String,
    pub page: i64,
    pub label: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookAnnotations {
    pub highlights: Vec<Highlight>,
    pub notes: Vec<Note>,
    pub bookmarks: Vec<Bookmark>,
    pub ink: Vec<InkStroke>,
}

#[derive(Debug, Serialize)]
pub struct NoteWithQuote {
    pub note: Note,
    pub quote: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct NotesGroup {
    pub book: Book,
    pub notes: Vec<NoteWithQuote>,
}

// ---- validation (the zod schemas in shared/ipc.ts) ----

fn unit(v: f64, what: &str) -> AppResult<()> {
    if (-0.05..=1.05).contains(&v) {
        Ok(())
    } else {
        Err(invalid(what))
    }
}

fn check_page(page: i64) -> AppResult<()> {
    if page >= 1 {
        Ok(())
    } else {
        Err(invalid("page"))
    }
}

fn check_time(t: i64) -> AppResult<()> {
    if t >= 0 {
        Ok(())
    } else {
        Err(invalid("timestamp"))
    }
}

fn check_label(label: &Option<String>) -> AppResult<()> {
    match label {
        Some(l) if l.encode_utf16().count() > 200 => Err(invalid("bookmark label")),
        _ => Ok(()),
    }
}

fn check_tags(tags: &[String]) -> AppResult<()> {
    if tags.len() > 3 || tags.iter().any(|t| !NOTE_TAGS.contains(&t.as_str())) {
        return Err(invalid("tags"));
    }
    Ok(())
}

fn validate_highlight(h: &Highlight) -> AppResult<()> {
    check_uuid(&h.id)?;
    check_book_id(&h.book_id)?;
    check_page(h.page)?;
    if h.rects.is_empty() || h.rects.len() > 500 {
        return Err(invalid("rects"));
    }
    for r in &h.rects {
        unit(r.x, "rect")?;
        unit(r.y, "rect")?;
        if !(0.0..=1.1).contains(&r.w) || !(0.0..=1.1).contains(&r.h) {
            return Err(invalid("rect"));
        }
    }
    if h.text.encode_utf16().count() > 20_000 {
        return Err(invalid("text"));
    }
    if !HIGHLIGHT_COLORS.contains(&h.color.as_str()) {
        return Err(invalid("color"));
    }
    if !HIGHLIGHT_STYLES.contains(&h.style.as_str()) {
        return Err(invalid("style"));
    }
    if let Some(n) = &h.note_id {
        check_uuid(n)?;
    }
    check_time(h.created_at)?;
    check_time(h.updated_at)
}

fn validate_note(n: &Note) -> AppResult<()> {
    check_uuid(&n.id)?;
    check_book_id(&n.book_id)?;
    check_page(n.page)?;
    if let Some(id) = &n.anchor.highlight_id {
        check_uuid(id)?;
    }
    if let Some(p) = &n.anchor.point {
        unit(p.x, "anchor")?;
        unit(p.y, "anchor")?;
    }
    if n.body.encode_utf16().count() > 100_000 {
        return Err(invalid("body"));
    }
    if let Some(t) = &n.tags {
        check_tags(t)?;
    }
    check_time(n.created_at)?;
    check_time(n.updated_at)
}

fn validate_ink(s: &InkStroke) -> AppResult<()> {
    check_uuid(&s.id)?;
    check_book_id(&s.book_id)?;
    check_page(s.page)?;
    if s.points.is_empty() || s.points.len() > 20_000 {
        return Err(invalid("points"));
    }
    for [x, y, p] in &s.points {
        unit(*x, "point")?;
        unit(*y, "point")?;
        if !(0.0..=1.0).contains(p) {
            return Err(invalid("pressure"));
        }
    }
    if !INK_COLORS.contains(&s.color.as_str()) {
        return Err(invalid("ink color"));
    }
    if !(s.width > 0.0 && s.width <= 0.1) {
        return Err(invalid("ink width"));
    }
    if s.tool != "pen" && s.tool != "highlighter" {
        return Err(invalid("ink tool"));
    }
    check_time(s.created_at)
}

// ---- ink blob: packed little-endian f32 [x, y, p, ...] (a JS Float32Array's bytes) ----

pub fn pack_points(points: &[[f64; 3]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(points.len() * 12);
    for p in points {
        for v in p {
            out.extend_from_slice(&(*v as f32).to_le_bytes());
        }
    }
    out
}

pub fn unpack_points(blob: &[u8]) -> Vec<[f64; 3]> {
    let floats: Vec<f32> = blob
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    floats
        .chunks_exact(3)
        .map(|c| [c[0] as f64, c[1] as f64, c[2] as f64])
        .collect()
}

// ---- row mapping ----

fn json_err(e: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
}

fn highlight_from_row(r: &rusqlite::Row) -> rusqlite::Result<Highlight> {
    let rects: String = r.get("rects_json")?;
    Ok(Highlight {
        id: r.get("id")?,
        book_id: r.get("book_id")?,
        page: r.get("page")?,
        rects: serde_json::from_str(&rects).map_err(json_err)?,
        text: r.get("text")?,
        color: r.get("color")?,
        style: r
            .get::<_, Option<String>>("style")?
            .unwrap_or_else(|| "highlight".into()),
        note_id: r.get("note_id")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn note_from_row(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    let anchor: String = r.get("anchor_json")?;
    let tags: Option<String> = r.get("tags_json")?;
    let tags: Vec<String> = match tags.as_deref() {
        Some(t) if !t.is_empty() => serde_json::from_str(t).map_err(json_err)?,
        _ => Vec::new(),
    };
    Ok(Note {
        id: r.get("id")?,
        book_id: r.get("book_id")?,
        page: r.get("page")?,
        anchor: serde_json::from_str(&anchor).map_err(json_err)?,
        body: r.get("body")?,
        tags: Some(tags),
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn bookmark_from_row(r: &rusqlite::Row) -> rusqlite::Result<Bookmark> {
    Ok(Bookmark {
        id: r.get("id")?,
        book_id: r.get("book_id")?,
        page: r.get("page")?,
        label: r.get("label")?,
        created_at: r.get("created_at")?,
    })
}

// ---- logic ----

pub fn list_for_book(conn: &Connection, book_id: &str) -> AppResult<BookAnnotations> {
    check_book_id(book_id)?;
    let q =
        |table: &str| format!("SELECT * FROM {table} WHERE book_id = ?1 ORDER BY page, created_at");
    let highlights = conn
        .prepare(&q("highlights"))?
        .query_map([book_id], highlight_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let notes = conn
        .prepare(&q("notes"))?
        .query_map([book_id], note_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let bookmarks = conn
        .prepare(&q("bookmarks"))?
        .query_map([book_id], bookmark_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let ink = conn
        .prepare(&q("ink_strokes"))?
        .query_map([book_id], |r| {
            let blob: Vec<u8> = r.get("points_blob")?;
            Ok(InkStroke {
                id: r.get("id")?,
                book_id: r.get("book_id")?,
                page: r.get("page")?,
                points: unpack_points(&blob),
                color: r.get("color")?,
                width: r.get("width")?,
                tool: r.get("tool")?,
                created_at: r.get("created_at")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(BookAnnotations {
        highlights,
        notes,
        bookmarks,
        ink,
    })
}

pub fn upsert_highlight(conn: &Connection, h: &Highlight) -> AppResult<()> {
    validate_highlight(h)?;
    require_book(conn, &h.book_id)?;
    let rects = serde_json::to_string(&h.rects)?;
    conn.execute(
        "INSERT INTO highlights (id, book_id, page, rects_json, text, color, style, note_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET rects_json = excluded.rects_json, text = excluded.text,
           color = excluded.color, style = excluded.style, note_id = excluded.note_id, updated_at = excluded.updated_at",
        params![h.id, h.book_id, h.page, rects, h.text, h.color, h.style, h.note_id, h.created_at, h.updated_at],
    )?;
    Ok(())
}

/// Deletes a highlight together with its note.
pub fn delete_highlight(conn: &Connection, id: &str) -> AppResult<()> {
    check_uuid(id)?;
    let tx = conn.unchecked_transaction()?;
    let note_id: Option<String> =
        match tx.query_row("SELECT note_id FROM highlights WHERE id = ?1", [id], |r| {
            r.get(0)
        }) {
            Ok(n) => n,
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e.into()),
        };
    if let Some(n) = note_id {
        tx.execute("DELETE FROM notes WHERE id = ?1", [n])?;
    }
    tx.execute(
        "DELETE FROM notes WHERE json_extract(anchor_json, '$.highlightId') = ?1",
        [id],
    )?;
    tx.execute("DELETE FROM highlights WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

/// Inserts or updates a note; a highlight anchor gets its note_id pointed at this note.
/// Tags are never written here (only `set_note_tags` changes them).
pub fn upsert_note(conn: &Connection, n: &Note) -> AppResult<()> {
    validate_note(n)?;
    require_book(conn, &n.book_id)?;
    let anchor = serde_json::to_string(&n.anchor)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO notes (id, book_id, page, anchor_json, body, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET anchor_json = excluded.anchor_json, body = excluded.body,
           updated_at = excluded.updated_at",
        params![
            n.id,
            n.book_id,
            n.page,
            anchor,
            n.body,
            n.created_at,
            n.updated_at
        ],
    )?;
    if let Some(hid) = &n.anchor.highlight_id {
        tx.execute(
            "UPDATE highlights SET note_id = ?1 WHERE id = ?2",
            params![n.id, hid],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn set_note_tags(conn: &Connection, id: &str, tags: &[String]) -> AppResult<()> {
    check_uuid(id)?;
    check_tags(tags)?;
    // fixed order, no duplicates
    let unique: Vec<&str> = NOTE_TAGS
        .iter()
        .copied()
        .filter(|t| tags.iter().any(|x| x == t))
        .collect();
    conn.execute(
        "UPDATE notes SET tags_json = ?1 WHERE id = ?2",
        params![serde_json::to_string(&unique)?, id],
    )?;
    Ok(())
}

pub fn delete_note(conn: &Connection, id: &str) -> AppResult<()> {
    check_uuid(id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE highlights SET note_id = NULL WHERE note_id = ?1",
        [id],
    )?;
    tx.execute("DELETE FROM notes WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

pub fn add_ink(conn: &Connection, strokes: &[InkStroke]) -> AppResult<()> {
    if strokes.is_empty() || strokes.len() > 500 {
        return Err(invalid("strokes"));
    }
    for s in strokes {
        validate_ink(s)?;
    }
    for s in strokes {
        require_book(conn, &s.book_id)?;
    }
    let tx = conn.unchecked_transaction()?;
    for s in strokes {
        tx.execute(
            "INSERT OR REPLACE INTO ink_strokes (id, book_id, page, points_blob, color, width, tool, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![s.id, s.book_id, s.page, pack_points(&s.points), s.color, s.width, s.tool, s.created_at],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn delete_ink(conn: &Connection, ids: &[String]) -> AppResult<()> {
    if ids.is_empty() || ids.len() > 500 {
        return Err(invalid("ids"));
    }
    for id in ids {
        check_uuid(id)?;
    }
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute("DELETE FROM ink_strokes WHERE id = ?1", [id])?;
    }
    tx.commit()?;
    Ok(())
}

/// Adds a bookmark on the page, or removes the existing one (returns None).
pub fn toggle_bookmark(
    conn: &Connection,
    book_id: &str,
    page: i64,
    label: Option<String>,
    id: Option<String>,
) -> AppResult<Option<Bookmark>> {
    require_book(conn, book_id)?;
    check_page(page)?;
    check_label(&label)?;
    if let Some(i) = &id {
        check_uuid(i)?;
    }
    let tx = conn.unchecked_transaction()?;
    let existing: i64 = tx.query_row(
        "SELECT count(*) FROM bookmarks WHERE book_id = ?1 AND page = ?2",
        params![book_id, page],
        |r| r.get(0),
    )?;
    if existing > 0 {
        tx.execute(
            "DELETE FROM bookmarks WHERE book_id = ?1 AND page = ?2",
            params![book_id, page],
        )?;
        tx.commit()?;
        return Ok(None);
    }
    let b = Bookmark {
        id: id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        book_id: book_id.to_string(),
        page,
        label,
        created_at: now_ms(),
    };
    tx.execute(
        "INSERT INTO bookmarks (id, book_id, page, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![b.id, b.book_id, b.page, b.label, b.created_at],
    )?;
    tx.commit()?;
    Ok(Some(b))
}

pub fn rename_bookmark(conn: &Connection, id: &str, label: Option<String>) -> AppResult<()> {
    check_uuid(id)?;
    check_label(&label)?;
    conn.execute(
        "UPDATE bookmarks SET label = ?1 WHERE id = ?2",
        params![label, id],
    )?;
    Ok(())
}

/// Notes for the home page: grouped by book in order of each book's newest note; books removed
/// from the library are left out.
pub fn list_all_notes(conn: &Connection, thumb_dir: &Path) -> AppResult<Vec<NotesGroup>> {
    let mut visible = std::collections::HashMap::new();
    {
        let mut st = conn.prepare(&format!(
            "SELECT {BOOK_COLUMNS} FROM books WHERE removed_at IS NULL"
        ))?;
        for row in st.query_map([], crate::models::book_from_row)? {
            let row = row?;
            visible.insert(row.id.clone(), row);
        }
    }
    let mut st = conn.prepare(
        "SELECT notes.*, highlights.text AS quote FROM notes
         LEFT JOIN highlights ON highlights.id = json_extract(notes.anchor_json, '$.highlightId')
         ORDER BY notes.updated_at DESC",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok((note_from_row(r)?, r.get::<_, Option<String>>("quote")?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut order: Vec<String> = Vec::new();
    let mut groups: std::collections::HashMap<String, NotesGroup> = Default::default();
    for (note, quote) in rows {
        let Some(row) = visible.get(&note.book_id) else {
            continue;
        };
        let bid = row.id.clone();
        let g = groups.entry(bid.clone()).or_insert_with(|| {
            order.push(bid.clone());
            NotesGroup {
                book: to_book(row.clone(), thumb_dir),
                notes: Vec::new(),
            }
        });
        g.notes.push(NoteWithQuote { note, quote });
    }
    Ok(order
        .into_iter()
        .filter_map(|id| groups.remove(&id))
        .collect())
}

// ---- commands ----

#[tauri::command]
pub async fn annotations_list_for_book(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<BookAnnotations> {
    state.with_db(|c| list_for_book(c, &book_id))
}

#[tauri::command]
pub async fn annotations_upsert_highlight(
    state: State<'_, AppState>,
    h: Highlight,
) -> AppResult<()> {
    state.with_db(|c| upsert_highlight(c, &h))
}

#[tauri::command]
pub async fn annotations_delete_highlight(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.with_db(|c| delete_highlight(c, &id))
}

#[tauri::command]
pub async fn annotations_upsert_note(state: State<'_, AppState>, n: Note) -> AppResult<()> {
    state.with_db(|c| upsert_note(c, &n))
}

#[tauri::command]
pub async fn annotations_delete_note(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.with_db(|c| delete_note(c, &id))
}

#[tauri::command]
pub async fn annotations_set_note_tags(
    state: State<'_, AppState>,
    id: String,
    tags: Vec<String>,
) -> AppResult<()> {
    state.with_db(|c| set_note_tags(c, &id, &tags))
}

#[tauri::command]
pub async fn annotations_add_ink(
    state: State<'_, AppState>,
    strokes: Vec<InkStroke>,
) -> AppResult<()> {
    state.with_db(|c| add_ink(c, &strokes))
}

#[tauri::command]
pub async fn annotations_delete_ink(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<()> {
    state.with_db(|c| delete_ink(c, &ids))
}

#[tauri::command]
pub async fn annotations_toggle_bookmark(
    state: State<'_, AppState>,
    book_id: String,
    page: i64,
    label: Option<String>,
    id: Option<String>,
) -> AppResult<Option<Bookmark>> {
    state.with_db(|c| toggle_bookmark(c, &book_id, page, label, id))
}

#[tauri::command]
pub async fn annotations_rename_bookmark(
    state: State<'_, AppState>,
    id: String,
    label: Option<String>,
) -> AppResult<()> {
    state.with_db(|c| rename_bookmark(c, &id, label))
}

#[tauri::command]
pub async fn annotations_list_all_notes(state: State<'_, AppState>) -> AppResult<Vec<NotesGroup>> {
    let thumbs = state.thumb_dir();
    state.with_db(|c| list_all_notes(c, &thumbs))
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOOK: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const BOOK2: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const H1: &str = "11111111-1111-4111-8111-111111111111";
    const N1: &str = "22222222-2222-4222-8222-222222222222";
    const N2: &str = "33333333-3333-4333-8333-333333333333";
    const S1: &str = "44444444-4444-4444-8444-444444444444";

    fn db() -> Connection {
        let c = crate::db::open_in_memory().unwrap();
        for id in [BOOK, BOOK2] {
            c.execute_batch(&format!(
                "INSERT INTO books (id, path, added_at) VALUES ('{id}', 'Z:/x.pdf', 1)"
            ))
            .unwrap();
        }
        c
    }

    fn hl() -> Highlight {
        Highlight {
            id: H1.into(),
            book_id: BOOK.into(),
            page: 2,
            rects: vec![Rect {
                x: 0.1,
                y: 0.2,
                w: 0.3,
                h: 0.04,
            }],
            text: "quoted text".into(),
            color: "yellow".into(),
            style: "highlight".into(),
            note_id: None,
            created_at: 10,
            updated_at: 10,
        }
    }

    fn note(id: &str, hid: Option<&str>, updated: i64) -> Note {
        Note {
            id: id.into(),
            book_id: BOOK.into(),
            page: 2,
            anchor: Anchor {
                highlight_id: hid.map(String::from),
                point: None,
            },
            body: "body".into(),
            tags: None,
            created_at: 10,
            updated_at: updated,
        }
    }

    fn stroke() -> InkStroke {
        InkStroke {
            id: S1.into(),
            book_id: BOOK.into(),
            page: 1,
            points: vec![[0.25, 0.5, 0.75], [1.0, 0.0, 0.5]],
            color: "#1f1f1f".into(),
            width: 0.005,
            tool: "pen".into(),
            created_at: 5,
        }
    }

    #[test]
    fn ink_blob_matches_ts_layout() {
        // Float32Array([0.25, 0.5, 0.75, 1, 0, 0.5]) little-endian, built by hand.
        let mut hand = Vec::new();
        for v in [0.25f32, 0.5, 0.75, 1.0, 0.0, 0.5] {
            hand.extend_from_slice(&v.to_le_bytes());
        }
        assert_eq!(&hand[..4], &[0x00, 0x00, 0x80, 0x3e]); // 0.25f32 = 0x3e800000
        assert_eq!(pack_points(&stroke().points), hand);
        assert_eq!(unpack_points(&hand), stroke().points);
        assert_eq!(hand.len(), 24);
    }

    #[test]
    fn ink_round_trips_through_the_db_and_replaces_by_id() {
        let c = db();
        add_ink(&c, &[stroke()]).unwrap();
        let mut s2 = stroke();
        s2.color = "#d0342c".into();
        add_ink(&c, &[s2]).unwrap();
        let a = list_for_book(&c, BOOK).unwrap();
        assert_eq!(a.ink.len(), 1);
        assert_eq!(a.ink[0].points, stroke().points);
        assert_eq!(a.ink[0].color, "#d0342c");
        delete_ink(&c, &[S1.into()]).unwrap();
        assert!(list_for_book(&c, BOOK).unwrap().ink.is_empty());
    }

    #[test]
    fn ink_validation() {
        let c = db();
        assert!(add_ink(&c, &[]).is_err());
        let mut s = stroke();
        s.points = vec![[0.0, 0.0, 0.5]; 20_001];
        assert!(add_ink(&c, &[s]).is_err());
        let mut s = stroke();
        s.color = "#000000".into();
        assert!(add_ink(&c, &[s]).is_err());
        let mut s = stroke();
        s.book_id = "c".repeat(64);
        assert!(add_ink(&c, &[s]).is_err()); // unknown book
    }

    #[test]
    fn highlight_upsert_and_validation() {
        let c = db();
        upsert_highlight(&c, &hl()).unwrap();
        let mut h = hl();
        h.color = "pink".into();
        h.updated_at = 20;
        upsert_highlight(&c, &h).unwrap();
        let got = list_for_book(&c, BOOK).unwrap().highlights;
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].color, "pink");
        assert_eq!(got[0].updated_at, 20);
        let raw: String = c
            .query_row("SELECT rects_json FROM highlights", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, r#"[{"x":0.1,"y":0.2,"w":0.3,"h":0.04}]"#);

        let mut bad = hl();
        bad.rects = vec![];
        assert!(upsert_highlight(&c, &bad).is_err());
        let mut bad = hl();
        bad.rects = vec![Rect {
            x: 2.0,
            y: 0.0,
            w: 0.1,
            h: 0.1,
        }];
        assert!(upsert_highlight(&c, &bad).is_err());
        let mut bad = hl();
        bad.id = "nope".into();
        assert!(upsert_highlight(&c, &bad).is_err());
        let mut bad = hl();
        bad.style = "fancy".into();
        assert!(upsert_highlight(&c, &bad).is_err());
    }

    #[test]
    fn note_links_highlight_and_deleting_either_cleans_up() {
        let c = db();
        upsert_highlight(&c, &hl()).unwrap();
        upsert_note(&c, &note(N1, Some(H1), 30)).unwrap();
        let a = list_for_book(&c, BOOK).unwrap();
        assert_eq!(a.highlights[0].note_id.as_deref(), Some(N1));
        assert_eq!(a.notes[0].tags, Some(vec![]));
        let raw: String = c
            .query_row("SELECT anchor_json FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, format!(r#"{{"highlightId":"{H1}"}}"#));

        delete_note(&c, N1).unwrap();
        let a = list_for_book(&c, BOOK).unwrap();
        assert!(a.notes.is_empty());
        assert_eq!(a.highlights[0].note_id, None);

        upsert_note(&c, &note(N1, Some(H1), 30)).unwrap();
        delete_highlight(&c, H1).unwrap();
        let a = list_for_book(&c, BOOK).unwrap();
        assert!(a.notes.is_empty() && a.highlights.is_empty());
    }

    #[test]
    fn saving_a_note_keeps_tags_and_set_tags_dedupes_in_fixed_order() {
        let c = db();
        upsert_note(&c, &note(N1, None, 1)).unwrap();
        set_note_tags(
            &c,
            N1,
            &["review".into(), "important".into(), "review".into()],
        )
        .unwrap();
        let raw: String = c
            .query_row("SELECT tags_json FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, r#"["important","review"]"#);
        let mut n = note(N1, None, 2);
        n.body = "edited".into();
        n.tags = Some(vec![]);
        upsert_note(&c, &n).unwrap();
        let got = list_for_book(&c, BOOK).unwrap().notes;
        assert_eq!(got[0].tags, Some(vec!["important".into(), "review".into()]));
        assert_eq!(got[0].body, "edited");
        assert!(set_note_tags(&c, N1, &["x".into()]).is_err());
        assert!(set_note_tags(&c, N1, &vec!["idea".to_string(); 4]).is_err());
    }

    #[test]
    fn bookmarks_toggle_and_rename() {
        let c = db();
        let b = toggle_bookmark(&c, BOOK, 3, Some("here".into()), Some(N2.into()))
            .unwrap()
            .unwrap();
        assert_eq!(b.id, N2);
        rename_bookmark(&c, N2, None).unwrap();
        assert_eq!(list_for_book(&c, BOOK).unwrap().bookmarks[0].label, None);
        assert!(toggle_bookmark(&c, BOOK, 3, None, None).unwrap().is_none());
        assert!(list_for_book(&c, BOOK).unwrap().bookmarks.is_empty());
        let b = toggle_bookmark(&c, BOOK, 3, None, None).unwrap().unwrap();
        assert!(check_uuid(&b.id).is_ok());
        assert!(toggle_bookmark(&c, BOOK, 0, None, None).is_err());
        assert!(toggle_bookmark(&c, BOOK, 1, Some("x".repeat(201)), None).is_err());
    }

    #[test]
    fn list_all_notes_newest_first_grouped_with_quotes_and_skips_removed_books() {
        let c = db();
        upsert_highlight(&c, &hl()).unwrap();
        upsert_note(&c, &note(N1, Some(H1), 50)).unwrap();
        let mut other = note(N2, None, 100);
        other.book_id = BOOK2.into();
        upsert_note(&c, &other).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let g = list_all_notes(&c, dir.path()).unwrap();
        assert_eq!(g.len(), 2);
        assert_eq!(g[0].book.id, BOOK2);
        assert_eq!(g[1].notes[0].quote.as_deref(), Some("quoted text"));
        assert_eq!(g[0].notes[0].quote, None);

        c.execute("UPDATE books SET removed_at = 1 WHERE id = ?1", [BOOK2])
            .unwrap();
        let g = list_all_notes(&c, dir.path()).unwrap();
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].book.id, BOOK);
    }

    #[test]
    fn json_shapes_are_camel_case() {
        let c = db();
        upsert_highlight(&c, &hl()).unwrap();
        let v = serde_json::to_value(list_for_book(&c, BOOK).unwrap()).unwrap();
        assert!(v["highlights"][0].get("bookId").is_some());
        assert!(v["highlights"][0].get("noteId").is_some());
        assert!(v.get("ink").is_some() && v.get("bookmarks").is_some());
        let bad: Result<Highlight, _> = serde_json::from_value(serde_json::json!({"extra": 1}));
        assert!(bad.is_err());
    }
}
