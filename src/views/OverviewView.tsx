import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, FlaskConical, Forward, Pin, Star, Volume2, ChevronDown, CornerDownLeft, ExternalLink, FileCode2, FileDiff, GitBranch, Hourglass, Loader2, Mic, Play, Plus, Repeat, RotateCw, Square, Users,
} from "lucide-react";
import { useApp } from "../store";
import {
  api, errMsg, type Activity, type Group, type QuotaWindow, type RecentFile, type Session, type SessionStats, type Template, type TimelineItem, type UsageSummary,
} from "../lib/api";
import { toggleDictation } from "../lib/voice";
import { ago, compact, duration, pct, resetLabel, usd, windowLabel } from "../lib/format";
import { paceOf, untilLabel } from "../lib/quota";
import { promptHistory, rememberPrompt } from "../lib/prompts";
import { speak, summarize } from "../lib/tts";
import { autonomyLabel } from "../lib/models";
import { Badge, Button, Card, cx, Empty, IconButton, Meter, Modal, ProviderMark, SectionTitle, StatusDot } from "../components/ui";

/** Mission control: what every agent is doing, what waits for you, what changed. */
export function OverviewView() {
  const sessions = useApp((s) => s.sessions);
  const order = useApp((s) => s.order);
  const filesVersion = useApp((s) => s.filesVersion);
  const liveActivity = useApp((s) => s.activity);
  const [files, setFiles] = useState<RecentFile[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [diff, setDiff] = useState<string | null>(null);
  const [, tick] = useState(0);
  const usageVersion = useApp((s) => s.usageVersion);
  const quota = useApp((s) => s.quota);
  const [sums, setSums] = useState<Partial<Record<Range, UsageSummary>>>({});
  const today = sums.today ?? null;
  const [range, setRange] = useState<Range>("today");
  const [history, setHistory] = useState<Record<string, QuotaWindow[]>>({});
  const [details, setDetails] = useState(false);
  const [stats, setStats] = useState<SessionStats[]>([]);

  useEffect(() => {
    api.recentFiles(60).then(setFiles).catch(() => {});
  }, [filesVersion]);
  useEffect(() => {
    for (const r of RANGES) api.usageSummary(r.id).then((v) => setSums((x) => ({ ...x, [r.id]: v }))).catch(() => {});
  }, [usageVersion]);
  useEffect(() => {
    api.quotaHistory(6).then(setHistory).catch(() => {});
  }, [quota]);
  // Working / waiting time today (refreshed when agents finish a turn and every minute).
  const turnsDone = Object.values(liveActivity).reduce((n, list) => n + list.filter((a) => a.kind === "done" || a.kind === "prompt").length, 0);
  useEffect(() => {
    const load = () => api.activityStats(new Date().setHours(0, 0, 0, 0)).then(setStats).catch(() => {});
    void load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [turnsDone]);
  useEffect(() => {
    api.timeline(undefined, 120).then(setTimeline).catch(() => {});
  }, [liveActivity]);
  // Relative times ("for 3m") stay fresh.
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, []);

  const agents = order.map((id) => sessions[id]).filter((s): s is Session => !!s && s.kind === "agent");
  const status = (s: Session) => s.runtime?.status ?? s.status;
  const waiting = agents.filter((s) => s.runtime?.running && status(s) === "waiting-for-input");
  const working = agents.filter((s) => status(s) === "working");
  const limited = agents.filter((s) => status(s) === "rate-limited");
  const loops = agents.filter((s) => s.runtime?.automation?.state === "running");
  // Waiting for you first, then working, then the rest.
  const rank = (s: Session) => (status(s) === "waiting-for-input" && s.runtime?.running ? 0 : status(s) === "working" ? 1 : status(s) === "rate-limited" ? 2 : s.runtime?.running ? 3 : 4);
  const sorted = [...agents].sort((a, b) => rank(a) - rank(b));
  const midnight = new Date().setHours(0, 0, 0, 0);
  const filesToday = files.filter((f) => f.ts >= midnight).length;
  const resumable = agents.filter((s) => !s.runtime?.running && s.startedAt && s.accountId);
  const resumeAll = async () => {
    for (const s of resumable) {
      useApp.getState().showSession(s.id);
      await useApp.getState().startSession(s.id);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-[16px] font-semibold">Overview</h1>
            <p className="text-[12px] text-muted">Every agent at a glance — answer, dictate or jump in without switching panes.</p>
          </div>
          <div className="flex gap-1.5">
            {resumable.length > 0 && (
              <Button onClick={() => void resumeAll()} title="Resume every stopped agent with its conversation (e.g. after a restart)">
                <RotateCw size={13} /> Resume all ({resumable.length})
              </Button>
            )}
            <Button onClick={() => useApp.getState().setTeamOpen(true)}><Users size={13} /> Team</Button>
            <Button variant="primary" onClick={() => useApp.getState().openNewSession(null)}><Plus size={13} /> New session</Button>
          </div>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2 xl:grid-cols-6">
          <Stat label="Waiting for you" value={waiting.length} tone={waiting.length ? "ok" : undefined} />
          <Stat label="Working" value={working.length} tone={working.length ? "accent" : undefined} />
          <Stat label="Usage limit" value={limited.length} tone={limited.length ? "warn" : undefined} />
          <Stat label="Loops running" value={loops.length} />
          <Stat label="Files changed today" value={filesToday} />
          <TokenStat sums={sums} open={details} onToggle={() => setDetails((d) => !d)} />
        </div>
        {details && sums[range] && <TodayDetails today={sums[range]!} range={range} setRange={setRange} stats={stats} />}
        <QuotaStrip history={history} today={today} />
        {sorted.length === 0 ? (
          <Card className="p-8">
            <Empty>No agent sessions yet. Start one with “New session” or a whole team with “Team”.</Empty>
          </Card>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-3">
            {sorted.map((s) => (
              <AgentCard key={s.id} s={s} live={liveActivity[s.id]} stats={stats.find((x) => x.sessionId === s.id)} tokens={today?.bySession.find((g) => g.key === (s.runtime?.providerSessionId ?? s.providerSessionId))?.totals.total} />
            ))}
          </div>
        )}
      </div>
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-panel">
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <SectionTitle>Recently changed files</SectionTitle>
          {files.length === 0 && <p className="text-[12px] text-faint">Files agents edit show up here.</p>}
          <div className="space-y-px">
            {files.slice(0, 40).map((f) => <FileRow key={f.file} f={f} onDiff={() => setDiff(f.file)} />)}
          </div>
        </div>
        <div className="max-h-[45%] min-h-[180px] overflow-auto border-t border-line p-3">
          <SectionTitle>Activity</SectionTitle>
          <Timeline items={timeline} />
        </div>
      </aside>
      {diff && <DiffDialog path={diff} onClose={() => setDiff(null)} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "accent" }) {
  return (
    <Card className="px-3 py-2">
      <div className={cx("text-[20px] font-semibold tabular", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "accent" && "text-accent")}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </Card>
  );
}

type Range = "today" | "7d" | "30d" | "all";
const RANGES: { id: Range; label: string; short: string }[] = [
  { id: "today", label: "Today", short: "today" },
  { id: "7d", label: "7 days", short: "7d" },
  { id: "30d", label: "30 days", short: "30d" },
  { id: "all", label: "All time", short: "all" },
];

/** Tokens today (+ 7 days, 30 days, all time); click opens the breakdown. */
function TokenStat({ sums, open, onToggle }: { sums: Partial<Record<Range, UsageSummary>>; open: boolean; onToggle: () => void }) {
  const today = sums.today ?? null;
  const t = today?.totals;
  const lastHour = today?.byHour[new Date().getHours()]?.total ?? 0;
  const title = t
    ? `Today: ${t.total.toLocaleString()} tokens\nInput ${compact(t.input)} · Output ${compact(t.output)} · Cache read ${compact(t.cacheRead)} · Cache write ${compact(t.cacheWrite)}\nThis hour: ${compact(lastHour)}${today?.cacheHitRatio != null ? `\nCache hits: ${pct(today.cacheHitRatio)}` : ""}\nClick for details`
    : "Token usage from the CLIs' local logs";
  return (
    <button onClick={onToggle} title={title} className={cx("rounded-md border bg-panel px-3 py-2 text-left hover:bg-hover", open ? "border-accent/60" : "border-line")}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[20px] font-semibold tabular">{compact(t?.total ?? 0)}</span>
        <span className="truncate text-[11px] text-faint">
          {lastHour > 0 ? `+${compact(lastHour)}/h` : ""}{today && today.apiValue.valueUsd > 0 ? ` · ≈ ${usd(today.apiValue.valueUsd)}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted">
        Tokens today
        <ChevronDown size={11} className={cx("ml-auto transition-transform", open && "rotate-180")} />
      </div>
      <div className="mt-0.5 flex gap-2 text-[10.5px] text-faint tabular" title="Tokens in the last 7 / 30 days and since the logs begin (with ≈ API value)">
        {(["7d", "30d", "all"] as Range[]).map((r) => (
          <span key={r}>{r === "all" ? "Σ" : r} {compact(sums[r]?.totals.total ?? 0)}</span>
        ))}
      </div>
    </button>
  );
}

function TodayDetails({ today, stats, range, setRange }: { today: UsageSummary; stats: SessionStats[]; range: Range; setRange: (r: Range) => void }) {
  const totalWait = stats.reduce((a, x) => a + x.waitingMs, 0);
  const totalWork = stats.reduce((a, x) => a + x.workingMs, 0);
  const turns = stats.reduce((a, x) => a + x.turns, 0);
  const agentsWithTurns = stats.filter((x) => x.turns > 0).sort((a, b) => b.workingMs - a.workingMs);
  const t = today.totals;
  const max = Math.max(1, ...today.byHour.map((h) => h.total));
  const now = new Date().getHours();
  const busiest = today.byHour.reduce((a, b) => (b.total > a.total ? b : a), today.byHour[0]);
  const row = (g: Group) => (
    <div key={g.key} className="flex items-center gap-2 text-[11.5px]">
      {g.provider && <ProviderMark provider={g.provider} />}
      <span className="min-w-0 flex-1 truncate" title={g.label}>{g.label}</span>
      <span className="tabular text-muted">{compact(g.totals.total)}</span>
      <span className="w-10 text-right tabular text-faint">{pct(t.total ? g.totals.total / t.total : 0)}</span>
    </div>
  );
  return (
    <Card className="mb-4 grid grid-cols-1 gap-4 p-3 lg:grid-cols-[1.3fr_1fr_1fr]">
      <div className="flex gap-1 lg:col-span-3">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={cx("h-6 rounded border px-2 text-[11.5px]", range === r.id ? "border-accent bg-accent/10 text-accent" : "border-line-strong text-muted hover:text-fg")}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-faint">
          {compact(t.total)} tokens · ≈ {usd(today.apiValue.valueUsd)} at API prices{today.apiValue.unpricedModels.length ? " (some models unpriced)" : ""}
        </span>
      </div>
      <div>
        {range === "today" ? <SectionTitle>Tokens per hour (today)</SectionTitle> : <SectionTitle>Tokens per day</SectionTitle>}
        {range !== "today" ? (
          <DayBars points={today.byDay} />
        ) : (
        <>
        <div className="flex h-20 items-end gap-px">
          {today.byHour.map((h, i) => (
            <div
              key={h.key}
              className={cx("flex-1 rounded-t-sm", i === now ? "bg-accent" : i > now ? "bg-hover/40" : "bg-accent/45")}
              style={{ height: `${Math.max(2, (h.total / max) * 100)}%` }}
              title={`${h.key}:00 — ${compact(h.total)} tokens (in ${compact(h.input)} · out ${compact(h.output)} · cache ${compact(h.cacheRead + h.cacheWrite)})`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-faint"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
        </>
        )}
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11.5px]">
          <span className="text-muted">Input / output</span><span className="tabular">{compact(t.input)} / {compact(t.output)}</span>
          <span className="text-muted">Cache read / write</span><span className="tabular">{compact(t.cacheRead)} / {compact(t.cacheWrite)}</span>
          {t.reasoning > 0 && <><span className="text-muted">Reasoning</span><span className="tabular">{compact(t.reasoning)}</span></>}
          <span className="text-muted">Cache hit rate</span><span className="tabular">{pct(today.cacheHitRatio)}</span>
          {range === "today" && <><span className="text-muted">Busiest hour</span><span className="tabular">{busiest && busiest.total > 0 ? `${busiest.key}:00 (${compact(busiest.total)})` : "–"}</span></>}
          <span className="text-muted">API-equivalent value</span>
          <span className="tabular" title={today.apiValue.unpricedModels.length ? `No price for: ${today.apiValue.unpricedModels.join(", ")} (Settings → API prices)` : "What these tokens would cost at the public API list prices (your subscription costs the same regardless)"}>
            {usd(today.apiValue.valueUsd)}
            {today.apiValue.unpricedModels.length > 0 && (
              <button className="ml-1 text-[10.5px] text-accent hover:underline" onClick={() => useApp.getState().setView("settings")}>
                + {today.apiValue.unpricedModels.length} unpriced
              </button>
            )}
          </span>
        </div>
      </div>
      <div>
        <SectionTitle>By account</SectionTitle>
        <div className="space-y-1">{today.byAccount.length ? today.byAccount.map(row) : <p className="text-[11.5px] text-faint">No usage in this period.</p>}</div>
      </div>
      <div>
        <SectionTitle right={<button className="text-[11px] text-accent hover:underline" onClick={() => useApp.getState().setView("usage")}>Usage →</button>}>By model</SectionTitle>
        <div className="space-y-1">{today.byModel.slice(0, 8).map(row)}</div>
      </div>
      <div className="lg:col-span-3">
        <SectionTitle>Agents today</SectionTitle>
        <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
          <span><span className="text-muted">Turns</span> <b className="tabular">{turns}</b></span>
          <span title="Sum over all agents: from your prompt until the agent finished"><span className="text-muted">Working</span> <b className="tabular">{duration(totalWork)}</b></span>
          <span title="Sum over all agents: from finishing until your next prompt (gaps over 2 h are capped)"><span className="text-muted">Waited for you</span> <b className={cx("tabular", totalWait > totalWork && totalWait > 10 * 60_000 && "text-warn")}>{duration(totalWait)}</b></span>
          <span><span className="text-muted">Avg. per turn</span> <b className="tabular">{turns ? duration(totalWork / turns) : "–"}</b></span>
        </div>
        {agentsWithTurns.length > 0 && (
          <table className="w-full text-[11.5px]">
            <thead className="text-left text-[10.5px] text-faint">
              <tr><th className="font-medium">Agent</th><th className="font-medium">Turns</th><th className="font-medium">Working</th><th className="font-medium">Waited for you</th><th className="font-medium">Files</th><th className="font-medium">Questions</th></tr>
            </thead>
            <tbody>
              {agentsWithTurns.map((x) => (
                <tr key={x.sessionId} className="tabular">
                  <td className="max-w-[220px] truncate py-0.5">{x.sessionName ?? "session"}</td>
                  <td>{x.turns}</td>
                  <td>{duration(x.workingMs)}</td>
                  <td className={cx(x.waitingMs > x.workingMs && x.waitingMs > 10 * 60_000 && "text-warn")}>{duration(x.waitingMs)}</td>
                  <td>{x.files}</td>
                  <td title="Permission / input requests">{x.inputs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function DayBars({ points }: { points: { key: string; total: number }[] }) {
  const list = points.slice(-60);
  const max = Math.max(1, ...list.map((p) => p.total));
  if (!list.length) return <p className="text-[11.5px] text-faint">No usage in this period.</p>;
  return (
    <>
      <div className="flex h-20 items-end gap-px">
        {list.map((p, i) => (
          <div key={p.key} className={cx("flex-1 rounded-t-sm", i === list.length - 1 ? "bg-accent" : "bg-accent/45")} style={{ height: `${Math.max(2, (p.total / max) * 100)}%` }} title={`${p.key}: ${compact(p.total)} tokens`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint"><span>{list[0].key}</span><span>{list[list.length - 1].key}</span></div>
    </>
  );
}

/** Where is there quota left? Usage per window, reset time, pace and forecast per account. */
function QuotaStrip({ history, today }: { history: Record<string, QuotaWindow[]>; today: UsageSummary | null }) {
  const accounts = useApp((s) => s.accounts);
  const quota = useApp((s) => s.quota);
  const sessions = useApp((s) => s.sessions);
  const [open, setOpen] = useState<string | null>(null);
  if (!accounts.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-start gap-2">
      {accounts.map((a) => {
        const all = quota[a.id] ?? [];
        const q = all.filter((w) => !w.resetsAt || w.resetsAt * 1000 > Date.now()).sort((x, y) => (x.windowMinutes ?? 0) - (y.windowMinutes ?? 0));
        // Windows whose reset passed: a new window started, the CLI reports it with the next answer.
        const renewed = all.filter((w) => w.resetsAt && w.resetsAt * 1000 <= Date.now() && !q.some((x) => x.window === w.window));
        const limitedSession = Object.values(sessions).find((s) => s.accountId === a.id && s.kind === "agent" && (s.runtime?.status ?? s.status) === "rate-limited");
        const full = q.some((w) => w.usedPercent >= 100);
        const paces = q.map((w) => paceOf(history[a.id] ?? [], w));
        const warn = paces.some((p) => p.beforeReset);
        const expanded = open === a.id;
        const tokens = today?.byAccount.find((g) => g.key === a.id)?.totals.total ?? 0;
        const running = Object.values(sessions).filter((s) => s.accountId === a.id && s.kind === "agent" && s.runtime?.running);
        const hover = [
          `${a.name} — ${a.authDetail ?? a.authStatus}`,
          ...q.map((w, i) => {
            const p = paces[i];
            return `${windowLabel(w.window, w.windowMinutes)}: ${w.usedPercent.toFixed(0)}% · resets ${resetLabel(w.resetsAt)} (${untilLabel(w.resetsAt)})${p.perHour != null ? ` · +${p.perHour.toFixed(1)}%/h` : ""}${p.fullAt ? ` · full ~${new Date(p.fullAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}`;
          }),
          `Tokens today: ${compact(tokens)} · ${running.length} running session${running.length === 1 ? "" : "s"}`,
          "Click for details",
        ].join("\n");
        return (
          <Card key={a.id} className={cx("min-w-[240px] flex-1", warn && "border-warn/50", (full || limitedSession) && "border-err/50", expanded && "border-accent/50")}>
            <button className="w-full px-3 py-2 text-left" onClick={() => setOpen(expanded ? null : a.id)} title={hover}>
              <div className="mb-1 flex items-center gap-1.5 text-[12px]">
                <ProviderMark provider={a.provider} />
                <b className="truncate">{a.name}</b>
                {tokens > 0 && <span className="text-[11px] text-faint tabular">{compact(tokens)} today</span>}
                <span className={cx("ml-auto h-1.5 w-1.5 shrink-0 rounded-full", a.authStatus === "connected" ? "bg-ok" : "bg-err")} />
                <ChevronDown size={12} className={cx("shrink-0 text-faint transition-transform", expanded && "rotate-180")} />
              </div>
              {q.length === 0 && renewed.length === 0 ? (
                <div className="text-[11px] text-faint">{a.provider === "custom" ? "No quota data for custom CLIs" : "No quota data yet"}</div>
              ) : (
                q.map((w, i) => (
                  <div key={w.window} className="flex items-center gap-2 text-[11px]">
                    <span className="w-14 shrink-0 text-muted">{windowLabel(w.window, w.windowMinutes).replace(" window", "")}</span>
                    <div className="flex-1"><Meter value={w.usedPercent} /></div>
                    <span className="w-9 text-right tabular">{w.usedPercent.toFixed(0)}%</span>
                    <span className={cx("w-[72px] shrink-0 text-right tabular", paces[i].beforeReset ? "text-warn" : "text-faint")} title={`Resets ${resetLabel(w.resetsAt)}`}>
                      {w.resetsAt ? `↻ ${untilLabel(w.resetsAt).replace("in ", "")}` : ""}
                    </span>
                  </div>
                ))
              )}
              {renewed.map((w) => (
                <div key={`r-${w.window}`} className="flex items-center gap-2 text-[11px] text-faint" title="Claude and Codex report their quota with each answer — the new window appears after the next reply">
                  <span className="w-14 shrink-0">{windowLabel(w.window, w.windowMinutes).replace(" window", "")}</span>
                  <span className="min-w-0 flex-1 truncate">new window since {resetLabel(w.resetsAt)} · no data yet</span>
                </div>
              ))}
              {limitedSession && !full && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-err" title={limitedSession.runtime?.attention ?? ""}>
                  <AlertTriangle size={11} /> Limit reached ({limitedSession.name})
                  {limitedSession.runtime?.autoContinueAt ? ` · continues ${resetLabel(Math.floor(limitedSession.runtime.autoContinueAt / 1000))}` : ""}
                </div>
              )}
              {warn && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-warn">
                  <AlertTriangle size={11} /> At this pace the limit is reached before the reset
                </div>
              )}
            </button>
            {expanded && (
              <div className="space-y-2 border-t border-line px-3 py-2 text-[11.5px]">
                {q.map((w, i) => {
                  const p = paces[i];
                  return (
                    <div key={w.window}>
                      <div className="font-medium">{windowLabel(w.window, w.windowMinutes)}</div>
                      <div className="grid grid-cols-[110px_1fr] gap-x-2 text-muted">
                        <span>Used</span><span className="text-fg tabular">{w.usedPercent.toFixed(1)}%</span>
                        <span>Resets</span><span className="text-fg">{w.resetsAt ? `${resetLabel(w.resetsAt)} · ${untilLabel(w.resetsAt)}` : "unknown"}</span>
                        <span>Pace (last hour)</span><span className="text-fg tabular">{p.perHour != null ? `+${p.perHour.toFixed(1)} %/h` : "not enough data yet"}</span>
                        <span>Forecast</span>
                        <span className={cx(p.beforeReset ? "text-warn" : "text-fg")}>
                          {p.fullAt ? `100% at ~${new Date(p.fullAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}${p.beforeReset ? " — before the reset" : " — after the reset, fine"}` : p.perHour != null ? "not rising" : "–"}
                        </span>
                        <span>Updated</span><span className="text-fg">{ago(w.capturedAt)} · {w.source}</span>
                      </div>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[110px_1fr] gap-x-2 text-muted">
                  <span>Tokens today</span><span className="text-fg tabular">{tokens.toLocaleString()}</span>
                  <span>Running now</span><span className="truncate text-fg">{running.length ? running.map((s) => s.name).join(", ") : "none"}</span>
                  <span>Login</span><span className="text-fg">{a.authDetail ?? a.authStatus}</span>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function sinceLabel(s: Session): string | null {
  const rt = s.runtime;
  const status = rt?.status ?? s.status;
  if (status === "working" && rt?.turnStartedAt) return `for ${duration(Date.now() - rt.turnStartedAt)}`;
  if (status === "waiting-for-input" && rt?.turnEndedAt) return `since ${ago(rt.turnEndedAt)}`.replace("since just now", "just now");
  return null;
}

function AgentCard({ s, live, tokens, stats }: { s: Session; live?: Activity[]; tokens?: number; stats?: SessionStats }) {
  const acc = useApp((st) => st.accounts.find((a) => a.id === s.accountId));
  const project = useApp((st) => st.projects.find((p) => p.id === s.projectId));
  const voiceHere = useApp((st) => st.voice.target === s.id && st.voice.state === "recording");
  const [reply, setReply] = useState("");
  const [histIdx, setHistIdx] = useState(-1);
  const test = useApp((st) => st.testResults[s.id]);
  const rt = s.runtime;
  const status = rt?.status ?? s.status;
  const running = !!rt?.running;
  const waiting = running && status === "waiting-for-input";
  const lastFiles = useMemo(() => (live ?? []).filter((a) => a.kind === "file").slice(-3).reverse(), [live]);
  const send = async () => {
    if (!reply.trim()) return;
    rememberPrompt(reply);
    if (await useApp.getState().queueInput(s.id, reply.trim())) {
      setReply("");
      setHistIdx(-1);
    }
  };
  // ↑ / ↓ walk through earlier commands (like a shell).
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void send();
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const list = promptHistory();
      if (!list.length) return;
      e.preventDefault();
      const next = e.key === "ArrowUp" ? Math.min(list.length - 1, histIdx + 1) : histIdx - 1;
      setHistIdx(next);
      setReply(next < 0 ? "" : list[next]);
    }
  };
  return (
    <Card className={cx("flex flex-col", waiting && "border-ok/50", status === "rate-limited" && "border-warn/50", voiceHere && "border-err/70")}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <ProviderMark provider={s.provider} />
        <button className="min-w-0 truncate text-left text-[13px] font-semibold hover:underline" onClick={() => useApp.getState().showSession(s.id)} title="Open in the workspace">
          {s.name}
        </button>
        <span className="min-w-0 truncate text-[11.5px] text-muted">{[acc?.name, project?.name].filter(Boolean).join(" · ")}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <StatusDot status={status} withLabel />
          {sinceLabel(s) && <span className="text-[11px] text-faint">{sinceLabel(s)}</span>}
        </span>
      </div>
      <div className="flex-1 space-y-2 px-3 py-2.5 text-[12.5px]">
        {status === "working" ? (
          <div className="flex items-center gap-2 text-accent">
            <Loader2 size={14} className="shrink-0 animate-spin" />
            <span className="truncate">{rt?.currentActivity ?? "Working…"}</span>
          </div>
        ) : waiting ? (
          <div className="flex items-center gap-2 text-ok"><CheckCircle2 size={14} /> {rt?.notice ?? "Ready for your next command"}</div>
        ) : status === "rate-limited" ? (
          <div className="flex items-center gap-2 text-warn">
            <Hourglass size={14} /> Usage limit{rt?.autoContinueAt ? ` · continues ${resetLabel(Math.floor(rt.autoContinueAt / 1000))}` : ""}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted">{running ? <StatusDot status={status} withLabel /> : "Not running"}</div>
        )}
        {rt?.lastMessage && <p className="line-clamp-4 whitespace-pre-wrap text-muted">{rt.lastMessage}</p>}
        {rt?.lastPrompt && <p className="truncate text-[11.5px] text-faint" title={rt.lastPrompt}>You: {rt.lastPrompt}</p>}
        {lastFiles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {lastFiles.map((f) => (
              <span key={`${f.file}${f.ts}`} className="inline-flex items-center gap-1 rounded bg-hover px-1.5 py-0.5 font-mono text-[10.5px] text-muted" title={f.file ?? ""}>
                <FileCode2 size={10} /> {f.file?.split(/[\\/]/).pop()}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {(rt?.model ?? s.model) && <Badge>{rt?.model ?? s.model}</Badge>}
          {autonomyLabel(s.options?.autonomy) && <Badge tone={s.options?.autonomy === "full" ? "err" : "neutral"}>{autonomyLabel(s.options?.autonomy)}</Badge>}
          {rt?.contextPercent != null && <Badge tone={rt.contextPercent > 80 ? "warn" : "neutral"}>ctx {rt.contextPercent.toFixed(0)}%</Badge>}
          {rt?.turnFiles ? <Badge>{rt.turnFiles} file{rt.turnFiles === 1 ? "" : "s"} this turn</Badge> : null}
          {tokens ? <Badge title="Tokens this conversation used today (input + output + cache)">{compact(tokens)} tokens today</Badge> : null}
          {stats && stats.turns > 0 ? (
            <Badge title={`Today: ${stats.turns} turns, working ${duration(stats.workingMs)}, waited for you ${duration(stats.waitingMs)}`}>
              {stats.turns} turns · {duration(stats.workingMs)} work · {duration(stats.waitingMs)} waited
            </Badge>
          ) : null}
          {rt?.gitBranch && (
            <Badge title={`${rt.gitChanged ?? 0} uncommitted file(s) in this repository`}>
              <GitBranch size={10} className="mr-1" />{rt.gitBranch}{rt.gitChanged ? ` · ${rt.gitChanged} changed` : " · clean"}
            </Badge>
          )}
          {rt?.automation && (
            <Badge tone={rt.automation.state === "running" ? "accent" : "neutral"} title={rt.automation.note ?? ""}>
              <Repeat size={10} className="mr-1" /> {rt.automation.name} {rt.automation.sent}{rt.automation.total ? `/${rt.automation.total}` : ""}
            </Badge>
          )}
          {s.autoContinue && <Badge title="Continues automatically after usage limits">auto-continue</Badge>}
          {test && (
            <Badge tone={test.state === "ok" ? "ok" : test.state === "fail" ? "err" : "accent"} title={test.tail ? test.tail.slice(-1500) : "Automatic test run after the last turn"}>
              <FlaskConical size={10} className="mr-1" />{test.state === "running" ? "tests running…" : test.state === "ok" ? "tests green" : "tests red"}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 border-t border-line px-3 py-2">
        {running ? (
          <>
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={onKey}
              placeholder={waiting ? "Next command… (Enter, ↑ earlier ones)" : "Queue a message… (sent when ready)"}
              className="h-7 min-w-0 flex-1 rounded border border-line-strong bg-bg px-2 text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
            />
            {reply.trim() && <IconButton title="Send" onClick={() => void send()}><CornerDownLeft size={13} /></IconButton>}
            <Favorites text={reply} onPick={(t) => setReply(t)} />
            <IconButton title="Dictate" onClick={() => void toggleDictation(s.id)} className={cx(voiceHere && "bg-err/20 text-err")}><Mic size={13} /></IconButton>
            <IconButton title="Stop" onClick={() => void useApp.getState().stopSession(s.id)}><Square size={12} /></IconButton>
          </>
        ) : (
          <Button size="sm" onClick={() => { useApp.getState().showSession(s.id); void useApp.getState().startSession(s.id); }}>
            <Play size={12} /> {s.startedAt ? "Resume" : "Start"}
          </Button>
        )}
        {rt?.lastMessage && (
          <>
            <IconButton title="Read the answer aloud" onClick={() => speak(`${s.name}: ${summarize(rt.lastMessage ?? "")}`)}><Volume2 size={13} /></IconButton>
            <IconButton title="Pin this answer (Pins)" onClick={() => void pinAnswer(s)}><Pin size={13} /></IconButton>
            <PassOn s={s} />
          </>
        )}
        <IconButton title="Open in the workspace" onClick={() => useApp.getState().showSession(s.id)}><ExternalLink size={13} /></IconButton>
      </div>
    </Card>
  );
}

async function pinAnswer(s: Session) {
  const text = s.runtime?.lastMessage;
  if (!text) return;
  try {
    await api.pinSave({ text, sessionId: s.id, sessionName: s.name, projectId: s.projectId });
    useApp.getState().toast("Pinned — see Pins", "ok", { label: "Open pins", run: () => useApp.getState().setView("pins") });
  } catch (e) {
    useApp.getState().toast(errMsg(e), "error");
  }
}

/** ★ Favourite commands (= templates): insert one, or save the current text as a favourite. */
function Favorites({ text, onPick }: { text: string; onPick: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Template[]>([]);
  useEffect(() => {
    if (open) api.templatesList().then(setList).catch(() => {});
  }, [open]);
  const save = async () => {
    const t = text.trim();
    if (!t) return;
    await api.templateSave({ id: "", name: t.slice(0, 48), text: t, sort: 0 }).catch((e) => useApp.getState().toast(errMsg(e), "error"));
    useApp.getState().toast("Saved as favourite", "ok");
    setOpen(false);
  };
  return (
    <div className="relative">
      <IconButton title="Favourite commands" onClick={() => setOpen((o) => !o)}><Star size={13} /></IconButton>
      {open && (
        <div className="absolute right-0 bottom-7 z-30 max-h-72 w-72 overflow-auto rounded-md border border-line-strong bg-panel p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          {text.trim() && (
            <button className="mb-1 w-full rounded border border-dashed border-line-strong px-2 py-1 text-left text-[11.5px] text-accent hover:bg-hover" onClick={() => void save()}>
              ★ Save the current text as favourite
            </button>
          )}
          {list.map((t) => (
            <button key={t.id} className="block w-full truncate rounded px-2 py-1 text-left text-[12px] hover:bg-hover" title={t.text} onClick={() => { onPick(t.text); setOpen(false); }}>
              {t.name}
            </button>
          ))}
          {!list.length && <p className="px-2 py-1 text-[11.5px] text-faint">No favourites yet.</p>}
        </div>
      )}
    </div>
  );
}

/** Hand this agent's last answer to another agent (review it, or continue with it). */
function PassOn({ s }: { s: Session }) {
  const sessions = useApp((st) => st.sessions);
  const [open, setOpen] = useState(false);
  const others = Object.values(sessions).filter((x) => x.id !== s.id && x.kind === "agent" && x.runtime?.running);
  const send = async (to: Session, mode: "review" | "continue") => {
    setOpen(false);
    const result = s.runtime?.lastMessage ?? "";
    const text = mode === "review"
      ? `Bitte prüfe das folgende Ergebnis von ${s.name}. Suche nach Fehlern, Lücken und Risiken und behebe eindeutige Probleme direkt.\n\nErgebnis von ${s.name}:\n${result}`
      : `Hier ist das Ergebnis von ${s.name}. Mach damit weiter.\n\n${result}`;
    if (await useApp.getState().queueInput(to.id, text)) useApp.getState().toast(`${s.name} → ${to.name}`, "ok");
  };
  return (
    <div className="relative">
      <IconButton title={others.length ? "Pass this answer to another agent (review / continue)" : "No other agent is running"} disabled={!others.length} onClick={() => setOpen((o) => !o)}>
        <Forward size={13} />
      </IconButton>
      {open && (
        <div className="absolute right-0 bottom-7 z-30 w-64 rounded-md border border-line-strong bg-panel p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <div className="px-2 py-1 text-[10.5px] text-faint uppercase">Pass the answer to</div>
          {others.map((o) => (
            <div key={o.id} className="flex items-center gap-1.5 rounded px-2 py-1 text-[12px] hover:bg-hover">
              <ProviderMark provider={o.provider} />
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <button className="rounded border border-line-strong px-1.5 text-[11px] hover:border-accent" onClick={() => void send(o, "review")}>review</button>
              <button className="rounded border border-line-strong px-1.5 text-[11px] hover:border-accent" onClick={() => void send(o, "continue")}>continue</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ f, onDiff }: { f: RecentFile; onDiff: () => void }) {
  const toast = useApp((s) => s.toast);
  const parts = f.file.split(/[\\/]/);
  const name = parts.pop();
  const dir = parts.slice(-2).join("/");
  return (
    <div className="group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-hover">
      <FileCode2 size={13} className={cx("shrink-0", f.exists ? "text-muted" : "text-faint")} />
      <button className="min-w-0 flex-1 text-left" onClick={onDiff} title={f.file} disabled={!f.exists}>
        <span className={cx("block truncate text-[12.5px]", !f.exists && "text-faint line-through")}>{name}</span>
        <span className="block truncate text-[10.5px] text-faint">{dir} · {f.sessionName ?? "session"} · {ago(f.ts)}{f.edits > 1 ? ` · ${f.edits}×` : ""}</span>
      </button>
      {f.exists && (
        <span className="hidden gap-0.5 group-hover:flex">
          <IconButton title="Show changes" onClick={onDiff}><FileDiff size={12} /></IconButton>
          <IconButton title="Open in editor" onClick={() => void api.fileOpen(f.file).catch((e) => toast(errMsg(e), "error"))}><ExternalLink size={12} /></IconButton>
        </span>
      )}
    </div>
  );
}

const KIND_STYLE: Record<string, string> = {
  prompt: "text-accent",
  done: "text-ok",
  file: "text-fg",
  tool: "text-muted",
  input: "text-warn",
  limit: "text-warn",
  loop: "text-accent",
};

function Timeline({ items }: { items: TimelineItem[] }) {
  const sessions = useApp((s) => s.sessions);
  if (!items.length) return <p className="text-[12px] text-faint">Nothing yet.</p>;
  return (
    <ol className="space-y-1.5">
      {items.map((a, i) => (
        <li key={`${a.ts}-${i}`} className="text-[11.5px]">
          <span className="text-faint">{new Date(a.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>{" "}
          <span className="text-muted">{sessions[a.sessionId]?.name ?? a.sessionName ?? "session"}</span>{" "}
          <span className={cx(KIND_STYLE[a.kind] ?? "text-muted")}>
            {a.kind === "prompt" ? "▸ " : a.kind === "done" ? "✓ " : a.kind === "input" ? "⚠ " : ""}
            {a.kind === "done" ? (a.text ? a.text.slice(0, 140) + (a.text.length > 140 ? "…" : "") : "finished") : a.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DiffDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [d, setD] = useState<{ kind: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.fileDiff(path).then(setD).catch((e) => setErr(errMsg(e)));
  }, [path]);
  const lines = (d?.text ?? "").split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  return (
    <Modal
      title={path.split(/[\\/]/).pop() ?? path}
      onClose={onClose}
      width={900}
      footer={
        <>
          <span className="mr-auto self-center truncate font-mono text-[11px] text-faint" title={path}>{path}</span>
          <Button onClick={() => void api.fileOpen(path).catch((e) => setErr(errMsg(e)))}><ExternalLink size={12} /> Open in editor</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </>
      }
    >
      {err && <p className="text-[12.5px] text-err">{err}</p>}
      {!d && !err && <p className="text-[12.5px] text-muted">Loading…</p>}
      {d && (
        <>
          <p className="mb-2 text-[11.5px] text-muted">
            {d.kind === "diff" ? <>Uncommitted changes · <span className="text-ok">+{compact(added)}</span> <span className="text-err">−{compact(removed)}</span></> : d.kind === "new" ? "New file (not in git yet)" : "No uncommitted changes — already committed"}
          </p>
          <pre className="max-h-[60vh] overflow-auto rounded border border-line bg-term p-2 font-mono text-[11.5px] leading-[1.45]">
            {lines.map((l, i) => (
              <div
                key={i}
                className={cx(
                  d.kind === "diff" && l.startsWith("+") && !l.startsWith("+++") && "bg-ok/10 text-ok",
                  d.kind === "diff" && l.startsWith("-") && !l.startsWith("---") && "bg-err/10 text-err",
                  d.kind === "diff" && l.startsWith("@@") && "text-accent",
                )}
              >
                {l || " "}
              </div>
            ))}
          </pre>
        </>
      )}
    </Modal>
  );
}

