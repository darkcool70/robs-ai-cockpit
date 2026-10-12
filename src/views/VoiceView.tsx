import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { AudioLines, Mic, Play, Radio, Sparkles, Volume2, Waves } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type TtsStatus } from "../lib/api";
import { DEFAULT_FOCUSED_HOTKEY, prettyHotkey, statusReport, talkToOperator, wantsOperator } from "../lib/voice";
import { PITCHES, callout, neuralVoice, phrase, refreshNeural, speak, startTalk, voices, type VoiceFx } from "../lib/tts";
import { playSfx, type Sfx } from "../lib/sfx";
import { voiceHooks } from "../lib/hooks";
import { useVoiceLog } from "../lib/voicelog";
import { speakModeOf } from "../lib/speakPolicy";
import { useWake, wakeWords } from "../lib/wake";
import { ago } from "../lib/format";
import { Badge, Button, Card, Field, Kbd, Meter, SectionTitle, Select, cx } from "../components/ui";
import { VoiceSettings } from "./VoiceSettings";
import { VoiceEngines } from "./VoiceEngines";
import { muteTitle } from "../components/MuteButton";

const SAMPLE = {
  de: "Guten Abend. Alle Systeme laufen. Agent zwei ist fertig, die Tests sind grün. Soll ich die Änderungen zusammenführen?",
  en: "Good evening. All systems are online. Agent two has finished and the tests are green. Shall I merge the changes?",
};

const FX: [VoiceFx, string, string][] = [
  ["natural", "Natural", "The voice as it is"],
  ["jarvis", "Jarvis", "Crisp, with a little room: an AI in the walls"],
  ["robot", "Robot", "Ring-modulated sci-fi machine voice"],
];

const SOUNDS: [Sfx, string][] = [
  ["start", "Listening"],
  ["stop", "Stop"],
  ["send", "Send"],
  ["done", "Agent done"],
  ["attention", "Needs you"],
  ["standby", "Standby"],
  ["error", "Error"],
];

const COMMANDS: [string, string][] = [
  ["Status · Lagebericht · Was ist los?", "Instant spoken report of all agents"],
  ["Claude B, …  ·  Fenster 3, …", "Talk to a session by name or pane number"],
  ["Fenster 2 vorlesen", "Read that agent's last answer aloud"],
  ["Fenster 2 weiter  ·  Alle weiter", "Continue one / every waiting agent"],
  ["Fenster 3 stopp", "Stop an agent"],
  ["Fenster 2 groß  ·  Alle Fenster", "Focus a pane / show all"],
  ["Zeig Übersicht · Aufgaben · Review", "Switch the view"],
  ["Neuer Agent", "Open the new-agent dialog"],
  ["Antworten aus · Antworten an", "Mute / unmute spoken answers"],
  ["…, absenden", "Ending with it sends at once"],
  ["Warte · Moment  →  Weiter", "Interrupt an answer and it waits; “weiter” continues from the sentence it stopped in"],
  ["Präsentier das Board", "Slides (Pro): then “weiter”, “zurück”, “nochmal”, “tiefer”, “von vorne”, “Ende”"],
  ["Gespräch beenden · Tschüss", "End the conversation"],
];

function Toggle({ on, onChange, children, hint }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span>
        {children}
        {hint && <span className="block text-[11.5px] text-faint">{hint}</span>}
      </span>
    </label>
  );
}

/** The Voice tab: talk to your agents and your operator, pick the AI's voice, sounds and callouts. */
export function VoiceView() {
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const toast = useApp((s) => s.toast);
  const panes = useApp((s) => s.panes);
  const focused = useApp((s) => s.focused);
  const sessions = useApp((s) => s.sessions);
  const voiceState = useApp((s) => s.voice.state);
  const assistants = useApp((s) => s.assistants);
  const [tts, setTts] = useState<TtsStatus | null>(null);
  const [progress, setProgress] = useState<{ item: string | null; done: number; total: number } | null>(null);
  const [winVoices, setWinVoices] = useState(voices());
  const [stt, setStt] = useState<{ installed: boolean } | null>(null);
  const lang: "de" | "en" = settings.voiceLanguage === "en" ? "en" : "de";
  const put = (k: string, v: unknown) => void setSetting(k, v);

  const reload = async () => {
    setTts(await refreshNeural());
    const s = await api.sttStatus().catch(() => null);
    const model = (settings.voiceModel as string) || "small";
    setStt(s ? { installed: s.serverInstalled && !!s.models.find((m) => m.id === model)?.installed } : null);
  };
  useEffect(() => {
    void reload();
    const off = listen<{ item: string | null; done: number; total: number }>("tts-progress", (e) => setProgress(e.payload.item ? e.payload : null));
    try {
      window.speechSynthesis.onvoiceschanged = () => setWinVoices(voices());
    } catch {
      /* no speech synthesis */
    }
    return () => void off.then((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = async (id: string) => {
    try {
      await api.ttsInstall(id);
      if (!settings.ttsNeuralVoice) await setSetting("ttsNeuralVoice", id);
      toast("Voice installed", "ok");
      await reload();
      speak(SAMPLE[tts?.voices.find((v) => v.id === id)?.lang ?? lang], { voice: id, name: tts?.voices.find((v) => v.id === id)?.label });
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setProgress(null);
    }
  };

  const active = neuralVoice();
  const activeLabel = active ? tts?.voices.find((v) => v.id === active)?.label : null;
  const hasOperator = !!voiceHooks.ensureOperator;
  const operator = assistants.find((a) => a.power === "operator");
  const hotkey = typeof settings.voiceHotkeyFocused === "string" ? settings.voiceHotkeyFocused : DEFAULT_FOCUSED_HOTKEY;
  const fx = ((settings.ttsFx as VoiceFx) || "natural") as VoiceFx;
  const calloutFx = ((settings.voiceCalloutFx as VoiceFx) || "robot") as VoiceFx;
  const delay = Number(settings.voiceSendDelayMs ?? 1200);
  const speakWhen = speakModeOf(settings);
  const wake = useWake();

  const talkNow = () => {
    if (wantsOperator()) return void talkToOperator();
    const id = panes[focused] ?? Object.values(sessions).find((s) => s.kind === "agent" && s.runtime?.running)?.id;
    if (!id) return toast("Start an agent first (or choose your operator as the main target)", "warn");
    startTalk(id);
  };

  return (
    <div className="h-full overflow-auto">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-line px-6 py-6">
        <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(700px 220px at 120px 50%, rgba(56,189,248,0.16), transparent), radial-gradient(600px 200px at 85% 40%, rgba(167,139,250,0.13), transparent)" }} />
        <div className="relative flex flex-wrap items-center gap-6">
          <button
            onClick={talkNow}
            disabled={voiceState !== "idle"}
            className="group relative h-[112px] w-[112px] shrink-0 rounded-full disabled:opacity-70"
            title="Start a voice conversation"
            style={{ "--va": "#38bdf8", "--vb": "#a78bfa" } as CSSProperties}
          >
            <span className="voice-glow absolute inset-[-30%] rounded-full opacity-70 transition group-hover:opacity-100" />
            <span className="voice-wave absolute inset-0 rounded-full" />
            <span className="voice-ring absolute inset-0 rounded-full" />
            <span className="voice-core absolute inset-[12px] grid place-items-center rounded-full">
              <AudioLines size={36} className="text-white drop-shadow" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-[20px] font-semibold"><Radio size={18} className="text-accent" /> Voice control</h1>
            <p className="mt-1 max-w-[680px] text-[12.5px] text-muted">
              Talk to your agents like to a crew: press <Kbd>{prettyHotkey(hotkey) || "—"}</Kbd> anywhere, speak, pause. Your words go out on their own, the answer
              comes back as speech, and in a conversation the cockpit listens again. Everything runs on this computer — recognition with Whisper, speech with Supertonic or Piper (Azure cloud voices only if you add your own key).
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
              <Badge tone={stt?.installed ? "ok" : "warn"}>{stt?.installed ? "Hearing: ready" : "Hearing: not installed"}</Badge>
              <Badge tone={active ? "ok" : "neutral"}>{active ? `Voice: ${activeLabel} (neural)` : "Voice: Windows"}</Badge>
              <Badge tone={settings.ttsEnabled !== false ? "accent" : "neutral"}>{settings.ttsEnabled !== false ? "Answers aloud" : "Answers muted"}</Badge>
              {hasOperator && <Badge tone={settings.voiceMainTarget === "operator" ? "accent" : "neutral"}>{settings.voiceMainTarget === "operator" ? `Shortcut → ${operator?.name ?? "operator"}` : "Shortcut → focused pane"}</Badge>}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="primary" onClick={talkNow} disabled={voiceState !== "idle"}><Mic size={13} /> Talk now</Button>
            <Button onClick={() => speak(statusReport(), { name: lang === "en" ? "Status" : "Lagebericht" })}><Volume2 size={13} /> Status report</Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-2">
        {/* How you talk */}
        <Card className="space-y-3 p-4 text-[12.5px]">
          <SectionTitle>How you talk</SectionTitle>
          <Field label={`Main shortcut ${prettyHotkey(hotkey) ? `(${prettyHotkey(hotkey)})` : ""} talks to`}>
            <Select value={settings.voiceMainTarget === "operator" && hasOperator ? "operator" : "pane"} onChange={(e) => put("voiceMainTarget", e.target.value)}>
              <option value="pane">the focused pane (or as set under Recognition below)</option>
              <option value="operator" disabled={!hasOperator}>
                {hasOperator ? `my operator${operator ? ` — ${operator.name}` : " (create one under Assistants)"}` : "my operator (Pro)"}
              </option>
            </Select>
          </Field>
          {hasOperator && settings.voiceMainTarget === "operator" && (
            <Toggle on={settings.voiceOperatorTalk !== false} onChange={(v) => put("voiceOperatorTalk", v)} hint="Answers are spoken and the microphone opens again — a real back and forth until you say “Tschüss”, press Esc or stay quiet.">
              Hands-free conversation with the operator
            </Toggle>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="After you stop talking">
              <Select value={settings.voiceAutoSend === false ? "type" : String(delay)} onChange={(e) => {
                if (e.target.value === "type") put("voiceAutoSend", false);
                else { put("voiceAutoSend", true); put("voiceSendDelayMs", Number(e.target.value)); }
              }}>
                <option value="0">send at once</option>
                <option value="800">send after 0.8 s (Esc keeps it)</option>
                <option value="1200">send after 1.2 s (Esc keeps it)</option>
                <option value="2000">send after 2 s (Esc keeps it)</option>
                <option value="type">only type it, I press Enter</option>
              </Select>
            </Field>
            <Field label="Pause that ends a sentence">
              <Select value={String(settings.voiceSilenceMs ?? 1500)} onChange={(e) => put("voiceSilenceMs", Number(e.target.value))}>
                {[900, 1200, 1500, 2000, 2500].map((ms) => <option key={ms} value={ms}>{(ms / 1000).toFixed(1)} s</option>)}
              </Select>
            </Field>
            <Field label="Pause that ends a sentence in a conversation">
              <Select value={String(settings.voiceTalkSilenceMs ?? 900)} onChange={(e) => put("voiceTalkSilenceMs", Number(e.target.value))}>
                {[600, 750, 900, 1200, 1500].map((ms) => <option key={ms} value={ms}>{(ms / 1000).toFixed(2).replace(/0$/, "")} s{ms === 900 ? " (natural)" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Conversation goes to standby after">
              <Select value={String(settings.voiceStandbyMs ?? 8000)} onChange={(e) => put("voiceStandbyMs", Number(e.target.value))}>
                {[5000, 8000, 12000, 20000].map((ms) => <option key={ms} value={ms}>{ms / 1000} s of silence</option>)}
              </Select>
            </Field>
            <Field label="Language">
              <Select value={(settings.voiceLanguage as string) || "de"} onChange={(e) => put("voiceLanguage", e.target.value)}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
                <option value="auto">Automatic</option>
              </Select>
            </Field>
          </div>
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5">
            <Toggle
              on={settings.voiceWakeWord === true}
              onChange={(v) => put("voiceWakeWord", v)}
              hint={
                <>
                  Say <b>“{wakeWords()[0]}, …”</b> anywhere — no key. A light detector listens; only when someone speaks is the first moment checked by
                  the local Whisper. Nothing is recorded or sent anywhere; paused while the cockpit speaks or records. Uses some CPU while people talk in the room.
                </>
              }
            >
              Wake word{" "}
              {wake.on ? <Badge tone="ok">listening for “{wakeWords().join("”, “")}”</Badge> : wake.error ? <Badge tone="err">{wake.error}</Badge> : null}
            </Toggle>
            {settings.voiceWakeWord === true && (
              <div className="mt-2 grid gap-2">
                <Field label="Wake phrase" hint="The name it answers to — “Hey” / “Okay” in front work too. Comma separated for several (e.g. “Atlas, Jarvis, Computer”). Default: your operator's name.">
                  <input
                    defaultValue={(settings.voiceWakeWords as string) ?? ""}
                    placeholder={wakeWords().join(", ")}
                    onBlur={(e) => put("voiceWakeWords", e.target.value.trim())}
                    className="w-full rounded border border-line-strong bg-bg px-2 py-1 text-[12px] focus:border-accent focus:outline-none"
                  />
                </Field>
                <WakeTest />
              </div>
            )}
          </div>
          <Toggle on={settings.voiceBargeIn !== false} onChange={(v) => put("voiceBargeIn", v)} hint="In a conversation the microphone stays open while it speaks: start talking and it stops and listens. Works best with headphones; with speakers its own voice is filtered out.">
            Interrupt it by talking
          </Toggle>
          <Toggle on={settings.voiceBackchannel !== false} onChange={(v) => put("voiceBackchannel", v)} hint="When you talk for longer, a soft hum in your breath pauses shows it is still listening — like a person saying “mhm”.">
            “Mhm” while I talk
          </Toggle>
          <Toggle on={settings.voiceAck !== false} onChange={(v) => put("voiceAck", v)} hint="“Okay.”, “Mach ich.”, “Gute Frage.” — in the voice that answers, the moment your sentence goes out, so there is never dead air. Worded for a question or a task and for how long this agent usually takes.">
            Instant acknowledgement in conversations
          </Toggle>
          {settings.voiceAck !== false && (
            <Toggle on={settings.voiceFillers !== false} onChange={(v) => put("voiceFillers", v)} hint="Dauert die Antwort, sagt es, was es gerade tut — „Ich suche kurz im Netz.“, „Ich lese gerade bei MDN nach.“, „Ich baue die Karten auf.“ —, höchstens alle 6–8 Sekunden und nie zweimal dasselbe. Nur wenn es nichts zu berichten gibt, ein kurzes „Ich bin noch dran.“">
              Keep me posted while it thinks
            </Toggle>
          )}
          <Toggle on={settings.boardSounds !== false} onChange={(v) => put("boardSounds", v)} hint="Soft sounds on the operator's board: cards landing, the pen drawing, the spotlight, a page turning (Pro).">
            Board sounds
          </Toggle>
          <Toggle on={settings.ambientOrb !== false} onChange={(v) => put("ambientOrb", v)} hint="A small glowing orb bottom right while the cockpit is in the background: blue breathes while agents work, amber pulses when one needs you, green when all are done. Hover for the list, click to open.">
            Ambient orb
          </Toggle>
          <Toggle on={settings.voicePolite !== false} onChange={(v) => put("voicePolite", v)} hint="Reports outside a conversation wait until you stop typing for 3 seconds (in any program) — at the latest 45 seconds. Interruptions at a natural pause cost the least attention.">
            Wait for a pause before speaking up
          </Toggle>
          <Toggle on={settings.voiceWelcome !== false} onChange={(v) => put("voiceWelcome", v)} hint="After 10 minutes away, a short spoken briefing of what the agents did — only if something happened.">
            “Welcome back” briefing
          </Toggle>
          <Toggle on={settings.voiceStopOnSilence !== false} onChange={(v) => put("voiceStopOnSilence", v)} hint="Off: tap the shortcut again (or release it) to finish.">
            Finish when I pause
          </Toggle>
          <Toggle on={settings.voiceShortAnswers !== false} onChange={(v) => put("voiceShortAnswers", v)} hint="In a conversation with a plain agent, the message asks for a short spoken answer. Assistants know it already.">
            Ask agents for short answers when we talk
          </Toggle>
        </Card>

        {/* Voice */}
        <Card className="space-y-3 p-4 text-[12.5px]">
          <SectionTitle right={<Button size="sm" onClick={() => speak(SAMPLE[lang], { name: activeLabel ?? "Windows voice" })}><Play size={11} /> Listen</Button>}>
            The AI's voice
          </SectionTitle>
          <div className="grid gap-1.5">
            <VoiceEngines tts={tts} active={active} busy={!!tts?.installing || !!progress} install={install} reload={reload} />
            {(() => {
              const v = tts?.voices.find((x) => x.id === active);
              if (!v?.styles?.length) return null;
              const STYLE_LABEL: Record<string, string> = { auto: "Auto — whispers at night, friendly for good news", neutral: "Neutral", amused: "Friendly", cheerful: "Cheerful", whisper: "Whisper", surprised: "Surprised", sleepy: "Sleepy" };
              return (
                <label className="flex items-center gap-2 rounded border border-line px-2 py-1.5">
                  <span className="flex-1 text-[12px]">Mood of {v.label}</span>
                  <Select
                    value={String(settings.ttsStyle ?? "auto")}
                    onChange={(e) => { put("ttsStyle", e.target.value); window.setTimeout(() => speak(SAMPLE[v.lang].split(". ")[0] + ".", { voice: v.id, name: v.label }), 50); }}
                    className="h-7 max-w-[300px] text-[11.5px]"
                  >
                    {["auto", "neutral", "amused", "cheerful", "whisper", "surprised", "sleepy"].filter((x) => x === "auto" || v.styles!.includes(x)).map((x) => <option key={x} value={x}>{STYLE_LABEL[x]}</option>)}
                  </Select>
                </label>
              );
            })()}
            {(() => {
              // An English voice (Amy) reads German with English sounds: German text goes to a German voice.
              const v = tts?.voices.find((x) => x.id === active);
              if (!v || v.lang === "de") return null;
              const german = (tts?.voices ?? []).filter((x) => x.lang === "de" && x.installed);
              const chosen = String(settings.ttsGermanVoice ?? "");
              const sample = () => window.setTimeout(() => speak(SAMPLE.de.split(". ").slice(0, 2).join(". ") + ".", { voice: v.id, name: v.label }), 50);
              return (
                <div className="space-y-2 rounded border border-line px-2 py-1.5">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Deutsch spricht" hint={`${v.label} kann kein Deutsch: deutsche Sätze spricht eine deutsche Stimme, die ${v.label} nahekommt; Englisch bleibt bei ${v.label}.`}>
                      <Select
                        value={german.some((x) => x.id === chosen) ? chosen : ""}
                        onChange={(e) => {
                          put("ttsAutoLanguage", true);
                          put("ttsGermanVoice", e.target.value);
                          sample();
                        }}
                      >
                        <option value="">Automatisch (am nächsten an {v.label})</option>
                        {german.map((x) => <option key={x.id} value={x.id}>{x.label} — {x.hint}</option>)}
                      </Select>
                    </Field>
                    <Field label="Its pitch">
                      <Select value={String(settings.ttsGermanPitch ?? "auto")} onChange={(e) => { put("ttsGermanPitch", e.target.value === "auto" ? "auto" : Number(e.target.value)); sample(); }}>
                        <option value="auto">Matched to {v.label}</option>
                        {PITCHES.map(([label, p]) => <option key={p} value={p}>{label}</option>)}
                      </Select>
                    </Field>
                    {!german.length && <span className="col-span-2 text-[11px] text-warn">Noch keine deutsche Stimme – am natürlichsten klingt Supertonic (Stimmen-Engine oben), klein und schnell ist Kerstin (Piper).</span>}
                  </div>
                </div>
              );
            })()}
            {progress && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-muted">
                  <span>Downloading {progress.item}…</span>
                  <span className="tabular">{Math.round(progress.done / 1048576)} / {progress.total ? Math.round(progress.total / 1048576) : "?"} MB</span>
                </div>
                <Meter value={progress.total ? (progress.done / progress.total) * 100 : 5} tone="accent" />
              </div>
            )}
            <label className={cx("flex items-center gap-2 rounded border px-2 py-1.5", !active ? "border-accent bg-accent/5" : "border-line")}>
              <input type="radio" checked={!active} onChange={() => put("ttsEngine", "windows")} />
              <span className="flex-1">Windows voice <span className="text-[11px] text-faint">(older, robotic, always available)</span></span>
              <Select value={(settings.ttsVoice as string) || ""} onChange={(e) => put("ttsVoice", e.target.value)} className="h-7 max-w-[210px] text-[11.5px]">
                <option value="">Automatic</option>
                {winVoices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </Select>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Speed">
              <Select value={String(settings.ttsRate ?? 1.05)} onChange={(e) => put("ttsRate", Number(e.target.value))}>
                {[0.85, 1, 1.05, 1.15, 1.25, 1.4].map((r) => <option key={r} value={r}>{r}×</option>)}
              </Select>
            </Field>
            <Field label="Pitch">
              <Select
                value={String(settings.ttsPitch ?? 1)}
                title="Higher or deeper without changing the speed (neural voices)"
                onChange={(e) => { put("ttsPitch", Number(e.target.value)); window.setTimeout(() => speak(SAMPLE[lang].split(". ")[0] + ".", { name: "Pitch", pitch: Number(e.target.value) }), 50); }}
              >
                {PITCHES.map(([label, v]) => <option key={v} value={v}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Effect">
              <div className="flex gap-1">
                {FX.map(([id, label, hint]) => (
                  <button
                    key={id}
                    title={hint}
                    onClick={() => { put("ttsFx", id); window.setTimeout(() => speak(SAMPLE[lang].split(". ").slice(0, 2).join(". ") + ".", { fx: id, name: label }), 50); }}
                    className={cx("flex-1 rounded border px-2 py-1 text-[11.5px]", fx === id ? "border-accent bg-accent/10 text-fg" : "border-line text-muted hover:text-fg")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Card>

        {/* Answers */}
        <Card className="space-y-3 p-4 text-[12.5px]">
          <SectionTitle>Spoken answers</SectionTitle>
          <Toggle on={settings.voiceMuted === true} onChange={(v) => put("voiceMuted", v)} hint={muteTitle(settings.voiceMuted === true, false)}>
            Stumm (nichts sprechen, alles als Text)
          </Toggle>
          <Toggle on={settings.ttsEnabled !== false} onChange={(v) => put("ttsEnabled", v)} hint="Dictating stops the reading at once. To silence everything for a while: „sprich erstmal nicht“, „psst“ or Strg+Umschalt+M — „sprich wieder“ brings the voice back.">
            Read answers aloud
          </Toggle>
          <Toggle on={settings.voiceBrief === true} onChange={(v) => put("voiceBrief", v)} hint="Spoken answers keep to two sentences, and while it works it only says what it is doing — no fillers. By voice: „sprich weniger“ / „nur das Wichtigste“ (back: „sag mir alles“).">
            Kurz fassen
          </Toggle>
          <Field
            label={`Wann spricht ${operator?.name ?? "das Cockpit"}?`}
            hint={
              speakWhen === "asked"
                ? "Antworten auf das, was du gesagt hast (Talk, Weckwort, Diktat). Braucht dich etwas – ein Agent fragt, ein Fehler, eine Frage wartet –, ein kurzer Satz, einmal. Alles andere bleibt stiller Text."
                : speakWhen === "important"
                  ? "Wie „Nur wenn ich frage“, dazu Ergebnisse der Agenten (fertig, Review, Crew) und „Als Nächstes“ in je einem Satz und das Willkommen-zurück-Briefing. Getippte Fragen bleiben still."
                  : "Alles wird vorgelesen: jede Antwort, auch auf Getipptes, und jede Meldung der Agenten."
            }
          >
            <Select value={speakWhen} onChange={(e) => put("voiceSpeakWhen", e.target.value)} disabled={settings.ttsEnabled === false}>
              <option value="asked">Nur wenn ich frage</option>
              <option value="important">Wichtiges auch melden</option>
              <option value="all">Alles vorlesen</option>
            </Select>
          </Field>
          <Toggle on={settings.voiceAnnounce === true} onChange={(v) => put("voiceAnnounce", v)} hint="A chime plus a short spoken line: “Codex B ist fertig.”, “Claude A braucht dich.”">
            Announce the other agents when they finish or need me
          </Toggle>
        </Card>

        {/* Signals */}
        <Card className="space-y-3 p-4 text-[12.5px]">
          <SectionTitle>Signals &amp; callouts</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sounds">
              <Select value={settings.voiceSounds === false ? "off" : (settings.voiceSoundStyle as string) || "scifi"} onChange={(e) => {
                if (e.target.value === "off") put("voiceSounds", false);
                else { put("voiceSounds", true); put("voiceSoundStyle", e.target.value); }
              }}>
                <option value="scifi">Sci-fi (chirps, whoosh, chimes)</option>
                <option value="classic">Classic beeps</option>
                <option value="off">Off</option>
              </Select>
            </Field>
            <Field label="Callout voice">
              <Select value={calloutFx} onChange={(e) => { put("voiceCalloutFx", e.target.value); window.setTimeout(() => void callout(phrase("online"), true), 50); }}>
                <option value="robot">Robot</option>
                <option value="jarvis">Jarvis</option>
                <option value="natural">Natural</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-1">
            {SOUNDS.map(([k, label]) => (
              <button key={k} onClick={() => playSfx(k)} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/60 hover:text-fg">
                <Waves size={10} /> {label}
              </button>
            ))}
          </div>
          <Toggle on={settings.voiceCallouts !== false} onChange={(v) => put("voiceCallouts", v)} hint={<>Short spoken confirmations like “{phrase("sent")}”, “{phrase("standby")}”, “{phrase("muted")}”.</>}>
            Spoken callouts
          </Toggle>
          <Button size="sm" onClick={() => void callout(phrase("online"), true)}><Sparkles size={11} /> Test callout</Button>
        </Card>

        {/* Commands */}
        <Card className="space-y-2 p-4 text-[12.5px]">
          <SectionTitle>Say it</SectionTitle>
          <p className="text-[11.5px] text-faint">Short phrases steer the cockpit directly — instantly, no AI involved. Everything else goes to the agent (or your operator).</p>
          <div className="divide-y divide-line rounded border border-line">
            {COMMANDS.map(([say, does]) => (
              <div key={say} className="flex items-center gap-3 px-2.5 py-1.5">
                <span className="w-[46%] shrink-0 font-medium">“{say}”</span>
                <span className="text-[11.5px] text-muted">{does}</span>
              </div>
            ))}
          </div>
          <Toggle on={settings.voiceCommands !== false} onChange={(v) => put("voiceCommands", v)}>Spoken commands steer the cockpit</Toggle>
        </Card>

        <VoiceLog />
      </div>

      <div className="px-5 pb-6">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-muted uppercase"><Mic size={12} /> Recognition &amp; shortcuts</div>
        <VoiceSettings />
      </div>
    </div>
  );
}

/** Hold, say the wake phrase with a command, release: shows whether it would wake and what it heard. */
function WakeTest() {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [result, setResult] = useState<string | null>(null);
  const start = async () => {
    setResult(null);
    setState("rec");
    await api.wakeBusy(true).catch(() => {});
    await api.sttStart("__test__").catch((e) => { setState("idle"); setResult(String(e)); });
  };
  const stop = async () => {
    if (state !== "rec") return;
    setState("busy");
    try {
      const r = await api.sttStop();
      const cmd = r.text ? await api.wakeCheck(r.text, wakeWords()) : null;
      setResult(!r.text ? "Nothing heard" : cmd === null ? `✗ Would not wake — heard “${r.text}”` : `✓ Wakes it${cmd ? ` — command: “${cmd}”` : " — and then listens"}`);
    } catch (e) {
      setResult(errMsg(e));
    } finally {
      setState("idle");
      await api.wakeBusy(false).catch(() => {});
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant={state === "rec" ? "danger" : "default"} disabled={state === "busy"} onMouseDown={() => void start()} onMouseUp={() => void stop()} onMouseLeave={() => void stop()}>
        <Mic size={12} /> {state === "rec" ? "Listening… release" : state === "busy" ? "Checking…" : "Hold and say it"}
      </Button>
      {result && <span className={cx("text-[11.5px]", result.startsWith("✓") ? "text-ok" : "text-warn")}>{result}</span>}
    </div>
  );
}

function VoiceLog() {
  const events = useVoiceLog((s) => s.events);
  return (
    <Card className="space-y-2 p-4 text-[12.5px]">
      <SectionTitle>Voice log</SectionTitle>
      {events.length === 0 ? (
        <p className="text-[11.5px] text-faint">What you say and where it went shows up here.</p>
      ) : (
        <div className="max-h-[260px] space-y-1 overflow-auto">
          {events.map((e) => (
            <div key={e.ts + e.heard} className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-hover/50">
              <span className="w-14 shrink-0 text-[10.5px] text-faint">{ago(e.ts)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">“{e.heard}”</span>
                <span className="text-[11px] text-muted">→ {e.to} · {e.what}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
