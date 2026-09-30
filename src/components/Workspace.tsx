import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  Copy, FolderOpen, GripVertical, PanelRight, Play, Plus, RotateCw, Square, SquareDashed, X, AppWindow, Pencil, LayoutGrid,
  Maximize2, Minimize2, MoreHorizontal, Type, Users, Send, Timer, TimerOff, ArrowRightLeft, ExternalLink, Hourglass, Mic, Keyboard, Repeat,
} from "lucide-react";
import { prettyHotkey, toggleDictation } from "../lib/voice";
import { MAX_PANES, SLOTS, isLayoutMode, modeFor, useApp } from "../store";
import { api, errMsg, type NamedLayout } from "../lib/api";
import { autonomyLabel } from "../lib/models";
import { resetLabel } from "../lib/format";
import { sessionDrag } from "../lib/drag";
import { TerminalView } from "./TerminalView";
import * as terms from "../lib/terminals";
import { Badge, Button, cx, IconButton, Kbd, ProviderMark, StatusDot } from "./ui";
import { Inspector } from "./Inspector";

/** Panes per row: up to 3 side by side, then two rows (5 = 3+2, 8 = 4+4). */
export function rowsFor(n: number): number[] {
  if (n <= 3) return [n];
  const top = Math.ceil(n / 2);
  return [top, n - top];
}

export function Workspace() {
  const mode = useApp((s) => s.mode);
  const panes = useApp((s) => s.panes);
  const openNewSession = useApp((s) => s.openNewSession);
  const setTeamOpen = useApp((s) => s.setTeamOpen);
  const setBroadcastOpen = useApp((s) => s.setBroadcastOpen);
  const runningAgents = useApp((s) => Object.values(s.sessions).filter((x) => x.kind === "agent" && x.runtime?.running).length);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const toggleInspector = useApp((s) => s.toggleInspector);
  const projects = useApp((s) => s.projects);
  const activeProjectId = useApp((s) => s.activeProjectId);
  const project = projects.find((p) => p.id === activeProjectId);

  const zoomed = useApp((s) => s.zoomed);
  const pane = (i: number) => <PaneView key={`slot-${i}`} index={i} id={panes[i] ?? null} />;

  let body;
  if (mode === "tabs") body = <TabsView />;
  else if (zoomed != null && panes[zoomed]) body = pane(zoomed);
  else if (mode === "1") body = pane(0);
  else {
    const rows = rowsFor(SLOTS[mode]);
    let first = 0;
    const rowGroups = rows.map((count, r) => {
      const start = first;
      first += count;
      return (
        <Group key={`row-${r}-${count}`} orientation="horizontal" className="h-full">
          {Array.from({ length: count }, (_, c) => (
            <Fragment key={start + c}>
              {c > 0 && <Separator className="w-px" />}
              <Panel minSize="8">{pane(start + c)}</Panel>
            </Fragment>
          ))}
        </Group>
      );
    });
    body = rows.length === 1 ? rowGroups[0] : (
      <Group key={`rows-${mode}`} orientation="vertical" className="h-full">
        {rowGroups.map((g, r) => (
          <Fragment key={r}>
            {r > 0 && <Separator className="h-px" />}
            <Panel minSize="10">{g}</Panel>
          </Fragment>
        ))}
      </Group>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <span className="truncate text-[12.5px] font-semibold">{project ? project.name : "No project selected"}</span>
        {project && <span className="truncate text-[11px] text-faint" title={project.path}>{project.path}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          <LayoutPicker />
          <span className="mx-1 h-4 w-px bg-line" />
          <IconButton title="Toggle inspector (git / usage)" onClick={toggleInspector} className={cx(inspectorOpen && "bg-hover text-fg")}>
            <PanelRight size={14} />
          </IconButton>
          <IconButton title="Send a message to several running agents" disabled={!runningAgents} onClick={() => setBroadcastOpen(true)}>
            <Send size={13} />
          </IconButton>
          <Button size="sm" className="ml-1" onClick={() => setTeamOpen(true)} title="Start several agents (e.g. 2× Claude + 1× Codex) in one project">
            <Users size={13} /> Team
          </Button>
          <Button variant="primary" size="sm" className="ml-1" onClick={() => openNewSession(null)}>
            <Plus size={13} /> New session <Kbd>Ctrl N</Kbd>
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">{body}</div>
        {inspectorOpen && (
          <div className="w-[300px] shrink-0 border-l border-line bg-panel">
            <Inspector />
          </div>
        )}
      </div>
      <SessionDock />
    </div>
  );
}

/** Mini previews of the grid (1–8 panes, tabs); the current one is highlighted. */
function LayoutPicker() {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  const n = mode === "tabs" ? 1 : SLOTS[mode];
  return (
    <div className="relative flex items-center gap-0.5" ref={ref}>
      <IconButton title="One pane less (sessions keep running)" disabled={mode === "tabs" || n <= 1} onClick={() => setMode(modeFor(n - 1))}>
        <span className="text-[14px] leading-none">−</span>
      </IconButton>
      <button
        className={cx("flex h-6 items-center gap-1.5 rounded px-1.5 text-[12px] text-muted hover:bg-hover hover:text-fg", open && "bg-hover text-fg")}
        title="Choose a layout"
        onClick={() => setOpen((o) => !o)}
      >
        {mode === "tabs" ? <AppWindow size={14} /> : <LayoutGrid size={14} />}
        <span className="tabular">{mode === "tabs" ? "Tabs" : `${n} pane${n === 1 ? "" : "s"}`}</span>
      </button>
      <IconButton title={`One pane more (up to ${MAX_PANES})`} disabled={mode !== "tabs" && n >= MAX_PANES} onClick={() => setMode(mode === "tabs" ? "2" : modeFor(n + 1))}>
        <Plus size={13} />
      </IconButton>
      {open && (
        <div className="absolute top-8 right-0 z-40 w-[288px] rounded-md border border-line-strong bg-panel p-2 shadow-xl">
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: MAX_PANES }, (_, i) => i + 1).map((k) => (
              <button
                key={k}
                onClick={() => { setMode(modeFor(k)); setOpen(false); }}
                className={cx("flex flex-col items-center gap-1 rounded border p-1.5 text-[11px] hover:bg-hover", mode === String(k) ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}
              >
                <GridPreview n={k} />
                {k} pane{k === 1 ? "" : "s"}
              </button>
            ))}
            <button
              onClick={() => { setMode("tabs"); setOpen(false); }}
              className={cx("flex flex-col items-center gap-1 rounded border p-1.5 text-[11px] hover:bg-hover", mode === "tabs" ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}
            >
              <span className="flex h-8 w-14 flex-col gap-px rounded-sm border border-current/40 p-px">
                <span className="flex h-1.5 gap-px"><span className="w-3 rounded-[1px] bg-current/60" /><span className="w-3 rounded-[1px] bg-current/25" /></span>
                <span className="flex-1 rounded-[1px] bg-current/40" />
              </span>
              Tabs
            </button>
          </div>
          <SavedWorkspaces onDone={() => setOpen(false)} />
          <p className="mt-2 text-[10.5px] leading-snug text-faint">
            Drag sessions from the bar at the bottom (or the sidebar) onto a pane. Hidden sessions keep running.
          </p>
        </div>
      )}
    </div>
  );
}

/** Named workspaces: which sessions sit in which pane, restored with one click. */
function SavedWorkspaces({ onDone }: { onDone: () => void }) {
  const [list, setList] = useState<NamedLayout[]>([]);
  const [name, setName] = useState("");
  const sessions = useApp((s) => s.sessions);
  const toast = useApp((s) => s.toast);
  const refresh = () => api.layoutsNamed().then(setList).catch(() => {});
  useEffect(() => { void refresh(); }, []);
  const save = async () => {
    const st = useApp.getState();
    try {
      await api.layoutNamedSave(name.trim(), st.mode, st.panes);
      setName("");
      await refresh();
      toast(`Workspace "${name.trim()}" saved`, "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const restore = (l: NamedLayout) => {
    const st = useApp.getState();
    if (!isLayoutMode(l.mode)) return;
    const saved = Array.isArray(l.panes) ? l.panes : [];
    const missing = saved.filter((id) => id && !st.sessions[id]).length;
    st.applyLayout(l.mode, saved);
    onDone();
    toast(`Workspace "${l.name}" restored${missing ? ` — ${missing} session${missing === 1 ? " was" : "s were"} closed meanwhile` : ""}`, missing ? "warn" : "ok");
  };
  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="mb-1 text-[10.5px] font-semibold tracking-wider text-faint uppercase">Saved workspaces</div>
      {list.map((l) => {
        const names = (Array.isArray(l.panes) ? l.panes : []).map((id) => (id ? sessions[id]?.name : null)).filter(Boolean);
        return (
          <div key={l.name} className="group flex items-center gap-1 rounded px-1 hover:bg-hover">
            <button className="min-w-0 flex-1 py-1 text-left text-[12px]" onClick={() => restore(l)} title={names.join(", ") || "no open sessions"}>
              <span className="block truncate">{l.name}</span>
              <span className="block truncate text-[10.5px] text-faint">{l.mode === "tabs" ? "tabs" : `${l.mode} panes`} · {names.length ? names.join(", ") : "sessions closed"}</span>
            </button>
            <IconButton title="Delete" className="opacity-0 group-hover:opacity-100" onClick={() => void api.layoutNamedDelete(l.name).then(refresh)}><X size={12} /></IconButton>
          </div>
        );
      })}
      <div className="mt-1 flex gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void save(); }}
          placeholder="Save current as… (e.g. Review)"
          className="h-6 min-w-0 flex-1 rounded border border-line-strong bg-bg px-1.5 text-[11.5px] placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <Button size="sm" disabled={!name.trim()} onClick={() => void save()}>Save</Button>
      </div>
    </div>
  );
}

function GridPreview({ n }: { n: number }) {
  return (
    <span className="flex h-8 w-14 flex-col gap-px rounded-sm border border-current/40 p-px">
      {rowsFor(n).map((count, r) => (
        <span key={r} className="flex flex-1 gap-px">
          {Array.from({ length: count }, (_, c) => <span key={c} className="flex-1 rounded-[1px] bg-current/40" />)}
        </span>
      ))}
    </span>
  );
}

/** All sessions at the bottom: click to show, drag onto a pane, drop on "+" for a new pane. */
function SessionDock() {
  const order = useApp((s) => s.order);
  const sessions = useApp((s) => s.sessions);
  const panes = useApp((s) => s.panes);
  const mode = useApp((s) => s.mode);
  const drag = useApp((s) => s.drag);
  const showSession = useApp((s) => s.showSession);
  const addPane = useApp((s) => s.addPane);
  const n = mode === "tabs" ? 1 : SLOTS[mode];
  if (!order.length) return null;
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-t border-line bg-panel px-2 text-[11.5px]">
      <span className="mr-1 shrink-0 text-[10.5px] font-semibold tracking-wider text-faint uppercase" title="Drag a session onto a pane">
        Sessions
      </span>
      {order.map((id) => {
        const s = sessions[id];
        if (!s) return null;
        const at = panes.indexOf(id);
        const status = s.runtime?.status ?? s.status;
        return (
          <button
            key={id}
            {...sessionDrag(id)}
            onClick={() => showSession(id)}
            title={`${s.name} — ${at >= 0 ? `shown in pane ${at + 1}` : "not on screen (keeps running)"}. Drag onto a pane to show it there.`}
            className={cx(
              "flex h-6 max-w-[190px] shrink-0 cursor-grab items-center gap-1.5 rounded border px-1.5 active:cursor-grabbing",
              at >= 0 ? "border-line bg-raised text-fg" : "border-dashed border-line-strong text-muted hover:text-fg",
              drag?.id === id && "opacity-40",
              status === "waiting-for-input" && s.runtime?.running && "border-ok/50",
            )}
          >
            <StatusDot status={status} />
            <span className="truncate">{s.name}</span>
            {at >= 0 && <span className="font-mono text-[10px] text-faint">{at + 1}</span>}
          </button>
        );
      })}
      {mode !== "tabs" && n < MAX_PANES && (
        <button
          data-drop="new"
          onClick={() => addPane()}
          title="Add a pane — or drop a session here to open it in a new pane"
          className={cx(
            "ml-1 flex h-6 shrink-0 items-center gap-1 rounded border border-dashed px-2",
            drag?.over === "new" ? "border-accent bg-accent/15 text-accent" : drag ? "border-accent/60 text-accent" : "border-line-strong text-faint hover:text-fg",
          )}
        >
          <Plus size={12} /> Pane
        </button>
      )}
    </div>
  );
}

/** Follows the pointer while a session is dragged. */
export function DragGhost() {
  const drag = useApp((s) => s.drag);
  const name = useApp((s) => (s.drag ? s.sessions[s.drag.id]?.name : null));
  const swap = useApp((s) => (s.drag && typeof s.drag.over === "number" ? s.panes[s.drag.over] : null));
  if (!drag || drag.id === "__files__") return null;
  const hint = drag.over === "new" ? "new pane" : typeof drag.over === "number" ? (swap && swap !== drag.id ? `pane ${drag.over + 1} (swap)` : `pane ${drag.over + 1}`) : "drop on a pane";
  // Above the pointer near the bottom edge (the dock), so it is never cut off.
  const below = drag.y < window.innerHeight - 80;
  return (
    <div
      className="pointer-events-none fixed z-[80] rounded border border-accent/60 bg-panel/95 px-2 py-1 text-[12px] whitespace-nowrap shadow-xl"
      style={{ left: Math.min(drag.x + 12, window.innerWidth - 260), top: below ? drag.y + 12 : drag.y - 40 }}
    >
      <b>{name}</b><span className={drag.over == null ? "text-faint" : "text-accent"}> → {hint}</span>
    </div>
  );
}

function TabsView() {
  const order = useApp((s) => s.order);
  const sessions = useApp((s) => s.sessions);
  const panes = useApp((s) => s.panes);
  const showSession = useApp((s) => s.showSession);
  const closeSession = useApp((s) => s.closeSession);
  const current = panes[0];
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-end gap-px overflow-x-auto border-b border-line bg-bg px-1">
        {order.map((id) => {
          const s = sessions[id];
          if (!s) return null;
          return (
            <div
              key={id}
              onClick={() => showSession(id)}
              className={cx(
                "group flex h-7 max-w-[220px] items-center gap-1.5 rounded-t border border-b-0 px-2 text-[12px]",
                id === current ? "border-line bg-panel text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              <StatusDot status={s.runtime?.status ?? s.status} />
              <span className="truncate">{s.name}</span>
              <button className="ml-1 opacity-0 group-hover:opacity-100" title="Close" onClick={(e) => { e.stopPropagation(); void closeSession(id); }}>
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="relative min-h-0 flex-1">
        <PaneView index={0} id={current ?? null} />
      </div>
    </div>
  );
}

function PaneView({ index, id }: { index: number; id: string | null }) {
  const session = useApp((s) => (id ? s.sessions[id] : undefined));
  const focused = useApp((s) => s.focused === index);
  const focusPane = useApp((s) => s.focusPane);
  const openNewSession = useApp((s) => s.openNewSession);
  const clearPane = useApp((s) => s.clearPane);
  const mode = useApp((s) => s.mode);
  const dictating = useApp((s) => !!id && s.voice.target === id && s.voice.state === "recording");
  const dropHere = useApp((s) => s.drag?.over === index);
  const dropFiles = useApp((s) => s.drag?.id === "__files__");
  const dragging = useApp((s) => !!s.drag);
  const hidden = useApp((s) => s.order.filter((x) => !s.panes.includes(x)).length);

  if (!id || !session) {
    return (
      <div
        data-drop={index}
        className={cx(
          "relative flex h-full flex-col items-center justify-center gap-2 bg-bg",
          focused && mode !== "1" && "ring-1 ring-accent/30 ring-inset",
          dropHere && "bg-accent/10 ring-2 ring-accent ring-inset",
        )}
        onMouseDown={() => focusPane(index)}
      >
        {mode !== "tabs" && mode !== "1" && (
          <IconButton title="Remove this empty pane" className="absolute top-1.5 right-1.5" onClick={() => useApp.getState().removePane(index)}>
            <X size={13} />
          </IconButton>
        )}
        <SquareDashed size={22} className={dropHere ? "text-accent" : "text-line-strong"} />
        {dragging ? (
          <span className="text-[12px] text-accent">Drop to show it in pane {index + 1}</span>
        ) : (
          <>
            <Button variant="ghost" onClick={() => openNewSession(index)}>
              <Plus size={14} /> New session
            </Button>
            {hidden > 0 && <span className="text-[11px] text-faint">or drag one of {hidden} running session{hidden === 1 ? "" : "s"} here from the bar below</span>}
          </>
        )}
        {mode !== "tabs" && <span className="text-[11px] text-faint">Pane {index + 1} · <Kbd>Ctrl {index + 1}</Kbd></span>}
      </div>
    );
  }
  return (
    <div
      data-drop={index}
      className={cx("@container relative flex h-full flex-col bg-term", focused && mode !== "1" && mode !== "tabs" && "ring-1 ring-accent/40 ring-inset", dictating && "ring-2 ring-err/70 ring-inset")}
      onMouseDown={() => focusPane(index)}
    >
      {dropHere && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-accent/10 ring-2 ring-accent ring-inset">
          <span className="rounded bg-panel px-2 py-1 text-[12px] text-accent shadow">
            {dropFiles ? `Drop: type the file path(s) into “${session.name}”` : `Drop: show here · “${session.name}” moves out (keeps running)`}
          </span>
        </div>
      )}
      <PaneHeader index={index} id={id} onHide={() => clearPane(index)} />
      <div className="relative min-h-0 flex-1">
        <TerminalView
          id={id}
          onReady={() => {
            const st = useApp.getState();
            if (st.pendingStart[id]) void st.startSession(id);
          }}
        />
        <StoppedOverlay id={id} />
      </div>
    </div>
  );
}

function PaneHeader({ index, id, onHide }: { index: number; id: string; onHide: () => void }) {
  const launching = useApp((st) => !!st.launching[id]);
  const s = useApp((st) => st.sessions[id]);
  const acc = useApp((st) => st.accounts.find((a) => a.id === s?.accountId));
  const test = useApp((st) => st.testResults[id]);
  const project = useApp((st) => st.projects.find((p) => p.id === s?.projectId));
  const { stopSession, restartSession, duplicateSession, renameSession, closeSession } = useApp.getState();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s?.name ?? "");
  if (!s) return null;
  const rt = s.runtime;
  const status = rt?.status ?? s.status;
  const running = !!rt?.running;
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 text-[12px] overflow-hidden"
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        // Double-click on the empty header area: focus mode (the name itself renames).
        if (e.target !== e.currentTarget) return;
        const st = useApp.getState();
        if (st.mode !== "1" && st.mode !== "tabs") st.setZoom(st.zoomed === index ? null : index);
      }}
    >
      <span {...sessionDrag(id)} className="flex shrink-0 cursor-grab items-center text-faint hover:text-fg active:cursor-grabbing" title="Drag onto another pane to swap">
        <GripVertical size={12} />
        <span className="font-mono text-[10px]">{index + 1}</span>
      </span>
      <ProviderMark provider={s.provider} />
      {editing ? (
        <input
          autoFocus
          className="h-6 w-40 rounded border border-accent bg-bg px-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { setEditing(false); if (name.trim() && name !== s.name) void renameSession(id, name.trim()); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setName(s.name); setEditing(false); } }}
        />
      ) : (
        <span className="max-w-[35%] min-w-[4.5rem] shrink-0 truncate font-medium" onDoubleClick={() => { setName(s.name); setEditing(true); }} title="Double-click to rename">
          {s.name}
        </span>
      )}
      <span className="min-w-0 truncate text-muted @max-[420px]:hidden" title={acc?.name}>{acc?.name}</span>
      {project && <span className="hidden truncate text-faint @min-[900px]:inline">{project.name}</span>}
      {(rt?.model ?? s.model) && <span className="@max-[560px]:hidden"><Badge>{rt?.model ?? s.model}</Badge></span>}
      {s.kind === "agent" && autonomyLabel(s.options?.autonomy) && (
        <Badge tone={s.options?.autonomy === "full" ? "err" : s.options?.autonomy === "auto" ? "accent" : "neutral"} title="Autonomy">{autonomyLabel(s.options?.autonomy)}</Badge>
      )}
      {rt?.contextPercent != null && <Badge title="Context window used (from Claude statusLine)">ctx {rt.contextPercent.toFixed(0)}%</Badge>}
      <span className="shrink-0 @max-[460px]:hidden"><StatusDot status={status} withLabel /></span><span className="shrink-0 @min-[460px]:hidden" title={status}><StatusDot status={status} /></span>
      {status === "working" && rt?.currentActivity && <span className="min-w-0 truncate text-[11.5px] text-accent" title={rt.currentActivity}>{rt.currentActivity}</span>}
      {rt?.notice && status !== "working" && <Badge tone="warn" title={rt.notice}>needs input</Badge>}
      {rt?.automation && (
        <button onClick={() => useApp.getState().setView("loops")} title={`${rt.automation.name}: ${rt.automation.note ?? rt.automation.state}`}>
          <Badge tone={rt.automation.state === "running" ? "accent" : "neutral"}>
            <Repeat size={10} className="mr-1" />{rt.automation.sent}{rt.automation.total ? `/${rt.automation.total}` : ""}
          </Badge>
        </button>
      )}
      {rt?.attention && status !== "rate-limited" && <Badge tone="warn">{rt.attention}</Badge>}
      {rt?.autoContinueAt != null && (
        <Badge tone="accent" title={rt.autoContinueNote ?? "Continues automatically"}>
          <Hourglass size={10} className="mr-1" /> continues {resetLabel(Math.floor(rt.autoContinueAt / 1000))}
        </Badge>
      )}
      {rt?.pendingInput && <Badge title="Queued text is typed as soon as the CLI is ready">queued</Badge>}
      {test && (
        <span className="@max-[560px]:hidden" title={test.tail ? test.tail.slice(-1500) : "Tests after the last turn"}>
          <Badge tone={test.state === "ok" ? "ok" : test.state === "fail" ? "err" : "accent"}>{test.state === "running" ? "tests…" : test.state === "ok" ? "tests ✓" : "tests ✗"}</Badge>
        </span>
      )}
      {s.kind === "login" && rt?.running && rt.loginUrl && (
        <Button size="sm" variant="primary" onClick={() => void useApp.getState().openLoginPrivately(id)} title="Opens the official login page in a fresh private browser window, so you can pick the right account">
          <ExternalLink size={12} /> Open login in private window
        </Button>
      )}
      <div className="ml-auto flex shrink-0 items-center">
        {s.kind === "agent" && (
          <>
            <span className="flex items-center @max-[680px]:hidden">
            <IconButton
              title={s.autoContinue ? `Auto-continue after limits: on${rt?.autoContinueNote ? ` (${rt.autoContinueNote})` : ""} — click to turn off` : "Auto-continue after limits: off — click to turn on"}
              onClick={() => void useApp.getState().setAutoContinue(id, !s.autoContinue)}
              className={cx(s.autoContinue && "text-accent")}
            >
              {s.autoContinue ? <Timer size={13} /> : <TimerOff size={13} />}
            </IconButton>
            <HandoffMenu id={id} />
            </span>
            <VoiceButton id={id} />
            <span className="flex items-center @max-[680px]:hidden">
            <IconButton title="Rename" onClick={() => { setName(s.name); setEditing(true); }}><Pencil size={12} /></IconButton>
            <IconButton title="Open working directory" onClick={() => void api.openKnownDir("cwd", id)}><FolderOpen size={13} /></IconButton>
            <IconButton title="Duplicate (new conversation, same account & directory)" onClick={() => void duplicateSession(id)}><Copy size={13} /></IconButton>
            </span>
            {running ? (
              <IconButton title="Stop" onClick={() => void stopSession(id)}><Square size={12} /></IconButton>
            ) : (
              <IconButton title="Start / resume" disabled={launching} onClick={() => void useApp.getState().startSession(id)}><Play size={13} /></IconButton>
            )}
            <span className="flex items-center @max-[680px]:hidden">
            <IconButton title="Restart (resumes the same conversation where supported)" disabled={launching} onClick={() => void restartSession(id)}><RotateCw size={13} /></IconButton>
            </span>
            <MoreMenu id={id} onRename={() => { setName(s.name); setEditing(true); }} />
          </>
        )}
        <ZoomButton index={index} />
        <IconButton title="Hide from this pane (keeps running)" onClick={onHide}><SquareDashed size={13} /></IconButton>
        <IconButton title={running ? "Stop and close" : "Close"} onClick={() => void closeSession(id)}><X size={14} /></IconButton>
      </div>
    </div>
  );
}

/** Dictate into this session; the small key shows / sets its own shortcut. */
function VoiceButton({ id }: { id: string }) {
  const hotkey = useApp((st) => st.sessions[id]?.voiceHotkey ?? null);
  const active = useApp((st) => st.voice.target === id && st.voice.state !== "idle");
  const recording = useApp((st) => st.voice.target === id && st.voice.state === "recording");
  return (
    <>
      <IconButton
        title={`Dictate into this session${hotkey ? ` (${prettyHotkey(hotkey)})` : ""} — click to start/stop`}
        onClick={() => void toggleDictation(id)}
        className={cx(recording && "bg-err/20 text-err", active && !recording && "text-accent")}
      >
        <Mic size={13} />
      </IconButton>
      <button
        title={hotkey ? `Voice shortcut ${prettyHotkey(hotkey)} — click to change` : "Set a voice shortcut for this session"}
        onClick={() => useApp.getState().setHotkeyFor(id)}
        className="mr-0.5 inline-flex @max-[520px]:hidden h-6 items-center gap-1 rounded px-1 text-[10px] text-faint hover:bg-hover hover:text-fg"
      >
        {hotkey ? prettyHotkey(hotkey).replace(/ /g, "") : <Keyboard size={12} />}
      </button>
    </>
  );
}

/** Focus mode: show this pane alone (double-click the header or Ctrl+Shift+F); the others keep running. */
function ZoomButton({ index }: { index: number }) {
  const zoomed = useApp((s) => s.zoomed === index);
  const single = useApp((s) => s.mode === "1" || s.mode === "tabs");
  if (single) return null;
  return (
    <IconButton title={zoomed ? "Show all panes (Ctrl+Shift+F)" : "Focus: show only this pane (Ctrl+Shift+F / double-click header)"} onClick={() => useApp.getState().setZoom(zoomed ? null : index)} className={cx(zoomed && "text-accent")}>
      {zoomed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
    </IconButton>
  );
}

/** Narrow panes: the less frequent header actions in one menu. */
function MoreMenu({ id, onRename }: { id: string; onRename: () => void }) {
  const s = useApp((st) => st.sessions[id]);
  const launching = useApp((st) => !!st.launching[id]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  if (!s) return null;
  const st = useApp.getState();
  const item = (label: string, icon: ReactNode, run: () => void, disabled = false) => (
    <button
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-hover disabled:opacity-40"
      onClick={() => { setOpen(false); run(); }}
    >
      {icon}{label}
    </button>
  );
  return (
    <div className="relative @min-[680px]:hidden" ref={ref}>
      <IconButton title="More actions" onClick={() => setOpen((o) => !o)}><MoreHorizontal size={14} /></IconButton>
      {open && (
        <div className="absolute top-7 right-0 z-30 w-60 rounded-md border border-line-strong bg-panel p-1 shadow-xl">
          {item(s.autoContinue ? "Auto-continue: on (turn off)" : "Auto-continue: off (turn on)", s.autoContinue ? <Timer size={13} /> : <TimerOff size={13} />, () => void st.setAutoContinue(id, !s.autoContinue))}
          {item("Rename", <Pencil size={13} />, onRename)}
          {item("Open working directory", <FolderOpen size={13} />, () => void api.openKnownDir("cwd", id))}
          {item("Duplicate (new conversation)", <Copy size={13} />, () => void st.duplicateSession(id))}
          {item("Restart", <RotateCw size={13} />, () => void st.restartSession(id), launching)}
          {item("Reset font size (Ctrl + wheel changes it)", <Type size={13} />, () => terms.zoomTerminal(id, "reset"))}
        </div>
      )}
    </div>
  );
}

/** Continue this conversation on another account of the same provider. */
function HandoffMenu({ id }: { id: string }) {
  const s = useApp((st) => st.sessions[id]);
  const accounts = useApp((st) => st.accounts);
  const quota = useApp((st) => st.quota);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  if (!s) return null;
  const others = accounts.filter((a) => a.provider === s.provider && a.id !== s.accountId);
  const hasConversation = !!(s.runtime?.providerSessionId ?? s.providerSessionId) && !!s.startedAt;
  return (
    <div className="relative" ref={ref}>
      <IconButton
        title={others.length ? (hasConversation ? "Continue this conversation on another account" : "Send a first message before moving the conversation") : "No other account of this provider"}
        disabled={!others.length || !hasConversation}
        onClick={() => setOpen((o) => !o)}
      >
        <ArrowRightLeft size={13} />
      </IconButton>
      {open && (
        <div className="absolute top-7 right-0 z-30 w-64 rounded-md border border-line-strong bg-panel p-1 shadow-xl">
          <div className="px-2 py-1 text-[10.5px] text-faint uppercase">Continue on account</div>
          {others.map((a) => {
            const q = quota[a.id] ?? [];
            const five = q.find((w) => w.window === "five_hour");
            return (
              <button
                key={a.id}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-hover"
                onClick={() => {
                  setOpen(false);
                  if (window.confirm(`Stop "${s.name}" and continue the same conversation on ${a.name}?`)) {
                    void useApp.getState().handoffSession(id, a.id, "continue");
                  }
                }}
              >
                <span className={cx("h-1.5 w-1.5 rounded-full", a.authStatus === "connected" ? "bg-ok" : "bg-err")} />
                <span className="flex-1 truncate">{a.name}</span>
                {five && <span className="text-[11px] text-faint tabular">5h {five.usedPercent.toFixed(0)}%</span>}
              </button>
            );
          })}
          <p className="px-2 pt-1 pb-1.5 text-[10.5px] text-faint">The transcript is copied locally into the other profile and resumed there.</p>
        </div>
      )}
    </div>
  );
}

function StoppedOverlay({ id }: { id: string }) {
  const launching = useApp((st) => !!st.launching[id]);
  const s = useApp((st) => st.sessions[id]);
  const pending = useApp((st) => !!st.pendingStart[id]);
  if (!s || pending || s.runtime?.running) return null;
  if (s.runtime && !["stopped", "failed"].includes(s.runtime.status)) return null;
  const canResume = s.kind === "agent" && !!s.providerSessionId && !!s.startedAt;
  return (
    <div className="absolute right-3 bottom-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-md border border-line-strong bg-panel/95 px-3 py-2 shadow-lg" onMouseDown={(e) => e.stopPropagation()}>
      <StatusDot status={s.status} withLabel />
      {s.exitCode != null && <span className="text-[11px] text-faint">exit {s.exitCode}</span>}
      {s.kind === "agent" ? (
        <>
          <Button size="sm" variant="primary" disabled={launching} onClick={() => void useApp.getState().startSession(id)}>
            <Play size={12} /> {launching ? "Starting…" : canResume ? "Resume" : "Start"}
          </Button>
          <Button size="sm" onClick={() => void useApp.getState().duplicateSession(id)}>New conversation</Button>
        </>
      ) : (
        <Button size="sm" onClick={() => void useApp.getState().closeSession(id)}>Close</Button>
      )}
    </div>
  );
}
