//! Claude plan provider: runs the reader's own installed Claude Code CLI (`claude`), signed in
//! with their Claude subscription.
//!
//! PageTurn never handles the sign-in or its tokens. The CLI signs itself in (`claude auth
//! login` in its own window, in the browser) and keeps its credentials; PageTurn only starts it
//! and reads its stream-json output, the same way any script would use Claude Code.
//!
//! Each reply runs in a fresh `claude -p` process (stream-json in and out):
//! - with no tools at all (`--tools ""`), no MCP servers, no user/project settings or hooks,
//!   and no slash commands, in an empty temp folder, so it cannot read or change the reader's
//!   files;
//! - one process per reply, because a process remembers its whole conversation: sharing one
//!   would carry one question's context into the next. Start-up is ~0.7 s, so a spare process
//!   is started ahead of time and handed to the next reply (measured: first token 1.8 s cold,
//!   1.1 s warm).
//!
//! Limits of the reader's plan apply. A reply over the limit fails with a clear message.
use super::{OnToken, Prompt, Provider};
use crate::commands::ai::{ChatMessage, ProviderErr};
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

/// Error codes `commands::ai::to_ai_error` turns into messages the panels show.
pub const SIGNED_OUT: &str = "CLAUDE_SIGNED_OUT";
pub const MISSING: &str = "CLAUDE_MISSING";
pub const PLAN_LIMIT: &str = "CLAUDE_PLAN_LIMIT";

/// Model aliases the CLI understands; "default" leaves the choice to the CLI (the plan's default).
pub const MODELS: [&str; 4] = ["default", "sonnet", "opus", "haiku"];

/// The same for every process (so a spare can be started before the request is known); each
/// request's own instructions travel in its message.
const SYSTEM: &str = "You are the reading assistant inside PageTurn, a PDF reader. Follow the \
instructions inside <instructions> in the message exactly. You have no tools: answer in plain \
text only.";

const REPLY_TIMEOUT: Duration = Duration::from_secs(120);
const STATUS_TIMEOUT: Duration = Duration::from_secs(15);

// ---------------------------------------------------------------------------------------
// Finding and starting the CLI
// ---------------------------------------------------------------------------------------

/// The installed `claude`: `PAGETURN_CLAUDE_PATH`, else the first match on PATH.
pub fn locate() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("PAGETURN_CLAUDE_PATH").map(PathBuf::from) {
        return p.is_file().then_some(p);
    }
    let names: &[&str] = if cfg!(windows) {
        &["claude.exe", "claude.cmd"]
    } else {
        &["claude"]
    };
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .find(|p| p.is_file())
}

fn is_cmd_script(p: &Path) -> bool {
    p.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
}

/// A command for the CLI: hidden window, no inherited Claude Code session markers, and no
/// `ANTHROPIC_API_KEY` (that would bill an API key instead of using the reader's plan).
fn command(exe: &Path) -> Command {
    let mut c = if is_cmd_script(exe) {
        // npm installs a .cmd shim, which only cmd.exe can start.
        let mut c = Command::new("cmd");
        c.arg("/C").arg(exe);
        c
    } else {
        Command::new(exe)
    };
    c.env_remove("CLAUDECODE")
        .env_remove("CLAUDE_CODE_ENTRYPOINT")
        .env_remove("ANTHROPIC_API_KEY")
        .kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}

/// An empty folder the CLI runs in, so even its working directory holds none of the reader's files.
fn work_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("PageTurn-claude");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Arguments for one tool-free, settings-free, stream-json `claude -p` process.
pub fn process_args(model: &str) -> Vec<String> {
    let mut a: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--system-prompt",
        SYSTEM,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if model != "default" && MODELS.contains(&model) {
        a.push("--model".into());
        a.push(model.into());
    }
    a
}

fn spawn(model: &str) -> Result<Child, ProviderErr> {
    let exe = locate().ok_or_else(missing)?;
    command(&exe)
        .args(process_args(model))
        .current_dir(work_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ProviderErr {
            code: Some(MISSING),
            message: format!("Could not start Claude Code: {e}"),
            ..Default::default()
        })
}

/// One process started ahead of time for the next reply (its model, the process).
fn spare() -> &'static Mutex<Option<(String, Child)>> {
    static S: OnceLock<Mutex<Option<(String, Child)>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

/// A ready process for `model`: the spare if it fits and is still running, else a new one.
/// Starts the next spare either way.
fn take_process(model: &str) -> Result<Child, ProviderErr> {
    let ready = {
        let mut slot = spare().lock().unwrap_or_else(|e| e.into_inner());
        match slot.take() {
            Some((m, mut child)) if m == model => {
                // Still running? Otherwise it is dropped (and killed) like any stale spare.
                matches!(child.try_wait(), Ok(None)).then_some(child)
            }
            _ => None, // a spare for another model is dropped, which kills it
        }
    };
    let child = match ready {
        Some(c) => c,
        None => spawn(model)?,
    };
    if let Ok(next) = spawn(model) {
        *spare().lock().unwrap_or_else(|e| e.into_inner()) = Some((model.to_string(), next));
    }
    Ok(child)
}

// ---------------------------------------------------------------------------------------
// Messages in, events out
// ---------------------------------------------------------------------------------------

/// The one user message a process receives: the request's instructions, then the conversation
/// so far (follow-ups resend it, as API providers do) and the newest question.
pub fn user_message(prompt: &Prompt) -> String {
    let mut out = format!(
        "<instructions>\n{}\n</instructions>\n\n",
        prompt.system.trim()
    );
    let (last, earlier) = match prompt.messages.split_last() {
        Some((l, e)) => (l.content.as_str(), e),
        None => ("", &[] as &[ChatMessage]),
    };
    if !earlier.is_empty() {
        out.push_str("<conversation_so_far>\n");
        for m in earlier {
            let who = if m.role == "assistant" {
                "assistant"
            } else {
                "reader"
            };
            out.push_str(&format!("<{who}>\n{}\n</{who}>\n", m.content.trim()));
        }
        out.push_str("</conversation_so_far>\n\nThe reader now says:\n");
    }
    out.push_str(last);
    out
}

/// The stream-json line that sends `text` as the user's turn.
pub fn input_line(text: &str) -> String {
    json!({"type": "user", "message": {"role": "user", "content": text}}).to_string() + "\n"
}

#[derive(Debug, PartialEq)]
pub enum Event {
    Token(String),
    /// The turn finished; carries the final text (used when no pieces were streamed).
    Done(String),
    Failed(String, Option<&'static str>, Option<u16>),
    Other,
}

/// Reads one line of `claude -p --output-format stream-json --include-partial-messages`.
pub fn parse_line(line: &str) -> Event {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return Event::Other;
    };
    match v.get("type").and_then(Value::as_str) {
        Some("stream_event") => {
            let ev = &v["event"];
            let delta = &ev["delta"];
            if ev["type"] == "content_block_delta" && delta["type"] == "text_delta" {
                if let Some(t) = delta["text"].as_str() {
                    return Event::Token(t.to_string());
                }
            }
            Event::Other
        }
        Some("rate_limit_event") => {
            let info = &v["rate_limit_info"];
            if info["status"] == "rejected" {
                return Event::Failed(
                    plan_limit_message(info["resetsAt"].as_i64()),
                    Some(PLAN_LIMIT),
                    Some(429),
                );
            }
            Event::Other
        }
        Some("result") => {
            let text = v["result"].as_str().unwrap_or("").to_string();
            let failed = v["is_error"].as_bool().unwrap_or(false)
                || v["subtype"].as_str().is_some_and(|s| s != "success");
            if failed {
                classify_failure(&text)
            } else {
                Event::Done(text)
            }
        }
        _ => Event::Other,
    }
}

fn plan_limit_message(resets_at: Option<i64>) -> String {
    let when = resets_at
        .and_then(|s| chrono::DateTime::from_timestamp(s, 0))
        .map(|t| {
            t.with_timezone(&chrono::Local)
                .format(" It resets at %H:%M.")
                .to_string()
        })
        .unwrap_or_default();
    format!("Your Claude plan's usage limit is reached.{when}")
}

/// Turns the CLI's error text into a failure the panels can explain.
pub fn classify_failure(text: &str) -> Event {
    let lower = text.to_lowercase();
    if lower.contains("/login")
        || lower.contains("not logged in")
        || lower.contains("log in")
        || lower.contains("invalid api key")
        || lower.contains("oauth")
    {
        return Event::Failed(text.to_string(), Some(SIGNED_OUT), Some(401));
    }
    if lower.contains("usage limit")
        || lower.contains("rate limit")
        || lower.contains("limit reached")
    {
        return Event::Failed(text.to_string(), Some(PLAN_LIMIT), Some(429));
    }
    let message = if text.is_empty() {
        "Claude Code stopped with an error.".to_string()
    } else {
        text.to_string()
    };
    Event::Failed(message, None, None)
}

fn missing() -> ProviderErr {
    ProviderErr {
        code: Some(MISSING),
        message: "Claude Code is not installed.".into(),
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------------------

pub struct ClaudeCodeProvider {
    pub model: String,
}

impl ClaudeCodeProvider {
    async fn run(&self, prompt: &Prompt, on_token: OnToken<'_>) -> Result<(), ProviderErr> {
        let mut child = take_process(&self.model)?;
        let mut stdin = child.stdin.take().ok_or_else(missing)?;
        let stdout = child.stdout.take().ok_or_else(missing)?;
        let mut stderr = child.stderr.take();
        let io_err = |e: std::io::Error| ProviderErr::from_message(format!("Claude Code: {e}"));
        stdin
            .write_all(input_line(&user_message(prompt)).as_bytes())
            .await
            .map_err(io_err)?;
        stdin.flush().await.map_err(io_err)?;
        drop(stdin); // end of input: the process answers, then exits

        let mut lines = BufReader::new(stdout).lines();
        let mut streamed = false;
        while let Some(line) = lines.next_line().await.map_err(io_err)? {
            match parse_line(&line) {
                Event::Token(t) => {
                    streamed = true;
                    on_token(&t);
                }
                Event::Done(text) => {
                    if !streamed && !text.is_empty() {
                        on_token(&text);
                    }
                    return Ok(());
                }
                Event::Failed(message, code, status) => {
                    return Err(ProviderErr {
                        status,
                        code,
                        message,
                        ..Default::default()
                    })
                }
                Event::Other => {}
            }
        }
        // Output ended without a result: report what the CLI printed on stderr.
        let mut err = String::new();
        if let Some(s) = stderr.as_mut() {
            let _ = s.read_to_string(&mut err).await;
        }
        match classify_failure(err.trim()) {
            Event::Failed(message, code, status) => Err(ProviderErr {
                status,
                code,
                message,
                ..Default::default()
            }),
            _ => Err(ProviderErr::from_message(
                "Claude Code stopped without an answer.",
            )),
        }
    }
}

impl Provider for ClaudeCodeProvider {
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

// ---------------------------------------------------------------------------------------
// Status and sign-in (Settings)
// ---------------------------------------------------------------------------------------

async fn output(exe: &Path, args: &[&str]) -> Option<String> {
    let out = command(exe)
        .args(args)
        .current_dir(work_dir())
        .stdin(Stdio::null())
        .output();
    match tokio::time::timeout(STATUS_TIMEOUT, out).await {
        Ok(Ok(o)) => Some(String::from_utf8_lossy(&o.stdout).trim().to_string()),
        _ => None,
    }
}

/// What Settings shows: installed? which version? signed in, how, on which plan? (Never the
/// account's email or tokens.)
pub async fn status() -> Value {
    let Some(exe) = locate() else {
        return json!({"installed": false, "loggedIn": false});
    };
    let version = output(&exe, &["--version"]).await.unwrap_or_default();
    let auth = output(&exe, &["auth", "status", "--json"])
        .await
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .unwrap_or(Value::Null);
    status_from(&version, &auth)
}

pub fn status_from(version: &str, auth: &Value) -> Value {
    json!({
        "installed": true,
        "version": version.split_whitespace().next().unwrap_or(""),
        "loggedIn": auth["loggedIn"].as_bool().unwrap_or(false),
        "authMethod": auth["authMethod"].as_str(),
        "plan": auth["subscriptionType"].as_str(),
    })
}

/// Opens `claude auth login` in its own console window; the CLI then signs in in the browser.
pub fn open_login() -> Result<(), String> {
    let exe = locate().ok_or("Claude Code is not installed.")?;
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "Claude Code sign-in"])
            .arg(&exe)
            .args(["auth", "login"])
            .current_dir(work_dir())
            .env_remove("CLAUDECODE")
            .env_remove("CLAUDE_CODE_ENTRYPOINT")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open the sign-in window: {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = exe;
        Err("Run `claude auth login` in a terminal to sign in.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(role: &'static str, content: &str) -> ChatMessage {
        ChatMessage {
            role,
            content: content.into(),
        }
    }

    #[test]
    fn args_are_tool_free_and_settings_free() {
        let a = process_args("sonnet");
        let after = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        assert_eq!(after("--tools"), "");
        assert_eq!(after("--setting-sources"), "");
        assert!(a.contains(&"--strict-mcp-config".to_string()));
        assert!(a.contains(&"--no-session-persistence".to_string()));
        assert_eq!(after("--model"), "sonnet");
        assert!(!process_args("default").contains(&"--model".to_string()));
        assert!(!process_args("anything-else").contains(&"--model".to_string()));
    }

    #[test]
    fn user_message_carries_instructions_and_history() {
        let one = Prompt {
            system: "Be brief.".into(),
            messages: vec![m("user", "What is a tokenizer?")],
        };
        let s = user_message(&one);
        assert!(s.starts_with("<instructions>\nBe brief.\n</instructions>"));
        assert!(s.ends_with("What is a tokenizer?"));
        assert!(!s.contains("conversation_so_far"));

        let three = Prompt {
            system: "Be brief.".into(),
            messages: vec![
                m("user", "Explain A"),
                m("assistant", "A is B."),
                m("user", "Why?"),
            ],
        };
        let s = user_message(&three);
        assert!(s.contains("<reader>\nExplain A\n</reader>"));
        assert!(s.contains("<assistant>\nA is B.\n</assistant>"));
        assert!(s.ends_with("The reader now says:\nWhy?"));
    }

    #[test]
    fn input_line_is_one_json_user_turn() {
        let l = input_line("hi \"there\"\nsecond line");
        assert!(l.ends_with('\n') && l.matches('\n').count() == 1);
        let v: Value = serde_json::from_str(l.trim()).unwrap();
        assert_eq!(v["message"]["content"], "hi \"there\"\nsecond line");
    }

    #[test]
    fn parses_text_deltas_and_ignores_thinking() {
        let t = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"hello"}}}"#;
        assert_eq!(parse_line(t), Event::Token("hello".into()));
        let think = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hm"}}}"#;
        assert_eq!(parse_line(think), Event::Other);
        assert_eq!(
            parse_line(r#"{"type":"system","subtype":"init"}"#),
            Event::Other
        );
        assert_eq!(parse_line("not json"), Event::Other);
    }

    #[test]
    fn parses_results() {
        let ok = r#"{"type":"result","subtype":"success","is_error":false,"result":"hello there"}"#;
        assert_eq!(parse_line(ok), Event::Done("hello there".into()));
        let out = r#"{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key · Please run /login"}"#;
        assert!(matches!(
            parse_line(out),
            Event::Failed(_, Some(SIGNED_OUT), Some(401))
        ));
        let other =
            r#"{"type":"result","subtype":"error_during_execution","is_error":true,"result":""}"#;
        assert!(matches!(parse_line(other), Event::Failed(_, None, None)));
    }

    #[test]
    fn plan_limit_from_rate_limit_events() {
        let allowed = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1795726800}}"#;
        assert_eq!(parse_line(allowed), Event::Other);
        let rejected = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1795726800}}"#;
        match parse_line(rejected) {
            Event::Failed(msg, Some(PLAN_LIMIT), Some(429)) => {
                assert!(msg.contains("usage limit") && msg.contains("resets at"))
            }
            e => panic!("{e:?}"),
        }
        assert!(matches!(
            classify_failure("Claude AI usage limit reached|1795726800"),
            Event::Failed(_, Some(PLAN_LIMIT), _)
        ));
    }

    #[test]
    fn status_never_includes_the_account() {
        let auth = serde_json::json!({"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "pro",
            "email": "someone@example.com", "orgId": "x"});
        let s = status_from("2.1.292 (Claude Code)", &auth);
        assert_eq!(s["version"], "2.1.292");
        assert_eq!(s["loggedIn"], true);
        assert_eq!(s["plan"], "pro");
        assert!(s.get("email").is_none() && s.get("orgId").is_none());
        assert_eq!(status_from("", &Value::Null)["loggedIn"], false);
    }
}
