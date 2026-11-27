//! Indexing books for Ask, one at a time in the background: read the PDF's text page by page,
//! split it into chunks, turn each chunk into a vector, store them (store.rs).
//!
//! Status per book, as the Ask drawer polls it: `missing` (never indexed), `queued`,
//! `indexing` (with `done`/`total` chunks, or `step: "download"` while the model downloads the
//! first time), `done`, `failed` (with `error`).
use super::{chunk, models, store};
use crate::state::AppState;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};


#[derive(Clone, Debug, PartialEq)]
enum Live {
    Queued,
    Indexing { step: &'static str, done: u64, total: u64 },
}

#[derive(Default)]
struct Queue {
    jobs: VecDeque<(String, String)>, // (book id, path)
    live: HashMap<String, Live>,
    running: bool,
}

fn queue() -> &'static Mutex<Queue> {
    static Q: OnceLock<Mutex<Queue>> = OnceLock::new();
    Q.get_or_init(|| Mutex::new(Queue::default()))
}

fn lock() -> std::sync::MutexGuard<'static, Queue> {
    queue().lock().unwrap_or_else(|e| e.into_inner())
}

fn set_live(book_id: &str, live: Option<Live>) {
    let mut q = lock();
    match live {
        Some(l) => q.live.insert(book_id.to_string(), l),
        None => q.live.remove(book_id),
    };
}

/// Is the stored index current for this file and model?
fn up_to_date(state: &AppState, book_id: &str, path: &str) -> bool {
    matches!(
        state.with_db(|c| Ok(store::indexed(c, book_id)?)),
        Ok(Some(i)) if i.state == "done" && i.path == path && i.model == models::EMBEDDER.name
    )
}

/// What the Ask drawer shows for this book.
pub fn status(state: &AppState, book_id: &str) -> Value {
    if let Some(live) = lock().live.get(book_id).cloned() {
        return match live {
            Live::Queued => json!({"ok": true, "state": "queued", "done": 0, "total": 0}),
            Live::Indexing { step, done, total } => {
                json!({"ok": true, "state": "indexing", "step": step, "done": done, "total": total})
            }
        };
    }
    match state.with_db(|c| Ok(store::indexed(c, book_id)?)) {
        Ok(Some(i)) if i.state == "done" => {
            json!({"ok": true, "state": "done", "done": i.chunks, "total": i.chunks})
        }
        Ok(Some(i)) if i.state == "failed" => json!({
            "ok": true, "state": "failed", "done": 0, "total": 0,
            "error": i.error.unwrap_or_default()
        }),
        Ok(_) => json!({"ok": true, "state": "missing", "done": 0, "total": 0}),
        Err(e) => json!({"ok": false, "error": e.to_string()}),
    }
}

/// Queues books that aren't indexed yet. A book that failed before waits for `retry` (or for
/// its file to move), so a broken PDF isn't read again at every start.
pub fn enqueue(app: &AppHandle, books: Vec<(String, String)>, retry: bool) {
    let state = app.state::<AppState>();
    let mut added = false;
    {
        let mut q = lock();
        for (id, path) in books {
            if q.live.contains_key(&id) || up_to_date(&state, &id, &path) {
                continue;
            }
            let failed_same_file = matches!(
                state.with_db(|c| Ok(store::indexed(c, &id)?)),
                Ok(Some(i)) if i.state == "failed" && i.path == path
            );
            if failed_same_file && !retry {
                continue;
            }
            q.live.insert(id.clone(), Live::Queued);
            q.jobs.push_back((id, path));
            added = true;
        }
        if !added || q.running {
            return;
        }
        q.running = true;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let next = {
                let mut q = lock();
                let job = q.jobs.pop_front();
                if job.is_none() {
                    q.running = false;
                }
                job
            };
            let Some((id, path)) = next else { break };
            let state = app.state::<AppState>();
            match index_one(&state, &id, &path).await {
                Ok(n) => log::info!("Ask: indexed book {id} ({n} chunks)"),
                Err(e) => {
                    log::warn!("Ask: could not index book {id}: {e}");
                    let _ = state.with_db(|c| {
                        Ok(store::save_failure(c, &id, &path, models::EMBEDDER.name, &e)?)
                    });
                }
            }
            set_live(&id, None);
        }
    });
}

async fn index_one(state: &AppState, book_id: &str, path: &str) -> Result<usize, String> {
    let data_dir = state.data_dir.clone();
    if !models::is_downloaded(&data_dir, &models::EMBEDDER) {
        let id = book_id.to_string();
        set_live(&id, Some(Live::Indexing { step: "download", done: 0, total: 0 }));
        let report = move |done: u64, total: u64| {
            set_live(&id, Some(Live::Indexing { step: "download", done, total }));
        };
        models::ensure(&data_dir, &models::EMBEDDER, &report).await?;
    }
    set_live(book_id, Some(Live::Indexing { step: "read", done: 0, total: 0 }));
    let file = PathBuf::from(path);
    let pages = tokio::task::spawn_blocking(move || super::pdf::page_texts(&file))
        .await
        .map_err(|e| e.to_string())??;

    let mut chunks = Vec::new();
    for (i, text) in pages.iter().enumerate() {
        for c in chunk::split_text(text) {
            chunks.push(store::Chunk { page: i as i64 + 1, text: c });
        }
    }
    if chunks.is_empty() {
        return Err("no text found (a scanned PDF without a text layer?)".into());
    }

    let embedder = {
        let dir = data_dir.clone();
        tokio::task::spawn_blocking(move || models::embedder(&dir))
            .await
            .map_err(|e| e.to_string())??
    };
    let total = chunks.len() as u64;
    set_live(book_id, Some(Live::Indexing { step: "embed", done: 0, total }));
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let id = book_id.to_string();
    let vecs = tokio::task::spawn_blocking(move || {
        let report = |done: usize| {
            set_live(&id, Some(Live::Indexing { step: "embed", done: done as u64, total }));
        };
        embedder.embed_all(&texts, &report)
    })
    .await
    .map_err(|e| e.to_string())??;
    let n = chunks.len();
    let mut conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    store::save_book(&mut conn, book_id, path, models::EMBEDDER.name, &chunks, &vecs)
        .map_err(|e| format!("could not save the index: {e}"))?;
    Ok(n)
}
