//! `ai` commands: explanations and follow-ups streamed from Anthropic, OpenAI or Gemini.
//!
//! Ported from src/main/ai/* and src/main/ipc/ai.ts. Keys come from the settings module
//! (`settings::api_key`), never reach the UI and are never logged. Tokens stream back as the
//! events `ai:token`, `ai:done` and `ai:error`.
use crate::error::{invalid, AppResult};
use crate::llm::chatgpt::{self, ChatGptProvider};
use crate::llm::claude_code::{self, ClaudeCodeProvider};
use crate::llm::{Prompt, Provider};
use crate::state::AppState;
use futures_util::future::BoxFuture;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

// ---------------------------------------------------------------------------------------
// Shared types (src/shared/ai.ts)
// ---------------------------------------------------------------------------------------

/// Providers that use the reader's own API key.
const PROVIDERS: [&str; 3] = ["anthropic", "openai", "gemini"];
/// The reader's Claude plan, through their installed Claude Code CLI (no key).
pub const CLAUDE: &str = "claude";
/// The reader's ChatGPT plan, through Sign in with ChatGPT (no key).
pub const CHATGPT: &str = "chatgpt";

/// Plan providers sign in their own way; they never use a saved API key.
fn is_plan(provider: &str) -> bool {
    provider == CLAUDE || provider == CHATGPT
}

fn default_model(provider: &str) -> &'static str {
    match provider {
        "openai" => "gpt-5",
        "gemini" => "gemini-3.8-flash",
        CLAUDE | CHATGPT => "default",
        _ => "claude-sonnet-5-5",
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AiError {
    pub kind: &'static str,
    pub message: String,
}

fn default_message(kind: &str) -> &'static str {
    match kind {
        "no_key" => "Add an API key in Settings to get explanations.",
        "invalid_key" => "The API key was rejected. Check it in Settings.",
        "rate_limit" => "The AI provider is rate limiting requests. Try again in a moment.",
        "offline" => "Could not reach the AI provider. Check your internet connection.",
        "timeout" => "The AI provider took too long to answer.",
        _ => "The AI provider returned an error.",
    }
}

fn ai_error(kind: &'static str) -> AiError {
    AiError {
        kind,
        message: default_message(kind).to_string(),
    }
}

fn ai_error_msg(kind: &'static str, message: impl Into<String>) -> AiError {
    AiError {
        kind,
        message: message.into(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChatMessage {
    pub role: &'static str,
    pub content: String,
}

fn msg(role: &'static str, content: impl Into<String>) -> ChatMessage {
    ChatMessage {
        role,
        content: content.into(),
    }
}

/// What the renderer sends for an explanation: the selection plus nearby text.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExplainRequest {
    pub book_title: Option<String>,
    pub heading: Option<String>,
    pub selection: String,
    pub pages: Vec<i64>,
    pub page_text: String,
    pub prev_tail: String,
    pub next_head: String,
}

fn len(s: &str) -> usize {
    s.chars().count()
}

/// The zod `ExplainRequestSchema`.
fn validate_explain(r: &ExplainRequest) -> AppResult<()> {
    let ok = r.book_title.as_deref().map_or(true, |s| len(s) <= 500)
        && r.heading.as_deref().map_or(true, |s| len(s) <= 500)
        && (1..=100_000).contains(&len(&r.selection))
        && (1..=4).contains(&r.pages.len())
        && r.pages.iter().all(|p| *p >= 1)
        && len(&r.page_text) <= 400_000
        && len(&r.prev_tail) <= 10_000
        && len(&r.next_head) <= 10_000;
    if ok {
        Ok(())
    } else {
        Err(invalid("explain request"))
    }
}

/// `^[A-Za-z0-9-]{8,64}$`
fn validate_request_id(id: &str) -> AppResult<()> {
    let n = id.len();
    if (8..=64).contains(&n) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        Ok(())
    } else {
        Err(invalid("request id"))
    }
}

fn validate_provider(p: &str) -> AppResult<()> {
    if PROVIDERS.contains(&p) {
        Ok(())
    } else {
        Err(invalid("provider"))
    }
}

/// Of a provider's model list, the ones that can chat (no embeddings, audio, images...).
pub fn chat_models(provider: &str, ids: &[String]) -> Vec<String> {
    const SKIP: [&str; 15] = [
        "embed",
        "audio",
        "tts",
        "transcribe",
        "whisper",
        "image",
        "dall-e",
        "realtime",
        "search",
        "moderation",
        "vision",
        "live",
        "preview-tts",
        "aqa",
        "instruct",
    ];
    let keep = |id: &str| -> bool {
        match provider {
            "anthropic" => id.starts_with("claude-"),
            "openai" => {
                let b = id.as_bytes();
                id.starts_with("gpt-")
                    || id.starts_with("chatgpt-")
                    || (b.len() >= 2 && b[0] == b'o' && b[1].is_ascii_digit())
            }
            "gemini" => id.starts_with("gemini-"),
            _ => false,
        }
    };
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        let lower = id.to_lowercase();
        if keep(id) && !SKIP.iter().any(|s| lower.contains(s)) && !out.contains(id) {
            out.push(id.clone());
        }
    }
    out.sort();
    out
}

// ---------------------------------------------------------------------------------------
// Prompt (src/main/ai/prompt.ts)
// ---------------------------------------------------------------------------------------

pub const MAX_CONTEXT: usize = 12_000;

const SYSTEM: &str = "You help someone who is reading a book and got stuck on a passage.
Explain the selected passage clearly and plainly, for a curious reader who is not an expert.
- Define any jargon or unusual terms you use or that appear in the passage.
- Give a short example or analogy when it helps.
- For math, code or logic, go step by step.
- If the passage is ambiguous, or the context is not enough to be sure, say so briefly.
- Use the surrounding page text only as context; focus on the selected part.
Keep it under about 250 words unless the reader asks for more. Use Markdown; use LaTeX ($...$) for math.";

fn size(r: &ExplainRequest) -> usize {
    r.book_title.as_deref().map_or(0, len)
        + r.heading.as_deref().map_or(0, len)
        + len(&r.selection)
        + len(&r.page_text)
        + len(&r.prev_tail)
        + len(&r.next_head)
}

fn take_chars(s: &str, from: usize, n: usize) -> String {
    s.chars().skip(from).take(n).collect()
}

/// Cuts `text` to `budget` chars around the first occurrence of `focus` (or its start).
fn around(text: &str, focus: &str, budget: i64) -> String {
    if budget <= 0 {
        return String::new();
    }
    let total = len(text) as i64;
    if total <= budget {
        return text.to_string();
    }
    let at = text
        .find(focus)
        .map_or(0, |b| text[..b].chars().count() as i64);
    let start = (at - (budget - len(focus) as i64).div_euclid(2))
        .min(total - budget)
        .max(0);
    take_chars(text, start as usize, budget as usize)
}

/// Keeps the request within MAX_CONTEXT characters. Drop order: the previous page's tail,
/// the next page's head, then the page text around the selection; a selection that alone
/// is too long is cut to MAX_CONTEXT - 200 characters plus an ellipsis.
pub fn cap_context(r: &ExplainRequest) -> ExplainRequest {
    let mut out = r.clone();
    if size(&out) <= MAX_CONTEXT {
        return out;
    }
    out.prev_tail = String::new();
    if size(&out) <= MAX_CONTEXT {
        return out;
    }
    out.next_head = String::new();
    if size(&out) <= MAX_CONTEXT {
        return out;
    }
    let fixed = out.book_title.as_deref().map_or(0, len) + out.heading.as_deref().map_or(0, len);
    let limit = MAX_CONTEXT - 200;
    if len(&out.selection) > limit {
        out.selection = format!("{}…", take_chars(&out.selection, 0, limit));
        out.page_text = String::new();
        return out;
    }
    let budget = MAX_CONTEXT as i64 - fixed as i64 - len(&out.selection) as i64;
    out.page_text = around(&out.page_text, &out.selection, budget);
    out
}

/// System prompt and the first user message for an explanation.
pub fn build_explain_messages(r: &ExplainRequest) -> (String, Vec<ChatMessage>) {
    let mut head: Vec<String> = Vec::new();
    if let Some(t) = r.book_title.as_deref().filter(|s| !s.is_empty()) {
        head.push(format!("Book: {t}"));
    }
    if let Some(h) = r.heading.as_deref().filter(|s| !s.is_empty()) {
        head.push(format!("Section: {h}"));
    }
    let head = head.join("\n");
    let mut content = String::new();
    if !head.is_empty() {
        content.push_str(&head);
        content.push_str("\n\n");
    }
    content.push_str(&format!(
        "<context_before>{}</context_before>\n<page>{}</page>\n<context_after>{}</context_after>\n\nI'm stuck on this part:\n<selection>{}</selection>\n\nExplain it.",
        r.prev_tail, r.page_text, r.next_head, r.selection
    ));
    (SYSTEM.to_string(), vec![msg("user", content)])
}

// ---------------------------------------------------------------------------------------
// Errors (src/main/ai/provider.ts: toAiError)
// ---------------------------------------------------------------------------------------

/// What the JS SDK errors carried: an HTTP status, a node-style code, a name, a message.
#[derive(Debug, Clone, Default)]
pub struct ProviderErr {
    pub status: Option<u16>,
    pub code: Option<&'static str>,
    pub name: Option<&'static str>,
    pub message: String,
}

impl ProviderErr {
    fn status(status: u16, message: impl Into<String>) -> Self {
        ProviderErr {
            status: Some(status),
            message: message.into(),
            ..Default::default()
        }
    }
    fn msg(message: impl Into<String>) -> Self {
        Self::from_message(message)
    }
    pub fn from_message(message: impl Into<String>) -> Self {
        ProviderErr {
            message: message.into(),
            ..Default::default()
        }
    }
}

/// Maps HTTP / network errors to the kinds the panel knows how to explain.
pub fn to_ai_error(e: &ProviderErr) -> AiError {
    // Claude plan failures carry their own codes; "no_key" makes the panel offer Settings.
    match e.code {
        Some(claude_code::MISSING) => return ai_error_msg(
            "no_key",
            "Claude Code is not installed. Install it, or pick another AI provider in Settings.",
        ),
        Some(claude_code::SIGNED_OUT) => {
            return ai_error_msg(
                "no_key",
                "Sign in to Claude Code in Settings to use your Claude plan.",
            )
        }
        Some(claude_code::PLAN_LIMIT) | Some(chatgpt::PLAN_LIMIT) => {
            return ai_error_msg("rate_limit", e.message.clone())
        }
        Some(chatgpt::SIGNED_OUT) => {
            return ai_error_msg(
                "no_key",
                "Sign in with ChatGPT in Settings to use your ChatGPT plan.",
            )
        }
        Some(chatgpt::PLAN_OFF) => return ai_error_msg(
            "no_key",
            "PageTurn doesn't have permission to use your ChatGPT plan. Turn it on in Settings.",
        ),
        Some(chatgpt::NOT_ELIGIBLE) => return ai_error_msg("provider", e.message.clone()),
        _ => {}
    }
    if matches!(e.status, Some(401) | Some(403)) {
        return ai_error("invalid_key");
    }
    let lower = e.message.to_lowercase();
    if lower.contains("api_key_invalid")
        || lower.contains("api key not valid")
        || lower.replace('_', " ").contains("invalid api key")
    {
        return ai_error("invalid_key"); // e.g. Gemini answers a bad key with 400
    }
    if e.status == Some(429) {
        return ai_error("rate_limit");
    }
    if matches!(e.name, Some("AbortError") | Some("TimeoutError")) {
        return ai_error("timeout");
    }
    let offline_code = matches!(
        e.code,
        Some("ENOTFOUND" | "ECONNREFUSED" | "ECONNRESET" | "EAI_AGAIN" | "ETIMEDOUT")
    );
    if offline_code
        || ["fetch failed", "network", "getaddrinfo", "connection error"]
            .iter()
            .any(|s| lower.contains(s))
    {
        return ai_error("offline");
    }
    if e.status.is_some_and(|s| s >= 500) {
        return ai_error_msg(
            "provider",
            "The AI provider is having trouble right now. Try again shortly.",
        );
    }
    if e.message.is_empty() {
        ai_error("provider")
    } else {
        ai_error_msg(
            "provider",
            format!("The AI provider returned an error: {}", e.message),
        )
    }
}

fn net_err(e: reqwest::Error) -> ProviderErr {
    if e.is_timeout() {
        ProviderErr {
            name: Some("TimeoutError"),
            message: "request timed out".into(),
            ..Default::default()
        }
    } else {
        // reqwest's Display can include the URL; keep the message generic.
        ProviderErr {
            code: Some("ECONNREFUSED"),
            message: "fetch failed".into(),
            ..Default::default()
        }
    }
}

/// The human message inside a provider's JSON error body.
fn error_message(status: u16, body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        let e = &v["error"];
        if let Some(m) = e["message"].as_str().or_else(|| e.as_str()) {
            return m.to_string();
        }
    }
    let t = body.trim();
    if t.is_empty() {
        format!("HTTP {status}")
    } else {
        t.chars().take(300).collect()
    }
}

// ---------------------------------------------------------------------------------------
// HTTP + SSE
// ---------------------------------------------------------------------------------------

fn http() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_default()
    })
}

/// Sends the request; one retry on connection errors, 408/409/429 and 5xx (the SDKs'
/// `maxRetries: 1`). Non-2xx answers become a `ProviderErr` with the provider's message.
async fn send(req: reqwest::RequestBuilder) -> Result<reqwest::Response, ProviderErr> {
    let retry = req.try_clone();
    let first = req.send().await;
    let retryable = match &first {
        Err(e) => !e.is_timeout(),
        Ok(r) => matches!(r.status().as_u16(), 408 | 409 | 429 | 500..=599),
    };
    let res = match (retryable, retry) {
        (true, Some(r2)) => {
            tokio::time::sleep(Duration::from_millis(500)).await;
            r2.send().await
        }
        _ => first,
    };
    let resp = res.map_err(net_err)?;
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Err(ProviderErr::status(status, error_message(status, &body)))
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

/// Incremental server-sent-events parser; keeps bytes so an event (or a UTF-8 character)
/// split across network chunks is reassembled.
#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.buf.drain(..=pos).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            self.line(&String::from_utf8_lossy(&line), &mut out);
        }
        out
    }

    /// End of stream: an unterminated last event still counts.
    pub fn finish(&mut self) -> Vec<SseEvent> {
        let mut out = Vec::new();
        if !self.buf.is_empty() {
            let line = String::from_utf8_lossy(&std::mem::take(&mut self.buf)).into_owned();
            self.line(line.trim_end_matches('\r'), &mut out);
        }
        self.line("", &mut out);
        out
    }

    fn line(&mut self, line: &str, out: &mut Vec<SseEvent>) {
        if line.is_empty() {
            if !self.data.is_empty() || self.event.is_some() {
                out.push(SseEvent {
                    event: self.event.take(),
                    data: std::mem::take(&mut self.data).join("\n"),
                });
            }
            return;
        }
        if line.starts_with(':') {
            return;
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "event" => self.event = Some(value.to_string()),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
    }
}

type Handler = fn(&SseEvent) -> Result<Option<String>, ProviderErr>;
type OnToken<'a> = &'a mut (dyn FnMut(&str) + Send);

fn dispatch(events: Vec<SseEvent>, handler: Handler, on_token: OnToken) -> Result<(), ProviderErr> {
    for ev in events {
        if let Some(t) = handler(&ev)? {
            if !t.is_empty() {
                on_token(&t);
            }
        }
    }
    Ok(())
}

async fn drive(
    resp: reqwest::Response,
    handler: Handler,
    on_token: OnToken<'_>,
) -> Result<(), ProviderErr> {
    let mut parser = SseParser::default();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(net_err)?;
        dispatch(parser.feed(&chunk), handler, on_token)?;
    }
    dispatch(parser.finish(), handler, on_token)
}

// ---------------------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------------------

pub struct StreamArgs {
    pub key: String,
    pub model: String,
    pub system: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Anthropic,
    OpenAi,
    Gemini,
    Mock,
}

fn kind_for(provider: &str, mock: bool) -> Kind {
    if mock {
        return Kind::Mock;
    }
    match provider {
        "openai" => Kind::OpenAi,
        "gemini" => Kind::Gemini,
        _ => Kind::Anthropic,
    }
}

fn mock_enabled() -> bool {
    std::env::var("PAGETURN_AI_MOCK").as_deref() == Ok("1")
}

fn parse_data(ev: &SseEvent) -> Option<Value> {
    serde_json::from_str::<Value>(&ev.data).ok()
}

// --- Anthropic ---------------------------------------------------------------------------

/// Models that accept server-side refusal fallbacks.
const FALLBACK_MODELS: [&str; 4] = [
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-fable-5-1",
];
const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

fn anthropic_body(args: &StreamArgs) -> Value {
    let mut body = json!({
        "model": args.model,
        "max_tokens": 1024,
        "stream": true,
        "system": args.system,
        "messages": args.messages,
    });
    if FALLBACK_MODELS.contains(&args.model.as_str()) {
        body["fallbacks"] = json!("default");
    }
    body
}

fn anthropic_req(path: &str, key: &str) -> reqwest::RequestBuilder {
    let url = format!("{ANTHROPIC_URL}{path}");
    let b = if path.starts_with("/models") {
        http().get(url)
    } else {
        http().post(url)
    };
    b.header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
}

fn anthropic_event(ev: &SseEvent) -> Result<Option<String>, ProviderErr> {
    let Some(v) = parse_data(ev) else {
        return Ok(None);
    };
    let ty = v["type"].as_str().or(ev.event.as_deref()).unwrap_or("");
    match ty {
        "content_block_delta" if v["delta"]["type"] == "text_delta" => {
            Ok(v["delta"]["text"].as_str().map(str::to_string))
        }
        "message_delta" if v["delta"]["stop_reason"] == "refusal" => Err(ProviderErr::msg(
            "The model declined to explain this passage.",
        )),
        "error" => Err(ProviderErr::msg(
            v["error"]["message"].as_str().unwrap_or("stream error"),
        )),
        _ => Ok(None),
    }
}

async fn anthropic_stream(args: &StreamArgs, on_token: OnToken<'_>) -> Result<(), ProviderErr> {
    let fallback = FALLBACK_MODELS.contains(&args.model.as_str());
    let path = if fallback {
        "/messages?beta=true"
    } else {
        "/messages"
    };
    let mut req = anthropic_req(path, &args.key).json(&anthropic_body(args));
    if fallback {
        req = req.header("anthropic-beta", FALLBACK_BETA);
    }
    drive(send(req).await?, anthropic_event, on_token).await
}

async fn anthropic_list(key: &str) -> Result<Vec<String>, ProviderErr> {
    let mut ids = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let mut path = "/models?limit=100".to_string();
        if let Some(a) = &after {
            path.push_str(&format!("&after_id={}", urlencoding::encode(a)));
        }
        let v: Value = send(anthropic_req(&path, key))
            .await?
            .json()
            .await
            .map_err(net_err)?;
        for m in v["data"].as_array().into_iter().flatten() {
            if let Some(id) = m["id"].as_str() {
                ids.push(id.to_string());
            }
        }
        match (v["has_more"].as_bool(), v["last_id"].as_str()) {
            (Some(true), Some(last)) => after = Some(last.to_string()),
            _ => return Ok(ids),
        }
    }
}

async fn anthropic_test(key: &str, model: &str) -> Result<(), ProviderErr> {
    let body = json!({
        "model": model,
        "max_tokens": 16,
        "messages": [{"role": "user", "content": "Reply with OK."}],
    });
    send(anthropic_req("/messages", key).json(&body)).await?;
    Ok(())
}

// --- OpenAI ------------------------------------------------------------------------------

const OPENAI_URL: &str = "https://api.openai.com/v1";

fn openai_body(args: &StreamArgs) -> Value {
    let mut messages = vec![json!({"role": "system", "content": args.system})];
    messages.extend(args.messages.iter().map(|m| json!(m)));
    json!({"model": args.model, "stream": true, "messages": messages})
}

fn openai_event(ev: &SseEvent) -> Result<Option<String>, ProviderErr> {
    if ev.data.trim() == "[DONE]" {
        return Ok(None);
    }
    let Some(v) = parse_data(ev) else {
        return Ok(None);
    };
    if let Some(m) = v["error"]["message"].as_str() {
        return Err(ProviderErr::msg(m));
    }
    Ok(v["choices"][0]["delta"]["content"]
        .as_str()
        .map(str::to_string))
}

async fn openai_stream(args: &StreamArgs, on_token: OnToken<'_>) -> Result<(), ProviderErr> {
    let req = http()
        .post(format!("{OPENAI_URL}/chat/completions"))
        .bearer_auth(&args.key)
        .json(&openai_body(args));
    drive(send(req).await?, openai_event, on_token).await
}

async fn openai_list(key: &str) -> Result<Vec<String>, ProviderErr> {
    let v: Value = send(http().get(format!("{OPENAI_URL}/models")).bearer_auth(key))
        .await?
        .json()
        .await
        .map_err(net_err)?;
    Ok(v["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str().map(str::to_string))
        .collect())
}

// --- Gemini ------------------------------------------------------------------------------

const GEMINI_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

fn gemini_body(args: &StreamArgs) -> Value {
    let contents: Vec<Value> = args
        .messages
        .iter()
        .map(|m| {
            json!({
                "role": if m.role == "assistant" { "model" } else { "user" },
                "parts": [{"text": m.content}],
            })
        })
        .collect();
    json!({
        "contents": contents,
        "systemInstruction": {"parts": [{"text": args.system}]},
    })
}

fn gemini_event(ev: &SseEvent) -> Result<Option<String>, ProviderErr> {
    let Some(v) = parse_data(ev) else {
        return Ok(None);
    };
    if let Some(m) = v["error"]["message"].as_str() {
        return Err(ProviderErr::msg(m));
    }
    let text: String = v["candidates"][0]["content"]["parts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["thought"] != true)
        .filter_map(|p| p["text"].as_str())
        .collect();
    Ok(Some(text))
}

fn gemini_req(path: &str, key: &str) -> reqwest::RequestBuilder {
    let url = format!("{GEMINI_URL}{path}");
    let b = if path.contains(":streamGenerateContent") {
        http().post(url)
    } else {
        http().get(url)
    };
    b.header("x-goog-api-key", key)
}

async fn gemini_stream(args: &StreamArgs, on_token: OnToken<'_>) -> Result<(), ProviderErr> {
    let path = format!(
        "/models/{}:streamGenerateContent?alt=sse",
        urlencoding::encode(&args.model)
    );
    let req = gemini_req(&path, &args.key).json(&gemini_body(args));
    drive(send(req).await?, gemini_event, on_token).await
}

/// Ids of the models whose methods include generateContent (a missing list counts as yes).
fn gemini_model_ids(v: &Value) -> Vec<String> {
    v["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| {
            m["supportedGenerationMethods"]
                .as_array()
                .map_or(true, |a| a.iter().any(|x| x == "generateContent"))
        })
        .filter_map(|m| m["name"].as_str())
        .map(|n| n.strip_prefix("models/").unwrap_or(n).to_string())
        .collect()
}

async fn gemini_list(key: &str) -> Result<Vec<String>, ProviderErr> {
    let mut ids = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let mut path = "/models?pageSize=100".to_string();
        if let Some(t) = &token {
            path.push_str(&format!("&pageToken={}", urlencoding::encode(t)));
        }
        let v: Value = send(gemini_req(&path, key))
            .await?
            .json()
            .await
            .map_err(net_err)?;
        ids.extend(gemini_model_ids(&v));
        match v["nextPageToken"].as_str().filter(|t| !t.is_empty()) {
            Some(t) => token = Some(t.to_string()),
            None => return Ok(ids),
        }
    }
}

async fn gemini_test(key: &str, model: &str) -> Result<(), ProviderErr> {
    let path = format!("/models/{}", urlencoding::encode(model));
    send(gemini_req(&path, key)).await?;
    Ok(())
}

// --- Mock (PAGETURN_AI_MOCK=1) -----------------------------------------------------------

const MOCK_TOKEN_CHARS: usize = 5;
const MOCK_TOKEN_MS: u64 = 20;

/// The full text the mock streams for a conversation, or the rate-limit error it simulates.
fn mock_text(messages: &[ChatMessage]) -> Result<String, ProviderErr> {
    let last = messages.last().map_or("", |m| m.content.as_str());
    let selection = last.find("<selection>").and_then(|s| {
        let rest = &last[s + "<selection>".len()..];
        rest.find("</selection>").map(|e| &rest[..e])
    });
    if selection.unwrap_or(last).contains("__FAIL_RATE__") {
        return Err(ProviderErr::status(429, "rate limited"));
    }
    Ok(match selection {
        Some(s) => format!("Mock explanation of: {}", take_chars(s, 0, 40)),
        None => format!("Mock answer to: {}", take_chars(last, 0, 40)),
    })
}

async fn mock_stream(args: &StreamArgs, on_token: OnToken<'_>) -> Result<(), ProviderErr> {
    let text: Vec<char> = mock_text(&args.messages)?.chars().collect();
    for piece in text.chunks(MOCK_TOKEN_CHARS) {
        tokio::time::sleep(Duration::from_millis(MOCK_TOKEN_MS)).await;
        on_token(&piece.iter().collect::<String>());
    }
    Ok(())
}

// --- dispatch ----------------------------------------------------------------------------

async fn stream_provider(
    kind: Kind,
    args: &StreamArgs,
    on_token: OnToken<'_>,
) -> Result<(), ProviderErr> {
    match kind {
        Kind::Anthropic => anthropic_stream(args, on_token).await,
        Kind::OpenAi => openai_stream(args, on_token).await,
        Kind::Gemini => gemini_stream(args, on_token).await,
        Kind::Mock => mock_stream(args, on_token).await,
    }
}

/// Anthropic, OpenAI or Gemini (or the mock) with the reader's own key.
pub struct ApiKeyProvider {
    kind: Kind,
    key: String,
    model: String,
    timeout: Duration,
}

impl Provider for ApiKeyProvider {
    fn stream<'a>(
        &'a self,
        prompt: &'a Prompt,
        on_token: OnToken<'a>,
    ) -> BoxFuture<'a, Result<(), ProviderErr>> {
        Box::pin(async move {
            let args = StreamArgs {
                key: self.key.clone(),
                model: self.model.clone(),
                system: prompt.system.clone(),
                messages: prompt.messages.clone(),
            };
            stream_provider(self.kind, &args, on_token).await
        })
    }

    fn timeout(&self) -> Duration {
        self.timeout
    }
}

/// The provider a run uses. `timeout` limits API providers; the Claude plan has its own
/// (a CLI process is slower to start and may think longer).
fn provider_for(
    cfg: &RunConfig,
    mock: bool,
    timeout: Duration,
) -> Result<Box<dyn Provider>, AiError> {
    if cfg.provider == CLAUDE && !mock {
        return Ok(Box::new(ClaudeCodeProvider {
            model: cfg.model.clone(),
        }));
    }
    if cfg.provider == CHATGPT && !mock {
        return Ok(Box::new(ChatGptProvider {
            model: cfg.model.clone(),
            dir: cfg.dir.clone(),
        }));
    }
    let key = match (&cfg.key, is_plan(&cfg.provider)) {
        (Some(k), _) => k.clone(),
        (None, true) => "sk-mock".into(), // mock runs need no sign-in
        (None, false) => return Err(ai_error("no_key")),
    };
    Ok(Box::new(ApiKeyProvider {
        kind: kind_for(&cfg.provider, mock),
        key,
        model: cfg.model.clone(),
        timeout,
    }))
}

async fn list_provider(kind: Kind, key: &str) -> Result<Vec<String>, ProviderErr> {
    match kind {
        Kind::Anthropic => anthropic_list(key).await,
        Kind::OpenAi => openai_list(key).await,
        Kind::Gemini => gemini_list(key).await,
        Kind::Mock => Ok(vec!["claude-sonnet-5-5".into(), "claude-mock-1".into()]),
    }
}

async fn test_provider(kind: Kind, key: &str, model: &str) -> Result<(), ProviderErr> {
    match kind {
        Kind::Anthropic => anthropic_test(key, model).await,
        Kind::OpenAi => openai_list(key).await.map(|_| ()),
        Kind::Gemini => gemini_test(key, model).await,
        Kind::Mock if key.starts_with("sk-") => Ok(()),
        Kind::Mock => Err(ProviderErr::status(401, "bad key")),
    }
}

// ---------------------------------------------------------------------------------------
// Settings + keys
// ---------------------------------------------------------------------------------------

/// Replaceable in tests so they do not need the settings module.
type KeyFn = fn(&AppState, &str) -> AppResult<Option<String>>;

fn read_setting(state: &AppState, key: &str) -> AppResult<Option<Value>> {
    state.with_db(|c| {
        let row: Option<String> = match c.query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [key],
            |r| r.get(0),
        ) {
            Ok(s) => Some(s),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e.into()),
        };
        Ok(row.and_then(|s| serde_json::from_str(&s).ok()))
    })
}

/// The model to use: the saved one, else the provider's default.
fn saved_model(state: &AppState, provider: &str) -> AppResult<String> {
    Ok(read_setting(state, "aiModel")?
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| default_model(provider).to_string()))
}

struct RunConfig {
    provider: String,
    model: String,
    key: Option<String>,
    /// The data folder (where a plan provider keeps its sign-in).
    dir: std::path::PathBuf,
}

fn resolve_config(state: &AppState, key_fn: KeyFn) -> AppResult<RunConfig> {
    let provider = read_setting(state, "aiProvider")?
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|p| PROVIDERS.contains(&p.as_str()) || is_plan(p))
        .unwrap_or_else(|| "anthropic".to_string());
    let model = saved_model(state, &provider)?;
    let key = if is_plan(&provider) {
        None // signed in its own way
    } else {
        key_fn(state, &provider)?
    };
    Ok(RunConfig {
        provider,
        model,
        key,
        dir: state.data_dir.clone(),
    })
}

// ---------------------------------------------------------------------------------------
// Sessions (src/main/ai/session.ts)
// ---------------------------------------------------------------------------------------

type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

struct Session {
    system: String,
    messages: Vec<ChatMessage>,
    /// Id of the live run; a newer run (follow-up) or removal makes older ones stale.
    run: u64,
    /// Dropping this cancels the live run.
    cancel: Option<oneshot::Sender<()>>,
}

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static S: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_sessions() -> std::sync::MutexGuard<'static, HashMap<String, Session>> {
    sessions().lock().unwrap_or_else(|e| e.into_inner())
}

static RUN_IDS: AtomicU64 = AtomicU64::new(1);

/// Everything one streaming run needs, taken while the session lock is held.
struct RunCtx {
    run: u64,
    cancelled: oneshot::Receiver<()>,
    system: String,
    messages: Vec<ChatMessage>,
}

/// Registers a fresh run for the session: aborts the previous one and snapshots the messages.
fn start_run(request_id: &str) -> Option<RunCtx> {
    let mut map = lock_sessions();
    let s = map.get_mut(request_id)?;
    let (tx, rx) = oneshot::channel();
    let run = RUN_IDS.fetch_add(1, Ordering::Relaxed);
    s.cancel = Some(tx); // drops (cancels) any previous sender
    s.run = run;
    Some(RunCtx {
        run,
        cancelled: rx,
        system: s.system.clone(),
        messages: s.messages.clone(),
    })
}

/// Starts a conversation for `request_id` (replacing any old one) and its first run.
fn begin_explain(request_id: &str, req: &ExplainRequest) -> RunCtx {
    cancel_session(request_id);
    let (system, messages) = build_explain_messages(&cap_context(req));
    lock_sessions().insert(
        request_id.to_string(),
        Session {
            system,
            messages,
            run: 0,
            cancel: None,
        },
    );
    start_run(request_id).expect("session just inserted")
}

/// Adds a follow-up question and starts its run; None when the conversation is gone.
fn begin_follow_up(request_id: &str, text: &str) -> Option<RunCtx> {
    {
        let mut map = lock_sessions();
        let s = map.get_mut(request_id)?;
        s.cancel = None; // abort the previous run
        s.messages.push(msg("user", text));
    }
    start_run(request_id)
}

fn cancel_session(request_id: &str) {
    // Dropping the session drops its cancel sender, which stops the run.
    lock_sessions().remove(request_id);
}

fn is_live(request_id: &str, run: u64) -> bool {
    lock_sessions()
        .get(request_id)
        .is_some_and(|s| s.run == run)
}

/// Runs one streaming request. A cancelled run sends nothing more, so tokens can never land
/// in a panel that moved on.
async fn execute(
    emit: Emit,
    request_id: String,
    mut ctx: RunCtx,
    cfg: AppResult<RunConfig>,
    mock: bool,
    timeout: Duration,
) {
    let send_error = |e: AiError| emit("ai:error", json!({"requestId": request_id, "error": e}));
    let cfg = match cfg {
        Ok(c) => c,
        Err(e) => return send_error(ai_error_msg("provider", e.to_string())),
    };
    let provider = match provider_for(&cfg, mock, timeout) {
        Ok(p) => p,
        Err(e) => return send_error(e),
    };
    let prompt = Prompt {
        system: ctx.system.clone(),
        messages: ctx.messages.clone(),
    };
    let limit = provider.timeout();
    let run = ctx.run;
    let mut text = String::new();

    enum Outcome {
        Finished(Result<(), ProviderErr>),
        Cancelled,
        TimedOut,
    }
    let outcome = {
        let mut on_token = |t: &str| {
            if is_live(&request_id, run) {
                text.push_str(t);
                emit("ai:token", json!({"requestId": request_id, "token": t}));
            }
        };
        let fut = provider.stream(&prompt, &mut on_token);
        tokio::select! {
            r = fut => Outcome::Finished(r),
            _ = &mut ctx.cancelled => Outcome::Cancelled,
            _ = tokio::time::sleep(limit) => Outcome::TimedOut,
        }
    };

    match outcome {
        Outcome::Cancelled => {}
        Outcome::TimedOut => {
            if is_live(&request_id, run) {
                send_error(ai_error("timeout"));
            }
        }
        Outcome::Finished(Ok(())) => {
            let mut map = lock_sessions();
            if let Some(s) = map.get_mut(&request_id).filter(|s| s.run == run) {
                s.messages.push(msg("assistant", text.clone()));
                s.cancel = None;
                drop(map);
                emit("ai:done", json!({"requestId": request_id, "text": text}));
            }
        }
        Outcome::Finished(Err(e)) => {
            if is_live(&request_id, run) {
                send_error(to_ai_error(&e));
            }
        }
    }
}

fn make_emit(app: AppHandle) -> Emit {
    Arc::new(move |event, payload| {
        let _ = app.emit(event, payload);
    })
}

const RUN_TIMEOUT: Duration = Duration::from_secs(30);

// ---------------------------------------------------------------------------------------
// Commands (src/main/ipc/ai.ts)
// ---------------------------------------------------------------------------------------

async fn test_key_core(
    state: &AppState,
    provider: &str,
    key_fn: KeyFn,
    mock: bool,
) -> AppResult<Value> {
    validate_provider(provider)?;
    let Some(key) = key_fn(state, provider)? else {
        return Ok(json!({"ok": false, "error": ai_error("no_key")}));
    };
    let model = saved_model(state, provider)?;
    Ok(
        match test_provider(kind_for(provider, mock), &key, &model).await {
            Ok(()) => json!({"ok": true}),
            Err(e) => json!({"ok": false, "error": to_ai_error(&e)}),
        },
    )
}

async fn list_models_core(
    state: &AppState,
    provider: &str,
    key_fn: KeyFn,
    mock: bool,
) -> AppResult<Vec<String>> {
    validate_provider(provider)?;
    let Some(key) = key_fn(state, provider)? else {
        return Ok(vec![]);
    };
    // Offline or a bad key: the built-in list still works.
    Ok(match list_provider(kind_for(provider, mock), &key).await {
        Ok(ids) => chat_models(provider, &ids),
        Err(_) => vec![],
    })
}

#[tauri::command]
pub async fn ai_test_key(
    _app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
) -> AppResult<Value> {
    test_key_core(
        &state,
        &provider,
        crate::commands::settings::api_key,
        mock_enabled(),
    )
    .await
}

#[tauri::command]
pub async fn ai_list_models(
    _app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
) -> AppResult<Vec<String>> {
    list_models_core(
        &state,
        &provider,
        crate::commands::settings::api_key,
        mock_enabled(),
    )
    .await
}

#[tauri::command]
pub async fn ai_explain(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    req: ExplainRequest,
) -> AppResult<()> {
    validate_request_id(&request_id)?;
    validate_explain(&req)?;
    let ctx = begin_explain(&request_id, &req);
    let cfg = resolve_config(&state, crate::commands::settings::api_key);
    tauri::async_runtime::spawn(execute(
        make_emit(app),
        request_id,
        ctx,
        cfg,
        mock_enabled(),
        RUN_TIMEOUT,
    ));
    Ok(())
}

#[tauri::command]
pub async fn ai_follow_up(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    text: String,
) -> AppResult<()> {
    validate_request_id(&request_id)?;
    let text = text.trim().to_string();
    if !(1..=4000).contains(&len(&text)) {
        return Err(invalid("follow-up"));
    }
    let emit = make_emit(app);
    match begin_follow_up(&request_id, &text) {
        None => emit(
            "ai:error",
            json!({"requestId": request_id, "error": ended_error()}),
        ),
        Some(ctx) => {
            let cfg = resolve_config(&state, crate::commands::settings::api_key);
            tauri::async_runtime::spawn(execute(
                emit,
                request_id,
                ctx,
                cfg,
                mock_enabled(),
                RUN_TIMEOUT,
            ));
        }
    }
    Ok(())
}

/// Claude plan status for Settings: installed, version, signed in, plan (never the account).
#[tauri::command]
pub async fn ai_claude_status() -> AppResult<Value> {
    Ok(claude_code::status().await)
}

/// Opens Claude Code's own sign-in window; PageTurn never sees the sign-in.
#[tauri::command]
pub async fn ai_claude_login() -> AppResult<()> {
    claude_code::open_login().map_err(crate::error::AppError::Msg)
}

// --- ChatGPT plan (Sign in with ChatGPT) ---

fn chatgpt_store(state: &AppState) -> chatgpt::Store {
    chatgpt::Store::os(&state.data_dir)
}

/// Signed in? Plan use allowed? Which email? (Never the tokens.)
#[tauri::command]
pub async fn ai_chatgpt_status(state: State<'_, AppState>) -> AppResult<Value> {
    Ok(chatgpt::status(&chatgpt_store(&state)))
}

/// Runs the browser sign-in; `consent` asks for plan permission again after a decline.
/// Answers `{ok: true, status}` or `{ok: false, error}`; never rejects for sign-in failures.
#[tauri::command]
pub async fn ai_chatgpt_login(
    app: AppHandle,
    state: State<'_, AppState>,
    consent: bool,
) -> AppResult<Value> {
    use tauri_plugin_opener::OpenerExt;
    let store = chatgpt_store(&state);
    let open = |url: &str| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string())
    };
    Ok(match chatgpt::sign_in(&store, consent, open).await {
        Ok(()) => json!({"ok": true, "status": chatgpt::status(&store)}),
        Err(e) => json!({"ok": false, "error": e.message, "status": chatgpt::status(&store)}),
    })
}

/// Signs out (revoking the sign-in at OpenAI); `confirmed` is false when OpenAI could not be told.
#[tauri::command]
pub async fn ai_chatgpt_logout(state: State<'_, AppState>) -> AppResult<Value> {
    let confirmed = chatgpt::sign_out(&chatgpt_store(&state)).await;
    Ok(json!({"confirmed": confirmed}))
}

/// The signed-in account's models ([] when signed out or offline).
#[tauri::command]
pub async fn ai_chatgpt_models(state: State<'_, AppState>) -> AppResult<Value> {
    let list = chatgpt::models(&chatgpt_store(&state))
        .await
        .unwrap_or_default();
    Ok(Value::Array(
        list.into_iter()
            .map(|(id, label)| json!({"id": id, "label": label}))
            .collect(),
    ))
}

/// The one-time "You're using your ChatGPT plan" notice was dismissed.
#[tauri::command]
pub async fn ai_chatgpt_welcomed(state: State<'_, AppState>) -> AppResult<()> {
    chatgpt::mark_welcomed(&chatgpt_store(&state));
    Ok(())
}

/// Opens ChatGPT settings → Usage in the browser.
#[tauri::command]
pub async fn ai_chatgpt_open_usage(app: AppHandle) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(chatgpt::USAGE_URL, None::<&str>)
        .map_err(|e| crate::error::AppError::Msg(e.to_string()))
}

fn ended_error() -> AiError {
    ai_error_msg(
        "provider",
        "This conversation has ended. Ask again from the page.",
    )
}

#[tauri::command]
pub async fn ai_cancel(
    _app: AppHandle,
    _state: State<'_, AppState>,
    request_id: String,
) -> AppResult<()> {
    validate_request_id(&request_id)?;
    cancel_session(&request_id);
    Ok(())
}

// ---------------------------------------------------------------------------------------
// Tests (no network)
// ---------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use rusqlite::Connection;

    fn req() -> ExplainRequest {
        ExplainRequest {
            book_title: Some("Physics".into()),
            heading: Some("Entropy".into()),
            selection: "the arrow of time".into(),
            pages: vec![4],
            page_text: "Before. the arrow of time. After.".into(),
            prev_tail: "tail of page 3".into(),
            next_head: "head of page 5".into(),
        }
    }

    // ---- prompt ----

    #[test]
    fn small_request_is_left_alone() {
        assert_eq!(cap_context(&req()), req());
    }

    #[test]
    fn big_page_is_cut_around_the_selection() {
        let mut r = req();
        r.page_text = format!(
            "{} the arrow of time {}",
            "a".repeat(10_000),
            "b".repeat(10_000)
        );
        let out = cap_context(&r);
        assert!(size(&out) <= MAX_CONTEXT);
        assert!(out.page_text.contains("the arrow of time"));
        assert_eq!(out.prev_tail, "");
        assert_eq!(out.next_head, "");
    }

    #[test]
    fn huge_selection_is_truncated_and_context_dropped() {
        let mut r = req();
        r.selection = "x".repeat(15_000);
        r.page_text = r.selection.clone();
        let out = cap_context(&r);
        assert!(out.selection.ends_with('…'));
        assert!(len(&out.selection) <= MAX_CONTEXT - 200 + 1);
        assert_eq!(out.page_text, "");
        assert!(size(&out) <= MAX_CONTEXT);
    }

    #[test]
    fn explain_messages_carry_book_context_and_selection() {
        let (system, messages) = build_explain_messages(&req());
        assert!(system.contains("Define any jargon"));
        assert!(system.contains("step by step"));
        assert!(system.contains("250 words"));
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "user");
        let c = &messages[0].content;
        assert!(c.starts_with("Book: Physics\nSection: Entropy\n\n"));
        assert!(c.contains("<context_before>tail of page 3</context_before>"));
        assert!(c.contains("<selection>the arrow of time</selection>"));
        assert!(c.ends_with("Explain it."));
        let mut bare = req();
        bare.book_title = None;
        bare.heading = None;
        assert!(build_explain_messages(&bare).1[0]
            .content
            .starts_with("<context_before>"));
    }

    #[test]
    fn validation_rules() {
        assert!(validate_request_id("abcd-1234").is_ok());
        assert!(validate_request_id("short").is_err());
        assert!(validate_request_id("bad id!!!!").is_err());
        let mut r = req();
        assert!(validate_explain(&r).is_ok());
        r.selection.clear();
        assert!(validate_explain(&r).is_err());
        let mut r = req();
        r.pages = vec![1, 2, 3, 4, 5];
        assert!(validate_explain(&r).is_err());
        r.pages = vec![0];
        assert!(validate_explain(&r).is_err());
        assert!(validate_provider("openai").is_ok());
        assert!(validate_provider("nope").is_err());
    }

    #[test]
    fn explain_request_rejects_unknown_fields() {
        let ok = json!({"bookTitle": null, "heading": null, "selection": "s", "pages": [1],
            "pageText": "", "prevTail": "", "nextHead": ""});
        assert!(serde_json::from_value::<ExplainRequest>(ok.clone()).is_ok());
        let mut bad = ok;
        bad["extra"] = json!(1);
        assert!(serde_json::from_value::<ExplainRequest>(bad).is_err());
    }

    // ---- error classification ----

    fn status(s: u16, m: &str) -> AiError {
        to_ai_error(&ProviderErr::status(s, m))
    }

    #[test]
    fn classifies_errors() {
        assert_eq!(status(401, "x").kind, "invalid_key");
        assert_eq!(status(403, "x").kind, "invalid_key");
        assert_eq!(
            status(400, "API key not valid. Please pass a valid API key.").kind,
            "invalid_key"
        );
        assert_eq!(status(400, "API_KEY_INVALID").kind, "invalid_key");
        assert_eq!(status(400, "Invalid_API_key").kind, "invalid_key");
        assert_eq!(status(429, "slow down").kind, "rate_limit");
        let t = ProviderErr {
            name: Some("TimeoutError"),
            ..Default::default()
        };
        assert_eq!(to_ai_error(&t).kind, "timeout");
        let a = ProviderErr {
            name: Some("AbortError"),
            ..Default::default()
        };
        assert_eq!(to_ai_error(&a).kind, "timeout");
        let o = ProviderErr {
            code: Some("ENOTFOUND"),
            ..Default::default()
        };
        assert_eq!(to_ai_error(&o).kind, "offline");
        assert_eq!(
            to_ai_error(&ProviderErr::msg("fetch failed")).kind,
            "offline"
        );
        let s = status(503, "overloaded");
        assert_eq!(s.kind, "provider");
        assert_eq!(
            s.message,
            "The AI provider is having trouble right now. Try again shortly."
        );
        let p = status(400, "bad request");
        assert_eq!(p.message, "The AI provider returned an error: bad request");
        assert_eq!(
            to_ai_error(&ProviderErr::default()).message,
            "The AI provider returned an error."
        );
    }

    #[test]
    fn extracts_error_messages() {
        assert_eq!(
            error_message(400, r#"{"error":{"message":"nope"}}"#),
            "nope"
        );
        assert_eq!(error_message(400, r#"{"error":"flat"}"#), "flat");
        assert_eq!(error_message(502, ""), "HTTP 502");
        assert_eq!(error_message(502, "  gateway  "), "gateway");
    }

    #[test]
    fn model_filter() {
        let v = |xs: &[&str]| -> Vec<String> { xs.iter().map(|s| s.to_string()).collect() };
        let ids = v(&[
            "gpt-5",
            "gpt-5-mini",
            "text-embedding-3",
            "o3",
            "gpt-4o-audio-preview",
            "whisper-1",
            "gpt-5",
        ]);
        assert_eq!(
            chat_models("openai", &ids),
            vec!["gpt-5", "gpt-5-mini", "o3"]
        );
        let g = v(&[
            "gemini-2.5-pro",
            "gemini-embedding-001",
            "models-x",
            "gemini-3.8-flash",
        ]);
        assert_eq!(
            chat_models("gemini", &g),
            vec!["gemini-2.5-pro", "gemini-3.8-flash"]
        );
        assert_eq!(
            chat_models("anthropic", &v(&["claude-sonnet-5-5", "other"])),
            vec!["claude-sonnet-5-5"]
        );
    }

    // ---- SSE ----

    /// Feeds chunks through the parser and a provider handler like `drive` does.
    fn run_chunks(chunks: &[&[u8]], handler: Handler) -> Result<String, ProviderErr> {
        let mut p = SseParser::default();
        let mut out = String::new();
        let mut on = |t: &str| out.push_str(t);
        for c in chunks {
            dispatch(p.feed(c), handler, &mut on)?;
        }
        dispatch(p.finish(), handler, &mut on)?;
        Ok(out)
    }

    /// The text must come out the same however the body is cut in two.
    fn check_all_splits(body: &str, handler: Handler, want: &str) {
        assert_eq!(run_chunks(&[body.as_bytes()], handler).unwrap(), want);
        for i in 1..body.len() {
            let (a, b) = body.as_bytes().split_at(i);
            assert_eq!(run_chunks(&[a, b], handler).unwrap(), want, "split at {i}");
        }
    }

    #[test]
    fn sse_parser_handles_split_events_and_crlf() {
        let mut p = SseParser::default();
        assert!(p.feed(b"event: a\nda").is_empty());
        let evs = p.feed(b"ta: one\n\n: comment\r\ndata: x\r\ndata: y\r\n\r\ndata: tail");
        assert_eq!(evs.len(), 2);
        assert_eq!(
            evs[0],
            SseEvent {
                event: Some("a".into()),
                data: "one".into()
            }
        );
        assert_eq!(evs[1].data, "x\ny");
        let rest = p.finish();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].data, "tail");
    }

    #[test]
    fn sse_parser_keeps_split_utf8() {
        let bytes = "data: h\u{e9}llo\n\n".as_bytes();
        let split = bytes.iter().position(|&b| b == 0xC3).unwrap() + 1;
        let mut p = SseParser::default();
        assert!(p.feed(&bytes[..split]).is_empty());
        assert_eq!(p.feed(&bytes[split..])[0].data, "h\u{e9}llo");
    }

    #[test]
    fn anthropic_stream_parsing() {
        let body = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hel\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"lo\"}}\n\n",
            "event: ping\ndata: {\"type\":\"ping\"}\n\n",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n",
        );
        check_all_splits(body, anthropic_event, "Hello");
    }

    #[test]
    fn anthropic_refusal_and_stream_error() {
        let refusal =
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"refusal\"}}\n\n";
        let e = run_chunks(&[refusal.as_bytes()], anthropic_event).unwrap_err();
        assert_eq!(e.message, "The model declined to explain this passage.");
        let err = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n";
        let e = run_chunks(&[err.as_bytes()], anthropic_event).unwrap_err();
        assert_eq!(e.message, "Overloaded");
    }

    #[test]
    fn openai_stream_parsing() {
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hi \"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"there\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n",
        );
        check_all_splits(body, openai_event, "Hi there");
    }

    #[test]
    fn gemini_stream_parsing() {
        let body = concat!(
            "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"Foo\"}]}}]}\r\n\r\n",
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hidden\",\"thought\":true},{\"text\":\"Bar\"}]}}]}\r\n\r\n",
            "data: {\"candidates\":[{\"finishReason\":\"STOP\"}],\"usageMetadata\":{}}\r\n\r\n",
        );
        check_all_splits(body, gemini_event, "FooBar");
        let err = "data: {\"error\":{\"code\":400,\"message\":\"API key not valid.\"}}\n\n";
        let e = run_chunks(&[err.as_bytes()], gemini_event).unwrap_err();
        assert_eq!(to_ai_error(&e).kind, "invalid_key");
    }

    #[test]
    fn request_shapes() {
        let args = StreamArgs {
            key: "k".into(),
            model: "claude-sonnet-5-5".into(),
            system: "sys".into(),
            messages: vec![msg("user", "q"), msg("assistant", "a")],
        };
        let b = anthropic_body(&args);
        assert_eq!(b["max_tokens"], 1024);
        assert_eq!(b["stream"], true);
        assert_eq!(b["fallbacks"], "default");
        assert_eq!(b["messages"][1]["role"], "assistant");
        let custom = StreamArgs {
            model: "claude-custom".into(),
            ..args
        };
        assert!(anthropic_body(&custom).get("fallbacks").is_none());
        let o = openai_body(&custom);
        assert_eq!(o["messages"][0]["role"], "system");
        assert_eq!(o["messages"][2]["content"], "a");
        let g = gemini_body(&custom);
        assert_eq!(g["contents"][1]["role"], "model");
        assert_eq!(g["systemInstruction"]["parts"][0]["text"], "sys");
    }

    #[test]
    fn gemini_model_list_filtering() {
        let v = json!({"models": [
            {"name": "models/gemini-2.5-pro", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/embedding-001", "supportedGenerationMethods": ["embedContent"]},
            {"name": "models/gemini-x"}
        ]});
        assert_eq!(gemini_model_ids(&v), vec!["gemini-2.5-pro", "gemini-x"]);
    }

    // ---- mock + sessions ----

    #[test]
    fn mock_text_is_deterministic() {
        let m = vec![msg("user", "<selection>abc</selection> more")];
        assert_eq!(mock_text(&m).unwrap(), "Mock explanation of: abc");
        let m = vec![msg("user", "why?")];
        assert_eq!(mock_text(&m).unwrap(), "Mock answer to: why?");
        let m = vec![msg("user", "x __FAIL_RATE__")];
        assert_eq!(to_ai_error(&mock_text(&m).unwrap_err()).kind, "rate_limit");
    }

    type Log = Arc<Mutex<Vec<(String, Value)>>>;

    fn collector() -> (Emit, Log) {
        let log: Log = Arc::new(Mutex::new(Vec::new()));
        let l = log.clone();
        (
            Arc::new(move |e, p| l.lock().unwrap().push((e.to_string(), p))),
            log,
        )
    }

    fn cfg(key: Option<&str>) -> AppResult<RunConfig> {
        Ok(RunConfig {
            provider: "anthropic".into(),
            model: "m".into(),
            key: key.map(str::to_string),
            dir: Default::default(),
        })
    }

    fn events(log: &Log) -> Vec<String> {
        log.lock().unwrap().iter().map(|(e, _)| e.clone()).collect()
    }

    const T: Duration = Duration::from_secs(5);

    #[tokio::test]
    async fn explain_streams_tokens_then_done() {
        let (emit, log) = collector();
        let id = "t-explain-1";
        let ctx = begin_explain(id, &req());
        execute(emit, id.into(), ctx, cfg(Some("sk-x")), true, T).await;
        let l = log.lock().unwrap();
        let tokens: String = l
            .iter()
            .filter(|(e, _)| e == "ai:token")
            .map(|(_, p)| p["token"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(tokens, "Mock explanation of: the arrow of time");
        let (last_ev, last) = l.last().unwrap();
        assert_eq!(last_ev, "ai:done");
        assert_eq!(last["text"], tokens);
        assert_eq!(last["requestId"], id);
        drop(l);
        cancel_session(id);
    }

    #[tokio::test]
    async fn follow_up_uses_session_memory() {
        let (emit, log) = collector();
        let id = "t-follow-1";
        let ctx = begin_explain(id, &req());
        execute(emit.clone(), id.into(), ctx, cfg(Some("sk-x")), true, T).await;
        let ctx = begin_follow_up(id, "why?").expect("session kept");
        assert_eq!(ctx.messages.len(), 3);
        assert_eq!(ctx.messages[1].role, "assistant");
        assert!(ctx.messages[1].content.starts_with("Mock explanation"));
        assert_eq!(ctx.messages[2].content, "why?");
        execute(emit, id.into(), ctx, cfg(Some("sk-x")), true, T).await;
        let l = log.lock().unwrap();
        let (ev, last) = l.last().unwrap();
        assert_eq!(ev, "ai:done");
        assert_eq!(last["text"], "Mock answer to: why?");
        drop(l);
        assert_eq!(lock_sessions().get(id).unwrap().messages.len(), 4);
        cancel_session(id);
        assert!(begin_follow_up(id, "again").is_none());
    }

    #[tokio::test]
    async fn missing_key_and_provider_errors() {
        let (emit, log) = collector();
        let id = "t-nokey-01";
        let ctx = begin_explain(id, &req());
        execute(emit.clone(), id.into(), ctx, cfg(None), true, T).await;
        assert_eq!(log.lock().unwrap()[0].1["error"]["kind"], "no_key");
        let ctx = begin_follow_up(id, "q __FAIL_RATE__").unwrap();
        execute(emit.clone(), id.into(), ctx, cfg(Some("sk-x")), true, T).await;
        assert_eq!(
            log.lock().unwrap().last().unwrap().1["error"]["kind"],
            "rate_limit"
        );
        let ctx = begin_follow_up(id, "q").unwrap();
        execute(
            emit,
            id.into(),
            ctx,
            Err(AppError::NotImplemented("x")),
            true,
            T,
        )
        .await;
        assert_eq!(
            log.lock().unwrap().last().unwrap().1["error"]["kind"],
            "provider"
        );
        cancel_session(id);
    }

    #[tokio::test]
    async fn cancel_stops_the_stream_silently() {
        let (emit, log) = collector();
        let id = "t-cancel-01";
        let ctx = begin_explain(id, &req());
        let task = tokio::spawn(execute(emit, id.into(), ctx, cfg(Some("sk-x")), true, T));
        tokio::time::sleep(Duration::from_millis(70)).await;
        cancel_session(id);
        task.await.unwrap();
        let evs = events(&log);
        assert!(
            !evs.is_empty() && evs.iter().all(|e| e == "ai:token"),
            "{evs:?}"
        );
        assert!(evs.len() < 8);
    }

    #[tokio::test]
    async fn new_explain_replaces_the_old_run() {
        let (emit, log) = collector();
        let id = "t-replace-1";
        let ctx = begin_explain(id, &req());
        let task = tokio::spawn(execute(
            emit.clone(),
            id.into(),
            ctx,
            cfg(Some("sk-x")),
            true,
            T,
        ));
        tokio::time::sleep(Duration::from_millis(30)).await;
        let ctx2 = begin_explain(id, &req());
        task.await.unwrap();
        assert!(!events(&log).contains(&"ai:done".to_string()));
        execute(emit, id.into(), ctx2, cfg(Some("sk-x")), true, T).await;
        assert_eq!(events(&log).iter().filter(|e| *e == "ai:done").count(), 1);
        cancel_session(id);
    }

    #[tokio::test]
    async fn timeout_reports_timeout() {
        let (emit, log) = collector();
        let id = "t-timeout-1";
        let ctx = begin_explain(id, &req());
        execute(
            emit,
            id.into(),
            ctx,
            cfg(Some("sk-x")),
            true,
            Duration::from_millis(50),
        )
        .await;
        let l = log.lock().unwrap();
        let (ev, p) = l.last().unwrap();
        assert_eq!(ev, "ai:error");
        assert_eq!(p["error"]["kind"], "timeout");
        drop(l);
        cancel_session(id);
    }

    #[test]
    fn ended_conversation_message() {
        assert_eq!(
            ended_error().message,
            "This conversation has ended. Ask again from the page."
        );
    }

    // ---- settings + keys + the commands' cores ----

    fn state_with(settings: &[(&str, &str)]) -> AppState {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT);")
            .unwrap();
        for (k, v) in settings {
            conn.execute(
                "INSERT INTO settings (key, value_json) VALUES (?1, ?2)",
                [k, v],
            )
            .unwrap();
        }
        AppState {
            db: Mutex::new(conn),
            data_dir: std::path::PathBuf::new(),
        }
    }

    fn key_sk(_: &AppState, p: &str) -> AppResult<Option<String>> {
        Ok(if p == "anthropic" {
            Some("sk-test".into())
        } else {
            None
        })
    }
    fn key_bad(_: &AppState, _: &str) -> AppResult<Option<String>> {
        Ok(Some("nope".into()))
    }

    #[test]
    fn config_reads_settings_table() {
        let s = state_with(&[("aiProvider", "\"openai\""), ("aiModel", "\"gpt-5-mini\"")]);
        let c = resolve_config(&s, key_sk).unwrap();
        assert_eq!(
            (c.provider.as_str(), c.model.as_str(), c.key),
            ("openai", "gpt-5-mini", None)
        );
        let s = state_with(&[("aiModel", "null")]);
        let c = resolve_config(&s, key_sk).unwrap();
        assert_eq!(
            (c.provider.as_str(), c.model.as_str()),
            ("anthropic", "claude-sonnet-5-5")
        );
        assert_eq!(c.key.as_deref(), Some("sk-test"));
        let s = state_with(&[("aiProvider", "\"gemini\"")]);
        assert_eq!(
            resolve_config(&s, key_sk).unwrap().model,
            "gemini-3.8-flash"
        );
    }

    #[test]
    fn claude_plan_config_needs_no_key() {
        fn no_lookup(_: &AppState, p: &str) -> AppResult<Option<String>> {
            panic!("the Claude plan must not read an API key (asked for {p})")
        }
        let s = state_with(&[("aiProvider", "\"claude\"")]);
        let c = resolve_config(&s, no_lookup).unwrap();
        assert_eq!(
            (c.provider.as_str(), c.model.as_str(), c.key),
            ("claude", "default", None)
        );
        let s = state_with(&[("aiProvider", "\"claude\""), ("aiModel", "\"opus\"")]);
        assert_eq!(resolve_config(&s, no_lookup).unwrap().model, "opus");
        // Not mocked, it runs the CLI with its own (longer) time limit.
        let p = provider_for(&resolve_config(&s, no_lookup).unwrap(), false, T).unwrap();
        assert_eq!(p.timeout(), Duration::from_secs(120));
    }

    #[test]
    fn claude_plan_errors_point_to_settings() {
        let e = |code| ProviderErr {
            code: Some(code),
            status: Some(401),
            message: "Your Claude plan's usage limit is reached.".into(),
            ..Default::default()
        };
        let missing = to_ai_error(&e(claude_code::MISSING));
        assert_eq!(missing.kind, "no_key");
        assert!(missing.message.contains("not installed"));
        let out = to_ai_error(&e(claude_code::SIGNED_OUT));
        assert_eq!(out.kind, "no_key");
        assert!(out.message.contains("Sign in"));
        let limit = to_ai_error(&e(claude_code::PLAN_LIMIT));
        assert_eq!(limit.kind, "rate_limit");
        assert!(limit.message.contains("usage limit"));
    }

    #[tokio::test]
    async fn claude_plan_runs_through_the_provider_layer_when_mocked() {
        let (emit, log) = collector();
        let id = "t-claude-1";
        let ctx = begin_explain(id, &req());
        let cfg = Ok(RunConfig {
            provider: CLAUDE.into(),
            model: "default".into(),
            key: None,
            dir: Default::default(),
        });
        execute(emit, id.into(), ctx, cfg, true, T).await;
        let l = log.lock().unwrap();
        let (last_ev, last) = l.last().unwrap();
        assert_eq!(last_ev, "ai:done");
        assert_eq!(last["text"], "Mock explanation of: the arrow of time");
        drop(l);
        cancel_session(id);
    }

    #[tokio::test]
    async fn test_key_and_list_models_with_mock() {
        let s = state_with(&[]);
        let ok = test_key_core(&s, "anthropic", key_sk, true).await.unwrap();
        assert_eq!(ok, json!({"ok": true}));
        let none = test_key_core(&s, "openai", key_sk, true).await.unwrap();
        assert_eq!(none["error"]["kind"], "no_key");
        let bad = test_key_core(&s, "anthropic", key_bad, true).await.unwrap();
        assert_eq!(bad["error"]["kind"], "invalid_key");
        assert!(test_key_core(&s, "bogus", key_sk, true).await.is_err());
        let models = list_models_core(&s, "anthropic", key_sk, true)
            .await
            .unwrap();
        assert_eq!(models, vec!["claude-mock-1", "claude-sonnet-5-5"]);
        assert!(list_models_core(&s, "openai", key_sk, true)
            .await
            .unwrap()
            .is_empty());
    }
}
