//! Where Ask's index lives: two tables in the app's own SQLite file (migration 006), plus an
//! in-memory copy of the open book's vectors for search. A book has a few thousand chunks, so
//! comparing the question with every chunk takes milliseconds; no vector index is needed.
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

pub const DIM: usize = 384;

#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    pub page: i64,
    pub text: String,
}

/// One book's chunks and their vectors, row by row (`vecs` holds DIM floats per chunk).
pub struct BookIndex {
    pub chunks: Vec<Chunk>,
    pub vecs: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Indexed {
    pub state: String,
    pub chunks: i64,
    pub path: String,
    pub model: String,
    pub error: Option<String>,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

pub fn from_blob(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

pub fn indexed(c: &Connection, book_id: &str) -> rusqlite::Result<Option<Indexed>> {
    c.query_row(
        "SELECT state, chunks, path, model, error FROM ask_books WHERE book_id = ?1",
        [book_id],
        |r| {
            Ok(Indexed {
                state: r.get(0)?,
                chunks: r.get(1)?,
                path: r.get(2)?,
                model: r.get(3)?,
                error: r.get(4)?,
            })
        },
    )
    .optional()
}

/// Replaces the book's chunks in one transaction (a crash never leaves half a book).
pub fn save_book(
    c: &mut Connection,
    book_id: &str,
    path: &str,
    model: &str,
    chunks: &[Chunk],
    vecs: &[Vec<f32>],
) -> rusqlite::Result<()> {
    let tx = c.transaction()?;
    tx.execute("DELETE FROM ask_chunks WHERE book_id = ?1", [book_id])?;
    {
        let mut ins = tx.prepare(
            "INSERT INTO ask_chunks (book_id, idx, page, text, vec) VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for (i, (ch, v)) in chunks.iter().zip(vecs).enumerate() {
            ins.execute(params![book_id, i as i64, ch.page, ch.text, to_blob(v)])?;
        }
    }
    tx.execute(
        "INSERT OR REPLACE INTO ask_books (book_id, state, chunks, path, model, error, updated_at)
         VALUES (?1, 'done', ?2, ?3, ?4, NULL, ?5)",
        params![book_id, chunks.len() as i64, path, model, now()],
    )?;
    tx.commit()?;
    forget(book_id);
    Ok(())
}

pub fn save_failure(
    c: &Connection,
    book_id: &str,
    path: &str,
    model: &str,
    error: &str,
) -> rusqlite::Result<()> {
    c.execute(
        "INSERT OR REPLACE INTO ask_books (book_id, state, chunks, path, model, error, updated_at)
         VALUES (?1, 'failed', 0, ?2, ?3, ?4, ?5)",
        params![book_id, path, model, error, now()],
    )?;
    Ok(())
}

fn load(c: &Connection, book_id: &str) -> rusqlite::Result<BookIndex> {
    let mut stmt =
        c.prepare("SELECT page, text, vec FROM ask_chunks WHERE book_id = ?1 ORDER BY idx")?;
    let mut chunks = Vec::new();
    let mut vecs = Vec::new();
    let rows = stmt.query_map([book_id], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Vec<u8>>(2)?))
    })?;
    for row in rows {
        let (page, text, blob) = row?;
        let v = from_blob(&blob);
        if v.len() != DIM {
            continue; // written by another model: ignored until the book is indexed again
        }
        chunks.push(Chunk { page, text });
        vecs.extend(v);
    }
    Ok(BookIndex { chunks, vecs })
}

fn cache() -> &'static Mutex<HashMap<String, Arc<BookIndex>>> {
    static C: OnceLock<Mutex<HashMap<String, Arc<BookIndex>>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Drops the cached copy (after indexing again, or when a book is removed).
pub fn forget(book_id: &str) {
    cache().lock().unwrap_or_else(|e| e.into_inner()).remove(book_id);
}

/// The book's index, read from SQLite once and then kept in memory. Only the last few books
/// asked about stay cached.
pub fn book(c: &Connection, book_id: &str) -> rusqlite::Result<Arc<BookIndex>> {
    if let Some(b) = cache().lock().unwrap_or_else(|e| e.into_inner()).get(book_id) {
        return Ok(b.clone());
    }
    let b = Arc::new(load(c, book_id)?);
    let mut map = cache().lock().unwrap_or_else(|e| e.into_inner());
    if map.len() >= 3 {
        map.clear();
    }
    map.insert(book_id.to_string(), b.clone());
    Ok(b)
}

/// Indices of the `k` chunks most similar to `query` (a unit vector), best first, among
/// chunks on pages up to `max_page`.
pub fn search(book: &BookIndex, query: &[f32], k: usize, max_page: Option<i64>) -> Vec<(usize, f32)> {
    let mut scored: Vec<(usize, f32)> = book
        .chunks
        .iter()
        .enumerate()
        .filter(|(_, c)| max_page.map_or(true, |m| c.page <= m))
        .map(|(i, _)| {
            let v = &book.vecs[i * DIM..(i + 1) * DIM];
            (i, v.iter().zip(query).map(|(a, b)| a * b).sum())
        })
        .collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    scored.truncate(k);
    scored
}

/// Chunks up to `max_page` whose text contains `name` exactly (Who is this?), in page order.
pub fn mentions(book: &BookIndex, name: &str, max_page: i64) -> Vec<usize> {
    book.chunks
        .iter()
        .enumerate()
        .filter(|(_, c)| c.page <= max_page && c.text.contains(name))
        .map(|(i, _)| i)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(at: usize) -> Vec<f32> {
        let mut v = vec![0.0; DIM];
        v[at] = 1.0;
        v
    }

    fn db_with_book() -> Connection {
        let c = crate::db::open_in_memory().unwrap();
        c.execute("INSERT INTO books (id, path, added_at) VALUES ('b', 'x.pdf', 1)", [])
            .unwrap();
        c
    }

    fn chunks() -> Vec<Chunk> {
        [(1, "LoRA trains few weights"), (5, "QLoRA quantizes"), (9, "RLHF uses LoRA")]
            .iter()
            .map(|(p, t)| Chunk { page: *p, text: t.to_string() })
            .collect()
    }

    #[test]
    fn saves_loads_and_searches_a_book() {
        let mut c = db_with_book();
        save_book(&mut c, "b", "x.pdf", "m", &chunks(), &[unit(0), unit(1), unit(2)]).unwrap();
        assert_eq!(indexed(&c, "b").unwrap().unwrap().chunks, 3);
        let b = book(&c, "b").unwrap();
        let q: Vec<f32> = (0..DIM).map(|i| if i == 2 { 0.9 } else if i == 0 { 0.4 } else { 0.0 }).collect();
        let hits = search(&b, &q, 2, None);
        assert_eq!(hits.iter().map(|h| h.0).collect::<Vec<_>>(), vec![2, 0]);
        // Spoiler Shield: page 9 is past the reader.
        assert_eq!(search(&b, &q, 2, Some(5))[0].0, 0);
        assert_eq!(mentions(&b, "LoRA", 5), vec![0, 1]);
        forget("b");
    }

    #[test]
    fn indexing_again_replaces_the_old_chunks() {
        let mut c = db_with_book();
        save_book(&mut c, "b", "x.pdf", "m", &chunks(), &[unit(0), unit(1), unit(2)]).unwrap();
        save_book(&mut c, "b", "x.pdf", "m", &chunks()[..1], &[unit(0)]).unwrap();
        assert_eq!(book(&c, "b").unwrap().chunks.len(), 1);
        forget("b");
    }

    #[test]
    fn removing_the_book_removes_its_index() {
        let mut c = db_with_book();
        save_book(&mut c, "b", "x.pdf", "m", &chunks(), &[unit(0), unit(1), unit(2)]).unwrap();
        c.execute("DELETE FROM books WHERE id = 'b'", []).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM ask_chunks", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        assert!(indexed(&c, "b").unwrap().is_none());
    }

    #[test]
    fn blobs_round_trip() {
        let v = vec![0.5f32, -1.25, 3.0];
        assert_eq!(from_blob(&to_blob(&v)), v);
    }
}
