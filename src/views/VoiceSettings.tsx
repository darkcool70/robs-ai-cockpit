import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle2, Download, Mic } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type SttStatus } from "../lib/api";
import { DEFAULT_FOCUSED_HOTKEY, DEFAULT_PANE_MODIFIER, PANE_MODIFIERS, hotkeyProblem, paneModifier } from "../lib/voice";
import { HotkeyCapture } from "../components/HotkeyDialog";
import { Badge, Button, Card, Field, Kbd, Meter, SectionTitle, Select, cx } from "../components/ui";

const DEFAULT_VOCABULARY = "Claude, Codex, Git, GitHub, commit, push, pull request, npm, pnpm, TypeScript, React, Rust, Tauri, README, TODO";

/** Settings → Voice: install Whisper locally, pick model / mic / language, shortcuts, test. */
export function VoiceSettings() {
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const toast = useApp((s) => s.toast);
  const [status, setStatus] = useState<SttStatus | null>(null);
  const [progress, setProgress] = useState<{ item: string | null; done: number; total: number } | null>(null);
  const [test, setTest] = useState<{ state: "idle" | "rec" | "busy"; text?: string }>({ state: "idle" });
  const [level, setLevel] = useState(0);

  const refresh = () => api.sttStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    void refresh();
    const offs = [
      listen<{ item: string | null; done: number; total: number }>("stt-progress", (e) => setProgress(e.payload.item ? e.payload : null)),
      listen<{ level: number }>("stt-level", (e) => setLevel(e.payload.level)),
    ];
    return () => offs.forEach((p) => void p.then((f) => f()));
  }, []);

  const model = (settings.voiceModel as string) || "small";
  const enabled = settings.voiceEnabled !== false;
  const installed = !!status?.serverInstalled && !!status.models.find((m) => m.id === model)?.installed;

  const install = async (id: string) => {
    try {
      await api.sttInstall(id);
      await setSetting("voiceModel", id);
      toast("Speech recognition installed", "ok");
      void api.sttWarmup().catch(() => {});
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setProgress(null);
      void refresh();
    }
  };

  // Hold-to-test: records into no session, shows the text here.
  const testStart = async () => {
    try {
      setTest({ state: "rec" });
      await api.sttStart("__test__");
    } catch (e) {
      setTest({ state: "idle" });
      toast(errMsg(e), "error");
    }
  };
  const testStop = async () => {
    if (test.state !== "rec") return;
    setTest({ state: "busy" });
    try {
      const r = await api.sttStop();
      setTest({ state: "idle", text: r.text ? `${r.text}${r.send ? "  ⏎ (would press Enter)" : ""}` : "(nothing recognised)" });
    } catch (e) {
      setTest({ state: "idle", text: errMsg(e) });
    }
  };

  return (
    <Card className="space-y-3 p-3 text-[12.5px]">
      <SectionTitle right={<Badge tone={installed ? "ok" : "warn"}>{installed ? "ready" : "not installed"}</Badge>}>Voice input (speech to text)</SectionTitle>
      <p className="text-[11.5px] text-faint">
        Dictate commands into any session with a shortcut — also while another program is in front. Recognition runs locally with
        whisper.cpp; audio never leaves this computer. One-time download of the engine (8 MB, GitHub) and a model (Hugging Face), both verified by checksum.
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(e) => void setSetting("voiceEnabled", e.target.checked)} />
        Voice shortcuts enabled
      </label>

      <Field label="Recognition model">
        <div className="grid gap-1.5">
          {(status?.models ?? []).map((m) => (
            <div key={m.id} className={cx("flex items-center gap-2 rounded border px-2 py-1.5", model === m.id ? "border-accent bg-accent/5" : "border-line")}>
              <input type="radio" disabled={!m.installed} checked={model === m.id} onChange={() => void setSetting("voiceModel", m.id).then(() => api.sttWarmup().catch(() => {}))} />
              <span className="flex-1">
                <span className="font-medium">{m.label}</span>
                <span className="block text-[11px] text-faint">{m.hint}</span>
              </span>
              {m.installed ? (
                <span className="flex items-center gap-1 text-[11px] text-ok"><CheckCircle2 size={12} /> installed</span>
              ) : (
                <Button size="sm" disabled={!!status?.installing || !!progress} onClick={() => void install(m.id)}>
                  <Download size={12} /> Download {m.sizeMb} MB
                </Button>
              )}
            </div>
          ))}
          {progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-muted">
                <span>Downloading {progress.item}…</span>
                <span className="tabular">{Math.round(progress.done / 1048576)} / {progress.total ? Math.round(progress.total / 1048576) : "?"} MB</span>
              </div>
              <Meter value={progress.total ? (progress.done / progress.total) * 100 : 5} tone="accent" />
            </div>
          )}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Language">
          <Select value={(settings.voiceLanguage as string) || "de"} onChange={(e) => void setSetting("voiceLanguage", e.target.value)}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
            <option value="auto">Automatic (slightly slower)</option>
          </Select>
        </Field>
        <Field label="Microphone">
          <Select value={(settings.voiceDevice as string) || ""} onChange={(e) => void setSetting("voiceDevice", e.target.value)}>
            <option value="">Windows default</option>
            {(status?.devices ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
      </div>

      <div className="space-y-3 rounded border border-line p-2.5">
        <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">Which session hears you</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Main shortcut">
            <div className="flex items-center gap-2">
              <HotkeyCapture
                value={typeof settings.voiceHotkeyFocused === "string" ? settings.voiceHotkeyFocused : DEFAULT_FOCUSED_HOTKEY}
                onChange={(h) => void setSetting("voiceHotkeyFocused", h ?? "")}
              />
              <Button size="sm" variant="ghost" onClick={() => void setSetting("voiceHotkeyFocused", "")}>Disable</Button>
            </div>
            {hotkeyProblem(typeof settings.voiceHotkeyFocused === "string" ? settings.voiceHotkeyFocused : DEFAULT_FOCUSED_HOTKEY) && (
              <p className="mt-1 max-w-[420px] text-[11.5px] text-warn">{hotkeyProblem(settings.voiceHotkeyFocused as string)}</p>
            )}
          </Field>
          <Field label="…dictates into" hint="You can still switch while speaking (see below).">
            <Select value={(settings.voiceTargetDefault as string) || "focused"} onChange={(e) => void setSetting("voiceTargetDefault", e.target.value)}>
              <option value="focused">the focused pane</option>
              <option value="waiting">the agent that just finished (waiting for you), else the focused pane</option>
              <option value="last">the session I dictated to last, else the focused pane</option>
            </Select>
          </Field>
        </div>
        <Field
          label="Direct shortcut per pane"
          hint="Pane numbers are shown in each pane header and in the bar at the bottom. Tabs layout: numbers follow the running agents."
        >
          <Select value={paneModifier(settings)} onChange={(e) => void setSetting("voicePaneModifier", e.target.value)}>
            {PANE_MODIFIERS.map((m) => <option key={m.value || "off"} value={m.value}>{m.label}{m.value === DEFAULT_PANE_MODIFIER ? " (default)" : ""}</option>)}
          </Select>
        </Field>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={settings.voicePickWhileRecording !== false} onChange={(e) => void setSetting("voicePickWhileRecording", e.target.checked)} className="mt-0.5" />
          <span>
            Switch the target while recording
            <span className="block text-[11.5px] text-faint">
              While the microphone is on: <Kbd>1</Kbd>–<Kbd>8</Kbd> picks that pane, <Kbd>←</Kbd> <Kbd>→</Kbd> step through the sessions, <Kbd>Enter</Kbd> finishes and sends,
              <Kbd>Esc</Kbd> cancels. Works in any program; these keys are only taken while you are recording. The pop-up bottom right shows the choice.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={settings.voiceCommands !== false} onChange={(e) => void setSetting("voiceCommands", e.target.checked)} className="mt-0.5" />
          <span>
            Spoken commands steer the cockpit
            <span className="block text-[11.5px] text-faint">
              Short phrases are carried out instead of typed: “Fenster 3 stopp”, “Fenster 2 groß”, “alle Fenster”, “zeig Fenster 4”, “zeig die Übersicht”,
              “zeig Aufgaben”, “alle weiter”. Longer sentences are always typed.
            </span>
          </span>
        </label>
        <p className="text-[11.5px] text-faint">
          Also possible: a fixed shortcut for one session (keyboard button next to the mic in its pane header), or say its name first — “Claude B, …”, “Fenster 3, …”.
        </p>
      </div>

      <label className="flex items-start gap-2">
        <input type="checkbox" checked={settings.voiceStopOnSilence !== false} onChange={(e) => void setSetting("voiceStopOnSilence", e.target.checked)} className="mt-0.5" />
        <span>
          Stop recording when I stop talking
          <span className="block text-[11.5px] text-faint">After about 1.5 seconds of quiet the text is transcribed. Esc while it is being transcribed discards it.</span>
        </span>
      </label>

      <label className="flex items-start gap-2">
        <input type="checkbox" checked={settings.voiceAutoSend === true} onChange={(e) => void setSetting("voiceAutoSend", e.target.checked)} className="mt-0.5" />
        <span>
          Press Enter after every dictation
          <span className="block text-[11.5px] text-faint">Off: the text is typed and you can check it first. Either way, ending with "…absenden" / "…senden" / "…enter" sends it.</span>
        </span>
      </label>

      <label className="flex items-start gap-2">
        <input type="checkbox" checked={settings.voiceSounds !== false} onChange={(e) => void setSetting("voiceSounds", e.target.checked)} className="mt-0.5" />
        <span>
          Short sounds when recording starts and stops
          <span className="block text-[11.5px] text-faint">So you know it is listening without looking.</span>
        </span>
      </label>

      <p className="rounded border border-line bg-hover/40 px-2 py-1.5 text-[11.5px] text-muted">
        <b className="text-fg">Tip — talk to any session by name:</b> start with its name and a short pause, e.g. “Claude B, run the tests”,
        “Codex: review the diff” or “Fenster 2, weiter”. The command goes to that session, whichever pane is focused.
      </p>

      <Field label="Vocabulary hints" hint="Names and terms Whisper should spell correctly (comma separated).">
        <textarea
          rows={2}
          defaultValue={(settings.voiceVocabulary as string) ?? DEFAULT_VOCABULARY}
          onBlur={(e) => void setSetting("voiceVocabulary", e.target.value.trim())}
          className="rounded border border-line-strong bg-bg px-2 py-1.5 text-[12px] focus:border-accent focus:outline-none"
        />
      </Field>

      <div className="flex items-center gap-3 rounded border border-line px-2 py-2">
        <Button
          variant={test.state === "rec" ? "danger" : "default"}
          disabled={!installed || test.state === "busy"}
          onMouseDown={() => void testStart()}
          onMouseUp={() => void testStop()}
          onMouseLeave={() => void testStop()}
        >
          <Mic size={13} /> {test.state === "rec" ? "Listening… release to finish" : test.state === "busy" ? "Transcribing…" : "Hold to test"}
        </Button>
        {test.state === "rec" && <div className="w-32"><Meter value={Math.min(100, level * 1200)} tone="ok" /></div>}
        {test.text && <span className="min-w-0 flex-1 truncate" title={test.text}>{test.text}</span>}
      </div>
    </Card>
  );
}
