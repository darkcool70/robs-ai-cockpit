import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, type LayoutMode, type View } from "../store";
import { cx, Kbd } from "./ui";
import { api, type Template } from "../lib/api";

interface Item {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPalette);
  const projects = useApp((s) => s.projects);
  const sessions = useApp((s) => s.sessions);
  const order = useApp((s) => s.order);
  const accounts = useApp((s) => s.accounts);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      api.templatesList().then(setTemplates).catch(() => {});
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const st = useApp.getState();
    const list: Item[] = [];
    for (const id of order) {
      const s = sessions[id];
      if (!s) continue;
      const acc = accounts.find((a) => a.id === s.accountId);
      list.push({ id: `s-${id}`, group: "Sessions", label: s.name, hint: `${acc?.name ?? s.kind} · ${s.runtime?.status ?? s.status}`, run: () => st.showSession(id) });
    }
    for (const p of projects) {
      list.push({ id: `p-${p.id}`, group: "Projects", label: p.name, hint: p.path, run: () => { st.selectProject(p.id); st.setView("workspace"); } });
    }
    for (const a of accounts) {
      list.push({
        id: `n-${a.id}`,
        group: "New session",
        label: `New session · ${a.name}`,
        hint: st.activeProjectId ? projects.find((p) => p.id === st.activeProjectId)?.name : "home directory",
        run: () => void st.createSession({ accountId: a.id, projectId: st.activeProjectId }),
      });
    }
    list.push({ id: "a-team", group: "Actions", label: "Start agent team…", hint: "several accounts in parallel", run: () => st.setTeamOpen(true) });
    list.push({ id: "a-broadcast", group: "Actions", label: "Send to several agents…", run: () => st.setBroadcastOpen(true) });
    list.push({ id: "a-new", group: "Actions", label: "New session…", hint: "Ctrl N", run: () => st.openNewSession(null) });
    list.push({ id: "a-keys", group: "Actions", label: "Keyboard & voice shortcuts", hint: "F1", run: () => st.setCheatsheet(true) });
    list.push({ id: "a-tour", group: "Actions", label: "Tour: what is where", run: () => st.setTourOpen(true) });
    list.push({ id: "a-zoom", group: "Actions", label: st.zoomed == null ? "Focus mode: only the focused pane" : "Show all panes", hint: "Ctrl Shift F", run: () => st.setZoom(st.zoomed == null ? st.focused : null) });
    list.push({ id: "a-task", group: "Actions", label: "New task…", run: () => st.setView("tasks") });
    const focusedId = st.panes[st.focused];
    for (const t of templates) {
      list.push({
        id: `t-${t.id}`,
        group: "Template",
        label: t.name,
        hint: focusedId ? `→ ${sessions[focusedId]?.name ?? "focused pane"}` : "focus a pane first",
        run: () => {
          const id = useApp.getState().panes[useApp.getState().focused];
          if (!id) return useApp.getState().toast("Focus a pane with a running session first", "warn");
          void useApp.getState().queueInput(id, t.text).then((ok) => ok && useApp.getState().toast(`"${t.name}" queued`, "ok"));
        },
      });
    }
    const views: [View, string][] = [["overview", "Overview"], ["tasks", "Tasks"], ["review", "Review & commit"], ["pins", "Pins"], ["loops", "Loops & templates"], ["workspace", "Workspace"], ["accounts", "Accounts"], ["usage", "Usage analytics"], ["history", "Session history"], ["security", "Security"], ["settings", "Settings"]];
    for (const [v, label] of views) list.push({ id: `v-${v}`, group: "Go to", label, run: () => st.setView(v) });
    const layouts: [LayoutMode, string][] = [["1", "Single pane"], ["2", "2 panes"], ["3", "3 panes"], ["4", "4 panes"], ["5", "5 panes"], ["6", "6 panes"], ["7", "7 panes"], ["8", "8 panes"], ["tabs", "Tabs"]];
    for (const [m, label] of layouts) list.push({ id: `l-${m}`, group: "Layout", label: `Layout: ${label}`, run: () => st.setMode(m) });
    return list;
  }, [order, sessions, projects, accounts, templates]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items
      .map((i) => ({ i, score: score(`${i.label} ${i.hint ?? ""} ${i.group}`.toLowerCase(), t) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.i);
  }, [items, q]);

  if (!open) return null;
  const run = (i: Item | undefined) => {
    if (!i) return;
    setOpen(false);
    i.run();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh]" onMouseDown={() => setOpen(false)}>
      <div className="w-[560px] overflow-hidden rounded-md border border-line-strong bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter") run(filtered[sel]);
          }}
          placeholder="Jump to session, project, action…"
          className="h-10 w-full border-b border-line bg-transparent px-3 text-[13.5px] outline-none placeholder:text-faint"
        />
        <div className="max-h-[52vh] overflow-auto py-1">
          {filtered.length === 0 && <div className="px-3 py-3 text-[12px] text-faint">No matches</div>}
          {filtered.slice(0, 60).map((i, idx) => (
            <div
              key={i.id}
              onMouseEnter={() => setSel(idx)}
              onClick={() => run(i)}
              className={cx("flex h-8 items-center gap-2 px-3 text-[12.5px]", idx === sel ? "bg-accent/12 text-fg" : "text-muted")}
            >
              <span className="w-24 shrink-0 text-[10.5px] tracking-wide text-faint uppercase">{i.group}</span>
              <span className="truncate text-fg">{i.label}</span>
              {i.hint && <span className="ml-auto truncate pl-3 text-[11px] text-faint">{i.hint}</span>}
            </div>
          ))}
        </div>
        <div className="flex gap-3 border-t border-line px-3 py-1.5 text-[11px] text-faint">
          <span><Kbd>↑↓</Kbd> navigate</span><span><Kbd>Enter</Kbd> open</span><span><Kbd>Esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}

/** Subsequence match; contiguous and early matches score higher. */
export function score(text: string, q: string): number {
  let ti = 0;
  let s = 0;
  let streak = 0;
  for (const ch of q) {
    const found = text.indexOf(ch, ti);
    if (found < 0) return 0;
    streak = found === ti ? streak + 1 : 0;
    s += 1 + streak * 2 + (found < 10 ? 1 : 0);
    ti = found + 1;
  }
  return s;
}
