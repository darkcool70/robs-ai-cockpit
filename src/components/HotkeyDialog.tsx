import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { useApp } from "../store";
import { altGrConflict, hotkeyFromEvent, pauseHotkeys, prettyHotkey, resumeHotkeys } from "../lib/voice";
import { Button, Kbd, Modal } from "./ui";

/** Press the combination you want; works while the cockpit has focus, fires system-wide later. */
export function HotkeyCapture({ value, onChange }: { value: string | null; onChange: (h: string | null) => void }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!listening) return;
    void pauseHotkeys();
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setListening(false);
        return;
      }
      const h = hotkeyFromEvent(e);
      if (!h) return;
      const ch = altGrConflict(h);
      if (ch) {
        setError(`${prettyHotkey(h)} is AltGr+${prettyHotkey(h).split(" + ").pop()} on a German keyboard ("${ch}") — you could no longer type it. Choose another.`);
        return;
      }
      setError(null);
      onChange(h);
      setListening(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      void resumeHotkeys();
    };
  }, [listening, onChange]);
  return (
    <span className="inline-flex flex-col gap-1">
    <button
      type="button"
      onClick={() => { setError(null); setListening(true); }}
      className={`flex h-8 min-w-[200px] items-center justify-center gap-2 rounded border px-3 text-[12.5px] ${listening ? "border-accent bg-accent/10 text-accent" : "border-line-strong hover:bg-hover"}`}
    >
      <Keyboard size={13} />
      {listening ? "Press the combination… (Esc = cancel)" : value ? <Kbd>{prettyHotkey(value)}</Kbd> : "Click and press a combination"}
    </button>
    {error && <span className="max-w-[360px] text-[11px] text-err">{error}</span>}
    </span>
  );
}

/** Per-session push-to-talk shortcut. */
export function HotkeyDialog() {
  const id = useApp((s) => s.hotkeyFor);
  const s = useApp((st) => (id ? st.sessions[id] : undefined));
  const panes = useApp((st) => st.panes);
  const close = () => useApp.getState().setHotkeyFor(null);
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => setValue(s?.voiceHotkey ?? null), [id]);
  if (!id || !s) return null;
  const pane = panes.indexOf(id);
  const suggestion = pane >= 0 ? `Control+Shift+Digit${pane + 1}` : null;
  const save = async (h: string | null) => {
    if (await useApp.getState().setSessionHotkey(id, h)) close();
  };
  return (
    <Modal
      title={`Voice shortcut · ${s.name}`}
      onClose={close}
      width={460}
      footer={
        <>
          {s.voiceHotkey && <Button variant="ghost" className="mr-auto" onClick={() => void save(null)}>Remove shortcut</Button>}
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!value || value === s.voiceHotkey} onClick={() => void save(value)}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3 text-[12.5px]">
        <p className="text-muted">
          This shortcut dictates into <b className="text-fg">{s.name}</b> — also when another window is in front.
          <b className="text-fg"> Tap</b> to start and tap again to stop, or <b className="text-fg">hold</b> while speaking and release.
          End with "…absenden" to press Enter.
        </p>
        <div className="flex items-center gap-2">
          <HotkeyCapture value={value} onChange={setValue} />
          {suggestion && value !== suggestion && (
            <Button size="sm" variant="ghost" onClick={() => setValue(suggestion)}>Use {prettyHotkey(suggestion)}</Button>
          )}
        </div>
        <p className="text-[11px] text-faint">The combination is reserved system-wide while the cockpit runs. Avoid ones your other programs use.</p>
      </div>
    </Modal>
  );
}
