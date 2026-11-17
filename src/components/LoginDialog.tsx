import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ExternalLink, KeyRound, RotateCw, X } from "lucide-react";
import { useApp } from "../store";
import { api, type Account } from "../lib/api";
import { planOf } from "../lib/accountInfo";
import { providerInfo } from "../lib/providers";
import { STEP_LABELS, baselineOf, flowView, hasDeviceLogin, isLoggedIn, loginInstruction, procState, type StepState } from "../lib/loginFlow";
import * as terms from "../lib/terminals";
import { Button, ProviderMark, cx } from "./ui";
import { TerminalView } from "./TerminalView";

const POLL_MS = 2500;
const CLOSE_AFTER_MS = 2500;

function Step({ n, label, state }: { n: number; label: string; state: StepState }) {
  return (
    <div className={cx("flex items-center gap-1.5 text-[12px]", state === "pending" ? "text-faint" : state === "failed" ? "text-err" : state === "done" ? "text-ok" : "text-fg")}>
      <span
        className={cx(
          "flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[10.5px] font-semibold",
          state === "done" && "border-ok bg-ok/15",
          state === "active" && "border-accent bg-accent/15 text-accent",
          state === "failed" && "border-err bg-err/15",
          state === "pending" && "border-line-strong",
        )}
      >
        {state === "done" ? <Check size={11} /> : state === "failed" ? <X size={11} /> : n}
      </span>
      <span className={cx(state === "active" && "font-medium")}>{label}</span>
    </div>
  );
}

/**
 * Guided login for one account, shown over the Accounts view: the login terminal is embedded
 * (type or paste a code into it), the success is detected by polling the CLI's own status.
 * The Workspace is never switched to.
 */
export function LoginDialog({ account, device: initialDevice = false, onClose }: { account: Account; device?: boolean; onClose: () => void }) {
  const live = useApp((s) => s.accounts.find((a) => a.id === account.id)) ?? account;
  const baseline = useRef(baselineOf(account));
  const [device, setDevice] = useState(initialDevice);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const session = useApp((s) => (sessionId ? s.sessions[sessionId] : undefined));
  const [startError, setStartError] = useState(false);
  const [polled, setPolled] = useState<Account | null>(null);
  const [finalChecked, setFinalChecked] = useState(false);
  const [now, setNow] = useState(Date.now());
  const startedAt = useRef(Date.now());
  const sessionRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const began = useRef(false);
  const successHandled = useRef(false);
  const checking = useRef(false);
  const exitChecked = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const closeSessionNow = useCallback(async () => {
    const id = sessionRef.current;
    sessionRef.current = null;
    if (id) await useApp.getState().closeSession(id);
  }, []);

  const start = useCallback(async (dev: boolean) => {
    setStartError(false);
    setFinalChecked(false);
    setPolled(null);
    exitChecked.current = null;
    await closeSessionNow();
    if (!mounted.current) return;
    setSessionId(null);
    setDevice(dev);
    startedAt.current = Date.now();
    const s = await useApp.getState().openUtility(dev ? "login-device" : "login", account.id, { show: false });
    if (!mounted.current) {
      if (s) void useApp.getState().closeSession(s.id);
      return;
    }
    if (!s) { setStartError(true); return; }
    sessionRef.current = s.id;
    setSessionId(s.id);
  }, [account.id, closeSessionNow]);

  // Start the login once; close the session when the dialog really goes away (a StrictMode
  // re-mount sets `mounted` again before the deferred check runs).
  useEffect(() => {
    mounted.current = true;
    if (!began.current) {
      began.current = true;
      void start(initialDevice);
    }
    return () => {
      mounted.current = false;
      window.setTimeout(() => { if (!mounted.current) void closeSessionNow(); }, 0);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const proc = procState(session);
  const rt = session?.runtime;
  const cur = polled ?? live;
  const ok = (a: Account) => isLoggedIn({ baseline: baseline.current, status: a.authStatus, email: a.authEmail ?? null, proc, exitCode: session?.exitCode ?? null });
  const loggedIn = ok(cur) || ok(live);
  const done = loggedIn ? (ok(cur) ? cur : live) : cur;

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const a = await api.accountCheckAuth(account.id, true);
      if (mounted.current) setPolled(a);
    } catch { /* the next poll tries again */ }
    finally { checking.current = false; }
  }, [account.id]);

  // Poll the CLI's own auth check while the login is open.
  useEffect(() => {
    if (!sessionId || loggedIn || startError) return;
    const t = window.setInterval(() => { void check(); setNow(Date.now()); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [sessionId, loggedIn, startError, check]);

  // The process ended: one more check, then the result is final.
  useEffect(() => {
    if (!sessionId || proc !== "exited" || loggedIn || exitChecked.current === sessionId) return;
    exitChecked.current = sessionId;
    void check().then(() => { if (mounted.current) setFinalChecked(true); });
  }, [sessionId, proc, loggedIn, check]);

  // Success: tidy up the login session, show the result for a moment, then close.
  useEffect(() => {
    if (!loggedIn || successHandled.current) return;
    successHandled.current = true;
    void useApp.getState().refreshAccounts();
    window.setTimeout(() => void closeSessionNow(), 150);
    window.setTimeout(() => { if (mounted.current) onCloseRef.current(); }, CLOSE_AFTER_MS);
  }, [loggedIn, closeSessionNow]);

  const cancel = useCallback(() => {
    void closeSessionNow();
    void useApp.getState().refreshAccounts();
    onClose();
  }, [closeSessionNow, onClose]);

  // Esc cancels, but not while the terminal has focus (the CLI may need Esc).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.(".xterm")) return;
      cancel();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [cancel]);

  const view = flowView({
    loggedIn,
    proc,
    hasLoginUrl: !!rt?.loginUrl,
    elapsedMs: now - startedAt.current,
    finalChecked,
    startError,
  });
  const info = providerInfo(account.provider);
  const plan = planOf(done);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[8vh]">
      <div role="dialog" aria-label={`Log in to ${account.name}`} className="flex max-h-[84vh] w-[760px] max-w-[96vw] flex-col rounded-md border border-line-strong bg-panel shadow-2xl">
        <div className="flex h-9 items-center gap-2 border-b border-line px-3">
          <ProviderMark provider={account.provider} />
          <span className="text-[13px] font-semibold">Log in · {live.name}</span>
          <span className="text-[11.5px] text-faint">{info?.label ?? account.provider}</span>
        </div>

        <div className="space-y-3 overflow-auto p-3">
          <p className="text-[12px] text-muted">{loginInstruction(account.provider, live.name, device)}</p>

          <div className="flex items-center gap-4">
            {view.steps.map((s, i) => <Step key={i} n={i + 1} label={STEP_LABELS[i]} state={s} />)}
          </div>

          {view.phase === "success" ? (
            <div className="flex items-center gap-3 rounded border border-ok/40 bg-ok/8 px-3 py-4">
              <CheckCircle2 size={22} className="text-ok" />
              <div className="min-w-0 text-[12.5px]">
                <div className="font-semibold text-ok">Logged in</div>
                <div className="truncate text-muted">
                  {done.authEmail ? <>Signed in as <b className="text-fg">{done.authEmail}</b></> : done.authDetail ?? "The CLI reports a connected account."}
                  {plan && <> · plan <b className="text-fg">{plan}</b></>}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className={cx("text-[12px]", view.phase === "failed" ? "text-err" : "text-muted")} aria-live="polite">{view.headline}</div>
              <div className="relative h-[300px] overflow-hidden rounded border border-line bg-bg">
                {sessionId ? (
                  <TerminalView id={sessionId} onReady={() => terms.focus(sessionId)} />
                ) : (
                  <div className="p-3 text-[12px] text-faint">{startError ? "No login terminal. See the message above." : "Starting the login…"}</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-3 py-2">
          {view.phase !== "success" && (
            <>
              {proc === "running" && rt?.loginUrl && (
                <Button size="sm" variant="primary" onClick={() => sessionId && void useApp.getState().openLoginPrivately(sessionId)} title="Opens the official login page in a fresh private browser window, so you can pick the right account">
                  <ExternalLink size={12} /> Open login in private window
                </Button>
              )}
              {hasDeviceLogin(account.provider) && (
                <Button size="sm" onClick={() => void start(!device)} title="Switch between the browser login and a short code you enter in any browser window">
                  <KeyRound size={12} /> {device ? "Use browser login" : "Device code login"}
                </Button>
              )}
              {(view.phase === "failed" || proc === "exited") && (
                <Button size="sm" onClick={() => void start(device)}><RotateCw size={12} /> Try again</Button>
              )}
              <span className="flex-1" />
            </>
          )}
          <Button variant={view.phase === "success" ? "primary" : "ghost"} onClick={view.phase === "success" ? onClose : cancel}>
            {view.phase === "success" ? "Close" : "Cancel"}
          </Button>
        </div>
      </div>
    </div>
  );
}
