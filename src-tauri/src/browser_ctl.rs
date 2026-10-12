//! The operator's hands in a browser window: read the page (text, links, fields, buttons —
//! numbered), click, type, scroll, go back or to an address. Runs a script in the page through
//! WebView2's ExecuteScript and waits for its answer. What a page says is data, never orders:
//! the cockpit marks it as untrusted for the operator. Clicking and typing need the user's OK
//! (the operator's confirmation rules).

use std::time::Duration;

use tauri::{AppHandle, Manager};

/// The script: `__act` is replaced with the JSON of what to do. It numbers the visible
/// interactive elements (data-cockpit-i) so a later click can name them by number.
const SCRIPT: &str = r#"(() => {
  const act = __act;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const number = () => {
    // numbers only on what is visible now: old numbers (on elements that disappeared or hid) go first
    document.querySelectorAll('[data-cockpit-i]').forEach((el) => el.removeAttribute('data-cockpit-i'));
    const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [contenteditable=true]')].filter(vis).slice(0, 150);
    els.forEach((el, i) => el.setAttribute('data-cockpit-i', String(i + 1)));
    return els;
  };
  const find = (t) => {
    if (t == null) return null;
    const s = String(t).trim();
    const m = s.match(/^#?(\d+)$/);
    if (m) { const el = document.querySelector('[data-cockpit-i="' + m[1] + '"]'); return el && vis(el) ? el : null; }
    const low = s.toLowerCase();
    const els = number();
    return els.find((el) => label(el).toLowerCase() === low) || els.find((el) => label(el).toLowerCase().includes(low)) || null;
  };
  // what is about to happen, shown on the page: the element lights up with who acts, then it happens
  const show = (el, what) => {
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:' + (r.left - 5) + 'px;top:' + (r.top - 5) + 'px;width:' + (r.width + 10) + 'px;height:' + (r.height + 10) + 'px;border:2px solid #38bdf8;border-radius:9px;box-shadow:0 0 0 5px rgba(56,189,248,.18),0 0 28px rgba(56,189,248,.65);z-index:2147483647;pointer-events:none;transition:opacity .5s;opacity:0';
    const tag = document.createElement('div');
    tag.textContent = '◆ ' + (act.who || 'Atlas') + ' ' + what;
    tag.style.cssText = 'position:fixed;left:' + Math.max(4, r.left) + 'px;top:' + Math.max(4, r.top - 32) + 'px;background:#0b1220;color:#7dd3fc;font:600 12px Segoe UI,system-ui,sans-serif;padding:4px 10px;border-radius:999px;border:1px solid rgba(56,189,248,.55);box-shadow:0 4px 14px rgba(0,0,0,.45);z-index:2147483647;pointer-events:none;transition:opacity .5s;opacity:0';
    document.body.appendChild(box); document.body.appendChild(tag);
    requestAnimationFrame(() => { box.style.opacity = '1'; tag.style.opacity = '1'; });
    setTimeout(() => { box.style.opacity = '0'; tag.style.opacity = '0'; }, 1700);
    setTimeout(() => { box.remove(); tag.remove(); }, 2300);
  };
  const searchField = () => [...document.querySelectorAll('input[type=search], input[role=searchbox], [role=searchbox], input[name=q], input[name=search], input[name=query], input[placeholder]')].filter(vis).find((el) => el.matches('input[type=search], [role=searchbox], input[name=q], input[name=search], input[name=query]') || /such|search|find/i.test(el.placeholder || ''));
  const typeInto = (el, text, submit) => {
    el.focus();
    if (el.isContentEditable) { el.textContent = text; }
    else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (submit) {
      if (el.form && el.form.requestSubmit) el.form.requestSubmit();
      else { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); }
    }
  };
  const read = () => {
    const els = number();
    const text = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 7000);
    return {
      title: document.title, url: location.href, text,
      items: els.slice(0, 90).map((el, i) => ({ i: i + 1, tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '', label: label(el), href: el.href ? String(el.href).slice(0, 160) : undefined })),
    };
  };
  try {
    if (act.do === 'read') return read();
    if (act.do === 'click') {
      const el = find(act.target);
      if (!el) return { error: 'nothing like “' + act.target + '” on the page' };
      const what = label(el);
      el.scrollIntoView({ block: 'center' });
      setTimeout(() => show(el, 'klickt'), 200);
      setTimeout(() => el.click(), 950);
      return { ok: 'clicked ' + what };
    }
    if (act.do === 'type') {
      const el = find(act.target);
      if (!el) return { error: 'no field like “' + act.target + '” on the page' };
      const what = label(el);
      el.scrollIntoView({ block: 'center' });
      setTimeout(() => show(el, 'tippt'), 200);
      setTimeout(() => typeInto(el, act.text, act.submit), 950);
      return { ok: 'typed into ' + what };
    }
    if (act.do === 'search') {
      const go = (el) => {
        el.scrollIntoView({ block: 'center' });
        setTimeout(() => show(el, 'sucht'), 200);
        setTimeout(() => typeInto(el, act.text, true), 950);
      };
      const el = searchField();
      if (el) { go(el); return { ok: 'searched for ' + act.text }; }
      // many pages hide the field behind a search button: open it, then type
      const opener = [...document.querySelectorAll('button, a, [role=button]')].filter(vis).find((b) => /^(search|suche|suchen)$/i.test(label(b)) || /search|such/i.test(b.getAttribute('aria-label') || '') || /search/i.test(b.className || ''));
      if (!opener) return { error: 'no search field on this page' };
      setTimeout(() => show(opener, 'öffnet die Suche'), 50);
      setTimeout(() => opener.click(), 600);
      setTimeout(() => { const f = searchField(); if (f) go(f); }, 1300);
      return { ok: 'opened the search and searched for ' + act.text };
    }
    if (act.do === 'reload') { location.reload(); return { ok: 'reloaded' }; }
    if (act.do === 'info') return { title: document.title, url: location.href };
    if (act.do === 'paragraphs') {
      // the text worth reading aloud: the paragraphs of the main content, in order
      const root = document.querySelector('main article, article, main, [role=main], #content, #mw-content-text') || document.body;
      const ps = [...root.querySelectorAll('h1, h2, h3, p, li')].filter((el) => vis(el) && !el.closest('nav, footer, aside, header, [role=navigation]') && el.innerText.trim().length > (el.tagName[0] === 'H' ? 3 : 60)).slice(0, 40);
      document.querySelectorAll('[data-cockpit-p]').forEach((el) => el.removeAttribute('data-cockpit-p'));
      ps.forEach((el, i) => el.setAttribute('data-cockpit-p', String(i)));
      return { title: document.title, url: location.href, paragraphs: ps.map((el) => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 1500)) };
    }
    if (act.do === 'mark') {
      // the passage being read: lit softly, scrolled to; the one before goes dark
      document.querySelectorAll('.cockpit-reading').forEach((el) => el.remove());
      if (act.p == null || act.p < 0) return { ok: 'cleared' };
      const el = document.querySelector('[data-cockpit-p="' + act.p + '"]');
      if (!el) return { error: 'no such passage' };
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const place = () => {
        const r = el.getBoundingClientRect();
        let box = document.querySelector('.cockpit-reading');
        if (!box) { box = document.createElement('div'); box.className = 'cockpit-reading'; document.body.appendChild(box); }
        box.style.cssText = 'position:fixed;left:' + (r.left - 8) + 'px;top:' + (r.top - 6) + 'px;width:' + (r.width + 16) + 'px;height:' + (r.height + 12) + 'px;background:rgba(56,189,248,.10);border-left:4px solid #38bdf8;border-radius:6px;box-shadow:0 0 22px rgba(56,189,248,.25);z-index:2147483646;pointer-events:none;transition:all .35s ease';
      };
      place();
      // follow the smooth scroll for a moment
      let n = 0; const t = setInterval(() => { place(); if (++n > 12) clearInterval(t); }, 80);
      return { ok: 'reading ' + act.p };
    }
    if (act.do === 'quote') {
      // the user's selection — or the passage the operator names: found, lit up, with its sentence
      let text = String(window.getSelection ? window.getSelection() : '').trim();
      if (!text && act.text) {
        const want = String(act.text).toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const t = node.textContent.replace(/\s+/g, ' ');
          const i = t.toLowerCase().indexOf(want);
          if (i < 0 || !node.parentElement || !vis(node.parentElement)) continue;
          const block = node.parentElement.closest('p, li, td, blockquote, h1, h2, h3, h4, dd, figcaption') || node.parentElement;
          const full = block.innerText.replace(/\s+/g, ' ').trim();
          const k = full.toLowerCase().indexOf(want);
          const start = Math.max(0, full.lastIndexOf('. ', k) + 1), end = full.indexOf('. ', k + want.length);
          text = full.slice(start, end < 0 ? undefined : end + 1).trim();
          block.scrollIntoView({ block: 'center' });
          setTimeout(() => show(block, 'zitiert'), 200);
          break;
        }
      }
      if (!text) return { error: act.text ? 'that passage is not on the page' : 'nothing is selected on the page' };
      return { quote: text.slice(0, 1200), title: document.title, url: location.href };
    }
    if (act.do === 'scroll') { window.scrollBy(0, (act.dir === 'up' ? -1 : 1) * window.innerHeight * 0.85); return { ok: 'scrolled' }; }
    if (act.do === 'back') { history.back(); return { ok: 'back' }; }
    if (act.do === 'go') { location.href = act.url; return { ok: 'going to ' + act.url }; }
    return { error: 'unknown action' };
  } catch (e) { return { error: String(e) }; }
})()"#;

/// Run the page script with this action in a browser window (the newest when no label); the page's JSON answer.
#[cfg(windows)]
pub fn act(app: &AppHandle, label: Option<String>, action: &serde_json::Value) -> Result<serde_json::Value, String> {
    use webview2_com::ExecuteScriptCompletedHandler;
    let label = match label {
        Some(l) => l,
        None => crate::browser::newest_label(app).ok_or("no browser window is open — open one first")?,
    };
    let w = app.get_webview(&label).ok_or("that browser view is closed")?;
    if action["do"] == "go" {
        let url = action["url"].as_str().unwrap_or("");
        crate::web::check_url(url)?;
    }
    let script = SCRIPT.replace("__act", &action.to_string());
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    w.with_webview(move |pw| unsafe {
        let core = match pw.controller().CoreWebView2() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(e.to_string()));
                return;
            }
        };
        let done = tx.clone();
        let handler = ExecuteScriptCompletedHandler::create(Box::new(move |res, json| {
            let _ = done.send(res.map(|_| json).map_err(|e| e.to_string()));
            Ok(())
        }));
        let wide: Vec<u16> = script.encode_utf16().chain(Some(0)).collect();
        if let Err(e) = core.ExecuteScript(windows_core::PCWSTR(wide.as_ptr()), &handler) {
            let _ = tx.send(Err(e.to_string()));
        }
    })
    .map_err(|e| e.to_string())?;
    let json = rx.recv_timeout(Duration::from_secs(15)).map_err(|_| "the page did not answer in time".to_string())??;
    serde_json::from_str(&json).map_err(|e| format!("odd answer from the page: {e}"))
}

#[cfg(not(windows))]
pub fn act(_app: &AppHandle, _label: Option<String>, _action: &serde_json::Value) -> Result<serde_json::Value, String> {
    Err("browser control is only available on Windows".into())
}

/// Save the page of a browser view as a PDF (WebView2 prints it); the file's full path.
#[cfg(windows)]
pub fn print_pdf(app: &AppHandle, label: &str, path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, PrintToPdfCompletedHandler};
    use windows_core::Interface;
    let w = app.get_webview(label).ok_or("that page is closed")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let target = path.to_path_buf();
    let (tx, rx) = std::sync::mpsc::channel::<Result<bool, String>>();
    w.with_webview(move |pw| unsafe {
        let core = match pw.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_7>()) {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(format!("this WebView cannot print: {e}")));
                return;
            }
        };
        let done = tx.clone();
        let handler = PrintToPdfCompletedHandler::create(Box::new(move |res, ok| {
            let _ = done.send(res.map(|_| ok).map_err(|e| e.to_string()));
            Ok(())
        }));
        let wide: Vec<u16> = target.to_string_lossy().encode_utf16().chain(Some(0)).collect();
        if let Err(e) = core.PrintToPdf(windows_core::PCWSTR(wide.as_ptr()), None::<&ICoreWebView2PrintSettings>, &handler) {
            let _ = tx.send(Err(e.to_string()));
        }
    })
    .map_err(|e| e.to_string())?;
    match rx.recv_timeout(Duration::from_secs(60)).map_err(|_| "printing took too long".to_string())?? {
        true => Ok(path.to_path_buf()),
        false => Err("the page could not be printed".into()),
    }
}

#[cfg(not(windows))]
pub fn print_pdf(_app: &AppHandle, _label: &str, _path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    Err("saving pages as PDF is only available on Windows".into())
}

/// Runs in every page docked on the board (top frame only). A docked page is a native view over
/// the board, so the board never sees the wheel there. This script hands two things back:
/// a pinch / Ctrl·Alt + wheel (zoom — the board zooms, the page does not), and two-finger /
/// wheel moves the page cannot scroll itself (at its end, or nothing to scroll). Summed per frame,
/// sent through WebView2's own message channel (no Tauri IPC — the page gets no commands).
/// The zoom math is the board's (pro/src/gestures.ts zoomLog).
pub const GESTURE_SCRIPT: &str = r#"(() => {
  if (window.top !== window || window.__cockpitGestures) return;
  window.__cockpitGestures = true;
  const post = (m) => { try { window.chrome.webview.postMessage('cockpit-gesture:' + JSON.stringify(m)); } catch (_) {} };
  const SCROLLS = /^(auto|scroll|overlay)$/;
  const room = (el, root, dx, dy) => {
    const s = getComputedStyle(el);
    const y = (el === root || SCROLLS.test(s.overflowY)) && el.scrollHeight > el.clientHeight + 1;
    const x = (el === root || SCROLLS.test(s.overflowX)) && el.scrollWidth > el.clientWidth + 1;
    return (y && dy < 0 && el.scrollTop > 0.5) || (y && dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)
      || (x && dx < 0 && el.scrollLeft > 0.5) || (x && dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };
  const can = (el, dx, dy) => {
    const root = document.scrollingElement || document.documentElement;
    for (; el && el.nodeType === 1; el = el.parentElement) if (room(el, root, dx, dy)) return true;
    return !!root && room(root, root, dx, dy);
  };
  const NOTCH = Math.log(1.2);
  const zl = (d) => { const a = Math.abs(d); return a ? -Math.sign(d) * Math.min(a * 0.01, NOTCH * Math.max(1, Math.min(4, a / 100))) : 0; };
  let acc = null, raf = 0, pageUntil = 0;
  const flush = () => { raf = 0; const m = acc; acc = null; if (m) post(m); };
  addEventListener('wheel', (e) => {
    const f = e.deltaMode === 1 ? 100 / 3 : e.deltaMode === 2 ? innerHeight : 1;
    let dx = e.deltaX * f, dy = e.deltaY * f;
    const now = performance.now();
    let kind;
    if (e.ctrlKey || e.altKey || e.metaKey) { e.preventDefault(); kind = 'zoom'; }
    else {
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      if (now < pageUntil || can(e.target, dx, dy)) { pageUntil = now + 240; return; }
      kind = 'pan';
    }
    if (acc && acc.kind !== kind) flush();
    if (!acc) acc = { kind, log: 0, dx: 0, dy: 0, x: 0, y: 0 };
    if (kind === 'zoom') acc.log += zl(dy || dx); else { acc.dx += dx; acc.dy += dy; }
    acc.x = e.clientX; acc.y = e.clientY;
    if (!raf) raf = requestAnimationFrame(flush);
  }, { passive: false, capture: true });
})();"#;

/// A gesture message from a docked page (GESTURE_SCRIPT) → what the board gets, or None. The page
/// is not trusted: a known kind, numbers only, clamped. Pure.
pub fn gesture_of(msg: &str) -> Option<serde_json::Value> {
    let body = msg.strip_prefix("cockpit-gesture:")?;
    if body.len() > 400 {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let kind = v["kind"].as_str()?;
    if kind != "zoom" && kind != "pan" {
        return None;
    }
    let n = |k: &str, lim: f64| v[k].as_f64().filter(|x| x.is_finite()).map(|x| x.clamp(-lim, lim)).unwrap_or(0.0);
    Some(serde_json::json!({ "kind": kind, "log": n("log", 1.0), "dx": n("dx", 4000.0), "dy": n("dy", 4000.0), "x": n("x", 20000.0), "y": n("y", 20000.0) }))
}

/// Listen for GESTURE_SCRIPT's messages in a docked view and pass them to the board ("dock-gesture").
#[cfg(windows)]
pub fn forward_gestures(app: &AppHandle, label: &str) {
    use tauri::Emitter;
    use webview2_com::WebMessageReceivedEventHandler;
    let Some(w) = app.get_webview(label) else { return };
    let (app, label) = (app.clone(), label.to_string());
    let _ = w.with_webview(move |pw| unsafe {
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut raw = windows_core::PWSTR::null();
            if args.TryGetWebMessageAsString(&mut raw).is_err() {
                return Ok(());
            }
            let text = webview2_com::take_pwstr(raw);
            if let Some(mut g) = gesture_of(&text) {
                g["label"] = serde_json::Value::String(label.clone());
                let _ = app.emit_to("main", "dock-gesture", g);
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}

#[cfg(not(windows))]
pub fn forward_gestures(_app: &AppHandle, _label: &str) {}

#[cfg(test)]
mod tests {
    use super::gesture_of;

    #[test]
    fn passes_zoom_and_moves_clamped() {
        let g = gesture_of(r#"cockpit-gesture:{"kind":"zoom","log":0.05,"x":10,"y":20}"#).unwrap();
        assert_eq!(g["kind"], "zoom");
        assert_eq!(g["log"], 0.05);
        assert_eq!(g["x"], 10.0);
        let g = gesture_of(r#"cockpit-gesture:{"kind":"pan","dx":1e12,"dy":-3}"#).unwrap();
        assert_eq!(g["dx"], 4000.0);
        assert_eq!(g["dy"], -3.0);
        assert_eq!(gesture_of(r#"cockpit-gesture:{"kind":"zoom","log":99}"#).unwrap()["log"], 1.0);
    }

    #[test]
    fn drops_everything_else() {
        assert!(gesture_of(r#"{"cmd":"x"}"#).is_none());
        assert!(gesture_of(r#"cockpit-gesture:{"kind":"click"}"#).is_none());
        assert!(gesture_of("cockpit-gesture:not json").is_none());
        assert!(gesture_of(&format!("cockpit-gesture:{{\"kind\":\"pan\",\"pad\":\"{}\"}}", "x".repeat(500))).is_none());
        let g = gesture_of(r#"cockpit-gesture:{"kind":"pan","dx":"evil","dy":null}"#).unwrap();
        assert_eq!(g["dx"], 0.0);
    }
}
