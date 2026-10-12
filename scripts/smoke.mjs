// UI smoke test for a running test instance (WebView2 remote debugging on 9230, isolated data
// dir via AI_COCKPIT_HOME). Clicks through every view, the operator's boards, the overview, the
// palette and Settings — no AI turns, no cost — and fails on any console error or crashed card.
//   node scripts/smoke.mjs [port]
import { connect } from "./cdp.mjs";

const port = Number(process.argv[2] ?? 9230);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const c = await connect(port);
const problems = [];
const step = (name) => console.log(`· ${name}`);

// collect errors from here on
await c.evaluate(`(()=>{ if (window.__smoke) return; window.__smoke=[]; const o=console.error; console.error=(...a)=>{ window.__smoke.push(a.map(x=>x&&x.stack?x.stack:String(x)).join(' ').slice(0,600)); o(...a); };
  window.addEventListener('error',e=>window.__smoke.push('window error: '+(e.error&&e.error.stack||e.message)));
  window.addEventListener('unhandledrejection',e=>window.__smoke.push('unhandled: '+String(e.reason&&e.reason.stack||e.reason)));})()`);

const clickText = (t) => c.evaluate(`(()=>{ const b=[...document.querySelectorAll('button')].find(b=>{ const x=b.textContent.trim(); return (x===${JSON.stringify(t)} || (x.startsWith(${JSON.stringify(t)}) && /^[0-9]+$/.test(x.slice(${JSON.stringify(t)}.length)))) && b.getBoundingClientRect().width>0; }); if(!b) return false; b.click(); return true; })()`);
const clickTitle = (t) => c.evaluate(`(()=>{ const b=[...document.querySelectorAll('button')].find(b=>(b.title||'').startsWith(${JSON.stringify(t)}) && b.getBoundingClientRect().width>0); if(!b) return false; b.click(); return true; })()`);
// the board speaks the voice language (German by default, English with voiceLanguage "en"): either title
const clickTitles = async (...ts) => { for (const t of ts) if (await clickTitle(t)) return true; return false; };
const key = async (k, code, vk, modifiers = 0) => {
  await c.call("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
};
// a card that crashed shows the error boundary's text; a blank window has (almost) no text
const health = (where) => c.evaluate(`(()=>{ const t=document.body.innerText||''; const out=[]; if (t.trim().length<40) out.push('almost empty window');
  for (const m of t.matchAll(/(Something went wrong|This card could not be shown|Diese Karte konnte nicht)[^\\n]{0,120}/g)) out.push(m[0]); return out; })()`).then((l) => l.forEach((x) => problems.push(`${where}: ${x}`)));

try {
  await c.evaluate(`void [...document.querySelectorAll('button')].find(e=>/Überspringen|Skip/.test(e.textContent))?.click()`);
  for (const view of ["Overview", "Workspace", "Assistants", "Voice", "Tasks", "Review & commit", "Pins", "Loops & templates", "Accounts", "Usage", "History", "Security", "Settings"]) {
    step(view);
    if (!(await clickText(view))) { problems.push(`view button "${view}" not found`); continue; }
    await delay(900);
    await health(view);
  }
  // the operator's board (Pro)
  step("operator board");
  await clickText("Assistants"); await delay(600);
  // the Assistants view remembers the open assistant: its board may already be there
  const opened = (await c.evaluate(`!!document.querySelector('.board-bg')`)) || (await clickText("Open"));
  await delay(2500);
  if (opened) {
    await health("board");
    // the room's control bar: talk, Stumm · Kurz · Normal · Alles (exactly one pressed), the ⋯ menu
    const bar = await c.evaluate(`(()=>{ const g=document.querySelector('[data-testid=voice-level]'); return { seg: g ? g.querySelectorAll('button').length : 0, on: g ? g.querySelectorAll('button[aria-pressed=true]').length : 0, talk: !!document.querySelector('[data-testid=talk]'), more: !!document.querySelector('[data-testid=assistant-more]') }; })()`);
    step(`control bar: ${JSON.stringify(bar)}`);
    if (bar.seg !== 4 || bar.on !== 1 || !bar.talk || !bar.more) problems.push(`control bar incomplete: ${JSON.stringify(bar)}`);
    const tabs = await c.evaluate(`[...document.querySelectorAll('button')].filter(b=>b.closest('[class*="tabs"],[role=tablist]')||/^(Plan)$/.test(b.textContent.trim())).length`);
    step(`board tabs ≈ ${tabs}`);
    for (const t of [["Alles zeigen", "Show everything"], ["Hineinzoomen (+)", "Zoom in (+)"], ["Herauszoomen (−)", "Zoom out (−)"]]) { await clickTitles(...t); await delay(300); }
    await health("board zoomed");
    step("overview");
    if (await clickTitles("Übersicht", "Overview")) { await delay(1500); await health("overview"); await clickTitles("Übersicht", "Overview"); await delay(600); }
    else problems.push("overview button not found");
    step("palette");
    await c.evaluate(`document.activeElement?.blur()`);
    if (!(await clickTitles("Befehle", "Command palette"))) await key("k", "KeyK", 75, 2);
    await delay(700);
    await c.call("Input.insertText", { text: "a" }); await delay(600);
    const pal = await c.evaluate(`(()=>{ const p=document.querySelector('.board-palette'); return p ? p.querySelectorAll('button').length : -1; })()`);
    if (pal < 0) problems.push("palette did not open on Ctrl+K");
    step(`palette entries: ${pal}`);
    await key("Escape", "Escape", 27); await delay(300);
    await health("palette");
  } else problems.push("operator board: no 'Open' button (Pro build? an operator assistant?)");
  await delay(1500);
  const errs = await c.evaluate(`JSON.stringify(window.__smoke||[])`);
  for (const e of JSON.parse(errs)) problems.push(`console: ${e}`);
} finally {
  c.close();
}
if (problems.length) {
  console.error(`\nSMOKE FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\nSMOKE OK — every view, the board, overview and palette rendered without errors.");
