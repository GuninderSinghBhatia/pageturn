//! Signed auto-update (tauri-plugin-updater), same behaviour as the Electron build:
//! check at start-up and every 4 hours, download in the background, tell the page
//! (`update:available`, `update:downloaded`), install and restart when the user agrees.
//!
//! Every update is verified against the public key in tauri.conf.json before it is installed;
//! an unsigned or tampered file is refused. The feed is `latest.json` on GitHub Releases.
//! `PAGETURN_UPDATE_URL` replaces the feed (tests, staging). It cannot weaken anything:
//! the signature check still applies.

use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

const CHECK_EVERY: Duration = Duration::from_secs(4 * 3600);
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(10);

/// An update that has been found and (once downloaded) is ready to install.
struct Pending {
    update: Update,
    bytes: Option<Vec<u8>>,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);

/// What a check found. Serialised for the UI in the same shape as the Electron build.
#[derive(Debug, PartialEq)]
pub enum Status {
    Dev,
    Current,
    Available(String),
    Error,
}

impl Status {
    pub fn to_json(&self) -> Value {
        match self {
            Status::Dev => json!({ "status": "dev" }),
            Status::Current => json!({ "status": "current" }),
            Status::Available(v) => json!({ "status": "available", "version": v }),
            Status::Error => json!({ "status": "error" }),
        }
    }
}

fn feed_override() -> Option<String> {
    std::env::var("PAGETURN_UPDATE_URL")
        .ok()
        .filter(|u| !u.is_empty())
}

/// Updates are active in release builds, or in any build when a feed is given explicitly.
pub fn enabled() -> bool {
    !cfg!(debug_assertions) || feed_override().is_some()
}

/// Whether `candidate` is a newer version than `current` (plain dotted numbers, like semver
/// without pre-release tags). Unparseable versions are never "newer".
pub fn is_newer(candidate: &str, current: &str) -> bool {
    fn parts(v: &str) -> Option<Vec<u64>> {
        v.trim_start_matches('v')
            .split('.')
            .map(|p| p.parse::<u64>().ok())
            .collect()
    }
    match (parts(candidate), parts(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

fn build_updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app.updater_builder();
    if let Some(url) = feed_override() {
        let url = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    builder.build().map_err(|e| e.to_string())
}

/// Checks the feed. When a newer, correctly signed version exists it is remembered and its
/// download starts in the background.
pub async fn check(app: &AppHandle) -> Status {
    if !enabled() {
        return Status::Dev;
    }
    let updater = match build_updater(app) {
        Ok(u) => u,
        Err(e) => {
            log::warn!("Update check failed: {e}");
            return Status::Error;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let already = PENDING
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
                .is_some_and(|p| p.update.version == version);
            if !already {
                log::info!("Update {version} is available");
                *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(Pending {
                    update: update.clone(),
                    bytes: None,
                });
                let _ = app.emit("update:available", json!({ "version": version }));
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move { download(&app2, update).await });
            }
            Status::Available(version)
        }
        Ok(None) => Status::Current,
        Err(e) => {
            log::warn!("Update check failed: {e}");
            Status::Error
        }
    }
}

async fn download(app: &AppHandle, update: Update) {
    let version = update.version.clone();
    match update.download(|_chunk, _total| {}, || {}).await {
        Ok(bytes) => {
            if let Some(p) = PENDING.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                if p.update.version == version {
                    p.bytes = Some(bytes);
                }
            }
            log::info!("Update {version} downloaded and verified");
            let _ = app.emit("update:downloaded", json!({ "version": version }));
        }
        Err(e) => {
            // A failed signature check lands here too: the file is dropped, nothing is installed.
            log::warn!("Update {version} was not installed: {e}");
            let mut pending = PENDING.lock().unwrap_or_else(|e| e.into_inner());
            if pending
                .as_ref()
                .is_some_and(|p| p.update.version == version)
            {
                *pending = None;
            }
        }
    }
}

/// Takes the update that is downloaded and verified, if there is one.
fn take_ready() -> Result<(Update, Vec<u8>), String> {
    let mut slot = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    match slot.take() {
        Some(Pending {
            update,
            bytes: Some(bytes),
        }) => Ok((update, bytes)),
        other => {
            *slot = other; // keep a download that is still running
            Err("No update has been downloaded yet".into())
        }
    }
}

/// Installs the downloaded update and restarts into it.
pub fn install(app: &AppHandle) -> Result<(), String> {
    let (update, bytes) = take_ready()?;
    update.install(bytes).map_err(|e| e.to_string())?;
    // On Windows the installer takes over and the app exits; elsewhere restart by hand.
    app.restart()
}

/// Background schedule: first check shortly after start-up, then every 4 hours.
pub fn start(app: AppHandle) {
    if !enabled() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_AFTER).await;
        loop {
            let _ = check(&app).await;
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_versions_compare_numerically() {
        assert!(is_newer("1.0.2", "1.0.1"));
        assert!(is_newer("1.10.0", "1.9.9"));
        assert!(is_newer("v2.0.0", "1.99.99"));
        assert!(!is_newer("1.0.1", "1.0.1"));
        assert!(!is_newer("1.0.0", "1.0.1"));
        assert!(!is_newer("1.0.1-beta", "1.0.0"));
        assert!(!is_newer("garbage", "1.0.0"));
    }

    #[test]
    fn status_json_matches_the_electron_shapes() {
        assert_eq!(Status::Dev.to_json(), json!({"status": "dev"}));
        assert_eq!(Status::Current.to_json(), json!({"status": "current"}));
        assert_eq!(Status::Error.to_json(), json!({"status": "error"}));
        assert_eq!(
            Status::Available("1.2.3".into()).to_json(),
            json!({"status": "available", "version": "1.2.3"})
        );
    }

    #[test]
    fn install_without_a_download_is_refused() {
        *PENDING.lock().unwrap() = None;
        assert_eq!(
            take_ready().err().as_deref(),
            Some("No update has been downloaded yet")
        );
    }
}
