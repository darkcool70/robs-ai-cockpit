import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Copy, Download, FlaskConical, Play, RefreshCw, Smartphone, Volume2 } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type RemoteInfo, type UpdateInfo } from "../lib/api";
import { budgets, type Budgets } from "../lib/workflow";
import { speak, voices } from "../lib/tts";
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

/** Read answers aloud. */
export function TtsSettings({ settings, put }: { settings: Record<string, unknown>; put: Put }) {
  const [list, setList] = useState(voices());
  useEffect(() => {
    const load = () => setList(voices());
    load();
    try {
      window.speechSynthesis.onvoiceschanged = load;
    } catch {
      /* no speech synthesis */
    }
  }, []);
  return (
    <Card className="space-y-3 p-3 text-[12.5px]">
      <SectionTitle>Read answers aloud</SectionTitle>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={settings.ttsEnabled === true} onChange={(e) => void put("ttsEnabled", e.target.checked)} className="mt-0.5" />
        <span>
          Speak a short summary when an agent is done
          <span className="block text-[11.5px] text-faint">Windows voices, offline. Code blocks are skipped; dictating stops the reading. Every agent card also has a 🔊 button.</span>
        </span>
      </label>
      <div className="grid grid-cols-3 gap-3">
        <Field label="For">
          <Select value={(settings.ttsWhen as string) || "voice"} onChange={(e) => void put("ttsWhen", e.target.value)}>
            <option value="voice">the session I last talked to</option>
            <option value="always">every agent</option>
          </Select>
        </Field>
        <Field label="Voice">
          <Select value={(settings.ttsVoice as string) || ""} onChange={(e) => void put("ttsVoice", e.target.value)}>
            <option value="">Automatic (dictation language)</option>
            {list.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
          </Select>
        </Field>
        <Field label="Speed">
          <Select value={String(settings.ttsRate ?? 1.05)} onChange={(e) => void put("ttsRate", Number(e.target.value))}>
            {[0.85, 1, 1.05, 1.2, 1.4].map((r) => <option key={r} value={r}>{r}×</option>)}
          </Select>
        </Field>
      </div>
      <Button size="sm" onClick={() => speak("Claude B: Die Tests sind grün, ich habe zwei Dateien geändert.")}><Volume2 size={12} /> Test</Button>
    </Card>
  );
}

function randomKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Phone remote in the home network. */
export function RemoteSettings({ settings, put }: { settings: Record<string, unknown>; put: Put }) {
  const toast = useApp((s) => s.toast);
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const port = Number(settings.remotePort ?? 8765) || 8765;
  useEffect(() => { api.remoteStatus().then(setInfo).catch(() => {}); }, []);
  const start = async (key?: string) => {
    const k = key ?? (typeof settings.remoteKey === "string" && settings.remoteKey.length >= 24 ? settings.remoteKey : randomKey());
    try {
      if (k !== settings.remoteKey) await put("remoteKey", k);
      setInfo(await api.remoteStart(port, k));
      await put("remoteEnabled", true);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const stop = async () => {
    await api.remoteStop().catch(() => {});
    setInfo(null);
    await put("remoteEnabled", false);
  };
  return (
    <Card className="space-y-3 p-3 text-[12.5px]">
      <SectionTitle right={<Badge tone={info ? "ok" : "neutral"}>{info ? "on" : "off"}</Badge>}>Phone remote (home network)</SectionTitle>
      <p className="text-[11.5px] text-faint">
        A small page for your phone: see every agent, read its last answer, reply or send “weiter”. Only reachable in your own network and only with the secret
        key in the link. Plain HTTP — use it at home, not in public Wi-Fi. Windows may ask once whether to allow the connection.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Field label="Port"><Input type="number" min={1024} max={65535} defaultValue={port} className="w-24" onBlur={(e) => void put("remotePort", Math.max(1024, Math.min(65535, Number(e.target.value) || 8765)))} /></Field>
        <div className="flex items-end gap-2 self-end">
          {info ? <Button onClick={() => void stop()}>Turn off</Button> : <Button variant="primary" onClick={() => void start()}><Smartphone size={12} /> Turn on</Button>}
          {info && <Button variant="ghost" onClick={() => { if (window.confirm("Create a new key? The old link stops working.")) void start(randomKey()); }}>New key</Button>}
        </div>
      </div>
      {info && (
        <div className="flex items-center gap-2 rounded border border-line bg-bg px-2 py-1.5">
          <code className="min-w-0 flex-1 truncate text-[12px]">{info.url}</code>
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(info.url).then(() => toast("Link copied — send it to your phone (e.g. to yourself by mail)", "ok"))}><Copy size={11} /> Copy link</Button>
        </div>
      )}
    </Card>
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
