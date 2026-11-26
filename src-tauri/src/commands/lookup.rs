//! `lookup` commands: Wikipedia summary (with the thumbnail inlined as a data URL) and
//! opening a look-up page in the default browser or a small secondary window (label `lookup`).
//! Ported from src/main/ipc/lookup.ts and src/shared/lookup.ts.
use crate::error::{invalid, AppError, AppResult};
use base64::Engine;
use reqwest::Url;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const UA: &str = "PageTurn/1.0 (desktop PDF reader; look-up feature)";
const TIMEOUT: Duration = Duration::from_secs(8);
const MAX_THUMB_BYTES: usize = 1_000_000;
const EXTRACT_CHARS: usize = 600;

#[derive(Debug, Serialize, PartialEq)]
pub struct WikiSummary {
    title: String,
    description: Option<String>,
    extract: String,
    thumbnail: Option<String>,
    url: String,
}

/// JavaScript's `encodeURIComponent`.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn is_web(u: &str) -> bool {
    let l = u.to_ascii_lowercase();
    l.starts_with("http://") || l.starts_with("https://")
}

/// `^[a-z]{2,3}(-[a-z]{2,8})?$`
fn language_ok(l: &str) -> bool {
    let mut parts = l.splitn(2, '-');
    let first = parts.next().unwrap_or("");
    let lower = |s: &str, lo: usize, hi: usize| {
        (lo..=hi).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_lowercase())
    };
    lower(first, 2, 3) && parts.next().map_or(true, |s| lower(s, 2, 8))
}

fn url_ok(u: &str) -> bool {
    u.chars().count() <= 2000 && is_web(u) && Url::parse(u).is_ok()
}

/// Trims an extract to whole sentences within EXTRACT_CHARS.
fn trim_extract(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= EXTRACT_CHARS {
        return text.to_string();
    }
    let cut: String = chars[..EXTRACT_CHARS].iter().collect();
    match cut.rfind(". ") {
        Some(end) if cut[..end].chars().count() > 200 => cut[..end + 1].to_string(),
        _ => format!("{}…", cut.trim_end()),
    }
}

/// `data:` URL for a small image of an allowed type, else None.
fn thumb_data_url(content_type: &str, bytes: &[u8]) -> Option<String> {
    let ok = ["png", "jpeg", "gif", "webp", "svg+xml"]
        .iter()
        .any(|t| content_type.starts_with(&format!("image/{t}")));
    if !ok || bytes.len() > MAX_THUMB_BYTES {
        return None;
    }
    let mime = content_type.split(';').next().unwrap_or("");
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

async fn get(client: &reqwest::Client, url: &str) -> Result<reqwest::Response, reqwest::Error> {
    client
        .get(url)
        .header("User-Agent", UA)
        .header("Api-User-Agent", UA)
        .header("Accept", "application/json")
        .timeout(TIMEOUT)
        .send()
        .await
}

async fn thumbnail(client: &reqwest::Client, thumb: Option<&Value>) -> Option<String> {
    let src = thumb?.get("source")?.as_str()?;
    if !src.starts_with("https://") {
        return None;
    }
    let res = get(client, src).await.ok()?;
    let ctype = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !res.status().is_success() {
        return None;
    }
    let bytes = res.bytes().await.ok()?;
    thumb_data_url(&ctype, &bytes)
}

async fn page_summary(
    client: &reqwest::Client,
    base: &str,
    title: &str,
) -> Result<Option<Value>, reqwest::Error> {
    let url = format!(
        "{base}/api/rest_v1/page/summary/{}?redirect=true",
        encode_uri_component(&title.replace(' ', "_"))
    );
    let res = get(client, &url).await?;
    if !res.status().is_success() {
        return Ok(None);
    }
    let json: Value = res.json().await?;
    Ok(match json.get("extract").and_then(Value::as_str) {
        Some(e) if !e.is_empty() => Some(json),
        _ => None,
    })
}

/// Best-matching article for a phrase: the exact title (following redirects), else the top
/// search hit. `base` is `https://{lang}.wikipedia.org` (overridable for tests).
async fn wikipedia_summary(
    client: &reqwest::Client,
    base: &str,
    query: &str,
) -> Result<Option<WikiSummary>, reqwest::Error> {
    let mut page = page_summary(client, base, query).await?;
    if page.is_none() {
        let url = format!(
            "{base}/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch={}",
            encode_uri_component(query)
        );
        let res = get(client, &url).await?;
        if !res.status().is_success() {
            return Ok(None);
        }
        let json: Value = res.json().await?;
        let Some(first) = json
            .pointer("/query/search/0/title")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            return Ok(None);
        };
        page = page_summary(client, base, &first).await?;
    }
    let Some(page) = page else { return Ok(None) };

    let title = match page.get("title") {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => query.to_string(),
    };
    let url = match page
        .pointer("/content_urls/desktop/page")
        .and_then(Value::as_str)
    {
        Some(u) if is_web(u) => u.to_string(),
        _ => format!(
            "{base}/wiki/{}",
            encode_uri_component(&title.replace(' ', "_"))
        ),
    };
    Ok(Some(WikiSummary {
        description: page
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        extract: trim_extract(page["extract"].as_str().unwrap_or("")),
        thumbnail: thumbnail(client, page.get("thumbnail")).await,
        title,
        url,
    }))
}

#[tauri::command]
pub async fn lookup_wikipedia(query: String, lang: String) -> AppResult<Option<WikiSummary>> {
    let query = query.trim().to_string();
    if query.is_empty() || query.chars().count() > 300 {
        return Err(invalid("query must be 1 to 300 characters"));
    }
    if !language_ok(&lang) {
        return Err(invalid("bad language code"));
    }
    let client = reqwest::Client::new();
    wikipedia_summary(&client, &format!("https://{lang}.wikipedia.org"), &query)
        .await
        .map_err(|e| AppError::Msg(format!("Wikipedia could not be reached ({e})")))
}

#[tauri::command]
pub async fn lookup_open(app: AppHandle, url: String, r#where: String) -> AppResult<()> {
    if !url_ok(&url) {
        return Err(invalid("only http(s) addresses can be opened"));
    }
    match r#where.as_str() {
        "browser" => app
            .opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| AppError::Msg(e.to_string())),
        "app" => open_lookup_window(&app, &url),
        _ => Err(invalid("where must be 'app' or 'browser'")),
    }
}

/// A small separate window for look-up results, reused for every look-up.
fn open_lookup_window(app: &AppHandle, url: &str) -> AppResult<()> {
    let parsed = Url::parse(url).map_err(invalid)?;
    if let Some(win) = app.get_webview_window("lookup") {
        win.navigate(parsed)?;
        win.show()?;
        win.set_focus()?;
        return Ok(());
    }
    let mut b = WebviewWindowBuilder::new(app, "lookup", WebviewUrl::External(parsed))
        .title("Look up")
        .inner_size(520.0, 760.0)
        .on_navigation(|u| matches!(u.scheme(), "http" | "https"));
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(pos), Ok(size), Ok(scale)) = (
            main.outer_position(),
            main.outer_size(),
            main.scale_factor(),
        ) {
            // Top-right of the main window, like PageTurn 1.x.
            let x = (pos.x as f64 + size.width as f64) / scale - 520.0 - 24.0;
            b = b.position(x.max(0.0), pos.y as f64 / scale + 48.0);
        }
    }
    b.build()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A fake Wikipedia: routes by substring of the request line.
    async fn fake(routes: Vec<(&'static str, u16, String)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let routes = routes.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let line = req.lines().next().unwrap_or("").to_string();
                    let (status, body) = routes
                        .iter()
                        .find(|(p, _, _)| line.contains(p))
                        .map(|(_, s, b)| (*s, b.clone()))
                        .unwrap_or((404, "{}".into()));
                    let resp = format!(
                        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                });
            }
        });
        base
    }

    fn ocean() -> String {
        r#"{"title":"Ocean","description":"Body of salt water","extract":"The ocean is salt water.","content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/Ocean"}}}"#.into()
    }

    #[tokio::test]
    async fn exact_title_summary() {
        let base = fake(vec![("/page/summary/Ocean?redirect=true", 200, ocean())]).await;
        let s = wikipedia_summary(&reqwest::Client::new(), &base, "Ocean")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(s.title, "Ocean");
        assert_eq!(s.description.as_deref(), Some("Body of salt water"));
        assert_eq!(s.url, "https://en.wikipedia.org/wiki/Ocean");
        assert_eq!(s.thumbnail, None);
    }

    #[tokio::test]
    async fn falls_back_to_search_hit_and_builds_url() {
        let base = fake(vec![
            (
                "list=search",
                200,
                r#"{"query":{"search":[{"title":"Ocean"}]}}"#.into(),
            ),
            (
                "/page/summary/Ocean",
                200,
                r#"{"title":"Ocean","extract":"Salt."}"#.into(),
            ),
        ])
        .await;
        let s = wikipedia_summary(&reqwest::Client::new(), &base, "the wide sea")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(s.url, format!("{base}/wiki/Ocean"));
        assert_eq!(s.description, None);
    }

    #[tokio::test]
    async fn null_when_nothing_matches() {
        let base = fake(vec![(
            "list=search",
            200,
            r#"{"query":{"search":[]}}"#.into(),
        )])
        .await;
        assert_eq!(
            wikipedia_summary(&reqwest::Client::new(), &base, "qwxzv")
                .await
                .unwrap(),
            None
        );
    }

    #[test]
    fn long_extract_is_cut_at_a_sentence() {
        let long = "A sentence that goes on for a while. ".repeat(40);
        let t = trim_extract(&long);
        assert!(t.chars().count() <= 600 && t.ends_with('.'));
        assert_eq!(trim_extract("short"), "short");
        assert!(trim_extract(&"x".repeat(700)).ends_with('…'));
    }

    #[test]
    fn thumbnails() {
        assert_eq!(
            thumb_data_url("image/jpeg; charset=x", &[1, 2, 3]).as_deref(),
            Some("data:image/jpeg;base64,AQID")
        );
        assert_eq!(thumb_data_url("text/html", &[1]), None);
        assert_eq!(
            thumb_data_url("image/png", &vec![0; MAX_THUMB_BYTES + 1]),
            None
        );
    }

    #[test]
    fn validation() {
        assert!(language_ok("en") && language_ok("zh-hans") && language_ok("pa"));
        assert!(
            !language_ok("EN") && !language_ok("e") && !language_ok("en-") && !language_ok("a.b")
        );
        assert!(url_ok("https://example.com/x") && url_ok("HTTP://example.com"));
        assert!(!url_ok("file:///etc/passwd") && !url_ok("javascript:alert(1)"));
        assert_eq!(encode_uri_component("a b/é'()"), "a%20b%2F%C3%A9'()");
    }
}
