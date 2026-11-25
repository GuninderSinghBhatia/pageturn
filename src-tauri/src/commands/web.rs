//! `web` commands: the Help panel's Web tab.
//!
//! LIMITATION (first version): Electron embeds the page inside the main window with a
//! WebContentsView. Tauri's multi-webview support is unstable, so here the page lives in its
//! own borderless `tauri::WebviewWindow` (label `web`), owned by the main window and placed
//! over the rectangle the renderer reserves (CSS pixels relative to the main window's client
//! area, converted with the scale factor). It is a separate OS window: it does not clip with
//! the main window's content, and the renderer must keep calling `web_set_bounds`. History
//! buttons use `history.back()` etc.; Tauri exposes no history state, so `canGoBack` is
//! derived from how many page loads were seen (approximate) and `canGoForward` is true only
//! after a back. `error` is always null: Tauri has no load-failure callback.
//! Web state is emitted as the `web:state` event.
use crate::error::{invalid, AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

use super::lookup::encode_uri_component;

const LABEL: &str = "web";

#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Bounds {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

impl Bounds {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| *v <= 20_000)
    }
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebState {
    url: String,
    can_go_back: bool,
    can_go_forward: bool,
    loading: bool,
    error: Option<String>,
}

struct Nav {
    url: String,
    loads: u32,
    forward: bool,
    loading: bool,
}

static NAV: Mutex<Nav> = Mutex::new(Nav {
    url: String::new(),
    loads: 0,
    forward: false,
    loading: false,
});

fn nav() -> std::sync::MutexGuard<'static, Nav> {
    NAV.lock().unwrap_or_else(|e| e.into_inner())
}

fn engine_url(engine: &str) -> &'static str {
    match engine {
        "google" => "https://www.google.com/search?q=",
        "bing" => "https://www.bing.com/search?q=",
        _ => "https://duckduckgo.com/?q=",
    }
}

/// Search address for a query, optionally with the book title (in quotes) added.
pub fn search_url(
    engine: &str,
    query: &str,
    book_title: Option<&str>,
    include_title: bool,
) -> String {
    let q = match book_title {
        Some(t) if include_title && !t.is_empty() => format!("{query} \"{t}\""),
        _ => query.to_string(),
    };
    format!("{}{}", engine_url(engine), encode_uri_component(&q))
}

pub fn is_allowed_navigation(url: &str) -> bool {
    Url::parse(url)
        .map(|u| matches!(u.scheme(), "http" | "https"))
        .unwrap_or(false)
}

fn setting(conn: &rusqlite::Connection, key: &str) -> Option<serde_json::Value> {
    let raw: String = conn
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .ok()?;
    serde_json::from_str(&raw).ok()
}

fn emit(app: &AppHandle) {
    let state = {
        let n = nav();
        WebState {
            url: n.url.clone(),
            can_go_back: n.loads > 1,
            can_go_forward: n.forward,
            loading: n.loading,
            error: None,
        }
    };
    let _ = app.emit("web:state", state);
}

/// Puts the window over `b` (CSS pixels relative to the main window's client area).
fn place(app: &AppHandle, win: &WebviewWindow, b: Bounds) -> AppResult<()> {
    let (mut x, mut y) = (b.x as f64, b.y as f64);
    if let Some(main) = app.get_webview_window("main") {
        let scale = main.scale_factor().unwrap_or(1.0);
        if let Ok(origin) = main.inner_position() {
            x += origin.x as f64 / scale;
            y += origin.y as f64 / scale;
        }
    }
    win.set_size(LogicalSize::new(
        b.width.max(1) as f64,
        b.height.max(1) as f64,
    ))?;
    win.set_position(LogicalPosition::new(x, y))?;
    Ok(())
}

fn bounds_arg(v: serde_json::Value) -> AppResult<Bounds> {
    let b: Bounds = serde_json::from_value(v).map_err(invalid)?;
    if !b.valid() {
        return Err(invalid("bounds out of range"));
    }
    Ok(b)
}

fn web_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

#[tauri::command]
pub async fn web_show(
    app: AppHandle,
    state: State<'_, AppState>,
    query: String,
    bounds: serde_json::Value,
    book_title: Option<String>,
) -> AppResult<()> {
    let query = query.trim().to_string();
    if query.is_empty() || query.chars().count() > 1000 {
        return Err(invalid("query must be 1 to 1000 characters"));
    }
    if book_title.as_ref().is_some_and(|t| t.chars().count() > 500) {
        return Err(invalid("title too long"));
    }
    let bounds = bounds_arg(bounds)?;
    let (engine, include) = state.with_db(|c| {
        Ok((
            setting(c, "searchEngine")
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_else(|| "duckduckgo".into()),
            setting(c, "searchIncludeTitle")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        ))
    })?;
    let url = search_url(&engine, &query, book_title.as_deref(), include);
    let parsed = Url::parse(&url).map_err(invalid)?;
    {
        let mut n = nav();
        n.url = url;
        n.loads = 0;
        n.forward = false;
        n.loading = true;
    }
    if let Some(win) = web_window(&app) {
        place(&app, &win, bounds)?;
        win.navigate(parsed)?;
        win.show()?;
    } else {
        let (app_nav, app_load) = (app.clone(), app.clone());
        let mut b = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(parsed))
            .title("Web")
            .decorations(false)
            .skip_taskbar(true)
            .on_navigation(move |u| {
                if !matches!(u.scheme(), "http" | "https") {
                    return false;
                }
                nav().url = u.to_string();
                emit(&app_nav);
                true
            })
            .on_page_load(move |_w, payload| {
                {
                    let mut n = nav();
                    n.url = payload.url().to_string();
                    match payload.event() {
                        PageLoadEvent::Started => n.loading = true,
                        PageLoadEvent::Finished => {
                            n.loading = false;
                            n.loads += 1;
                        }
                    }
                }
                emit(&app_load);
            });
        if let Some(main) = app.get_webview_window("main") {
            b = b.parent(&main)?;
        }
        let win = b.build()?;
        place(&app, &win, bounds)?;
    }
    emit(&app);
    Ok(())
}

/// Shows the window again (same page and history) without navigating.
#[tauri::command]
pub async fn web_reveal(app: AppHandle, bounds: serde_json::Value) -> AppResult<()> {
    let bounds = bounds_arg(bounds)?;
    if let Some(win) = web_window(&app) {
        place(&app, &win, bounds)?;
        win.show()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_set_bounds(app: AppHandle, bounds: serde_json::Value) -> AppResult<()> {
    let bounds = bounds_arg(bounds)?;
    if let Some(win) = web_window(&app) {
        if win.is_visible().unwrap_or(false) {
            place(&app, &win, bounds)?;
        }
    }
    Ok(())
}

/// Takes the window off screen; it keeps its page and history for next time.
#[tauri::command]
pub async fn web_hide(app: AppHandle) -> AppResult<()> {
    if let Some(win) = web_window(&app) {
        win.hide()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_back(app: AppHandle) -> AppResult<()> {
    if let Some(win) = web_window(&app) {
        {
            let mut n = nav();
            if n.loads > 1 {
                n.loads -= 1;
                n.forward = true;
            }
        }
        win.eval("history.back()").map_err(AppError::from)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_forward(app: AppHandle) -> AppResult<()> {
    if let Some(win) = web_window(&app) {
        win.eval("history.forward()").map_err(AppError::from)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_reload(app: AppHandle) -> AppResult<()> {
    if let Some(win) = web_window(&app) {
        win.eval("location.reload()").map_err(AppError::from)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_open_external(app: AppHandle) -> AppResult<()> {
    let url = nav().url.clone();
    if web_window(&app).is_some() && is_allowed_navigation(&url) {
        app.opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| AppError::Msg(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_url_every_engine() {
        assert_eq!(
            search_url("duckduckgo", "hello world", None, false),
            "https://duckduckgo.com/?q=hello%20world"
        );
        assert_eq!(
            search_url("google", "a&b", None, true),
            "https://www.google.com/search?q=a%26b"
        );
        assert_eq!(
            search_url("bing", "who", Some("Dune"), true),
            "https://www.bing.com/search?q=who%20%22Dune%22"
        );
        assert_eq!(
            search_url("bing", "who", Some("Dune"), false),
            "https://www.bing.com/search?q=who"
        );
        assert_eq!(
            search_url("google", "who", Some(""), true),
            "https://www.google.com/search?q=who"
        );
    }

    #[test]
    fn navigation_allowlist() {
        assert!(is_allowed_navigation("https://a.com") && is_allowed_navigation("http://a.com"));
        assert!(!is_allowed_navigation("file:///c:/x") && !is_allowed_navigation("nonsense"));
        assert!(!is_allowed_navigation("javascript:alert(1)"));
    }

    #[test]
    fn bounds_validation() {
        let ok = serde_json::json!({"x":0,"y":10,"width":300,"height":200});
        assert!(bounds_arg(ok).is_ok());
        assert!(bounds_arg(serde_json::json!({"x":-1,"y":0,"width":1,"height":1})).is_err());
        assert!(bounds_arg(serde_json::json!({"x":0,"y":0,"width":20001,"height":1})).is_err());
        assert!(bounds_arg(serde_json::json!({"x":0,"y":0,"width":1,"height":1,"z":1})).is_err());
    }

    #[test]
    fn reads_settings_table() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
             INSERT INTO settings VALUES ('searchEngine','\"bing\"'),('searchIncludeTitle','true');",
        )
        .unwrap();
        assert_eq!(setting(&c, "searchEngine").unwrap().as_str(), Some("bing"));
        assert_eq!(
            setting(&c, "searchIncludeTitle").unwrap().as_bool(),
            Some(true)
        );
        assert!(setting(&c, "nope").is_none());
    }
}
