//! `window` commands: minimise / maximise / close, the book-shaped window and the state events.
//! Port of `src/main/ipc/window.ts`. Tauri has no aspect-ratio lock, so the aspect is kept in a
//! static and applied on the window's resize event while it is not maximised / fullscreen.
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

/// Pixels of the work area kept free for the window frame (same as PageTurn 1.x).
const FRAME_ALLOWANCE: f64 = 40.0;
/// A resize closer than this to the wanted size is left alone (stops feedback loops).
const TOLERANCE_PX: f64 = 2.0;

/// The remembered aspect (width / height) as f64 bits; 0.0 means no lock.
static ASPECT: AtomicU64 = AtomicU64::new(0);
/// True while we resize the window ourselves, so our own resize event is ignored.
static FITTING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct WindowState {
    pub maximized: bool,
    pub fullscreen: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowControl {
    Minimize,
    ToggleMaximize,
    Close,
}

/// Same check as `WindowControlSchema`.
pub fn parse_control(action: &str) -> AppResult<WindowControl> {
    match action {
        "minimize" => Ok(WindowControl::Minimize),
        "toggleMaximize" => Ok(WindowControl::ToggleMaximize),
        "close" => Ok(WindowControl::Close),
        _ => Err(AppError::Msg("Invalid window action".into())),
    }
}

/// Same check as `WindowAspectSchema`: 0, or a number from 0.3 to 4.
pub fn validate_aspect(aspect: f64) -> AppResult<f64> {
    if aspect == 0.0 || (aspect.is_finite() && (0.3..=4.0).contains(&aspect)) {
        Ok(aspect)
    } else {
        Err(AppError::Msg("Invalid window aspect".into()))
    }
}

/// The size (w, h) a window of this aspect should take: keep the current height, but never
/// exceed the work area minus the frame allowance; shrink the other side to keep the shape.
pub fn fit_size(
    aspect: f64,
    current_h: f64,
    area_w: f64,
    area_h: f64,
    allowance: f64,
) -> (f64, f64) {
    let mut h = current_h.min(area_h - allowance);
    let mut w = (h * aspect).round();
    if w > area_w - allowance {
        w = area_w - allowance;
        h = (w / aspect).round();
    }
    (w, h)
}

fn aspect() -> f64 {
    f64::from_bits(ASPECT.load(Ordering::Relaxed))
}

fn state_of(win: &WebviewWindow) -> WindowState {
    WindowState {
        maximized: win.is_maximized().unwrap_or(false),
        fullscreen: win.is_fullscreen().unwrap_or(false),
    }
}

fn main_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    app.get_webview_window("main")
        .ok_or_else(|| AppError::Msg("Main window not found".into()))
}

/// Resize to the remembered aspect (keeping the height). Does nothing when unlocked,
/// maximised or fullscreen, or when the window already has the right shape.
fn fit(win: &WebviewWindow) {
    let aspect = aspect();
    if aspect == 0.0 || win.is_maximized().unwrap_or(false) || win.is_fullscreen().unwrap_or(false)
    {
        return;
    }
    let (Ok(size), Ok(Some(mon))) = (win.inner_size(), win.current_monitor()) else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);
    let area = mon.work_area().size;
    let (cur_w, cur_h) = (size.width as f64, size.height as f64);
    let (w, h) = fit_size(
        aspect,
        cur_h,
        area.width as f64,
        area.height as f64,
        FRAME_ALLOWANCE * scale,
    );
    if (cur_w - w).abs() <= TOLERANCE_PX && (cur_h - h).abs() <= TOLERANCE_PX {
        return;
    }
    FITTING.store(true, Ordering::SeqCst);
    let _ = win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
    FITTING.store(false, Ordering::SeqCst);
}

/// Subscribe to the main window's changes: emit `window:state` and keep the book's shape.
pub fn setup(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        log::warn!("window::setup: main window not found");
        return;
    };
    let w = win.clone();
    win.on_window_event(move |event| {
        // Maximise, restore and fullscreen all arrive as a resize.
        if let WindowEvent::Resized(_) = event {
            if !FITTING.load(Ordering::SeqCst) {
                fit(&w);
            }
            let _ = w.emit("window:state", state_of(&w));
        }
    });
}

#[tauri::command]
pub async fn window_fit_aspect(app: AppHandle, aspect: f64) -> AppResult<()> {
    let aspect = validate_aspect(aspect)?;
    ASPECT.store(aspect.to_bits(), Ordering::Relaxed);
    fit(&main_window(&app)?);
    Ok(())
}

#[tauri::command]
pub async fn window_control(app: AppHandle, action: String) -> AppResult<()> {
    let action = parse_control(&action)?;
    let win = main_window(&app)?;
    match action {
        WindowControl::Minimize => win.minimize()?,
        WindowControl::Close => win.close()?,
        WindowControl::ToggleMaximize => {
            if win.is_fullscreen()? {
                win.set_fullscreen(false)?;
            } else if win.is_maximized()? {
                win.unmaximize()?;
            } else {
                win.maximize()?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn window_get_state(app: AppHandle) -> AppResult<WindowState> {
    Ok(state_of(&main_window(&app)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_keeps_height_and_shapes_width() {
        assert_eq!(fit_size(0.7, 1000.0, 3000.0, 2000.0, 40.0), (700.0, 1000.0));
    }

    #[test]
    fn fit_is_limited_by_work_area_height() {
        assert_eq!(fit_size(0.5, 2000.0, 3000.0, 1000.0, 40.0), (480.0, 960.0));
    }

    #[test]
    fn fit_is_limited_by_work_area_width() {
        assert_eq!(fit_size(2.0, 900.0, 1000.0, 2000.0, 40.0), (960.0, 480.0));
    }

    #[test]
    fn control_validation() {
        assert_eq!(parse_control("minimize").unwrap(), WindowControl::Minimize);
        assert_eq!(
            parse_control("toggleMaximize").unwrap(),
            WindowControl::ToggleMaximize
        );
        assert_eq!(parse_control("close").unwrap(), WindowControl::Close);
        assert!(parse_control("explode").is_err());
        assert!(parse_control("").is_err());
    }

    #[test]
    fn aspect_validation() {
        assert!(validate_aspect(0.0).is_ok());
        assert!(validate_aspect(0.3).is_ok());
        assert!(validate_aspect(4.0).is_ok());
        assert!(validate_aspect(1.25).is_ok());
        assert!(validate_aspect(0.2).is_err());
        assert!(validate_aspect(4.1).is_err());
        assert!(validate_aspect(-1.0).is_err());
        assert!(validate_aspect(f64::NAN).is_err());
    }

    #[test]
    fn window_state_keys() {
        let v = serde_json::to_value(WindowState {
            maximized: true,
            fullscreen: false,
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({"maximized": true, "fullscreen": false})
        );
    }
}
