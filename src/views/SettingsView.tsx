import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { MAX_PANES, maxPanes, useApp } from "../store";
import { api, errMsg, type Price } from "../lib/api";
import { setFont } from "../lib/terminals";
import { Button, Card, Field, IconButton, Input, SectionTitle, Select } from "../components/ui";
import { AUTONOMY } from "../lib/models";
import { VoiceSettings } from "./VoiceSettings";
import { AppearanceSettings, BudgetSettings, RemoteSettings, TestsSettings, TtsSettings, UpdateSettings } from "./SettingsExtras";

export function SettingsView() {
  const toast = useApp((s) => s.toast);
  const refreshClis = useApp((s) => s.refreshClis);
  const clis = useApp((s) => s.clis);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [prices, setPrices] = useState<Price[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.settingsGet().then(setSettings).catch(() => {});
    api.pricesGet().then(setPrices).catch(() => {});
  }, []);

  const projects = useApp((s) => s.projects);
  const put = async (key: string, value: unknown) => {
    try {
      await api.settingsSet(key, value);
      setSettings((s) => ({ ...s, [key]: value }));
      useApp.setState((st) => ({ settings: { ...st.settings, [key]: value } }));
      if (key.endsWith("Path")) await refreshClis();
      if (key === "terminalFontSize") setFont(Number(value) || 13);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const bool = (k: string, d = true) => (typeof settings[k] === "boolean" ? (settings[k] as boolean) : d);

  const savePrices = async () => {
    try {
      await api.pricesSave(prices.filter((p) => p.modelPattern.trim()));
      setDirty(false);
      toast("Prices saved", "ok");
      useApp.setState((s) => ({ usageVersion: s.usageVersion + 1 }));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const setPrice = (i: number, patch: Partial<Price>) => {
    setPrices((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    setDirty(true);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[900px] space-y-4 p-5">
        <h1 className="text-[16px] font-semibold">Settings</h1>

        <Card className="space-y-3 p-3">
          <SectionTitle>CLI binaries</SectionTitle>
          {(["claude", "codex"] as const).map((p) => {
            const info = clis.find((c) => c.provider === p);
            return (
              <Field key={p} label={p === "claude" ? "Claude Code path" : "Codex path"} hint={`Detected: ${info?.path ?? "not found"} (${info?.source ?? ""})`}>
                <Input
                  className="font-mono"
                  defaultValue={(settings[`${p}Path`] as string) ?? ""}
                  placeholder="auto-detect (PATH and known install locations)"
                  onBlur={(e) => void put(`${p}Path`, e.target.value.trim())}
                />
              </Field>
            );
          })}
        </Card>

        <Card className="space-y-3 p-3 text-[12.5px]">
          <SectionTitle>Automation</SectionTitle>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={bool("autoContinueDefault")} onChange={(e) => void put("autoContinueDefault", e.target.checked)} className="mt-0.5" />
            <span>
              Continue automatically after usage limits <span className="text-faint">(default for new sessions)</span>
              <span className="block text-[11.5px] text-faint">
                When a CLI reports a limit, the cockpit waits for the reset time it printed (or the quota data, else retries periodically) and then types the
                message below. If the process has exited it is resumed first. Toggle per session with the timer icon in the pane header.
              </span>
            </span>
          </label>
          <div className="grid grid-cols-[1fr_160px] gap-3 pl-5">
            <Field label="Message sent to continue">
              <Input defaultValue={(settings.autoContinueMessage as string) ?? ""} placeholder="continue" onBlur={(e) => void put("autoContinueMessage", e.target.value.trim())} />
            </Field>
            <Field label="Retry every (minutes)" hint="If no reset time is known.">
              <Input type="number" min={1} max={240} defaultValue={(settings.autoContinueRetryMin as number) ?? 15} onBlur={(e) => void put("autoContinueRetryMin", Math.max(1, Math.min(240, Number(e.target.value) || 15)))} />
            </Field>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={bool("autoFailover", false)} onChange={(e) => void put("autoFailover", e.target.checked)} className="mt-0.5" />
            <span>
              Switch to another account instead of waiting
              <span className="block text-[11.5px] text-faint">
                For sessions with auto-continue: when an account hits its limit, the conversation is copied locally into another logged-in account of the same
                provider with free quota and continued there. Without this, the cockpit only offers the switch as a button.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={bool("notifyOnWaiting")} onChange={(e) => void put("notifyOnWaiting", e.target.checked)} className="mt-0.5" />
            <span>
              Notify when an agent finishes and waits for input
              <span className="block text-[11.5px] text-faint">Flashes the taskbar icon when the cockpit is in the background, and shows a toast for sessions not on screen.</span>
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default autonomy for new sessions" hint="Projects can override this (checkbox in the new-session dialog).">
              <Select value={(settings.defaultAutonomy as string) ?? ""} onChange={(e) => void put("defaultAutonomy", e.target.value)}>
                {AUTONOMY.map((a) => <option key={a.value || "d"} value={a.value}>{a.label}</option>)}
              </Select>
            </Field>
            <Field label="Project selected at startup">
              <Select value={(settings.defaultProjectId as string) ?? ""} onChange={(e) => void put("defaultProjectId", e.target.value)}>
                <option value="">Most recently used</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="space-y-3 p-3 text-[12.5px]">
          <SectionTitle>Workspace</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Grow up to (panes)" hint="New sessions open in a new pane until this many are shown (max 8).">
              <Select value={String(maxPanes(settings))} onChange={(e) => void put("maxPanes", Number(e.target.value))}>
                {Array.from({ length: MAX_PANES }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
            <Field label="When all panes are taken" hint="The session that makes room keeps running in the bar at the bottom.">
              <Select value={(settings.whenFull as string) || "ask"} onChange={(e) => void put("whenFull", e.target.value)}>
                <option value="ask">Ask me which pane makes room</option>
                <option value="replace">Replace the focused pane</option>
              </Select>
            </Field>
          </div>
          <p className="text-[11.5px] text-faint">
            Rearrange anytime: drag a session from the bar at the bottom, the sidebar or a pane header (⠿) onto a pane — two shown sessions swap places.
          </p>
        </Card>

        <Card className="space-y-3 p-3 text-[12.5px]">
          <SectionTitle>Watchdogs</SectionTitle>
          <div className="grid grid-cols-[1fr_160px] items-start gap-3">
            <span>
              Suggest <code>/compact</code> when an agent's context is this full
              <span className="block text-[11.5px] text-faint">A nearly full context makes answers worse and costs more. One hint per session, with a button that sends /compact. 0 = off.</span>
            </span>
            <Input type="number" min={0} max={99} defaultValue={(settings.contextWarnPercent as number) ?? 85} onBlur={(e) => void put("contextWarnPercent", Math.max(0, Math.min(99, Number(e.target.value) || 0)))} />
          </div>
          <div className="grid grid-cols-[1fr_160px] items-start gap-3">
            <span>
              Warn when an agent works this many minutes without visible progress
              <span className="block text-[11.5px] text-faint">No new tool call, file or message during a turn — it may hang. The hint offers to interrupt it (Esc). 0 = off.</span>
            </span>
            <Input type="number" min={0} max={240} defaultValue={(settings.hangMinutes as number) ?? 15} onBlur={(e) => void put("hangMinutes", Math.max(0, Math.min(240, Number(e.target.value) || 0)))} />
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={bool("conflictWarn")} onChange={(e) => void put("conflictWarn", e.target.checked)} className="mt-0.5" />
            <span>
              Warn when two agents edit the same file
              <span className="block text-[11.5px] text-faint">Within 15 minutes of each other — they would overwrite each other's work. Tip: separate git worktrees per agent (Team dialog).</span>
            </span>
          </label>
        </Card>

        <PushSettings settings={settings} put={put} bool={bool} />
        <TestsSettings settings={settings} put={put} />
        <BudgetSettings settings={settings} put={put} />
        <RemoteSettings settings={settings} put={put} />
        <TtsSettings settings={settings} put={put} />
        <AppearanceSettings settings={settings} put={put} />
        <UpdateSettings />

        <Card className="space-y-3 p-3 text-[12.5px]">
          <SectionTitle>Notifications &amp; activity</SectionTitle>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={bool("notifyPopup")} onChange={(e) => void put("notifyPopup", e.target.checked)} className="mt-0.5" />
            <span>
              Pop-up bottom right when an agent is done or needs input
              <span className="block text-[11.5px] text-faint">Shows the agent's last answer; reply, dictate or jump to the session right from the pop-up. Stays on top of other programs and never takes the keyboard focus.</span>
            </span>
          </label>
          <div className="grid grid-cols-3 gap-3 pl-5">
            <Field label="Show pop-ups">
              <Select value={(settings.notifyWhen as string) || "offscreen"} onChange={(e) => void put("notifyWhen", e.target.value)}>
                <option value="offscreen">When the session isn't on screen</option>
                <option value="always">Always</option>
              </Select>
            </Field>
            <Field label="Hide after (seconds)">
              <Input type="number" min={5} max={600} defaultValue={(settings.notifyTimeoutSec as number) ?? 20} onBlur={(e) => void put("notifyTimeoutSec", Math.max(5, Math.min(600, Number(e.target.value) || 20)))} />
            </Field>
            <label className="flex items-center gap-2 pt-5">
              <input type="checkbox" checked={bool("notifySound")} onChange={(e) => void put("notifySound", e.target.checked)} /> Sound
            </label>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={bool("activityDetails")} onChange={(e) => void put("activityDetails", e.target.checked)} className="mt-0.5" />
            <span>
              Record activity details (file paths, short command and prompt excerpts)
              <span className="block text-[11.5px] text-faint">Powers “what is the agent doing”, recently changed files and the timeline. Stays in the local database; tool output is never recorded. Applies to newly started Claude sessions.</span>
            </span>
          </label>
          <Field label="Editor for “open file”" hint="Command in PATH, e.g. cursor or code. Empty: Cursor, then VS Code, else the system default.">
            <Input className="font-mono" defaultValue={(settings.editorCommand as string) ?? ""} placeholder="auto" onBlur={(e) => void put("editorCommand", e.target.value.trim())} />
          </Field>
        </Card>

        <VoiceSettings />

        <Card className="space-y-2 p-3 text-[12.5px]">
          <SectionTitle>Claude Code integration</SectionTitle>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={bool("claudeHooks")} onChange={(e) => void put("claudeHooks", e.target.checked)} className="mt-0.5" />
            <span>
              Session state via hooks <span className="text-faint">(recommended)</span>
              <span className="block text-[11.5px] text-faint">Reliable working / waiting-for-input detection using documented hooks passed with <code>--settings</code>. Applies to newly started sessions.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={bool("claudeStatusLine")} disabled={!bool("claudeHooks")} onChange={(e) => void put("claudeStatusLine", e.target.checked)} className="mt-0.5" />
            <span>
              Quota + model via statusLine
              <span className="block text-[11.5px] text-faint">Receives 5-hour / weekly usage percentages from Claude Code. Replaces your own statusLine for cockpit sessions only.</span>
            </span>
          </label>
        </Card>

        <Card className="grid grid-cols-2 gap-3 p-3">
          <SectionTitle>Terminal &amp; indexing</SectionTitle>
          <span />
          <Field label="Terminal font size">
            <Input type="number" min={9} max={24} defaultValue={(settings.terminalFontSize as number) ?? 13} onBlur={(e) => void put("terminalFontSize", Number(e.target.value))} />
          </Field>
          <Field label="Log index interval (seconds)" hint="Incremental; only changed files are read.">
            <Input type="number" min={15} max={3600} defaultValue={(settings.indexIntervalSec as number) ?? 60} onBlur={(e) => void put("indexIntervalSec", Number(e.target.value))} />
          </Field>
        </Card>

        <Card className="p-3">
          <SectionTitle
            right={
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => { setPrices((p) => [...p, { modelPattern: "", inputPerMtok: 0, outputPerMtok: 0, cacheReadPerMtok: 0, cacheWritePerMtok: 0 }]); setDirty(true); }}>
                  <Plus size={12} /> Add model price
                </Button>
                <Button size="sm" variant="primary" disabled={!dirty} onClick={savePrices}>Save prices</Button>
              </div>
            }
          >
            API prices for "API-equivalent value" (USD per 1M tokens)
          </SectionTitle>
          <p className="mb-2 text-[11.5px] text-faint">
            Enter current public API list prices yourself — nothing is hard-coded. A pattern matches model names case-insensitively as a substring;
            the longest matching pattern wins (e.g. <code>claude-opus</code> beats <code>claude</code>). This is only used to estimate what your subscription usage
            would have cost via the API.
          </p>
          <table className="w-full text-[12px]">
            <thead className="text-left text-[11px] text-faint">
              <tr><th className="font-medium">Model pattern</th><th className="font-medium">Input</th><th className="font-medium">Output</th><th className="font-medium">Cache read</th><th className="font-medium">Cache write</th><th /></tr>
            </thead>
            <tbody>
              {prices.map((p, i) => (
                <tr key={i}>
                  <td className="py-0.5 pr-1"><Input className="w-full font-mono" value={p.modelPattern} onChange={(e) => setPrice(i, { modelPattern: e.target.value })} placeholder="claude-opus" /></td>
                  {(["inputPerMtok", "outputPerMtok", "cacheReadPerMtok", "cacheWritePerMtok"] as const).map((k) => (
                    <td key={k} className="pr-1"><Input type="number" step="0.01" min={0} className="w-24" value={p[k]} onChange={(e) => setPrice(i, { [k]: Number(e.target.value) } as Partial<Price>)} /></td>
                  ))}
                  <td><IconButton title="Remove" onClick={() => { setPrices((ps) => ps.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 size={12} /></IconButton></td>
                </tr>
              ))}
            </tbody>
          </table>
          {prices.length === 0 && <p className="py-2 text-[12px] text-faint">No prices configured — API-equivalent value shows $0 and lists unpriced models.</p>}
        </Card>
      </div>
    </div>
  );
}

/** Phone push via ntfy (or any service that accepts a plain HTTPS POST). */
function PushSettings({ settings, put, bool }: { settings: Record<string, unknown>; put: (k: string, v: unknown) => Promise<void>; bool: (k: string, d?: boolean) => boolean }) {
  const toast = useApp((s) => s.toast);
  const url = typeof settings.pushUrl === "string" ? settings.pushUrl : "";
  const test = async () => {
    try {
      await api.pushSend(url, "Robs AI Cockpit", "Test: push notifications work.");
      toast("Test push sent — check your phone", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <Card className="space-y-3 p-3 text-[12.5px]">
      <SectionTitle>Push to your phone</SectionTitle>
      <p className="text-[11.5px] text-faint">
        Install the free <b className="text-muted">ntfy</b> app, subscribe to a topic with a long random name, and enter its address here (e.g.{" "}
        <code>https://ntfy.sh/my-cockpit-&lt;random&gt;</code>). Only the agent's name and a short excerpt of its answer are sent — nothing else leaves the computer.
      </p>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input className="font-mono" defaultValue={url} placeholder="https://ntfy.sh/your-topic" onBlur={(e) => void put("pushUrl", e.target.value.trim())} />
        <Button disabled={!url} onClick={() => void test()}>Send test</Button>
      </div>
      <div className="grid grid-cols-[1fr_160px] items-start gap-3">
        <span>
          Push when an agent has been waiting for you longer than (minutes)
          <span className="block text-[11.5px] text-faint">Only while the cockpit is not the active window. 0 = off.</span>
        </span>
        <Input type="number" min={0} max={240} defaultValue={(settings.pushAfterMin as number) ?? 5} onBlur={(e) => void put("pushAfterMin", Math.max(0, Math.min(240, Number(e.target.value) || 0)))} />
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={bool("pushOnLimit")} onChange={(e) => void put("pushOnLimit", e.target.checked)} /> Push when an account hits its usage limit
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={bool("pushOnFailed")} onChange={(e) => void put("pushOnFailed", e.target.checked)} /> Push when a session ends with an error
      </label>
    </Card>
  );
}
