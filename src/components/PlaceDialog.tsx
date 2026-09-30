import { useEffect } from "react";
import { EyeOff, Play } from "lucide-react";
import { SLOTS, useApp } from "../store";
import type { Session } from "../lib/api";
import { ago } from "../lib/format";
import { rowsFor } from "./Workspace";
import { Button, Kbd, Modal, ProviderMark, StatusDot, cx } from "./ui";

/** How gladly a pane gives up its place: stopped first, then idle, then waiting; never a working agent. */
export function evictionScore(s: Session | undefined): number {
  if (!s) return 100;
  const rt = s.runtime;
  const status = rt?.status ?? s.status;
  if (!rt?.running) return 90;
  if (status === "working" || status === "starting") return 0;
  if (status === "rate-limited") return 60;
  if (status === "waiting-for-input") {
    // The longer nobody answered, the more likely it can move out.
    const idleMin = rt.turnEndedAt ? (Date.now() - rt.turnEndedAt) / 60_000 : 0;
    return 30 + Math.min(25, idleMin / 4);
  }
  return 50;
}

/** All panes are taken: pick which one makes room, or keep the new session in the background. */
export function PlaceDialog() {
  const id = useApp((s) => s.placeFor);
  const session = useApp((s) => (s.placeFor ? s.sessions[s.placeFor] : undefined));
  const panes = useApp((s) => s.panes);
  const sessions = useApp((s) => s.sessions);
  const mode = useApp((s) => s.mode);
  const pending = useApp((s) => (s.placeFor ? !!s.pendingStart[s.placeFor] : false));
  const close = () => useApp.getState().setPlaceFor(null);

  const scores = panes.map((p) => evictionScore(p ? sessions[p] : undefined));
  const best = scores.indexOf(Math.max(...scores));

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= panes.length) {
        e.preventDefault();
        useApp.getState().placeSession(id, n - 1);
      } else if (e.key === "Enter" && best >= 0) {
        e.preventDefault();
        useApp.getState().placeSession(id, best);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [id, panes.length, best]);

  if (!id || !session) return null;
  const rows = rowsFor(mode === "tabs" ? 1 : SLOTS[mode]);
  let first = 0;
  const background = () => {
    close();
    if (pending) void useApp.getState().startSession(id);
  };
  return (
    <Modal
      title={`Where should “${session.name}” go?`}
      onClose={close}
      width={720}
      footer={
        <>
          <span className="mr-auto self-center text-[11px] text-faint">
            <Kbd>1</Kbd>–<Kbd>{panes.length}</Kbd> choose · <Kbd>Enter</Kbd> suggestion · Settings → Workspace changes this behaviour
          </span>
          <Button onClick={background} title="Runs without a pane; drag it from the bar at the bottom whenever you want to see it">
            {pending ? <Play size={12} /> : <EyeOff size={12} />} {pending ? "Start in background" : "Keep in background"}
          </Button>
          <Button variant="ghost" onClick={close}>Cancel</Button>
        </>
      }
    >
      <p className="mb-3 text-[12.5px] text-muted">
        All {panes.length} panes are in use. Click the pane that should make room — that session keeps running and stays in the bar at the bottom.
      </p>
      <div className="flex flex-col gap-1.5">
        {rows.map((count, r) => {
          const start = first;
          first += count;
          return (
            <div key={r} className="flex gap-1.5">
              {Array.from({ length: count }, (_, c) => {
                const i = start + c;
                const s = panes[i] ? sessions[panes[i]!] : undefined;
                const rt = s?.runtime;
                const status = rt?.status ?? s?.status;
                const working = status === "working";
                return (
                  <button
                    key={i}
                    onClick={() => useApp.getState().placeSession(id, i)}
                    className={cx(
                      "flex min-h-[74px] min-w-0 flex-1 flex-col gap-1 rounded border p-2 text-left text-[12px] hover:border-accent hover:bg-accent/5",
                      i === best ? "border-accent/70 bg-accent/5" : "border-line-strong",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <Kbd>{i + 1}</Kbd>
                      {s && <ProviderMark provider={s.provider} />}
                      <b className="min-w-0 truncate">{s?.name ?? "empty"}</b>
                      {i === best && <span className="ml-auto shrink-0 text-[10.5px] text-accent">suggested</span>}
                    </span>
                    {s && (
                      <span className="flex items-center gap-1.5 text-muted">
                        <StatusDot status={status ?? "stopped"} withLabel />
                        {status === "waiting-for-input" && rt?.turnEndedAt ? <span className="text-faint">{ago(rt.turnEndedAt)}</span> : null}
                      </span>
                    )}
                    {working && <span className="text-[11px] text-warn">working right now — it keeps working in the background</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
