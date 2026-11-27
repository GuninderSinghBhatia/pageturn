//! `rag` commands: thin proxies to the Python rag-service on localhost:8000.
//! Ported from src/main/ipc/rag.ts. They never reject for service failures: those come
//! back as `{ok:false,error}`. Only invalid arguments are an `Err`.
use crate::error::{invalid, AppError, AppResult};
use crate::state::AppState;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::time::Duration;
use tauri::State;

const RAG_URL: &str = "http://localhost:8000";
const UNREACHABLE: &str = "rag-service is not reachable on localhost:8000";

fn fail(error: impl Into<String>) -> Value {
    json!({ "ok": false, "error": error.into() })
}

fn question_ok(s: &str) -> AppResult<String> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > 500 {
        return Err(invalid("question must be 1 to 500 characters"));
    }
    Ok(t.to_string())
}

fn name_ok(s: &str) -> AppResult<String> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > 100 {
        return Err(invalid("name must be 1 to 100 characters"));
    }
    Ok(t.to_string())
}

/// The app's id for the open book (a content hash): sent so rag-service searches that book only.
fn book_ok(id: Option<String>) -> AppResult<Option<String>> {
    match id {
        None => Ok(None),
        Some(s)
            if !s.is_empty()
                && s.len() <= 200
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') =>
        {
            Ok(Some(s))
        }
        Some(_) => Err(invalid("bookId must be 1 to 200 letters, digits, - or _")),
    }
}

fn page_ok(p: i64) -> AppResult<i64> {
    if p < 1 {
        return Err(invalid("currentPage must be a positive integer"));
    }
    Ok(p)
}

async fn health(base: &str) -> Value {
    let client = reqwest::Client::new();
    match client
        .get(format!("{base}/health"))
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Err(_) => fail(UNREACHABLE),
        Ok(res) if !res.status().is_success() => fail(format!("HTTP {}", res.status().as_u16())),
        Ok(res) => match res.json::<Value>().await {
            Ok(body) => json!({ "ok": true, "body": body }),
            Err(_) => fail(UNREACHABLE),
        },
    }
}

/// True when rag-service answers its health check.
pub async fn is_up() -> bool {
    health(RAG_URL).await["ok"] == true
}

/// POSTs to an endpoint that answers with text + the pages it used.
async fn post_for_answer(base: &str, path: &str, payload: Value) -> Value {
    let client = reqwest::Client::new();
    let res = match client
        .post(format!("{base}{path}"))
        .json(&payload)
        // Self-RAG makes several LLM calls, paced under Groq's rate limit.
        .timeout(Duration::from_secs(180))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return fail(UNREACHABLE),
    };
    if !res.status().is_success() {
        return fail(format!(
            "rag-service answered HTTP {}",
            res.status().as_u16()
        ));
    }
    let body: Value = match res.json().await {
        Ok(b) => b,
        Err(_) => return fail(UNREACHABLE),
    };
    let unexpected = || fail("rag-service sent an unexpected reply");
    let Some(answer) = body.get("answer").and_then(Value::as_str) else {
        return unexpected();
    };
    let Some(arr) = body.get("context_pages").and_then(Value::as_array) else {
        return unexpected();
    };
    let mut pages = BTreeSet::new();
    for p in arr {
        match p.as_i64() {
            Some(n) if n > 0 => {
                pages.insert(n);
            }
            _ => return unexpected(),
        }
    }
    let mut out =
        json!({ "ok": true, "answer": answer, "pages": pages.into_iter().collect::<Vec<_>>() });
    if body.get("not_indexed").and_then(Value::as_bool) == Some(true) {
        out["notIndexed"] = json!(true); // the Ask drawer shows indexing progress instead
    }
    if let Some(related) = body.get("related") {
        match related_ok(related) {
            Some(r) => out["related"] = r,
            None => return unexpected(),
        }
    }
    out
}

/// Graph neighbours sent with "Who is this?": [{name, relation, direction, pages}].
fn related_ok(v: &Value) -> Option<Value> {
    let mut items = Vec::new();
    for item in v.as_array()? {
        let name = item.get("name")?.as_str()?;
        let relation = item.get("relation")?.as_str()?;
        let direction = item.get("direction")?.as_str()?;
        if direction != "in" && direction != "out" {
            return None;
        }
        let mut pages = Vec::new();
        for p in item.get("pages")?.as_array()? {
            pages.push(p.as_i64().filter(|n| *n > 0)?);
        }
        items.push(
            json!({ "name": name, "relation": relation, "direction": direction, "pages": pages }),
        );
    }
    Some(Value::Array(items))
}

// ---------------------------------------------------------------- automatic indexing

/// Asks rag-service to index one book in the background. Answers its status
/// (`{ok: true, state, done, total, error?}`) or `{ok: false, error}`.
async fn request_index(base: &str, book_id: &str, path: &str, retry: bool) -> Value {
    let res = reqwest::Client::new()
        .post(format!("{base}/index"))
        .json(&json!({ "book_id": book_id, "path": path, "retry": retry }))
        .timeout(Duration::from_secs(10))
        .send()
        .await;
    status_reply(res).await
}

async fn index_status(base: &str, book_id: &str) -> Value {
    let res = reqwest::Client::new()
        .get(format!("{base}/index/status"))
        .query(&[("book_id", book_id)])
        .timeout(Duration::from_secs(5))
        .send()
        .await;
    status_reply(res).await
}

async fn status_reply(res: reqwest::Result<reqwest::Response>) -> Value {
    let Ok(r) = res else {
        return fail(UNREACHABLE);
    };
    if !r.status().is_success() {
        return fail(format!("rag-service answered HTTP {}", r.status().as_u16()));
    }
    let Ok(body) = r.json::<Value>().await else {
        return fail("rag-service sent an unexpected reply");
    };
    let state = body.get("state").and_then(Value::as_str).unwrap_or("");
    if !["missing", "queued", "indexing", "done", "failed"].contains(&state) {
        return fail("rag-service sent an unexpected reply");
    }
    let num = |k: &str| body.get(k).and_then(Value::as_i64).unwrap_or(0).max(0);
    let mut out = json!({ "ok": true, "state": state, "done": num("done"), "total": num("total") });
    if let Some(e) = body.get("error").and_then(Value::as_str) {
        out["error"] = json!(e);
    }
    out
}

/// Sends books to rag-service for indexing (it skips indexed ones). Stops at the first
/// connection failure: the service is off, and the next app start sends them again.
async fn send_for_indexing(base: &str, books: &[(String, String)]) -> usize {
    let mut sent = 0;
    for (id, path) in books {
        let r = request_index(base, id, path, false).await;
        if r["ok"] != true && r["error"] == UNREACHABLE {
            log::info!(
                "rag-service is not running; {} book(s) not sent for indexing",
                books.len() - sent
            );
            break;
        }
        sent += 1;
    }
    sent
}

/// Indexes these books for Ask in the background (after an import, and at every start).
pub fn index_in_background(app: &tauri::AppHandle, books: Vec<(String, String)>) {
    if books.is_empty() {
        return;
    }
    if !crate::rag::use_service() {
        crate::rag::index::enqueue(app, books, false);
        return;
    }
    tauri::async_runtime::spawn(async move {
        send_for_indexing(RAG_URL, &books).await;
    });
}

/// At startup: every book in the library, so books added while Ask was off get indexed.
pub fn index_library(app: &tauri::AppHandle, state: &AppState) {
    match state.with_db(crate::commands::library::library_books) {
        Ok(books) => index_in_background(app, books),
        Err(e) => log::error!("Could not list books for indexing: {e}"),
    }
}

/// The open book's path, for queueing it.
fn book_path(state: &AppState, id: &str) -> AppResult<String> {
    Ok(state
        .with_db(|c| crate::models::get_book_row(c, id))?
        .ok_or(AppError::UnknownBook)?
        .path)
}

/// In-app Ask on a book that isn't indexed yet: queue it and let the drawer show progress.
fn not_indexed(app: &tauri::AppHandle, state: &AppState, id: &str) -> AppResult<Option<Value>> {
    let s = crate::rag::index::status(state, id);
    if s["state"] == "done" {
        return Ok(None);
    }
    crate::rag::index::enqueue(app, vec![(id.to_string(), book_path(state, id)?)], false);
    Ok(Some(json!({ "ok": true, "answer": "", "pages": [], "notIndexed": true })))
}

fn open_book(id: Option<String>) -> AppResult<String> {
    book_ok(id)?.ok_or_else(|| invalid("bookId is required"))
}

/// The open book's indexing state (the Ask drawer polls this while a book is being indexed).
#[tauri::command]
pub async fn rag_index_status(state: State<'_, AppState>, book_id: String) -> AppResult<Value> {
    let id = book_ok(Some(book_id))?.unwrap_or_default();
    if !crate::rag::use_service() {
        return Ok(crate::rag::index::status(&state, &id));
    }
    Ok(index_status(RAG_URL, &id).await)
}

/// Queues the book now (for example when Ask was off at import); `retry` tries a book
/// that failed before.
#[tauri::command]
pub async fn rag_index_book(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    book_id: String,
    retry: bool,
) -> AppResult<Value> {
    let id = book_ok(Some(book_id))?.unwrap_or_default();
    let path = book_path(&state, &id)?;
    if !crate::rag::use_service() {
        crate::rag::index::enqueue(&app, vec![(id.clone(), path)], retry);
        return Ok(crate::rag::index::status(&state, &id));
    }
    Ok(request_index(RAG_URL, &id, &path, retry).await)
}

#[tauri::command]
pub async fn rag_health() -> AppResult<Value> {
    if !crate::rag::use_service() {
        return Ok(json!({ "ok": true, "body": { "status": "healthy", "engine": "app" } }));
    }
    Ok(health(RAG_URL).await)
}

#[tauri::command]
pub async fn rag_ask(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    question: String,
    current_page: i64,
    book_id: Option<String>,
) -> AppResult<Value> {
    let question = question_ok(&question)?;
    let page = page_ok(current_page)?;
    if !crate::rag::use_service() {
        let id = open_book(book_id)?;
        if let Some(wait) = not_indexed(&app, &state, &id)? {
            return Ok(wait);
        }
        return Ok(crate::rag::answer::ask(&state, &id, &question, page).await);
    }
    let payload = json!({ "question": question, "current_page": page, "book_id": book_ok(book_id)? });
    Ok(post_for_answer(RAG_URL, "/ask", payload).await)
}

#[tauri::command]
pub async fn rag_who(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    current_page: i64,
    book_id: Option<String>,
) -> AppResult<Value> {
    let name = name_ok(&name)?;
    let page = page_ok(current_page)?;
    if !crate::rag::use_service() {
        let id = open_book(book_id)?;
        if let Some(wait) = not_indexed(&app, &state, &id)? {
            return Ok(wait);
        }
        return Ok(crate::rag::answer::who(&state, &id, &name, page).await);
    }
    let payload = json!({ "name": name, "current_page": page, "book_id": book_ok(book_id)? });
    Ok(post_for_answer(RAG_URL, "/who", payload).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn book_id_validation() {
        assert_eq!(book_ok(None).unwrap(), None);
        assert_eq!(
            book_ok(Some("abc-123_X".into())).unwrap(),
            Some("abc-123_X".into())
        );
        assert!(book_ok(Some(String::new())).is_err());
        assert!(book_ok(Some("../etc".into())).is_err());
        assert!(book_ok(Some("x".repeat(201))).is_err());
    }
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Serves one canned (status, body) per connection; returns the base URL and the raw requests.
    async fn fake(status: u16, body: &'static str) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s2 = seen.clone();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                s2.lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&buf[..n]).to_string());
                let resp = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            }
        });
        (base, seen)
    }

    #[tokio::test]
    async fn health_ok_and_http_error() {
        let (base, _) = fake(200, r#"{"status":"ok"}"#).await;
        assert_eq!(
            health(&base).await,
            json!({"ok": true, "body": {"status": "ok"}})
        );
        let (base, _) = fake(503, "{}").await;
        assert_eq!(
            health(&base).await,
            json!({"ok": false, "error": "HTTP 503"})
        );
    }

    #[tokio::test]
    async fn unreachable_never_rejects() {
        let base = "http://127.0.0.1:1";
        assert_eq!(health(base).await, fail(UNREACHABLE));
        assert_eq!(
            post_for_answer(base, "/ask", json!({})).await,
            fail(UNREACHABLE)
        );
    }

    #[tokio::test]
    async fn ask_dedupes_and_sorts_pages_and_sends_payload() {
        let (base, seen) = fake(200, r#"{"answer":"hi","context_pages":[5,2,5,3]}"#).await;
        let r = post_for_answer(&base, "/ask", json!({"question":"q","current_page":4})).await;
        assert_eq!(r, json!({"ok": true, "answer": "hi", "pages": [2, 3, 5]}));
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /ask "));
        assert!(req.contains(r#""current_page":4"#));
    }

    #[tokio::test]
    async fn index_request_and_status_shapes() {
        let (base, seen) = fake(200, r#"{"state":"indexing","done":64,"total":300}"#).await;
        let r = request_index(&base, "abc", r"D:\Books\x.pdf", false).await;
        assert_eq!(
            r,
            json!({"ok": true, "state": "indexing", "done": 64, "total": 300})
        );
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /index "));
        assert!(req.contains(r#""book_id":"abc""#) && req.contains(r#""retry":false"#));

        let (base, seen) = fake(200, r#"{"state":"failed","error":"no text found"}"#).await;
        let r = index_status(&base, "abc").await;
        assert_eq!(r["state"], "failed");
        assert_eq!(r["error"], "no text found");
        assert!(seen.lock().unwrap()[0].starts_with("GET /index/status?book_id=abc "));

        let (base, _) = fake(200, r#"{"state":"weird"}"#).await;
        assert_eq!(index_status(&base, "abc").await["ok"], false);
    }

    #[tokio::test]
    async fn indexing_stops_when_the_service_is_off() {
        let books = vec![
            ("a".to_string(), "a.pdf".to_string()),
            ("b".into(), "b.pdf".into()),
        ];
        assert_eq!(send_for_indexing("http://127.0.0.1:9", &books).await, 0);
        let (base, seen) = fake(200, r#"{"state":"queued"}"#).await;
        assert_eq!(send_for_indexing(&base, &books).await, 2);
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn not_indexed_answers_are_flagged() {
        let (base, _) = fake(
            200,
            r#"{"answer":"This book isn't set up for Ask yet.","context_pages":[],"not_indexed":true}"#,
        )
        .await;
        let r = post_for_answer(&base, "/ask", json!({})).await;
        assert_eq!(r["notIndexed"], true);
    }

    #[tokio::test]
    async fn ask_error_shapes() {
        let (base, _) = fake(500, "{}").await;
        assert_eq!(
            post_for_answer(&base, "/who", json!({})).await,
            fail("rag-service answered HTTP 500")
        );
        let (base, _) = fake(200, r#"{"answer":"x","context_pages":[0]}"#).await;
        assert_eq!(
            post_for_answer(&base, "/ask", json!({})).await,
            fail("rag-service sent an unexpected reply")
        );
    }

    #[tokio::test]
    async fn who_passes_related_terms_through() {
        let (base, _) = fake(
            200,
            r#"{"answer":"a","context_pages":[3],"related":[{"name":"LoRA","relation":"is a version of","direction":"out","pages":[661]}]}"#,
        )
        .await;
        let r = post_for_answer(&base, "/who", json!({})).await;
        assert_eq!(r["related"][0]["name"], "LoRA");
        assert_eq!(r["related"][0]["pages"], json!([661]));
        let (base, _) = fake(
            200,
            r#"{"answer":"a","context_pages":[3],"related":[{"name":"x"}]}"#,
        )
        .await;
        assert_eq!(
            post_for_answer(&base, "/who", json!({})).await,
            fail("rag-service sent an unexpected reply")
        );
    }

    #[test]
    fn validation() {
        assert_eq!(question_ok("  hi  ").unwrap(), "hi");
        assert!(question_ok("   ").is_err());
        assert!(question_ok(&"a".repeat(501)).is_err());
        assert!(question_ok(&"a".repeat(500)).is_ok());
        assert!(name_ok(&"a".repeat(101)).is_err());
        assert!(page_ok(0).is_err());
        assert_eq!(page_ok(1).unwrap(), 1);
    }
}
