//! `rag` commands: thin proxies to the Python rag-service on localhost:8000.
//! Ported from src/main/ipc/rag.ts. They never reject for service failures: those come
//! back as `{ok:false,error}`. Only invalid arguments are an `Err`.
use crate::error::{invalid, AppResult};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::time::Duration;

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

/// POSTs to an endpoint that answers with text + the pages it used.
async fn post_for_answer(base: &str, path: &str, payload: Value) -> Value {
    let client = reqwest::Client::new();
    let res = match client
        .post(format!("{base}{path}"))
        .json(&payload)
        .timeout(Duration::from_secs(60))
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
    json!({ "ok": true, "answer": answer, "pages": pages.into_iter().collect::<Vec<_>>() })
}

#[tauri::command]
pub async fn rag_health() -> AppResult<Value> {
    Ok(health(RAG_URL).await)
}

#[tauri::command]
pub async fn rag_ask(question: String, current_page: i64) -> AppResult<Value> {
    let payload =
        json!({ "question": question_ok(&question)?, "current_page": page_ok(current_page)? });
    Ok(post_for_answer(RAG_URL, "/ask", payload).await)
}

#[tauri::command]
pub async fn rag_who(name: String, current_page: i64) -> AppResult<Value> {
    let payload = json!({ "name": name_ok(&name)?, "current_page": page_ok(current_page)? });
    Ok(post_for_answer(RAG_URL, "/who", payload).await)
}

#[cfg(test)]
mod tests {
    use super::*;
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
