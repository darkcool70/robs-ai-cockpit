import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, ChevronDown, RefreshCw, Settings2, Terminal, UserRound } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type Account, type QuotaWindow } from "../lib/api";
import { accountSummary, planOf, tightest, windowInfos, type WindowInfo } from "../lib/accountInfo";
import { ago, resetLabel, shortPath } from "../lib/format";
import { autonomyLabel } from "../lib/models";
import { providerInfo } from "../lib/providers";
import { Badge, Meter, cx } from "./ui";

const AUTH_TONE: Record<string, { label: string; tone: "ok" | "warn" | "err" | "neutral" }> = {
  connected: { label: "Connected", tone: "ok" },
  "connected-api": { label: "API login", tone: "warn" },
  "logged-out": { label: "Logged out", tone: "err" },
  expired: { label: "Login expired", tone: "err" },
  error: { label: "Error", tone: "err" },
  unknown: { label: "Not checked", tone: "neutral" },
};

const WIDTH = 340;

/**
 * The account in a pane header: hover for a summary, click for login, plan, quota with countdown,
 * this session's settings, and switching the conversation to another account.
 */
export function AccountChip({ sessionId }: { sessionId: string }) {
  const s = useApp((st) => st.sessions[sessionId]);
  const acc = useApp((st) => st.accounts.find((a) => a.id === st.sessions[sessionId]?.accountId));
  const windows = useApp((st) => (acc ? st.quota[acc.id] : undefined));
  // The chip element while the panel is open (it anchors the panel); null when closed.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = !!anchor;
  if (!s || !acc) return null;
  const infos = windowInfos(windows);
  const top = tightest(infos);
  const auth = AUTH_TONE[acc.authStatus] ?? AUTH_TONE.unknown;
  return (
    <>
      <button
        onClick={(e) => setAnchor(open ? null : e.currentTarget)}
        title={open ? undefined : accountSummary(acc, infos)}
        className={cx(
          "flex min-w-0 shrink items-center gap-1 rounded px-1 text-muted hover:bg-hover hover:text-fg @max-[420px]:hidden",
          open && "bg-hover text-fg",
        )}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: acc.color ?? providerInfo(acc.provider)?.color ?? "var(--color-faint)" }} />
        <span className="min-w-0 truncate">{acc.name}</span>
        {auth.tone === "err" && <span className="shrink-0 text-[10.5px] text-err">{auth.label.toLowerCase()}</span>}
        {top && (
          <span className={cx("shrink-0 tabular text-[10.5px] @max-[620px]:hidden", top.used >= 90 || top.runsOut ? "text-err" : top.used >= 70 ? "text-warn" : "text-faint")}>
            {top.short} {top.used.toFixed(0)}%
          </span>
        )}
        <ChevronDown size={11} className="shrink-0 opacity-60" />
      </button>
      {anchor && <AccountPanel sessionId={sessionId} account={acc} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}

function AccountPanel({ sessionId, account: a, anchor, onClose }: { sessionId: string; account: Account; anchor: HTMLElement; onClose: () => void }) {
  const s = useApp((st) => st.sessions[sessionId]);
  const accounts = useApp((st) => st.accounts);
  const quota = useApp((st) => st.quota);
  const [history, setHistory] = useState<Record<string, QuotaWindow[]>>({});
  const [checking, setChecking] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.quotaHistory(6).then(setHistory).catch(() => {});
  }, []);
  // The header clips overflow, so the panel lives in a portal, placed under the chip.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8)) });
  }, [anchor]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  if (!s) return null;
  const st = useApp.getState();
  const infos = windowInfos(quota[a.id], history[a.id]);
  const plan = planOf(a);
  const auth = AUTH_TONE[a.authStatus] ?? AUTH_TONE.unknown;
  const rt = s.runtime;
  const others = accounts.filter((x) => x.provider === s.provider && x.id !== a.id);
  const hasConversation = !!(rt?.providerSessionId ?? s.providerSessionId) && !!s.startedAt;
  const sameAccount = Object.values(useApp.getState().sessions).filter((x) => x.kind === "agent" && !x.closed && x.accountId === a.id && x.runtime?.running).length;
  const best = bestOf(others, quota);

  const recheck = async () => {
    setChecking(true);
    try {
      await api.accountCheckAuth(a.id, true);
      await st.refreshAccounts();
    } catch (e) {
      st.toast(errMsg(e), "error");
    } finally {
      setChecking(false);
    }
  };
  const switchTo = (target: Account) => {
    if (!window.confirm(`Stop "${s.name}" and continue the same conversation on ${target.name}?`)) return;
    onClose();
    void st.handoffSession(sessionId, target.id, "continue");
  };
  const opts = s.options ?? {};
  const settings: [string, string][] = [
    ["Model", rt?.model ?? s.model ?? s.requestedModel ?? "CLI default"],
    ...(opts.effort ? [["Effort", opts.effort] as [string, string]] : []),
    ["Autonomy", autonomyLabel(opts.autonomy) ?? "CLI default"],
    ["Folder", s.worktreePath ? `${shortPath(s.worktreePath, 34)} (worktree)` : shortPath(s.cwd, 34)],
    ...(rt?.gitBranch ? [["Branch", rt.gitBranch] as [string, string]] : []),
    ["Auto-continue", s.autoContinue ? "on after limits" : "off"],
    ...(opts.fallbackModel ? [["Fallback", opts.fallbackModel] as [string, string]] : []),
    ...(opts.webSearch || opts.chrome ? [["Tools", [opts.webSearch && "web search", opts.chrome && "Chrome"].filter(Boolean).join(", ")] as [string, string]] : []),
  ];

  return createPortal(
    <div
      ref={panel}
      className="fixed z-50 max-h-[80vh] overflow-auto rounded-md border border-line-strong bg-panel text-[12px] shadow-2xl"
      style={{ top: pos.top, left: pos.left, width: WIDTH }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <UserRound size={15} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <b className="text-[13px]">{a.name}</b>
            {plan && <Badge tone="accent" title="Plan reported by the CLI">{plan}</Badge>}
            <Badge tone={auth.tone} title={a.authDetail ?? ""}>● {auth.label}</Badge>
          </div>
          <div className="truncate text-[11px] text-muted" title={a.authOrg ?? undefined}>
            {a.authEmail ? <>{a.authEmail}{a.authOrg && <span className="text-faint"> · {a.authOrg}</span>}</> : <span className="text-faint">{a.authDetail ?? "Login not checked yet"}</span>}
          </div>
          <div className="text-[10.5px] text-faint">
            Login checked {ago(a.authCheckedAt)} · {sameAccount} running session{sameAccount === 1 ? "" : "s"} on this account
          </div>
        </div>
      </div>

      <Section title="Quota">
        {infos.length === 0 ? (
          <p className="text-[11.5px] text-faint">
            {a.provider === "claude" ? "Appears after the first reply of a session." : a.provider === "codex" ? "Appears once Codex writes its rate limits." : "This CLI does not report its allowance."}
          </p>
        ) : (
          infos.map((w) => <QuotaRow key={w.key} w={w} />)
        )}
      </Section>

      <Section title="This session">
        <dl className="grid grid-cols-[92px_1fr] gap-y-0.5 text-[11.5px]">
          {settings.map(([k, v]) => (
            <Row key={k} k={k} v={v} />
          ))}
        </dl>
      </Section>

      {s.kind === "agent" && (
        <Section title="Continue on another account">
          {others.length === 0 ? (
            <p className="text-[11.5px] text-faint">No other {providerInfo(s.provider)?.label ?? ""} account. Add one under Accounts.</p>
          ) : (
            <>
              {!hasConversation && <p className="mb-1 text-[11px] text-faint">Send a first message before moving the conversation.</p>}
              {others.map((o) => {
                const oi = windowInfos(quota[o.id]);
                const ok = o.authStatus === "connected";
                return (
                  <button
                    key={o.id}
                    disabled={!hasConversation || !ok}
                    onClick={() => switchTo(o)}
                    title={ok ? `Stop this session and resume the conversation on ${o.name}` : "Log in to this account first"}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <ArrowRightLeft size={12} className="shrink-0 text-faint" />
                    <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-ok" : "bg-err")} />
                    <span className="min-w-0 flex-1 truncate">{o.name}{planOf(o) && <span className="text-faint"> · {planOf(o)}</span>}</span>
                    {o.id === best && <Badge tone="ok">most left</Badge>}
                    <span className="shrink-0 tabular text-[10.5px] text-faint">{oi.map((w) => `${w.short} ${w.used.toFixed(0)}%`).join(" · ") || "no data"}</span>
                  </button>
                );
              })}
              <p className="mt-1 text-[10.5px] text-faint">The transcript is copied locally into the other profile and resumed there.</p>
            </>
          )}
        </Section>
      )}

      <div className="flex flex-wrap gap-1 px-2 py-2">
        <PanelButton onClick={() => void recheck()} disabled={checking}><RefreshCw size={12} className={cx(checking && "animate-spin")} /> Re-check login</PanelButton>
        {a.provider !== "custom" && (
          <PanelButton onClick={() => { onClose(); void st.openUtility("status", a.id); }}><Terminal size={12} /> {a.provider === "claude" || a.provider === "codex" ? "/status" : "/usage"}</PanelButton>
        )}
        <PanelButton onClick={() => { onClose(); st.setView("accounts"); }}><Settings2 size={12} /> All accounts</PanelButton>
      </div>
    </div>,
    document.body,
  );
}

function QuotaRow({ w }: { w: WindowInfo }) {
  const full = w.pace.fullAt ? new Date(w.pace.fullAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-muted">{w.label}</span>
        <span className="tabular"><b>{w.used.toFixed(0)}%</b> used</span>
      </div>
      <Meter value={w.used} tone={w.runsOut ? "err" : undefined} />
      <div className="mt-0.5 flex justify-between gap-2 text-[10.5px] text-faint">
        <span>{w.resetsAt ? `Resets ${resetLabel(w.resetsAt)} · ${w.until}` : "Reset time unknown"}</span>
        {w.pace.perHour != null && <span className="tabular">+{w.pace.perHour.toFixed(1)}%/h</span>}
      </div>
      {w.runsOut && full && <div className="text-[10.5px] text-err">At this pace it runs out around {full}, before the reset.</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-line px-3 py-2.5">
      <div className="mb-1.5 text-[10.5px] font-semibold tracking-wider text-faint uppercase">{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-faint">{k}</dt>
      <dd className="truncate" title={v}>{v}</dd>
    </>
  );
}

function PanelButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} className="inline-flex h-7 items-center gap-1.5 rounded border border-line-strong px-2 text-[11.5px] hover:bg-hover disabled:opacity-50">
      {children}
    </button>
  );
}

/** The connected account whose fullest window is emptiest; null without quota data. */
function bestOf(candidates: Account[], quota: Record<string, QuotaWindow[]>): string | null {
  let best: { id: string; used: number } | null = null;
  for (const c of candidates) {
    if (c.authStatus !== "connected") continue;
    const t = tightest(windowInfos(quota[c.id]));
    if (t && (!best || t.used < best.used)) best = { id: c.id, used: t.used };
  }
  return best?.id ?? null;
}
