//! Starts Ask with the app. By default Ask runs inside the app (crate::rag). With
//! `PAGETURN_ASK_ENGINE=service` this starts the Python rag-service instead, and stops it
//! with the app.
//!
//! Where it looks for the service: `PAGETURN_RAG_DIR`, else the repo's `rag-service/` folder
//! (found at build time). It needs that folder's `.venv`. Without one (an installed copy on a
//! reader's machine) nothing starts and Ask works as before when a service is already running.
//! On Windows the child goes into a job object that kills it, and the reloader's children,
//! whenever PageTurn exits, so no stale service is left holding port 8000.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::state::AppState;

const PORT: &str = "8000";
/// The embedding model loads before uvicorn answers; a cold start can take a while.
const STARTUP_WAIT: Duration = Duration::from_secs(120);

fn service_dir() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("PAGETURN_RAG_DIR") {
        if !custom.is_empty() {
            return Some(PathBuf::from(custom));
        }
    }
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("rag-service");
    repo.join("main.py").exists().then_some(repo)
}

fn venv_python(dir: &Path) -> PathBuf {
    if cfg!(windows) {
        dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        dir.join(".venv").join("bin").join("python")
    }
}

/// Starts Ask: the in-app engine indexes the library right away; with
/// `PAGETURN_ASK_ENGINE=service`, rag-service is started (unless one already answers on port
/// 8000) and the library is sent to it once it is up. Never blocks app start.
pub fn start(app: &AppHandle, logs_dir: PathBuf) {
    if !crate::rag::use_service() {
        super::rag::index_library(app, &app.state::<AppState>());
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if super::rag::is_up().await {
            log::info!("rag-service already running on port {PORT}; using it");
        } else if let Err(e) = spawn_service(&logs_dir) {
            log::warn!("rag-service not started: {e}");
        } else if !wait_until_up().await {
            log::warn!(
                "rag-service did not answer within {}s; see logs/rag-service.log",
                STARTUP_WAIT.as_secs()
            );
        }
        // Books added while rag-service was off get indexed for Ask now.
        super::rag::index_library(&app, &app.state::<AppState>());
    });
}

async fn wait_until_up() -> bool {
    let deadline = tokio::time::Instant::now() + STARTUP_WAIT;
    while tokio::time::Instant::now() < deadline {
        if super::rag::is_up().await {
            log::info!("rag-service is up");
            return true;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    false
}

fn spawn_service(logs_dir: &Path) -> Result<(), String> {
    let dir = service_dir().ok_or("no rag-service folder found")?;
    let python = venv_python(&dir);
    if !python.exists() {
        return Err(format!("no Python environment at {}", python.display()));
    }
    let _ = std::fs::create_dir_all(logs_dir);
    let log_path = logs_dir.join("rag-service.log");
    let out = std::fs::File::create(&log_path).map_err(|e| format!("log file: {e}"))?;
    let err = out.try_clone().map_err(|e| format!("log file: {e}"))?;

    let mut cmd = Command::new(&python);
    cmd.args(["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", PORT])
        .current_dir(&dir)
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err);
    if cfg!(debug_assertions) {
        // Dev builds pick up Python edits without restarting the app.
        cmd.arg("--reload");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd.spawn().map_err(|e| format!("could not run {}: {e}", python.display()))?;
    log::info!(
        "rag-service starting (pid {}) from {}; log at {}",
        child.id(),
        dir.display(),
        log_path.display()
    );
    #[cfg(windows)]
    if let Err(e) = kill_with_app(&child) {
        log::warn!("rag-service will not stop with the app: {e}");
    }
    // The job object (Windows) owns its lifetime from here.
    std::mem::forget(child);
    Ok(())
}

/// Puts the child in a job object that kills everything in it when PageTurn's handle to the
/// job closes, which happens however the app exits.
#[cfg(windows)]
fn kill_with_app(child: &std::process::Child) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    unsafe {
        let job = CreateJobObjectW(None, None).map_err(|e| e.to_string())?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|e| e.to_string())?;
        AssignProcessToJobObject(job, HANDLE(child.as_raw_handle() as _))
            .map_err(|e| e.to_string())?;
        // The job handle stays open for the app's lifetime on purpose: closing it kills the service.
    }
    Ok(())
}
