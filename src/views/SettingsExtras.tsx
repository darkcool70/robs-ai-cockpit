import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Copy, Download, Eye, FlaskConical, KeyRound, Play, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { qrEncode, qrPath } from "../lib/qr";
import { expiryClock, freshKey, KEY_TTL_HOURS, savedKeys, ttlHours, ttlLabel, untilLabel, type RemoteKeys } from "../lib/remoteKeys";
import { useApp } from "../store";
import { api, errMsg, type RemoteInfo, type UpdateInfo } from "../lib/api";
import { budgets, type Budgets } from "../lib/workflow";
import { Badge, Button, Card, Field, Input, SectionTitle, Select, cx } from "../components/ui";

type Put = (k: string, v: unknown) => Promise<void>;

/** Tests after each turn: one command per project folder. */
export function TestsSettings({ settings, put }: { settings: Record<string, unknown>; put: Put }) {
  const projects = useApp((s) => s.projects);
  const toast = useApp((s) => s.toast);
  const cmds = (settings.testCommands as Record<string, string> | undefined) ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const setCmd = (path: string, v: string) => void put("testCommands", { ...cmds, [path]: v.trim() });
  const runNow = async (path: string) => {
    if (!cmds[path]) return;
    setBusy(path);
    try {
      const r = await api.testsRun(path, cmds[path]);
      toast(`${r.ok ? "✓ Tests green" : "✗ Tests red"} (${Math.round(r.durationMs / 1000)} s)${r.ok ? "" : `: ${r.tail.split("\n").slice(-2).join(" ")}`}`, r.ok ? "ok" : "error");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="space-y-3 p-3 text-[12.5px]">
      <SectionTitle>Tests after each turn</SectionTitle>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={settings.autoTests === true} onChange={(e) => void put("autoTests", e.target.checked)} className="mt-0.5" />
        <span>
          Run the project's tests whenever an agent finishes a turn
          <span className="block text-[11.5px] text-faint">Result as a green/red badge on the agent card and its task; on red a button sends the failures to the agent. Runs in the agent's own folder (also worktrees).</span>
        </span>
      </label>
      <div className="space-y-1.5">
        {projects.map((p) => (
          <div key={p.id} className="grid grid-cols-[160px_1fr_auto] items-center gap-2">
            <span className="truncate" title={p.path}>{p.name}</span>
            <Input className="font-mono" defaultValue={cmds[p.path] ?? ""} placeholder="e.g. pnpm test  ·  cargo test  ·  pytest -q" onBlur={(e) => setCmd(p.path, e.target.value)} />
            <Button size="sm" disabled={!cmds[p.path] || busy === p.path} onClick={() => void runNow(p.path)}>
              {busy === p.path ? <RefreshCw size={11} className="animate-spin" /> : <FlaskConical size={11} />} Run now
            </Button>
          </div>
        ))}
        {!projects.length && <p className="text-[11.5px] text-faint">Add a project first.</p>}
      </div>
    </Card>
  );
}

/** Daily token budget per project. */
export function BudgetSettings({ settings, put }: { settings: Record<string, unknown>; put: Put }) {
  const projects = useApp((s) => s.projects);
  const b = budgets(settings);
  const save = (next: Budgets) => void put("budgets", next);
  return (
    <Card className="space-y-3 p-3 text-[12.5px]">
      <SectionTitle>Token budget per project and day</SectionTitle>
      <p className="text-[11.5px] text-faint">Warning at 80 % and 100 % (also as phone push). Measured from the CLIs' logs, including cache tokens. Empty = no budget.</p>
      <div className="grid grid-cols-[1fr_140px] gap-x-3 gap-y-1.5">
        {projects.map((p) => (
          <FragmentRow key={p.id} label={p.name} title={p.path}>
            <Input
              type="number"
              min={0}
              step={1}
              defaultValue={b.limits[p.path] ?? ""}
              placeholder="M tokens"
              onBlur={(e) => {
                const v = Number(e.target.value);
                const limits = { ...b.limits };
                if (v > 0) limits[p.path] = v;
                else delete limits[p.path];
                save({ ...b, limits });
              }}
            />
          </FragmentRow>
        ))}
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!b.block} onChange={(e) => save({ ...b, block: e.target.checked })} />
        Over budget: no automatic tasks for that project today (auto-dispatch / night shift)
      </label>
    </Card>
  );
}

function FragmentRow({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <>
      <span className="self-center truncate" title={title}>{label}</span>
      {children}
    </>
  );
}

/** Phone remote in the home network: keys that expire, a view-only link for colleagues (Pro). */
export function RemoteSettings({ settings, put }: { settings: Record<string, unknown>; put: Put }) {
  const toast = useApp((s) => s.toast);
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [qr, setQr] = useState<"own" | "view" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const port = Number(settings.remotePort ?? 8765) || 8765;
  useEffect(() => { api.remoteStatus().then(setInfo).catch(() => {}); }, []);
  // the expiry line stays true while Settings is open
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const saved = savedKeys(settings, now).keys;
  const expires = info?.expires ?? saved?.expires ?? 0;
  const expired = (!!info || !!saved) && expires <= now;
  const viewExpired = !!info?.viewUrl && (info.viewExpires ?? 0) <= now;

  /** Save the keys; while on, the running remote takes them at once (the old links stop). */
  const saveKeys = async (k: RemoteKeys) => {
    await put("remoteKey", k.key);
    await put("remoteKeyExpires", k.expires);
    await put("remoteViewKey", k.viewKey ?? "");
    await put("remoteViewExpires", k.viewKey ? k.viewExpires : 0);
    if (info) setInfo(await api.remoteSetKeys(k.key, k.expires, k.viewKey, k.viewKey ? k.viewExpires : undefined));
  };
  const start = async () => {
    // a saved key that still works is kept (the phone's link keeps working); else a fresh one
    const k: RemoteKeys = saved && saved.expires > Date.now() ? saved : { ...freshKey(settings), viewKey: saved?.viewKey ?? null, viewExpires: saved?.viewExpires ?? 0 };
    try {
      await put("remoteKey", k.key);
      await put("remoteKeyExpires", k.expires);
      setInfo(await api.remoteStart(port, k.key, k.expires, k.viewKey, k.viewKey ? k.viewExpires : undefined));
      await put("remoteEnabled", true);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const stop = async () => {
    await api.remoteStop().catch(() => {});
    setInfo(null);
    setQr(null);
    await put("remoteEnabled", false);
  };
  const newKey = async () => {
    if (info && !expired && !window.confirm("Create a new key? The phone's current link stops working.")) return;
    try {
      await saveKeys({ ...freshKey(settings), viewKey: saved?.viewKey ?? null, viewExpires: saved?.viewExpires ?? 0 });
      if (info) setQr("own");
      toast(info ? "New key — scan the QR code again on your phone" : "New key saved — it is used when you turn the remote on", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const makeView = async () => {
    if (!saved) return;
    const v = freshKey(settings);
    try {
      await saveKeys({ ...saved, viewKey: v.key, viewExpires: v.expires });
      setQr("view");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const revokeView = async () => {
    if (!saved) return;
    try {
      await saveKeys({ ...saved, viewKey: null, viewExpires: 0 });
      if (qr === "view") setQr(null);
      toast("View-only link revoked — it stopped working", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const copy = (url: string, hint: string) => void navigator.clipboard.writeText(url).then(() => toast(hint, "ok"));
  return (
    <Card className="space-y-3 p-3 text-[12.5px]">
      <SectionTitle right={<Badge tone={info ? "ok" : "neutral"}>{info ? "on" : "off"}</Badge>}>Phone remote (home network)</SectionTitle>
      <p className="text-[11.5px] text-faint">
        A small page for your phone: see every agent, read its last answer, reply or send “weiter”{__PRO__ ? " — and the open board, live and read-only, with a line to the operator" : ""}. Only
        answers devices in your own network and only with the secret key in the link. Plain HTTP — use it at home, not in public Wi-Fi. Windows may ask once whether to allow the connection.
        Keys expire: after the chosen lifetime the phone shows “Link abgelaufen” and you scan a new QR code.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Field label="Port"><Input type="number" min={1024} max={65535} defaultValue={port} className="w-24" onBlur={(e) => void put("remotePort", Math.max(1024, Math.min(65535, Number(e.target.value) || 8765)))} /></Field>
        <Field label="Key lifetime">
          <Select value={String(ttlHours(settings))} onChange={(e) => void put("remoteKeyTtl", Number(e.target.value))} className="w-28">
            {KEY_TTL_HOURS.map((h) => <option key={h} value={h}>{ttlLabel(h)}</option>)}
          </Select>
        </Field>
        <div className="flex items-end gap-2 self-end">
          {info ? <Button onClick={() => void stop()}>Turn off</Button> : <Button variant="primary" onClick={() => void start()}><Smartphone size={12} /> Turn on</Button>}
          <Button variant="ghost" onClick={() => void newKey()} title="A fresh secret key with the chosen lifetime; the old link stops working"><KeyRound size={12} /> New key</Button>
        </div>
      </div>
      {(info || saved) && (
        <p className={cx("text-[11.5px]", expired ? "text-warn" : "text-faint")}>
          {expired
            ? "The key has expired — the phone shows “Link abgelaufen”. Create a new key and scan the QR code again."
            : `Key valid until ${expiryClock(expires)} (${untilLabel(expires, now)}). A changed lifetime applies to the next key.`}
        </p>
      )}
      {info && (
        <div className="flex items-center gap-2 rounded border border-line bg-bg px-2 py-1.5">
          <code className="min-w-0 flex-1 truncate text-[12px]">{info.url}</code>
          <Button size="sm" onClick={() => setQr(qr === "own" ? null : "own")}><QrCode size={11} /> {qr === "own" ? "Hide QR code" : "QR code"}</Button>
          <Button size="sm" onClick={() => copy(info.url, "Link copied — send it to your phone (e.g. to yourself by mail)")}><Copy size={11} /> Copy link</Button>
        </div>
      )}
      {info && qr === "own" && <QrImage text={info.url} />}
      {__PRO__ && info && (
        <div className="space-y-2 border-t border-line pt-2">
          <div className="flex items-start gap-2">
            <span className="flex-1">
              View-only link for colleagues
              <span className="block text-[11.5px] text-faint">The open board with the operator's answer — no message line, no agent list. The server refuses everything else for this key; it expires like yours.</span>
            </span>
            {info.viewUrl && viewExpired && <Button size="sm" onClick={() => void makeView()}><Eye size={11} /> New link</Button>}
            {info.viewUrl ? <Button size="sm" variant="ghost" onClick={() => void revokeView()}>Revoke</Button> : <Button size="sm" onClick={() => void makeView()}><Eye size={11} /> Create view-only link</Button>}
          </div>
          {info.viewUrl && (
            <div className="flex items-center gap-2 rounded border border-line bg-bg px-2 py-1.5">
              <code className="min-w-0 flex-1 truncate text-[12px]">{info.viewUrl}</code>
              <span className={cx("shrink-0 text-[11px]", viewExpired ? "text-warn" : "text-faint")}>{untilLabel(info.viewExpires ?? 0, now)}</span>
              <Button size="sm" onClick={() => setQr(qr === "view" ? null : "view")}><QrCode size={11} /> {qr === "view" ? "Hide QR code" : "QR code"}</Button>
              <Button size="sm" onClick={() => copy(info.viewUrl!, "View-only link copied — it shows only the board")}><Copy size={11} /> Copy link</Button>
            </div>
          )}
          {info.viewUrl && qr === "view" && <QrImage text={info.viewUrl} />}
        </div>
      )}
    </Card>
  );
}

/** The link as a QR code: the phone's camera opens it. Shown only on request (it carries the key). */
function QrImage({ text }: { text: string }) {
  const path = useMemo(() => { try { const m = qrEncode(text); return { d: qrPath(m), n: m.length + 8 }; } catch { return null; } }, [text]);
  if (!path) return <p className="text-[11.5px] text-faint">The link is too long for a QR code — copy it instead.</p>;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox={`0 0 ${path.n} ${path.n}`} width={176} height={176} shapeRendering="crispEdges" className="shrink-0 rounded" role="img" aria-label="QR code of the phone link">
        <rect width={path.n} height={path.n} fill="#fff" />
        <path d={path.d} fill="#000" />
      </svg>
      <p className="text-[11.5px] text-faint">Point your phone's camera at it (same Wi-Fi). Anyone who sees this code can open the page — hide it before sharing your screen, and use “New key” if it leaked.</p>
    </div>
  );
}

/** Update from the source folder: pull, build, swap, restart. */
export function UpdateSettings() {
  const toast = useApp((s) => s.toast);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [ready, setReady] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const check = async (fetch = false) => {
    setChecking(true);
    try {
      setInfo(await api.updateInfo(fetch));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void check(false);
    const offs = [
      listen<string>("update-progress", (e) => setLog((l) => [...l.slice(-200), e.payload])),
      listen<{ ok: boolean; exe?: string; error?: string }>("update-done", (e) => {
        void check(false);
        if (e.payload.ok && e.payload.exe) {
          setReady(e.payload.exe);
          toast("New version built — restart to use it", "ok");
        } else {
          toast(`Update failed: ${e.payload.error ?? "unknown error"}`, "error");
        }
      }),
    ];
    return () => offs.forEach((p) => void p.then((f) => f()));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    setLog([]);
    setReady(null);
    try {
      await api.updateStart(!!info?.remote);
      setInfo((i) => (i ? { ...i, building: true } : i));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const apply = async () => {
    if (!ready) return;
    const running = Object.values(useApp.getState().sessions).filter((s) => s.runtime?.running).length;
    if (running && !window.confirm(`${running} session(s) are running. They stop now and can be resumed after the restart. Restart?`)) return;
    await api.updateApply(ready).catch((e) => toast(errMsg(e), "error"));
  };
  return (
    <Card className="space-y-2 p-3 text-[12.5px]">
      <SectionTitle right={<Button size="sm" variant="ghost" disabled={checking} onClick={() => void check(true)}><RefreshCw size={11} className={cx(checking && "animate-spin")} /> Check</Button>}>
        Update from source
      </SectionTitle>
      {!info?.repo ? (
        <p className="text-[11.5px] text-faint">The source folder this build came from is not available on this computer.</p>
      ) : (
        <>
          <dl className="grid grid-cols-[110px_1fr] gap-y-0.5 text-[11.5px]">
            <dt className="text-faint">Source</dt><dd className="truncate font-mono" title={info.repo}>{info.repo}</dd>
            <dt className="text-faint">Version</dt><dd className="truncate">{info.branch} · {info.head}</dd>
            <dt className="text-faint">Remote</dt>
            <dd>{info.remote ? (info.behind ? <span className="text-accent">{info.behind} new commit(s) available</span> : "up to date") : "none (local repository — builds the current state)"}</dd>
            {info.dirty && <><dt className="text-faint">Note</dt><dd className="text-warn">uncommitted changes in the source are built too</dd></>}
          </dl>
          <div className="flex gap-2">
            <Button variant="primary" disabled={info.building} onClick={() => void start()}>
              <Download size={12} /> {info.building ? "Building…" : info.remote ? "Pull, build & install" : "Build & install"}
            </Button>
            {ready && <Button variant="primary" onClick={() => void apply()}><Play size={12} /> Restart with the new version</Button>}
          </div>
          {log.length > 0 && <pre className="max-h-40 overflow-auto rounded border border-line bg-term p-2 font-mono text-[11px] text-muted">{log.join("\n")}</pre>}
        </>
      )}
    </Card>
  );
}

/** Light / dark theme. */
export function AppearanceSettings({ settings, put }: { settings: Record<string, unknown>; put: Put }) {
  return (
    <Card className="space-y-2 p-3 text-[12.5px]">
      <SectionTitle>Appearance</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Theme">
          <Select value={(settings.theme as string) || "dark"} onChange={(e) => void put("theme", e.target.value)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">Like Windows</option>
          </Select>
        </Field>
        <p className="self-end text-[11.5px] text-faint">Terminal font per pane: Ctrl + mouse wheel over a terminal. The size is remembered per session.</p>
      </div>
    </Card>
  );
}
