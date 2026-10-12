//! A real browser window inside the cockpit: for pages that do not let themselves be shown in a
//! card (most big sites forbid framing), Google Maps with a route, a cloud console. Its own
//! window, public web addresses only, no access to the cockpit (no IPC for remote pages).
//! A snapshot of it can go onto the board as a picture.
//!
//! On the board, a page is a real browser view docked into the cockpit window (a child webview
//! — so pages that refuse to be framed still show): large over the whole board, or pinned on a
//! card where it moves and resizes with it; the board places it, shows and hides it.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

static NEXT: AtomicU32 = AtomicU32::new(1);
/// The browser windows opened, newest last.
static OPEN: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

pub fn open(app: &AppHandle, url: &str, title: Option<String>) -> AppResult<String> {
    let url = crate::web::check_url(url).map_err(AppError::invalid)?;
    let parsed: tauri::Url = url.parse().map_err(|e| AppError::invalid(format!("not a web address: {e}")))?;
    let label = format!("browser-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let shown = title.unwrap_or_else(|| parsed.host_str().unwrap_or("Browser").to_string());
    WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .title(format!("{shown} — Robs AI Cockpit"))
        .inner_size(1280.0, 860.0)
        .min_inner_size(480.0, 360.0)
        .additional_browser_args(crate::hud::BROWSER_ARGS)
        .build()
        .map_err(|e| AppError::other(format!("could not open the browser window: {e}")))?;
    OPEN.lock().unwrap().push((label.clone(), shown));
    Ok(label)
}

/// A browser view docked on the board: created on first use, then only moved, resized, shown or hidden.
pub fn dock(app: &AppHandle, label: &str, url: Option<&str>, x: f64, y: f64, w: f64, h: f64, visible: bool) -> AppResult<()> {
    if !label.starts_with("dock-") {
        return Err(AppError::invalid("docked views are called dock-…"));
    }
    let (w, h) = (w.max(40.0), h.max(40.0));
    if let Some(v) = app.get_webview(label) {
        if let Some(u) = url {
            let u = crate::web::check_url(u).map_err(AppError::invalid)?;
            if v.url().map(|cur| cur.as_str() != u).unwrap_or(true) {
                v.navigate(u.parse().map_err(|e| AppError::invalid(format!("not a web address: {e}")))?).map_err(|e| AppError::other(e.to_string()))?;
            }
        }
        v.set_position(LogicalPosition::new(x, y)).map_err(|e| AppError::other(e.to_string()))?;
        v.set_size(LogicalSize::new(w, h)).map_err(|e| AppError::other(e.to_string()))?;
        if visible { v.show() } else { v.hide() }.map_err(|e| AppError::other(e.to_string()))?;
        return Ok(());
    }
    if !visible {
        return Ok(());
    }
    let url = crate::web::check_url(url.ok_or_else(|| AppError::invalid("no address"))?).map_err(AppError::invalid)?;
    let parsed: tauri::Url = url.parse().map_err(|e| AppError::invalid(format!("not a web address: {e}")))?;
    let window = app.get_window("main").ok_or_else(|| AppError::other("no main window"))?;
    window
        // the same start options as the main view: WebView2 shares one environment per window
        .add_child(
            WebviewBuilder::new(label, WebviewUrl::External(parsed.clone()))
                .additional_browser_args(crate::hud::BROWSER_ARGS)
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                // on, because wry ties WebView2's pinch to it: without, a touchpad pinch never reaches the
                // page. The page cancels it and hands it to the board instead (browser_ctl::GESTURE_SCRIPT),
                // so a pinch over the page zooms the board, never the page
                .zoom_hotkeys_enabled(true)
                .initialization_script(crate::browser_ctl::GESTURE_SCRIPT),
            LogicalPosition::new(x, y),
            LogicalSize::new(w, h),
        )
        .map_err(|e| AppError::other(format!("could not open the page on the board: {e}")))?;
    crate::browser_ctl::forward_gestures(app, label);
    OPEN.lock().unwrap().push((label.to_string(), parsed.host_str().unwrap_or("Browser").to_string()));
    Ok(())
}

/// Close a docked view (its card left the board, or the user closed it).
pub fn undock(app: &AppHandle, label: &str) -> AppResult<()> {
    if let Some(v) = app.get_webview(label) {
        v.close().map_err(|e| AppError::other(e.to_string()))?;
    }
    Ok(())
}

/// Where a docked view stands, what it shows: (url, title of the page).
pub fn docked_page(app: &AppHandle, label: &str) -> Option<String> {
    app.get_webview(label).and_then(|v| v.url().ok()).map(|u| u.to_string())
}

/// The label of the newest browser window still open.
pub fn newest_label(app: &AppHandle) -> Option<String> {
    newest(app).map(|(l, _)| l)
}

/// The newest browser window still open: (label, title).
fn newest(app: &AppHandle) -> Option<(String, String)> {
    let mut open = OPEN.lock().unwrap();
    open.retain(|(l, _)| app.get_webview(l).is_some());
    open.last().cloned()
}

/// A picture of a browser window (the newest one when no label is given) as a PNG data URL,
/// at most `max_w` pixels wide. Returns (data URL, title of the page).
pub fn snapshot(app: &AppHandle, label: Option<String>, max_w: u32) -> AppResult<(String, String)> {
    let (label, title) = match label {
        Some(l) => (l.clone(), l),
        None => newest(app).ok_or_else(|| AppError::invalid("no browser window is open"))?,
    };
    let v = app.get_webview(&label).ok_or_else(|| AppError::invalid("that browser view is closed"))?;
    let w = v.window();
    let docked = label.starts_with("dock-");
    let title = if docked { title } else { w.title().map(|t| t.trim_end_matches(" — Robs AI Cockpit").to_string()).unwrap_or(title) };
    #[cfg(windows)]
    {
        let hwnd = w.hwnd().map_err(|e| AppError::other(e.to_string()))?;
        let (rgba, width, height) = capture(hwnd.0 as _).map_err(AppError::other)?;
        // a docked view: only its part of the cockpit window
        let (rgba, width, height) = if docked {
            let p = v.position().map_err(|e| AppError::other(e.to_string()))?;
            let s = v.size().map_err(|e| AppError::other(e.to_string()))?;
            crop(rgba, width, height, p.x.max(0) as u32, p.y.max(0) as u32, s.width, s.height)
        } else {
            (rgba, width, height)
        };
        let (rgba, width, height) = shrink(rgba, width, height, max_w);
        let mut png = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut png, width, height);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut wr = enc.write_header().map_err(|e| AppError::other(e.to_string()))?;
            wr.write_image_data(&rgba).map_err(|e| AppError::other(e.to_string()))?;
        }
        use base64::Engine;
        Ok((format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)), title))
    }
    #[cfg(not(windows))]
    {
        let _ = (w, max_w);
        Err(AppError::invalid("window pictures are only available on Windows"))
    }
}

/// A rectangle of a picture (clamped to it).
fn crop(px: Vec<u8>, w: u32, h: u32, x: u32, y: u32, cw: u32, ch: u32) -> (Vec<u8>, u32, u32) {
    let (x, y) = (x.min(w.saturating_sub(1)), y.min(h.saturating_sub(1)));
    let (cw, ch) = (cw.min(w - x).max(1), ch.min(h - y).max(1));
    let mut out = Vec::with_capacity((cw * ch * 4) as usize);
    for row in y..y + ch {
        let start = ((row * w + x) * 4) as usize;
        out.extend_from_slice(&px[start..start + (cw * 4) as usize]);
    }
    (out, cw, ch)
}

/// Halve the picture until it fits `max_w` (box filter: every 2×2 pixels become one).
fn shrink(mut px: Vec<u8>, mut w: u32, mut h: u32, max_w: u32) -> (Vec<u8>, u32, u32) {
    while w > max_w && w >= 2 && h >= 2 {
        let (nw, nh) = (w / 2, h / 2);
        let mut out = vec![0u8; (nw * nh * 4) as usize];
        for y in 0..nh {
            for x in 0..nw {
                for c in 0..4 {
                    let at = |xx: u32, yy: u32| px[((yy * w + xx) * 4 + c) as usize] as u32;
                    let v = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
                    out[((y * nw + x) * 4 + c) as usize] = v as u8;
                }
            }
        }
        px = out;
        w = nw;
        h = nh;
    }
    (px, w, h)
}

/// The window's client area as RGBA (PrintWindow with full content: also GPU-drawn web pages).
#[cfg(windows)]
fn capture(hwnd: windows_sys::Win32::Foundation::HWND) -> Result<(Vec<u8>, u32, u32), String> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::Storage::Xps::PrintWindow;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, PW_RENDERFULLCONTENT};
    unsafe {
        let mut r: RECT = std::mem::zeroed();
        if GetClientRect(hwnd, &mut r) == 0 {
            return Err("window size unknown".into());
        }
        let (w, h) = ((r.right - r.left).max(1), (r.bottom - r.top).max(1));
        let screen = GetDC(hwnd);
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp as _);
        // PW_CLIENTONLY (1) | PW_RENDERFULLCONTENT (2)
        let ok = PrintWindow(hwnd, mem, 1 | PW_RENDERFULLCONTENT);
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = w;
        info.bmiHeader.biHeight = -h; // top-down
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut px = vec![0u8; (w * h * 4) as usize];
        let lines = GetDIBits(mem, bmp, 0, h as u32, px.as_mut_ptr() as _, &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        DeleteObject(bmp as _);
        DeleteDC(mem);
        ReleaseDC(hwnd, screen);
        if ok == 0 || lines == 0 {
            return Err("the window could not be captured".into());
        }
        // BGRA → RGBA, opaque
        for p in px.chunks_exact_mut(4) {
            p.swap(0, 2);
            p[3] = 255;
        }
        Ok((px, w as u32, h as u32))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn crops_a_rectangle() {
        let px: Vec<u8> = (0..4 * 3 * 4).map(|i| i as u8).collect();
        let (out, w, h) = super::crop(px, 4, 3, 1, 1, 2, 5);
        assert_eq!((w, h), (2, 2));
        assert_eq!(&out[0..4], &[20, 21, 22, 23]);
    }

    #[test]
    fn halves_until_it_fits() {
        let px = vec![200u8; 8 * 4 * 4];
        let (out, w, h) = super::shrink(px, 8, 4, 3);
        assert_eq!((w, h, out.len()), (2, 1, 8));
        assert!(out.iter().all(|&v| v == 200));
    }
}
