import { useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { X } from "lucide-react";
import { MAX_PANES, modeFor, SLOTS, useApp } from "./store";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { DragGhost, Workspace } from "./components/Workspace";
import { PlaceDialog } from "./components/PlaceDialog";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { CommandPalette } from "./components/CommandPalette";
import { TeamDialog } from "./components/TeamDialog";
import { BroadcastDialog } from "./components/BroadcastDialog";
import { HotkeyDialog } from "./components/HotkeyDialog";
import { VoiceIndicator } from "./components/VoiceIndicator";
import { initVoice } from "./lib/voice";
import { initNotify } from "./lib/notify";
import { initWorkflow } from "./lib/workflow";
import { initTts } from "./lib/tts";
import { initFileDrop } from "./lib/filedrop";
import { AccountsView } from "./views/AccountsView";
import { HistoryView } from "./views/HistoryView";
import { UsageView } from "./views/UsageView";
import { SecurityView } from "./views/SecurityView";
import { SettingsView } from "./views/SettingsView";
import { OverviewView } from "./views/OverviewView";
import { LoopsView } from "./views/LoopsView";
import { AssistantsView } from "@pro/AssistantsView";
import { TasksView } from "./views/TasksView";
import { ReviewView } from "./views/ReviewView";
import { PinsView } from "./views/PinsView";
import { Cheatsheet } from "./components/Cheatsheet";
import { Tour, TOUR_VERSION } from "./components/Tour";
import { cx } from "./components/ui";
import { api, errMsg } from "./lib/api";
import { setTerminalLight } from "./lib/terminals";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1" && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        useApp.getState().setCheatsheet(!useApp.getState().cheatsheetOpen);
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const st = useApp.getState();
      const k = e.key.toLowerCase();
      if (k === "n" && e.shiftKey) {
        e.preventDefault();
        // New agent pane: grow the layout and open the dialog targeting the new slot.
        if (st.mode !== "tabs" && SLOTS[st.mode] < MAX_PANES) st.setMode(modeFor(SLOTS[st.mode] + 1));
        const panes = useApp.getState().panes;
        const free = panes.indexOf(null);
        st.openNewSession(free >= 0 ? free : null);
      } else if (k === "f" && e.shiftKey) {
        e.preventDefault();
        if (st.mode !== "1" && st.mode !== "tabs") st.setZoom(st.zoomed == null ? st.focused : null);
      } else if (k === "n") {
        e.preventDefault();
        st.openNewSession(null);
      } else if (k === "p" && !e.shiftKey) {
        e.preventDefault();
        st.setPalette(!st.paletteOpen);
      } else if (k === "w" && !e.shiftKey) {
        e.preventDefault();
        const id = st.panes[st.focused];
        if (!id) return;
        const s = st.sessions[id];
        if (s?.runtime?.running && !window.confirm(`Stop and close "${s.name}"?`)) return;
        void st.closeSession(id);
      } else if (k === "0" && !e.shiftKey) {
        e.preventDefault();
        st.setView(st.view === "overview" ? "workspace" : "overview");
      } else if (/^[1-9]$/.test(k) && !e.shiftKey) {
        e.preventDefault();
        st.focusPane(Number(k) - 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

export default function App() {
  const ready = useApp((s) => s.ready);
  const initError = useApp((s) => s.initError);
  const view = useApp((s) => s.view);
  const init = useApp((s) => s.init);
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  const waiting = useApp((s) => Object.values(s.sessions).filter((x) => x.kind === "agent" && x.runtime?.running && x.runtime.status === "waiting-for-input").length);
  useShortcuts();

  // Window title shows how many agents wait for you (visible in the taskbar).
  useEffect(() => {
    document.title = waiting ? `(${waiting}) Robs AI Cockpit` : "Robs AI Cockpit";
  }, [waiting]);

  useEffect(() => {
    init().catch((e) => useApp.getState().toast(`Startup failed: ${errMsg(e)}`, "error"));
  }, [init]);

  // Theme: dark / light / like Windows.
  const theme = useApp((s) => (typeof s.settings.theme === "string" ? s.settings.theme : "dark"));
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    const apply = () => {
      const light = theme === "light" || (theme === "system" && !!mq?.matches);
      document.documentElement.dataset.theme = light ? "light" : "dark";
      setTerminalLight(light);
    };
    apply();
    mq?.addEventListener?.("change", apply);
    return () => mq?.removeEventListener?.("change", apply);
  }, [theme]);
  useEffect(() => {
    if (!ready) return;
    initVoice().catch((e) => useApp.getState().toast(`Voice shortcuts unavailable: ${errMsg(e)}`, "warn"));
    initNotify().catch(() => {});
    initWorkflow();
    initTts();
    initFileDrop().catch(() => {});
    // First start (or an update with new tour steps): show the tour once.
    if (Number(useApp.getState().settings.tourSeen ?? 0) < TOUR_VERSION) window.setTimeout(() => useApp.getState().setTourOpen(true), 800);
    // Phone remote: back on after a restart if it was on.
    const st = useApp.getState().settings;
    if (st.remoteEnabled === true && typeof st.remoteKey === "string") {
      api.remoteStart(Number(st.remotePort ?? 8765) || 8765, st.remoteKey).catch((e) => useApp.getState().toast(`Phone remote: ${errMsg(e)}`, "warn"));
    }
  }, [ready]);

  if (!ready) {
    return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-[12px] text-muted">
      {initError ? <><p role="alert">Startup failed: {initError}</p><button className="rounded border border-accent px-3 py-1 text-accent" onClick={() => void init()}>Retry</button></> : "Loading…"}
    </div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <Group orientation="horizontal">
          <Panel defaultSize={220} minSize={170} maxSize={380}>
            <Sidebar />
          </Panel>
          <Separator className="w-px" />
          <Panel minSize="40">
            {/* Workspace stays mounted so terminals keep their DOM while other views are shown. */}
            <div className={cx("h-full", view !== "workspace" && "hidden")}>
              <Workspace />
            </div>
            {view === "overview" && <OverviewView />}
            {view === "assistants" && <AssistantsView />}
            {view === "tasks" && <TasksView />}
            {view === "review" && <ReviewView />}
            {view === "pins" && <PinsView />}
            {view === "loops" && <LoopsView />}
            {view === "accounts" && <AccountsView />}
            {view === "history" && <HistoryView />}
            {view === "usage" && <UsageView />}
            {view === "security" && <SecurityView />}
            {view === "settings" && <SettingsView />}
          </Panel>
        </Group>
      </div>
      <StatusBar />
      <NewSessionDialog />
      <TeamDialog />
      <BroadcastDialog />
      <HotkeyDialog />
      <PlaceDialog />
      <DragGhost />
      <VoiceIndicator />
      <CommandPalette />
      <Cheatsheet />
      <Tour />
      <div className="pointer-events-none fixed right-3 bottom-8 z-[60] flex w-[380px] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex items-start gap-2 rounded-md border bg-panel px-3 py-2 text-[12.5px] shadow-xl",
              t.kind === "error" && "border-err/50",
              t.kind === "warn" && "border-warn/50",
              t.kind === "ok" && "border-ok/40",
              t.kind === "info" && "border-line-strong",
            )}
          >
            <span className="flex-1">
              {t.text}
              {t.action && (
                <button
                  className="mt-1.5 block rounded border border-accent/50 px-2 py-0.5 text-[12px] text-accent hover:bg-accent/10"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </span>
            <button onClick={() => dismiss(t.id)} className="text-faint hover:text-fg">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
