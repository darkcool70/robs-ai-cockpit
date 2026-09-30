import { useApp } from "../store";
import { cx } from "./ui";
import { currentWindows, resetLabel } from "../lib/format";

const AUTH_DOT: Record<string, string> = {
  connected: "bg-ok",
  "connected-api": "bg-warn",
  "logged-out": "bg-err",
  expired: "bg-err",
  error: "bg-err",
  unknown: "bg-faint",
};

export function StatusBar() {
  const accounts = useApp((s) => s.accounts);
  const quota = useApp((s) => s.quota);
  const sessions = useApp((s) => s.sessions);
  const clis = useApp((s) => s.clis);
  const setView = useApp((s) => s.setView);
  const running = Object.values(sessions).filter((s) => s.runtime?.running).length;

  return (
    <footer className="flex h-6 items-center gap-4 border-t border-line bg-panel px-2 text-[11px] text-muted">
      <button className="flex items-center gap-1.5 hover:text-fg" onClick={() => setView("accounts")}>
        {accounts.length === 0 && <span className="text-faint">No accounts — add one in Accounts</span>}
        {accounts.map((a) => {
          const q = currentWindows(quota[a.id]);
          const five = q.find((w) => w.window === "five_hour");
          const week = q.find((w) => w.window === "seven_day");
          const limited = Object.values(sessions).some((s) => s.accountId === a.id && (s.runtime?.status ?? s.status) === "rate-limited");
          return (
            <span key={a.id} className="mr-3 flex items-center gap-1.5" title={`${a.name}: ${a.authDetail ?? a.authStatus}`}>
              <span className={cx("h-1.5 w-1.5 rounded-full", AUTH_DOT[a.authStatus] ?? "bg-faint")} />
              <span className="text-fg/90">{a.name}</span>
              {five && (
                <span className={cx("tabular", five.usedPercent >= 90 ? "text-err" : five.usedPercent >= 70 ? "text-warn" : "")} title={`5h window, resets ${resetLabel(five.resetsAt)}`}>
                  5h {five.usedPercent.toFixed(0)}%
                </span>
              )}
              {limited && !(five && five.usedPercent >= 100) && <span className="text-err" title="A session of this account reports its usage limit">limit</span>}
              {week && (
                <span className="tabular" title={`Weekly, resets ${resetLabel(week.resetsAt)}`}>
                  wk {week.usedPercent.toFixed(0)}%
                </span>
              )}
            </span>
          );
        })}
      </button>
      <span className="ml-auto flex items-center gap-3">
        {clis.map((c) => (
          <span key={c.provider} title={c.path ?? "not found"} className={c.path ? "" : "text-err"}>
            {c.provider} {c.version ? c.version.replace(/\s*\(.*\)/, "").replace(/^codex-cli /, "") : "missing"}
          </span>
        ))}
        <span>{running} running</span>
        <span title="The cockpit sends no telemetry">telemetry off</span>
        <button className="rounded px-1 hover:bg-hover hover:text-fg" title="Keyboard & voice shortcuts (F1)" onClick={() => useApp.getState().setCheatsheet(true)}>F1 ?</button>
      </span>
    </footer>
  );
}
