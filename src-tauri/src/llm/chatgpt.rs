//! ChatGPT plan provider: OpenAI's "Sign in with ChatGPT" plan usage for open-source,
//! locally run apps (developers.openai.com/siwc/token-sharing-open-source). PageTurn is MIT
//! licensed and runs on the reader's own computer, which is the case these docs cover.
//!
//! - Sign-in: the system browser at OpenAI's authorize page (PKCE, a loopback callback on
//!   127.0.0.1), first as a dynamic registration (`dynamic_agent_client`), later with the issued
//!   client id. The ID token is checked against OpenAI's published keys (issuer, audience =
//!   issued client id, expiry, nonce). Plan use needs the `chatgpt.tokens.use.direct` scope.
//! - Storage: the tokens are encrypted with the same OS encryption as API keys
//!   (`settings::secret_*`); the host id, issued client id and email sit in `chatgpt.json`.
//! - Replies: `POST /v1/responses` with `store: false, stream: true`, the conversation resent in
//!   `input` each time (no server-side history in this flow).
use super::{OnToken, Prompt, Provider};
use crate::commands::ai::{ChatMessage, ProviderErr, SseParser};
use crate::commands::settings::{secret_clear, secret_get, secret_set, OsCipher, SecretCipher};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use futures_util::future::BoxFuture;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const DISCOVERY: &str = "https://auth.openai.com/.well-known/openid-configuration";
const ISSUER: &str = "https://auth.openai.com";
const RESOURCE: &str = "https://api.openai.com/v1";
const RESPONSES: &str = "https://api.openai.com/v1/responses";
const MODELS: &str = "https://api.openai.com/v1/models";
pub const USAGE_URL: &str = "https://chatgpt.com/settings/usage";
const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const NEW_CLIENT: &str = "dynamic_agent_client";
const APP_NAME: &str = "PageTurn";
const CALLBACK_PATH: &str = "/auth/callback";
const PREFERRED_PORT: u16 = 1455;
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
const REPLY_TIMEOUT: Duration = Duration::from_secs(90);
/// Refresh this long before the access token runs out.
const REFRESH_EARLY_SECS: i64 = 120;

/// Error codes `commands::ai::to_ai_error` turns into messages the panels show.
pub const SIGNED_OUT: &str = "CHATGPT_SIGNED_OUT";
pub const PLAN_OFF: &str = "CHATGPT_PLAN_OFF";
pub const NOT_ELIGIBLE: &str = "CHATGPT_NOT_ELIGIBLE";
pub const PLAN_LIMIT: &str = "CHATGPT_PLAN_LIMIT";

const SECRET: &str = "chatgpt";

// ---------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------

/// Not secret: which host this is and which registration it signed in with.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Account {
    pub host_id: String,
    pub client_id: Option<String>,
    pub email: Option<String>,
    pub subject: Option<String>,
    /// The one-time "You're using your ChatGPT plan" notice was dismissed.
    #[serde(default)]
    pub welcomed: bool,
}

/// Secret: the tokens, encrypted at rest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    /// Unix seconds.
    pub expires_at: i64,
    pub scopes: Vec<String>,
}

impl Session {
    pub fn plan_use(&self) -> bool {
        self.scopes.iter().any(|s| s == PLAN_SCOPE)
    }
}

pub struct Store {
    pub dir: PathBuf,
    pub cipher: Box<dyn SecretCipher + Send + Sync>,
}

impl Store {
    pub fn os(dir: &Path) -> Self {
        Store {
            dir: dir.to_path_buf(),
            cipher: Box::new(OsCipher),
        }
    }

    fn account_file(&self) -> PathBuf {
        self.dir.join("chatgpt.json")
    }

    /// The saved account, creating this host's stable id (`urn:uuid:…`) on first use.
    pub fn account(&self) -> Account {
        let saved = std::fs::read_to_string(self.account_file())
            .ok()
            .and_then(|s| serde_json::from_str::<Account>(&s).ok());
        match saved {
            Some(a) if !a.host_id.is_empty() => a,
            _ => {
                let a = Account {
                    host_id: format!("urn:uuid:{}", uuid::Uuid::new_v4()),
                    ..Default::default()
                };
                let _ = self.save_account(&a);
                a
            }
        }
    }

    pub fn save_account(&self, a: &Account) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.dir.join("chatgpt.json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(a).unwrap_or_default())?;
        std::fs::rename(tmp, self.account_file())
    }

    pub fn session(&self) -> Option<Session> {
        secret_get(&self.dir, self.cipher.as_ref(), SECRET)
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn save_session(&self, s: &Session) -> Result<(), ProviderErr> {
        let text = serde_json::to_string(s).unwrap_or_default();
        secret_set(&self.dir, self.cipher.as_ref(), SECRET, &text)
            .map_err(|e| ProviderErr::from_message(format!("Could not save the sign-in: {e}")))
    }

    pub fn clear_session(&self) {
        let _ = secret_clear(&self.dir, SECRET);
    }
}

// ---------------------------------------------------------------------------------------
// Sign-in pieces (pure, tested)
// ---------------------------------------------------------------------------------------

/// 32 random bytes, base64url without padding (state, nonce, PKCE verifier).
fn random_token() -> String {
    let mut b = [0u8; 32];
    b[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    b[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    B64URL.encode(b)
}

/// PKCE S256: base64url(SHA-256(verifier)) without padding.
pub fn pkce_challenge(verifier: &str) -> String {
    B64URL.encode(Sha256::digest(verifier.as_bytes()))
}

pub struct AuthRequest<'a> {
    pub client_id: Option<&'a str>,
    pub host_id: &'a str,
    pub redirect_uri: &'a str,
    pub state: &'a str,
    pub nonce: &'a str,
    pub challenge: &'a str,
    pub login_hint: Option<&'a str>,
    pub id_token_hint: Option<&'a str>,
    /// Ask for consent again (turning plan use on after an earlier decline).
    pub consent: bool,
}

/// The authorize URL: a first registration (no saved client id) or a returning sign-in.
pub fn authorize_url(r: &AuthRequest) -> String {
    let mut q: Vec<(&str, &str)> = vec![
        ("client_id", r.client_id.unwrap_or(NEW_CLIENT)),
        ("ext_agent_host_id", r.host_id),
        ("response_type", "code"),
        ("redirect_uri", r.redirect_uri),
        ("scope", SCOPES),
        ("resource", RESOURCE),
        ("state", r.state),
        ("nonce", r.nonce),
        ("code_challenge_method", "S256"),
        ("code_challenge", r.challenge),
    ];
    if r.client_id.is_none() {
        q.push(("agent_name_hint", APP_NAME)); // only on the first registration
    }
    if let Some(h) = r.id_token_hint {
        q.push(("id_token_hint", h));
    }
    if let Some(h) = r.login_hint {
        q.push(("login_hint", h));
    }
    if r.consent {
        q.push(("prompt", "consent"));
    }
    let query: Vec<String> = q
        .iter()
        .map(|(k, v)| format!("{k}={}", urlencoding::encode(v)))
        .collect();
    format!("{AUTHORIZE}?{}", query.join("&"))
}

/// The query of `GET /auth/callback?…` as key → value (None for any other path).
pub fn parse_callback(request_line: &str) -> Option<std::collections::HashMap<String, String>> {
    let target = request_line.split_whitespace().nth(1)?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return None;
    }
    Some(
        query
            .split('&')
            .filter(|p| !p.is_empty())
            .filter_map(|p| {
                let (k, v) = p.split_once('=').unwrap_or((p, ""));
                let dec = |s: &str| {
                    urlencoding::decode(&s.replace('+', " "))
                        .map(|c| c.into_owned())
                        .ok()
                };
                Some((dec(k)?, dec(v)?))
            })
            .collect(),
    )
}

/// The client id to exchange the code with: the issued one from a new registration, or the saved
/// one. A callback naming a different client than the saved one is rejected.
pub fn pick_client_id(saved: Option<&str>, from_callback: Option<&str>) -> Result<String, String> {
    match (saved, from_callback) {
        (Some(s), Some(c)) if s != c => {
            Err("The sign-in came back for a different registration. Try again.".into())
        }
        (Some(s), _) => Ok(s.to_string()),
        (None, Some(c)) if c != NEW_CLIENT && !c.is_empty() => Ok(c.to_string()),
        _ => Err("OpenAI did not finish registering PageTurn. Try again.".into()),
    }
}

/// A token-endpoint answer turned into a session (`scope` is space-separated).
pub fn session_from_tokens(v: &Value, now: i64, previous: Option<&Session>) -> Option<Session> {
    let scopes = match v["scope"].as_str() {
        Some(s) => s.split_whitespace().map(String::from).collect(),
        None => previous.map(|p| p.scopes.clone()).unwrap_or_default(),
    };
    Some(Session {
        access_token: v["access_token"].as_str()?.to_string(),
        refresh_token: v["refresh_token"]
            .as_str()
            .map(String::from)
            .or_else(|| previous.map(|p| p.refresh_token.clone()))?,
        id_token: v["id_token"]
            .as_str()
            .map(String::from)
            .or_else(|| previous.map(|p| p.id_token.clone()))
            .unwrap_or_default(),
        expires_at: now + v["expires_in"].as_i64().unwrap_or(3600),
        scopes,
    })
}

pub fn needs_refresh(s: &Session, now: i64) -> bool {
    s.expires_at - now <= REFRESH_EARLY_SECS
}

/// Refresh errors that mean the sign-in is over (sign in again).
fn refresh_is_terminal(code: &str) -> bool {
    matches!(
        code,
        "invalid_grant"
            | "invalid_refresh_token"
            | "token_expired"
            | "refresh_token_expired"
            | "refresh_token_invalidated"
            | "refresh_token_reused"
    )
}

// ---------------------------------------------------------------------------------------
// Replies: request body, stream events, errors (pure, tested)
// ---------------------------------------------------------------------------------------

/// The Responses request. Instructions go in `instructions` (system items are rejected); the
/// whole conversation travels in `input`.
pub fn request_body(model: &str, prompt: &Prompt) -> Value {
    let input: Vec<Value> = prompt
        .messages
        .iter()
        .map(|m: &ChatMessage| json!({"role": m.role, "content": m.content}))
        .collect();
    json!({
        "model": model,
        "instructions": prompt.system,
        "input": input,
        "store": false,
        "stream": true,
    })
}

#[derive(Debug, PartialEq)]
pub enum Event {
    Token(String),
    Done,
    Failed(ProviderErrLite),
    Other,
}

/// `ProviderErr` without the non-PartialEq parts, for tests.
#[derive(Debug, PartialEq, Clone)]
pub struct ProviderErrLite {
    pub status: Option<u16>,
    pub code: Option<&'static str>,
    pub message: String,
}

impl From<ProviderErrLite> for ProviderErr {
    fn from(e: ProviderErrLite) -> Self {
        ProviderErr {
            status: e.status,
            code: e.code,
            message: e.message,
            ..Default::default()
        }
    }
}

/// One server-sent event of the Responses stream.
pub fn parse_event(data: &str) -> Event {
    let Ok(v) = serde_json::from_str::<Value>(data) else {
        return Event::Other;
    };
    match v["type"].as_str() {
        Some("response.output_text.delta") => {
            Event::Token(v["delta"].as_str().unwrap_or("").to_string())
        }
        Some("response.completed") => Event::Done,
        Some("response.failed") => {
            let e = &v["response"]["error"];
            Event::Failed(classify_code(
                e["code"].as_str().unwrap_or("unknown_error"),
                e["message"].as_str().unwrap_or(""),
                None,
            ))
        }
        Some("response.incomplete") => Event::Failed(ProviderErrLite {
            status: None,
            code: None,
            message: "ChatGPT stopped before finishing the answer.".into(),
        }),
        Some("error") => {
            let code = v["code"]
                .as_str()
                .or(v["error"]["code"].as_str())
                .unwrap_or("error");
            let msg = v["message"]
                .as_str()
                .or(v["error"]["message"].as_str())
                .unwrap_or("");
            Event::Failed(classify_code(code, msg, None))
        }
        _ => Event::Other,
    }
}

/// Maps the documented plan-usage error codes to failures the panels can explain.
pub fn classify_code(code: &str, message: &str, status: Option<u16>) -> ProviderErrLite {
    let (code, status, message) = match code {
        "subscription_sharing_usage_limit_exceeded" => (
            Some(PLAN_LIMIT),
            Some(429),
            "Your ChatGPT plan's usage limit for PageTurn is reached. Check it in ChatGPT settings → Usage.".to_string(),
        ),
        "subscription_sharing_user_not_eligible" => (
            Some(NOT_ELIGIBLE),
            Some(403),
            "This ChatGPT account or workspace can't use its plan in other apps.".to_string(),
        ),
        "subscription_sharing_invalid_user" => (Some(SIGNED_OUT), Some(401), message.to_string()),
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => (
            None,
            Some(503),
            "ChatGPT couldn't check your plan's usage right now. Try again shortly.".to_string(),
        ),
        _ => (
            None,
            status,
            if message.is_empty() {
                format!("ChatGPT returned an error ({code}).")
            } else {
                message.to_string()
            },
        ),
    };
    ProviderErrLite {
        status,
        code,
        message,
    }
}

/// A non-2xx answer: a structured `{"error": {code, message}}` or a bare `{"detail": "..."}`.
pub fn classify_http(status: u16, body: &str) -> ProviderErrLite {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    if let Some(code) = v["error"]["code"].as_str() {
        return classify_code(
            code,
            v["error"]["message"].as_str().unwrap_or(""),
            Some(status),
        );
    }
    let detail = v["detail"]
        .as_str()
        .or(v["error"]["message"].as_str())
        .map(String::from)
        .unwrap_or_else(|| body.chars().take(200).collect());
    match status {
        401 => ProviderErrLite {
            status: Some(401),
            code: Some(SIGNED_OUT),
            message: detail,
        },
        _ => ProviderErrLite {
            status: Some(status),
            code: None,
            message: if detail.is_empty() {
                format!("ChatGPT answered HTTP {status}.")
            } else {
                detail
            },
        },
    }
}

/// Models meant for a picker, in the server's order: (slug, display name).
pub fn listed_models(v: &Value) -> Vec<(String, String)> {
    v["models"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|m| m["visibility"] == "list")
                .filter_map(|m| {
                    let slug = m["slug"].as_str()?.to_string();
                    let name = m["display_name"].as_str().unwrap_or(&slug).to_string();
                    Some((slug, name))
                })
                .collect()
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------------------
// Network
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

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn net_err(e: reqwest::Error) -> ProviderErr {
    ProviderErr {
        code: Some("ECONNREFUSED"),
        message: if e.is_timeout() {
            "request timed out".into()
        } else {
            "fetch failed".into()
        },
        ..Default::default()
    }
}

fn signed_out(message: &str) -> ProviderErr {
    ProviderErr {
        status: Some(401),
        code: Some(SIGNED_OUT),
        message: message.into(),
        ..Default::default()
    }
}

async fn discovery() -> Result<Value, ProviderErr> {
    static D: tokio::sync::OnceCell<Value> = tokio::sync::OnceCell::const_new();
    D.get_or_try_init(|| async {
        http()
            .get(DISCOVERY)
            .send()
            .await
            .map_err(net_err)?
            .json::<Value>()
            .await
            .map_err(net_err)
    })
    .await
    .cloned()
}

#[derive(Deserialize)]
struct IdClaims {
    sub: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    nonce: Option<String>,
}

/// Verifies the ID token's signature against OpenAI's keys, plus issuer, audience, expiry and
/// nonce. Returns (subject, email).
async fn validate_id_token(
    id_token: &str,
    client_id: &str,
    nonce: &str,
) -> Result<(String, Option<String>), ProviderErr> {
    use jsonwebtoken::{decode, decode_header, jwk::JwkSet, DecodingKey, Validation};
    let bad =
        |m: &str| ProviderErr::from_message(format!("The sign-in could not be verified: {m}"));
    let jwks_uri = discovery().await?["jwks_uri"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| bad("no signing keys published"))?;
    let keys: JwkSet = http()
        .get(jwks_uri)
        .send()
        .await
        .map_err(net_err)?
        .json()
        .await
        .map_err(net_err)?;
    let header = decode_header(id_token).map_err(|_| bad("malformed token"))?;
    let jwk = match &header.kid {
        Some(kid) => keys.find(kid),
        None => keys.keys.first(),
    }
    .ok_or_else(|| bad("unknown signing key"))?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| bad("unusable signing key"))?;
    let mut v = Validation::new(header.alg);
    v.set_issuer(&[ISSUER]);
    v.set_audience(&[client_id]);
    let claims = decode::<IdClaims>(id_token, &key, &v)
        .map_err(|e| bad(&e.to_string()))?
        .claims;
    if claims.nonce.as_deref() != Some(nonce) {
        return Err(bad("nonce mismatch"));
    }
    Ok((claims.sub, claims.email))
}

/// Opens the browser, waits for OpenAI's redirect to the loopback callback, exchanges the code,
/// verifies the result and saves it. `open` opens a URL in the system browser.
pub async fn sign_in(
    store: &Store,
    consent: bool,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), ProviderErr> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let mut account = store.account();
    let previous = store.session();

    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| ProviderErr::from_message(format!("Could not start the sign-in: {e}")))?,
    };
    let port = listener
        .local_addr()
        .map(|a| a.port())
        .unwrap_or(PREFERRED_PORT);
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let (state, nonce, verifier) = (random_token(), random_token(), random_token());
    let url = authorize_url(&AuthRequest {
        client_id: account.client_id.as_deref(),
        host_id: &account.host_id,
        redirect_uri: &redirect_uri,
        state: &state,
        nonce: &nonce,
        challenge: &pkce_challenge(&verifier),
        login_hint: account.email.as_deref(),
        id_token_hint: previous
            .as_ref()
            .map(|s| s.id_token.as_str())
            .filter(|t| !t.is_empty()),
        consent,
    });
    open(&url)
        .map_err(|e| ProviderErr::from_message(format!("Could not open the browser: {e}")))?;

    // Wait for the redirect (other requests, like a favicon, get a 404).
    let params = tokio::time::timeout(SIGN_IN_TIMEOUT, async {
        loop {
            let (mut sock, _) = listener.accept().await?;
            let mut line = String::new();
            BufReader::new(&mut sock).read_line(&mut line).await?;
            match parse_callback(&line) {
                Some(p) => {
                    let page = "<!doctype html><meta charset=utf-8><title>PageTurn</title>\
                        <body style=\"font:16px system-ui;margin:3em\">You can close this tab and \
                        go back to PageTurn.</body>";
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n{page}",
                        page.len()
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                    return Ok::<_, std::io::Error>(p);
                }
                None => {
                    let _ = sock
                        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
                        .await;
                }
            }
        }
    })
    .await
    .map_err(|_| ProviderErr::from_message("The sign-in timed out. Try again."))?
    .map_err(|e| ProviderErr::from_message(format!("The sign-in failed: {e}")))?;

    if params.get("state").map(String::as_str) != Some(state.as_str()) {
        return Err(ProviderErr::from_message(
            "The sign-in answer did not match. Try again.",
        ));
    }
    if let Some(err) = params.get("error") {
        return Err(if err == "access_denied" {
            ProviderErr {
                code: Some(PLAN_OFF),
                message: "Sign-in was cancelled, so PageTurn can't use your ChatGPT plan.".into(),
                ..Default::default()
            }
        } else {
            ProviderErr::from_message(format!("OpenAI refused the sign-in ({err})."))
        });
    }
    let code = params
        .get("code")
        .ok_or_else(|| ProviderErr::from_message("OpenAI sent no sign-in code. Try again."))?;
    let client_id = pick_client_id(
        account.client_id.as_deref(),
        params.get("client_id").map(String::as_str),
    )
    .map_err(ProviderErr::from_message)?;

    let resp = http()
        .post(TOKEN)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", client_id.as_str()),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("resource", RESOURCE),
        ])
        .send()
        .await
        .map_err(net_err)?;
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if status != 200 {
        let e = body["error"].as_str().unwrap_or("error");
        return Err(ProviderErr::from_message(format!(
            "OpenAI did not accept the sign-in ({e}). Try again."
        )));
    }
    let session = session_from_tokens(&body, now(), None)
        .ok_or_else(|| ProviderErr::from_message("OpenAI's sign-in answer was incomplete."))?;
    let (subject, email) = validate_id_token(&session.id_token, &client_id, &nonce).await?;
    if account.subject.as_deref().is_some_and(|s| s != subject) && account.client_id.is_some() {
        return Err(ProviderErr::from_message(
            "That's a different ChatGPT account than the one PageTurn registered. Sign out first.",
        ));
    }

    account.client_id = Some(client_id);
    account.subject = Some(subject);
    account.email = email;
    store
        .save_account(&account)
        .map_err(|e| ProviderErr::from_message(format!("Could not save the sign-in: {e}")))?;
    store.save_session(&session)?;
    if !session.plan_use() {
        return Err(ProviderErr {
            code: Some(PLAN_OFF),
            message: "Signed in, but permission to use your ChatGPT plan wasn't given.".into(),
            ..Default::default()
        });
    }
    Ok(())
}

/// A usable access token, refreshed when it is about to run out. Refreshes are serialized so two
/// replies never race the rotating refresh token.
pub async fn access_token(store: &Store) -> Result<String, ProviderErr> {
    static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = LOCK.lock().await;
    let s = store
        .session()
        .ok_or_else(|| signed_out("Sign in with ChatGPT in Settings."))?;
    if !s.plan_use() {
        return Err(ProviderErr {
            code: Some(PLAN_OFF),
            message: "Permission to use your ChatGPT plan wasn't given.".into(),
            ..Default::default()
        });
    }
    if !needs_refresh(&s, now()) {
        return Ok(s.access_token);
    }
    let client_id = store
        .account()
        .client_id
        .ok_or_else(|| signed_out("Sign in with ChatGPT in Settings."))?;
    let resp = http()
        .post(TOKEN)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id.as_str()),
            ("refresh_token", s.refresh_token.as_str()),
            ("resource", RESOURCE),
        ])
        .send()
        .await
        .map_err(net_err)?;
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if status != 200 {
        let code = body["error"].as_str().unwrap_or("");
        if refresh_is_terminal(code) {
            store.clear_session();
            return Err(signed_out(
                "Your ChatGPT sign-in ended. Sign in again in Settings.",
            ));
        }
        return Err(ProviderErr {
            status: Some(status),
            message: format!("Could not renew the ChatGPT sign-in ({code})."),
            ..Default::default()
        });
    }
    let fresh = session_from_tokens(&body, now(), Some(&s))
        .ok_or_else(|| ProviderErr::from_message("OpenAI's renewal answer was incomplete."))?;
    store.save_session(&fresh)?;
    Ok(fresh.access_token)
}

/// Signs out: revokes the refresh token at OpenAI, then clears the tokens. Keeps the host id and
/// registration for a later sign-in. Returns whether OpenAI confirmed the revocation.
pub async fn sign_out(store: &Store) -> bool {
    let Some(s) = store.session() else {
        return true;
    };
    let client_id = store.account().client_id.unwrap_or_default();
    let mut confirmed = false;
    if let Ok(d) = discovery().await {
        if let Some(url) = d["revocation_endpoint"].as_str() {
            for attempt in 0..3 {
                let r = http()
                    .post(url)
                    .form(&[
                        ("token", s.refresh_token.as_str()),
                        ("token_type_hint", "refresh_token"),
                        ("client_id", client_id.as_str()),
                    ])
                    .send()
                    .await;
                match r {
                    Ok(r) if r.status().is_success() => {
                        confirmed = true;
                        break;
                    }
                    Ok(r) if r.status().is_client_error() => break,
                    _ => tokio::time::sleep(Duration::from_millis(400 * (attempt + 1))).await,
                }
            }
        }
    }
    store.clear_session();
    confirmed
}

/// What Settings shows (never the tokens).
pub fn status(store: &Store) -> Value {
    let a = store.account();
    let s = store.session();
    json!({
        "signedIn": s.is_some(),
        "planUse": s.as_ref().is_some_and(Session::plan_use),
        "email": a.email,
        "welcomed": a.welcomed,
    })
}

pub fn mark_welcomed(store: &Store) {
    let mut a = store.account();
    a.welcomed = true;
    let _ = store.save_account(&a);
}

/// The signed-in account's models for a picker.
pub async fn models(store: &Store) -> Result<Vec<(String, String)>, ProviderErr> {
    let token = access_token(store).await?;
    let resp = http()
        .get(MODELS)
        .bearer_auth(token)
        .send()
        .await
        .map_err(net_err)?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if status != 200 {
        return Err(classify_http(status, &text).into());
    }
    Ok(listed_models(
        &serde_json::from_str(&text).unwrap_or(Value::Null),
    ))
}

// ---------------------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------------------

pub struct ChatGptProvider {
    pub model: String,
    pub dir: PathBuf,
}

impl ChatGptProvider {
    async fn run(&self, prompt: &Prompt, on_token: OnToken<'_>) -> Result<(), ProviderErr> {
        let store = Store::os(&self.dir);
        let token = access_token(&store).await?;
        // "default": the first model the account lists.
        let model = if self.model.is_empty() || self.model == "default" {
            models(&store)
                .await?
                .into_iter()
                .next()
                .map(|(slug, _)| slug)
                .ok_or_else(|| ProviderErr::from_message("Your ChatGPT plan lists no models."))?
        } else {
            self.model.clone()
        };
        let resp = http()
            .post(RESPONSES)
            .bearer_auth(token)
            .json(&request_body(&model, prompt))
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let body = resp.text().await.unwrap_or_default();
            return Err(classify_http(status, &body).into());
        }
        let mut parser = SseParser::default();
        let mut stream = resp.bytes_stream();
        let mut handle =
            |events: Vec<crate::commands::ai::SseEvent>| -> Option<Result<(), ProviderErr>> {
                for ev in events {
                    match parse_event(&ev.data) {
                        Event::Token(t) if !t.is_empty() => on_token(&t),
                        Event::Done => return Some(Ok(())),
                        Event::Failed(e) => return Some(Err(e.into())),
                        _ => {}
                    }
                }
                None
            };
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(net_err)?;
            if let Some(end) = handle(parser.feed(&chunk)) {
                return end;
            }
        }
        if let Some(end) = handle(parser.finish()) {
            return end;
        }
        Err(ProviderErr::from_message(
            "The answer stopped before it finished. Try again.",
        ))
    }
}

impl Provider for ChatGptProvider {
    fn stream<'a>(
        &'a self,
        prompt: &'a Prompt,
        on_token: OnToken<'a>,
    ) -> BoxFuture<'a, Result<(), ProviderErr>> {
        Box::pin(self.run(prompt, on_token))
    }

    fn timeout(&self) -> Duration {
        REPLY_TIMEOUT
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppResult;

    struct Fake;
    impl SecretCipher for Fake {
        fn encrypt(&self, p: &[u8]) -> AppResult<Vec<u8>> {
            Ok(p.iter().rev().cloned().collect())
        }
        fn decrypt(&self, c: &[u8]) -> AppResult<Vec<u8>> {
            Ok(c.iter().rev().cloned().collect())
        }
    }

    fn store() -> Store {
        let dir = std::env::temp_dir().join(format!("pt-chatgpt-{}", uuid::Uuid::new_v4()));
        Store {
            dir,
            cipher: Box::new(Fake),
        }
    }

    fn session(scopes: &[&str], expires_at: i64) -> Session {
        Session {
            access_token: "at".into(),
            refresh_token: "rt".into(),
            id_token: "it".into(),
            expires_at,
            scopes: scopes.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn pkce_matches_rfc7636_example() {
        // RFC 7636 appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let t = random_token();
        assert_eq!(t.len(), 43);
        assert_ne!(t, random_token());
    }

    #[test]
    fn first_registration_url_vs_returning_sign_in() {
        let req = |client_id| AuthRequest {
            client_id,
            host_id: "urn:uuid:1",
            redirect_uri: "http://127.0.0.1:1455/auth/callback",
            state: "s",
            nonce: "n",
            challenge: "c",
            login_hint: None,
            id_token_hint: None,
            consent: false,
        };
        let first = authorize_url(&req(None));
        assert!(first.starts_with("https://auth.openai.com/api/accounts/authorize?"));
        assert!(first.contains("client_id=dynamic_agent_client"));
        assert!(first.contains("agent_name_hint=PageTurn"));
        assert!(first.contains("ext_agent_host_id=urn%3Auuid%3A1"));
        assert!(first.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback"));
        assert!(first.contains("scope=openid%20profile%20email%20offline_access%20resource.invoke%20chatgpt.tokens.use.direct"));
        assert!(first.contains("resource=https%3A%2F%2Fapi.openai.com%2Fv1"));
        assert!(first.contains("code_challenge_method=S256"));
        assert!(!first.contains("prompt="));

        let again = authorize_url(&AuthRequest {
            id_token_hint: Some("tok"),
            login_hint: Some("a@b.c"),
            consent: true,
            ..req(Some("oaiapp_1"))
        });
        assert!(again.contains("client_id=oaiapp_1"));
        assert!(!again.contains("agent_name_hint"));
        assert!(again.contains("id_token_hint=tok") && again.contains("login_hint=a%40b.c"));
        assert!(again.contains("prompt=consent"));
    }

    #[test]
    fn callback_parsing() {
        let p = parse_callback(
            "GET /auth/callback?code=abc&state=x%2By&scope=openid+email&client_id=oaiapp_9 HTTP/1.1",
        )
        .unwrap();
        assert_eq!(p["code"], "abc");
        assert_eq!(p["state"], "x+y");
        assert_eq!(p["scope"], "openid email");
        assert_eq!(p["client_id"], "oaiapp_9");
        assert!(parse_callback("GET /favicon.ico HTTP/1.1").is_none());
        assert!(parse_callback("GET /callback?code=1 HTTP/1.1").is_none());
    }

    #[test]
    fn client_id_choice() {
        assert_eq!(pick_client_id(None, Some("oaiapp_1")).unwrap(), "oaiapp_1");
        assert!(pick_client_id(None, Some("dynamic_agent_client")).is_err());
        assert!(pick_client_id(None, None).is_err());
        assert_eq!(pick_client_id(Some("oaiapp_1"), None).unwrap(), "oaiapp_1");
        assert!(pick_client_id(Some("oaiapp_1"), Some("oaiapp_2")).is_err());
    }

    #[test]
    fn tokens_to_session_and_refresh_timing() {
        let v = json!({"access_token": "a", "refresh_token": "r", "id_token": "i",
            "expires_in": 3600, "scope": "openid chatgpt.tokens.use.direct"});
        let s = session_from_tokens(&v, 1000, None).unwrap();
        assert_eq!(s.expires_at, 4600);
        assert!(s.plan_use());
        assert!(!needs_refresh(&s, 1000));
        assert!(needs_refresh(&s, 4600 - REFRESH_EARLY_SECS));
        // A refresh answer without scope/id token keeps the earlier ones.
        let r = session_from_tokens(
            &json!({"access_token": "a2", "refresh_token": "r2"}),
            5000,
            Some(&s),
        )
        .unwrap();
        assert_eq!((r.refresh_token.as_str(), r.id_token.as_str()), ("r2", "i"));
        assert!(r.plan_use());
        assert!(session_from_tokens(&json!({"refresh_token": "r"}), 0, None).is_none());
        assert!(!session(&["openid"], 0).plan_use());
    }

    #[test]
    fn request_body_follows_the_preview_rules() {
        let p = Prompt {
            system: "Be brief.".into(),
            messages: vec![
                ChatMessage {
                    role: "user",
                    content: "Explain A".into(),
                },
                ChatMessage {
                    role: "assistant",
                    content: "A is B.".into(),
                },
                ChatMessage {
                    role: "user",
                    content: "Why?".into(),
                },
            ],
        };
        let b = request_body("gpt-x", &p);
        assert_eq!(b["store"], false);
        assert_eq!(b["stream"], true);
        assert_eq!(b["instructions"], "Be brief.");
        assert_eq!(b["input"].as_array().unwrap().len(), 3);
        assert_eq!(b["input"][1]["role"], "assistant");
        for unsupported in [
            "temperature",
            "max_output_tokens",
            "previous_response_id",
            "metadata",
            "user",
        ] {
            assert!(b.get(unsupported).is_none(), "{unsupported}");
        }
    }

    #[test]
    fn stream_events() {
        assert_eq!(
            parse_event(r#"{"type":"response.output_text.delta","delta":"Hi"}"#),
            Event::Token("Hi".into())
        );
        assert_eq!(
            parse_event(r#"{"type":"response.completed","response":{}}"#),
            Event::Done
        );
        assert_eq!(parse_event(r#"{"type":"response.created"}"#), Event::Other);
        match parse_event(
            r#"{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}"#,
        ) {
            Event::Failed(e) => assert_eq!((e.code, e.status), (Some(PLAN_LIMIT), Some(429))),
            e => panic!("{e:?}"),
        }
        assert!(matches!(
            parse_event(r#"{"type":"response.incomplete"}"#),
            Event::Failed(_)
        ));
    }

    #[test]
    fn http_errors() {
        let e = classify_http(
            403,
            r#"{"error":{"code":"subscription_sharing_user_not_eligible","message":"x"}}"#,
        );
        assert_eq!(e.code, Some(NOT_ELIGIBLE));
        let e = classify_http(401, r#"{"detail":"bad identity"}"#);
        assert_eq!(
            (e.code, e.message.as_str()),
            (Some(SIGNED_OUT), "bad identity")
        );
        let e = classify_http(503, "");
        assert_eq!((e.code, e.status), (None, Some(503)));
        assert!(e.message.contains("503"));
    }

    #[test]
    fn model_list_keeps_listed_models_in_order() {
        let v = json!({"models": [
            {"slug": "b", "display_name": "B", "visibility": "list"},
            {"slug": "hidden", "visibility": "hide"},
            {"slug": "a", "visibility": "list"}
        ]});
        assert_eq!(
            listed_models(&v),
            vec![("b".into(), "B".into()), ("a".into(), "a".into())]
        );
    }

    #[test]
    fn storage_keeps_host_id_and_encrypts_tokens() {
        let st = store();
        let a = st.account();
        assert!(a.host_id.starts_with("urn:uuid:"));
        assert_eq!(st.account().host_id, a.host_id); // stable
        assert!(st.session().is_none());
        st.save_session(&session(&[PLAN_SCOPE], 99)).unwrap();
        assert_eq!(st.session().unwrap().refresh_token, "rt");
        let raw = std::fs::read_to_string(st.dir.join("secrets.bin")).unwrap();
        assert!(!raw.contains("\"rt\"") && !raw.contains("refresh_token"));
        assert_eq!(status(&st)["signedIn"], true);
        assert_eq!(status(&st)["planUse"], true);
        assert!(status(&st).get("access_token").is_none());
        st.clear_session();
        assert_eq!(status(&st)["signedIn"], false);
        assert_eq!(st.account().host_id, a.host_id); // survives sign-out
        mark_welcomed(&st);
        assert!(st.account().welcomed);
        let _ = std::fs::remove_dir_all(&st.dir);
    }
}
