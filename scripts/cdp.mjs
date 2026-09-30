// Local test WebView integration checks. Use only an isolated test data directory.
import fs from "node:fs/promises";

export async function connect(port = 9230) {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
  // The main window, not the heads-up notification window (#hud) of the same app.
  const tab = tabs.find(t => t.type === "page" && !t.url.includes("#hud") && (t.url.includes("tauri.localhost") || t.url.includes("localhost:1420")));
  if (!tab) throw new Error("Cockpit test WebView not found");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = ({data}) => {
    const m = JSON.parse(data), p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id); clearTimeout(p.timer);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, {resolve, reject, timer});
    ws.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const r = await call("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true});
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const invoke = (command, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)}).catch(e=>{throw new Error(typeof e==='string'?e:JSON.stringify(e))})`);
  const click = async (text) => {
    const pos = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)} && e.getBoundingClientRect().width > 0);
      if (!b) throw new Error('Button not found');
      const r=b.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2;
      if (!b.contains(document.elementFromPoint(x,y))) throw new Error('Button is covered');
      return {x,y};
    })()`);
    await call("Input.dispatchMouseEvent", {type:"mousePressed", button:"left", clickCount:1, ...pos});
    await call("Input.dispatchMouseEvent", {type:"mouseReleased", button:"left", clickCount:1, ...pos});
  };
  return {call, evaluate, invoke, click, close: () => ws.close(), screenshot: async path => {
    const r=await call("Page.captureScreenshot",{format:"png"});
    await fs.writeFile(path, Buffer.from(r.data,"base64"));
  }};
}
