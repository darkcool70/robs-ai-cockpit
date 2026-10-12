import { useApp } from "../store";
import { DEFAULT_FOCUSED_HOTKEY, paneModifier, prettyHotkey } from "../lib/voice";
import { Kbd, Modal } from "./ui";

/** F1: every shortcut at a glance, including the voice shortcuts configured right now. */
export function Cheatsheet() {
  const open = useApp((s) => s.cheatsheetOpen);
  const settings = useApp((s) => s.settings);
  const sessions = useApp((s) => s.sessions);
  if (!open) return null;
  const main = typeof settings.voiceHotkeyFocused === "string" ? settings.voiceHotkeyFocused : DEFAULT_FOCUSED_HOTKEY;
  const mod = paneModifier(settings);
  const perSession = Object.values(sessions).filter((s) => s.voiceHotkey);
  const rows: [string, string][] = [
    ["Ctrl N", "New session"],
    ["Ctrl Shift N", "New session in an extra pane"],
    ["Ctrl 1 … 8", "Focus pane 1 … 8"],
    ["Ctrl 0", "Overview ↔ workspace"],
    ["Ctrl Shift F", "Focus mode: only the focused pane (again: all)"],
    ["Ctrl W", "Close the focused session"],
    ["Ctrl P", "Command palette"],
    ["Ctrl Shift C / V", "Copy / paste in a terminal"],
    ["F1", "This overview"],
  ];
  // the board (Pro): its help line is gone, the gestures live here
  const board: [string, string][] = [
    ["Pinch / spread", "Zoom around the fingers (also Ctrl or Alt + wheel)"],
    ["Two fingers · wheel", "Move the board (Shift + wheel: sideways)"],
    ["+ / − · 0", "Zoom · show everything"],
    ["Double-click", "Empty spot: a note · card: open it"],
    ["Right-click · Ctrl K", "Add something · board commands"],
  ];
  const voice: [string, string][] = [
    ["Ctrl Shift M", "Stumm / Ton an — the voice only, the microphone keeps working"],
    ...(main ? [[prettyHotkey(main), "Dictate (tap = start/stop, hold = push-to-talk)"] as [string, string]] : []),
    ...(mod ? [[`${prettyHotkey(mod)} + 1 … 8`, "Dictate into pane 1 … 8"] as [string, string]] : []),
    ...(settings.voicePickWhileRecording !== false ? [["1 … 8 · ← →", "While recording: switch the target"] as [string, string], ["Enter / Esc", "While recording: send / cancel"] as [string, string]] : []),
    ...perSession.map((s) => [prettyHotkey(s.voiceHotkey), `Dictate into “${s.name}”`] as [string, string]),
  ];
  const spoken = [
    "“Claude B, …” — to a session by name",
    "“Status” · “Was ist los?” — spoken report of all agents",
    "“Fenster 2 vorlesen” · “Fenster 2 weiter” · “Fenster 3 stopp”",
    "“Fenster 2 groß” · “alle Fenster” · “Alle weiter” · “Neuer Agent”",
    "“Zeig die Übersicht” · “Zeig Aufgaben” · “Zeig Sprache”",
    "“Sprich erstmal nicht” · “Psst” · “Sprich wieder” — mute / unmute the voice",
    "“Sprich weniger” · “Sag mir alles” · “Lies alles vor” — how much it talks",
    "“Tschüss” ends a conversation",
    "“…, absenden” at the end sends at once",
  ];
  const section = (title: string, list: [string, string][]) => (
    <div>
      <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</div>
      <table className="w-full text-[12.5px]">
        <tbody>
          {list.map(([k, v]) => (
            <tr key={k + v}>
              <td className="w-[46%] py-0.5 pr-2"><Kbd>{k}</Kbd></td>
              <td className="py-0.5 text-muted">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <Modal title="Keyboard & voice shortcuts" onClose={() => useApp.getState().setCheatsheet(false)} width={640}>
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-4">
          {section("Keyboard", rows)}
          {section("Board", board)}
        </div>
        <div className="space-y-4">
          {section("Voice", voice)}
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Say</div>
            <ul className="space-y-0.5 text-[12.5px] text-muted">{spoken.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <p className="flex-1 text-[11px] text-faint">Mouse: drag sessions from the bar at the bottom onto panes · double-click a pane header for focus mode.</p>
        <button className="rounded border border-accent/60 px-2 py-0.5 text-[11.5px] text-accent hover:bg-accent/10" onClick={() => useApp.getState().setTourOpen(true)}>Start the tour</button>
      </div>
    </Modal>
  );
}
