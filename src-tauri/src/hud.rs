//! Heads-up window: notifications ("Claude A is done — waiting for you") and the dictation
//! indicator, bottom-right above the taskbar, always on top — also while another program is
//! in front. It is shown without taking focus, so typing elsewhere is never interrupted.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

pub const LABEL: &str = "hud";
const WIDTH: f64 = 400.0;
const MARGIN: f64 = 12.0;

/// WebView2 arguments for every window. Chromium throttles hidden, minimized and occluded
/// views (after ~5 min timers wake at most once a minute), which delayed "agent is done"
/// pop-ups by minutes while the cockpit sat in the background. All webviews of one app share
/// one WebView2 environment, so the main window (tauri.conf.json) must use the exact same
/// string. It replaces wry's default, hence the msWebOOUI/msPdfOOUI/msSmartScreenProtection part.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,IntensiveWakeUpThrottling,CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

pub fn create(app: &AppHandle) -> AppResult<()> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#hud".into()))
        .title("Robs AI Cockpit notifications")
        .inner_size(WIDTH, 120.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(false)
        .additional_browser_args(BROWSER_ARGS)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .build()
        .map_err(|e| AppError::other(format!("could not create the notification window: {e}")))?;
    Ok(())
}

/// Resize to the content and pin to the bottom-right of the work area; height 0 hides it.
pub fn layout(app: &AppHandle, height: f64) -> AppResult<()> {
    let w = app.get_webview_window(LABEL).ok_or_else(|| AppError::other("notification window missing"))?;
    if height <= 0.0 {
        w.hide().map_err(|e| AppError::other(e.to_string()))?;
        return Ok(());
    }
    let monitor = w
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| app.get_webview_window("main").and_then(|m| m.current_monitor().ok().flatten()))
        .ok_or_else(|| AppError::other("no monitor"))?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let pw = (WIDTH * scale).round() as i32;
    let ph = (height.min(900.0) * scale).round() as i32;
    let x = area.position.x + area.size.width as i32 - pw - (MARGIN * scale) as i32;
    let y = area.position.y + area.size.height as i32 - ph - (MARGIN * scale) as i32;
    show_no_activate(&w, x, y, pw, ph)
}

#[cfg(windows)]
fn show_no_activate(w: &tauri::WebviewWindow, x: i32, y: i32, width: i32, height: i32) -> AppResult<()> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE};
    let hwnd = w.hwnd().map_err(|e| AppError::other(e.to_string()))?.0 as _;
    unsafe {
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    Ok(())
}

#[cfg(not(windows))]
fn show_no_activate(w: &tauri::WebviewWindow, x: i32, y: i32, width: i32, height: i32) -> AppResult<()> {
    let _ = w.set_size(tauri::PhysicalSize::new(width as u32, height as u32));
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    w.show().map_err(|e| AppError::other(e.to_string()))
}

/// Bring the main window to the front (from a notification click).
pub fn focus_main(app: &AppHandle) -> AppResult<()> {
    let m = app.get_webview_window("main").ok_or_else(|| AppError::other("main window missing"))?;
    let _ = m.unminimize();
    let _ = m.show();
    m.set_focus().map_err(|e| AppError::other(e.to_string()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn main_window_uses_the_same_browser_args() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = &conf["app"]["windows"][0];
        assert_eq!(main["additionalBrowserArgs"].as_str(), Some(super::BROWSER_ARGS));
        assert_eq!(main["backgroundThrottling"].as_str(), Some("disabled"));
    }
}
