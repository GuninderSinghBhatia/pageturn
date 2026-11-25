//! Types and helpers more than one command area needs. JSON field names match
//! `src/shared/types.ts` (camelCase), so the React code receives the same shapes as before.

use crate::error::{invalid, AppError, AppResult};
use base64::Engine;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// A book as the UI sees it (`Book` in shared/types.ts).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub path: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub num_pages: Option<i64>,
    pub last_page: i64,
    pub added_at: i64,
    pub last_opened_at: Option<i64>,
    pub liked: bool,
    pub missing: bool,
    pub thumbnail_url: Option<String>,
}

/// A `books` table row (no `missing` / `thumbnailUrl`, which come from the disk).
#[derive(Debug, Clone, PartialEq)]
pub struct BookRow {
    pub id: String,
    pub path: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub num_pages: Option<i64>,
    pub last_page: i64,
    pub added_at: i64,
    pub last_opened_at: Option<i64>,
    pub liked: bool,
}

/// Columns to SELECT for `book_from_row`, in order.
pub const BOOK_COLUMNS: &str =
    "id, path, title, author, num_pages, last_page, added_at, last_opened_at, liked";

pub fn book_from_row(r: &Row) -> rusqlite::Result<BookRow> {
    Ok(BookRow {
        id: r.get(0)?,
        path: r.get(1)?,
        title: r.get(2)?,
        author: r.get(3)?,
        num_pages: r.get(4)?,
        last_page: r.get::<_, Option<i64>>(5)?.unwrap_or(1),
        added_at: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
        last_opened_at: r.get(7)?,
        liked: r.get::<_, i64>(8)? == 1,
    })
}

pub fn get_book_row(conn: &Connection, id: &str) -> AppResult<Option<BookRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {BOOK_COLUMNS} FROM books WHERE id = ?1"),
            [id],
            book_from_row,
        )
        .optional()?)
}

pub fn thumbnail_path(thumb_dir: &Path, book_id: &str) -> std::path::PathBuf {
    thumb_dir.join(format!("{book_id}.png"))
}

/// Row → Book: `missing` from the disk, cover inlined as a data URL (the CSP allows no file: images).
pub fn to_book(row: BookRow, thumb_dir: &Path) -> Book {
    let thumb = thumbnail_path(thumb_dir, &row.id);
    let thumbnail_url = std::fs::read(&thumb).ok().map(|bytes| {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    });
    Book {
        missing: !Path::new(&row.path).exists(),
        thumbnail_url,
        id: row.id,
        path: row.path,
        title: row.title,
        author: row.author,
        num_pages: row.num_pages,
        last_page: row.last_page,
        added_at: row.added_at,
        last_opened_at: row.last_opened_at,
        liked: row.liked,
    }
}

/// Book ids are SHA-256 hex (`BookIdSchema`).
pub fn check_book_id(id: &str) -> AppResult<()> {
    if id.len() == 64 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        Ok(())
    } else {
        Err(invalid("book id"))
    }
}

/// Annotation ids are UUIDs (`IdSchema`).
pub fn check_uuid(id: &str) -> AppResult<()> {
    uuid::Uuid::parse_str(id).map(|_| ()).map_err(|_| invalid("id"))
}

/// Looks a book up or fails with "Unknown book".
pub fn require_book(conn: &Connection, id: &str) -> AppResult<BookRow> {
    check_book_id(id)?;
    get_book_row(conn, id)?.ok_or(AppError::UnknownBook)
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn book_id_must_be_64_lowercase_hex() {
        assert!(check_book_id(&"a".repeat(64)).is_ok());
        assert!(check_book_id(&"A".repeat(64)).is_err());
        assert!(check_book_id("abc").is_err());
    }

    #[test]
    fn to_book_marks_missing_files_and_has_no_cover_without_thumbnail() {
        let dir = tempfile::tempdir().unwrap();
        let row = BookRow {
            id: "a".repeat(64),
            path: "Z:/nope.pdf".into(),
            title: None,
            author: None,
            num_pages: None,
            last_page: 1,
            added_at: 0,
            last_opened_at: None,
            liked: false,
        };
        let b = to_book(row, dir.path());
        assert!(b.missing);
        assert!(b.thumbnail_url.is_none());
        let json = serde_json::to_value(&b).unwrap();
        assert!(json.get("thumbnailUrl").is_some() && json.get("numPages").is_some());
    }
}
