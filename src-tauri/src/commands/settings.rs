//! `settings` commands: the settings table and API-key storage.
//!
//! API keys live in `<data_dir>/secrets.bin` as JSON `{ provider: base64(ciphertext) }`
//! (same file and shape as PageTurn 1.x), encrypted with Windows DPAPI. Keys
//! saved by 1.x used a different scheme that plain DPAPI cannot decrypt, so they read
//! as "no key" and the user re-enters them (accepted). Keys never leave
//! Rust: the UI can only store, clear, or ask whether one exists.
use crate::error::{invalid, AppError, AppResult};
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Map, Value};
use std::path::Path;
use tauri::State;

const PROVIDERS: [&str; 3] = ["anthropic", "openai", "gemini"];
const HIGHLIGHT_COLORS: [&str; 5] = ["yellow", "green", "blue", "pink", "purple"];
const INK_COLORS: [&str; 6] = [
    "#1f1f1f", "#d0342c", "#2a62c9", "#2e8b57", "#e07b00", "#7b3fb5",
];
const INK_WIDTHS: [f64; 3] = [0.0025, 0.005, 0.01];
const LOOKUP_SITES: [&str; 7] = [
    "wikipedia",
    "wiktionary",
    "merriam-webster",
    "britannica",
    "google",
    "duckduckgo",
    "custom",
];

fn defaults() -> Map<String, Value> {
    let v = json!({
        "theme": "system", "paperTint": "cream", "pageTurnStyle": "curl", "layout": "auto",
        "turnSound": false, "highlightColor": "yellow", "drawWithMouse": false,
        "penColor": "#1f1f1f", "penWidth": 0.005, "showBookmarkTabs": true,
        "lookupSite": "wikipedia", "lookupLanguage": "en", "lookupCustomUrl": "",
        "lookupOpenIn": "app", "aiProvider": "anthropic", "aiModel": null,
        "searchEngine": "duckduckgo", "searchIncludeTitle": false, "helpDefaultTab": "auto",
        "helpPanelWidth": 420, "aiPrivacyAcknowledged": false, "onboardingDone": false,
        "sampleImported": false, "spoilerShield": {}
    });
    match v {
        Value::Object(m) => m,
        _ => unreachable!(),
    }
}

/// `/^[a-z]{2,3}(-[a-z]{2,8})?$/`
fn language_ok(s: &str) -> bool {
    let low = |p: &str, lo: usize, hi: usize| {
        (lo..=hi).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_lowercase())
    };
    match s.split_once('-') {
        None => low(s, 2, 3),
        Some((a, b)) => low(a, 2, 3) && low(b, 2, 8),
    }
}

/// Validates one field the way `SettingsPartialSchema` does; returns the value to store.
fn check_field(key: &str, v: &Value) -> AppResult<Value> {
    let bad = || invalid(format!("setting {key}"));
    let one_of = |opts: &[&str]| match v.as_str() {
        Some(s) if opts.contains(&s) => Ok(v.clone()),
        _ => Err(bad()),
    };
    let boolean = || {
        if v.is_boolean() {
            Ok(v.clone())
        } else {
            Err(bad())
        }
    };
    match key {
        "theme" => one_of(&["system", "light", "dark"]),
        "paperTint" => one_of(&["white", "cream", "sepia", "dark"]),
        "pageTurnStyle" => one_of(&["curl", "slide", "instant"]),
        "layout" => one_of(&["auto", "spread", "single"]),
        "turnSound"
        | "drawWithMouse"
        | "showBookmarkTabs"
        | "searchIncludeTitle"
        | "aiPrivacyAcknowledged"
        | "onboardingDone" => boolean(),
        "highlightColor" => one_of(&HIGHLIGHT_COLORS),
        "penColor" => one_of(&INK_COLORS),
        "penWidth" => match v.as_f64() {
            Some(n) if INK_WIDTHS.contains(&n) => Ok(v.clone()),
            _ => Err(bad()),
        },
        "lookupSite" => one_of(&LOOKUP_SITES),
        "lookupLanguage" => match v.as_str() {
            Some(s) if language_ok(s) => Ok(v.clone()),
            _ => Err(bad()),
        },
        "lookupCustomUrl" => match v.as_str() {
            Some(s) if s.chars().count() <= 500 => Ok(v.clone()),
            _ => Err(bad()),
        },
        "lookupOpenIn" => one_of(&["app", "browser"]),
        "aiProvider" => one_of(&["anthropic", "openai", "gemini", "claude", "chatgpt"]),
        "aiModel" => match v {
            Value::Null => Ok(Value::Null),
            Value::String(s) => {
                let t = s.trim();
                if (1..=120).contains(&t.chars().count()) {
                    Ok(Value::String(t.to_string()))
                } else {
                    Err(bad())
                }
            }
            _ => Err(bad()),
        },
        "searchEngine" => one_of(&["duckduckgo", "google", "bing"]),
        "helpDefaultTab" => one_of(&["auto", "explain", "web"]),
        "helpPanelWidth" => match v.as_f64() {
            Some(n) if n.fract() == 0.0 && (320.0..=4000.0).contains(&n) => {
                Ok(Value::from(n as i64))
            }
            _ => Err(bad()),
        },
        // Spoiler Shield per book: { bookId: on? } (a book missing from it has not been asked).
        "spoilerShield" => match v.as_object() {
            Some(m)
                if m.len() <= 100_000
                    && m.iter()
                        .all(|(id, on)| (1..=64).contains(&id.len()) && on.is_boolean()) =>
            {
                Ok(v.clone())
            }
            _ => Err(bad()),
        },
        // Includes `sampleImported` (set by main only) and anything unknown.
        _ => Err(invalid(format!("unknown setting {key}"))),
    }
}

fn get_settings(conn: &rusqlite::Connection) -> AppResult<Value> {
    let mut out = defaults();
    let mut stmt = conn.prepare("SELECT key, value_json FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (key, json) = row?;
        if out.contains_key(&key) {
            out.insert(key, serde_json::from_str(&json)?);
        }
    }
    Ok(Value::Object(out))
}

fn set_settings(conn: &rusqlite::Connection, partial: &Value) -> AppResult<Value> {
    let obj = partial
        .as_object()
        .ok_or_else(|| invalid("settings must be an object"))?;
    let mut clean = Vec::new();
    for (k, v) in obj {
        clean.push((k.as_str(), check_field(k, v)?));
    }
    let tx = conn.unchecked_transaction()?;
    for (k, v) in &clean {
        tx.execute(
            "INSERT INTO settings (key, value_json) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            rusqlite::params![k, serde_json::to_string(v)?],
        )?;
    }
    tx.commit()?;
    get_settings(conn)
}

// ---- API keys ----

/// The encryption behind the key store (injected so tests can fake it).
pub trait SecretCipher {
    fn encrypt(&self, plain: &[u8]) -> AppResult<Vec<u8>>;
    fn decrypt(&self, cipher: &[u8]) -> AppResult<Vec<u8>>;
}

#[cfg_attr(windows, allow(dead_code))]
fn unavailable() -> AppError {
    AppError::Msg("Secure key storage is not available on this system".into())
}

/// Windows DPAPI (current user). Elsewhere: refuses, never stores plaintext.
pub struct OsCipher;

#[cfg(windows)]
impl SecretCipher for OsCipher {
    fn encrypt(&self, plain: &[u8]) -> AppResult<Vec<u8>> {
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
        let input = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: input points at `plain` for the call; output is freed with LocalFree.
        unsafe {
            CryptProtectData(&input, None, None, None, None, 0, &mut out)
                .map_err(|_| AppError::Msg("Could not encrypt the key".into()))?;
            let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            let _ = LocalFree(HLOCAL(out.pbData as *mut _));
            Ok(v)
        }
    }

    fn decrypt(&self, cipher: &[u8]) -> AppResult<Vec<u8>> {
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
        let input = CRYPT_INTEGER_BLOB {
            cbData: cipher.len() as u32,
            pbData: cipher.as_ptr() as *mut u8,
        };
        let mut out = CRYPT_INTEGER_BLOB::default();
        // SAFETY: as in `encrypt`.
        unsafe {
            CryptUnprotectData(&input, None, None, None, None, 0, &mut out)
                .map_err(|_| AppError::Msg("Cannot decrypt the saved key".into()))?;
            let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            let _ = LocalFree(HLOCAL(out.pbData as *mut _));
            Ok(v)
        }
    }
}

#[cfg(not(windows))]
impl SecretCipher for OsCipher {
    fn encrypt(&self, _: &[u8]) -> AppResult<Vec<u8>> {
        Err(unavailable())
    }
    fn decrypt(&self, _: &[u8]) -> AppResult<Vec<u8>> {
        Err(unavailable())
    }
}

fn secrets_file(dir: &Path) -> std::path::PathBuf {
    dir.join("secrets.bin")
}

fn read_secrets(dir: &Path) -> Map<String, Value> {
    std::fs::read_to_string(secrets_file(dir))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| match v {
            Value::Object(m) => Some(m),
            _ => None,
        })
        .unwrap_or_default()
}

fn check_provider(p: &str) -> AppResult<()> {
    if PROVIDERS.contains(&p) {
        Ok(())
    } else {
        Err(invalid("provider"))
    }
}

fn store_set(dir: &Path, c: &dyn SecretCipher, provider: &str, key: &str) -> AppResult<()> {
    check_provider(provider)?;
    let key = key.trim();
    if key.is_empty() || key.chars().count() > 512 {
        return Err(invalid("API key"));
    }
    let blob = c.encrypt(key.as_bytes())?;
    let mut data = read_secrets(dir);
    data.insert(provider.into(), Value::String(B64.encode(blob)));
    std::fs::create_dir_all(dir)?;
    std::fs::write(secrets_file(dir), serde_json::to_string(&data)?)?;
    Ok(())
}

/// The key, or None when missing or not decryptable (e.g. saved by PageTurn 1.x).
fn store_get(dir: &Path, c: &dyn SecretCipher, provider: &str) -> AppResult<Option<String>> {
    check_provider(provider)?;
    let Some(blob) = read_secrets(dir)
        .get(provider)
        .and_then(|v| v.as_str().map(String::from))
    else {
        return Ok(None);
    };
    let Ok(bytes) = B64.decode(blob) else {
        return Ok(None);
    };
    Ok(c.decrypt(&bytes)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .filter(|s| !s.is_empty()))
}

fn store_clear(dir: &Path, provider: &str) -> AppResult<()> {
    check_provider(provider)?;
    let mut data = read_secrets(dir);
    if data.remove(provider).is_some() {
        std::fs::write(secrets_file(dir), serde_json::to_string(&data)?)?;
    }
    Ok(())
}

// ---- commands ----

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> AppResult<Value> {
    state.with_db(get_settings)
}

#[tauri::command]
pub async fn settings_set(state: State<'_, AppState>, partial: Value) -> AppResult<Value> {
    state.with_db(|c| set_settings(c, &partial))
}

#[tauri::command]
pub async fn settings_set_api_key(
    state: State<'_, AppState>,
    provider: String,
    key: String,
) -> AppResult<()> {
    store_set(&state.data_dir, &OsCipher, &provider, &key)
}

#[tauri::command]
pub async fn settings_has_api_key(state: State<'_, AppState>, provider: String) -> AppResult<bool> {
    Ok(store_get(&state.data_dir, &OsCipher, &provider)?.is_some())
}

#[tauri::command]
pub async fn settings_clear_api_key(state: State<'_, AppState>, provider: String) -> AppResult<()> {
    store_clear(&state.data_dir, &provider)
}

/// Internal secrets (not API keys, never exposed to the UI), stored in secrets.bin under
/// `secret:<name>` and encrypted like the keys. Used for the ChatGPT plan session.
pub fn secret_set(dir: &Path, c: &dyn SecretCipher, name: &str, plain: &str) -> AppResult<()> {
    let blob = c.encrypt(plain.as_bytes())?;
    let mut data = read_secrets(dir);
    data.insert(format!("secret:{name}"), Value::String(B64.encode(blob)));
    std::fs::create_dir_all(dir)?;
    std::fs::write(secrets_file(dir), serde_json::to_string(&data)?)?;
    Ok(())
}

pub fn secret_get(dir: &Path, c: &dyn SecretCipher, name: &str) -> Option<String> {
    let blob = read_secrets(dir)
        .get(&format!("secret:{name}"))?
        .as_str()?
        .to_string();
    let bytes = B64.decode(blob).ok()?;
    String::from_utf8(c.decrypt(&bytes).ok()?).ok()
}

pub fn secret_clear(dir: &Path, name: &str) -> AppResult<()> {
    let mut data = read_secrets(dir);
    if data.remove(&format!("secret:{name}")).is_some() {
        std::fs::write(secrets_file(dir), serde_json::to_string(&data)?)?;
    }
    Ok(())
}

/// The saved API key for a provider ("anthropic" | "openai" | "gemini"), or None.
/// Used by the AI module.
pub fn api_key(state: &AppState, provider: &str) -> AppResult<Option<String>> {
    store_get(&state.data_dir, &OsCipher, provider)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake;
    impl SecretCipher for Fake {
        fn encrypt(&self, p: &[u8]) -> AppResult<Vec<u8>> {
            Ok(p.iter().rev().cloned().collect())
        }
        fn decrypt(&self, c: &[u8]) -> AppResult<Vec<u8>> {
            Ok(c.iter().rev().cloned().collect())
        }
    }

    fn db() -> rusqlite::Connection {
        crate::db::open_in_memory().unwrap()
    }

    #[test]
    fn defaults_when_empty() {
        let s = get_settings(&db()).unwrap();
        assert_eq!(s["theme"], "system");
        assert_eq!(s["helpPanelWidth"], 420);
        assert_eq!(s["aiModel"], Value::Null);
        assert_eq!(s["sampleImported"], false);
        assert_eq!(s["spoilerShield"], json!({}));
    }

    #[test]
    fn spoiler_shield_is_remembered_per_book() {
        let c = db();
        let s = set_settings(
            &c,
            &json!({"spoilerShield": {"book-1": true, "book-2": false}}),
        )
        .unwrap();
        assert_eq!(s["spoilerShield"]["book-1"], true);
        assert_eq!(get_settings(&c).unwrap()["spoilerShield"]["book-2"], false);
    }

    #[test]
    fn partial_merge_persists() {
        let c = db();
        set_settings(&c, &json!({"theme": "dark"})).unwrap();
        let s = set_settings(&c, &json!({"aiModel": "  gpt-5 ", "helpPanelWidth": 500})).unwrap();
        assert_eq!(s["theme"], "dark");
        assert_eq!(s["aiModel"], "gpt-5");
        assert_eq!(s["helpPanelWidth"], 500);
        assert_eq!(get_settings(&c).unwrap()["theme"], "dark");
    }

    #[test]
    fn rejects_bad_input() {
        let c = db();
        for bad in [
            json!({"nope": 1}),
            json!({"sampleImported": true}),
            json!({"theme": "neon"}),
            json!({"helpPanelWidth": 319}),
            json!({"helpPanelWidth": 4001}),
            json!({"helpPanelWidth": 400.5}),
            json!({"penWidth": 0.02}),
            json!({"penColor": "#000000"}),
            json!({"lookupLanguage": "EN"}),
            json!({"aiModel": "   "}),
            json!({"turnSound": "yes"}),
            json!({"spoilerShield": {"book-1": "on"}}),
            json!({"spoilerShield": {"": true}}),
            json!({"spoilerShield": [true]}),
            json!([1]),
        ] {
            assert!(set_settings(&c, &bad).is_err(), "{bad}");
        }
        // an invalid field stops the whole write
        assert!(set_settings(&c, &json!({"theme": "dark", "layout": "x"})).is_err());
        assert_eq!(get_settings(&c).unwrap()["theme"], "system");
    }

    #[test]
    fn accepts_valid_fields() {
        let c = db();
        let s = set_settings(
            &c,
            &json!({"penWidth": 0.01, "lookupLanguage": "pt-br", "aiModel": null, "lookupSite": "custom"}),
        )
        .unwrap();
        assert_eq!(s["penWidth"], 0.01);
        assert_eq!(s["lookupLanguage"], "pt-br");
    }

    #[test]
    fn api_key_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        assert_eq!(store_get(p, &Fake, "openai").unwrap(), None);
        store_set(p, &Fake, "openai", "  sk-abc ").unwrap();
        assert_eq!(
            store_get(p, &Fake, "openai").unwrap().as_deref(),
            Some("sk-abc")
        );
        assert_eq!(store_get(p, &Fake, "gemini").unwrap(), None);
        let raw = std::fs::read_to_string(p.join("secrets.bin")).unwrap();
        assert!(!raw.contains("sk-abc"));
        store_clear(p, "openai").unwrap();
        assert_eq!(store_get(p, &Fake, "openai").unwrap(), None);
        store_clear(p, "openai").unwrap();
    }

    #[test]
    fn api_key_validation_and_unreadable() {
        let d = tempfile::tempdir().unwrap();
        assert!(store_set(d.path(), &Fake, "bogus", "k").is_err());
        assert!(store_set(d.path(), &Fake, "openai", "   ").is_err());
        std::fs::write(d.path().join("secrets.bin"), "not json").unwrap();
        assert_eq!(store_get(d.path(), &Fake, "openai").unwrap(), None);
        std::fs::write(d.path().join("secrets.bin"), r#"{"openai":"!!!"}"#).unwrap();
        assert_eq!(store_get(d.path(), &Fake, "openai").unwrap(), None);
    }

    #[test]
    fn key_not_in_settings() {
        let c = db();
        let d = tempfile::tempdir().unwrap();
        store_set(d.path(), &Fake, "openai", "sk-secret").unwrap();
        let s = get_settings(&c).unwrap().to_string();
        assert!(!s.contains("sk-secret"));
        assert!(set_settings(&c, &json!({"apiKey": "x"})).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip() {
        let enc = OsCipher.encrypt(b"hello").unwrap();
        assert_ne!(enc, b"hello");
        assert_eq!(OsCipher.decrypt(&enc).unwrap(), b"hello");
    }
}
