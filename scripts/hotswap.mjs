// Frontend hot swap for the local test instance: serves the freshly built ./dist to the running test
// WebView instead of the assets compiled into the exe, so a UI-only change needs `vite build`, not a
// Rust rebuild. Keeps running (the interception lives as long as this CDP session); stop with Ctrl+C.
//   pnpm exec vite build && node scripts/hotswap.mjs [port]
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 9230);
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ico": "image/x-icon" };

const tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
const tab = tabs.find(t => t.type === "page" && !t.url.includes("#hud") && t.url.includes("tauri.localhost"));
if (!tab) throw new Error("Cockpit test WebView not found");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++seq, method, params }));

ws.onmessage = async ({ data }) => {
  const m = JSON.parse(data);
  if (m.method !== "Fetch.requestPaused") return;
  const { requestId, request } = m.params;
  const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(dist, rel);
  try {
    if (!file.startsWith(dist)) throw new Error("outside dist");
    const body = await fs.readFile(file);
    const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    send("Fetch.fulfillRequest", { requestId, responseCode: 200, body: body.toString("base64"),
      responseHeaders: [{ name: "Content-Type", value: type }, { name: "Cache-Control", value: "no-store" }] });
  } catch {
    // not in dist (or an API route): let the app's own protocol answer
    send("Fetch.continueRequest", { requestId });
  }
};
ws.onclose = () => process.exit(0);

send("Fetch.enable", { patterns: [{ urlPattern: "http://tauri.localhost/*", requestStage: "Request" }] });
send("Page.reload", { ignoreCache: true });
console.log(`hot swap active: ${tab.url} ← ${dist}`);
