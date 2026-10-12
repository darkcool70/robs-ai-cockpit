// Wake word: "Atlas, …" from anywhere, without a key. The listening runs locally in the backend
// (wake.rs); here it is switched on and off, paused while the cockpit records or speaks, and the
// command that follows the name is carried out — by the operator, or in the focused pane.
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { api, errMsg } from "./api";
import { useApp } from "../store";
import { voiceHooks } from "./hooks";
import { deliver, parseControl, runControl, startDictation } from "./voice";
import { callout } from "./tts";
import { playSfx } from "./sfx";
import { logVoice } from "./voicelog";
import { wakePaused } from "./speakPolicy";
import { applySpeechControl, spokenSpeechControl } from "./mute";

export const useWake = create<{ on: boolean; heard: number; error: string | null }>(() => ({ on: false, heard: 0, error: null }));

/** Names that wake it: the operator's name, or the one set in the Voice tab. */
export function wakeWords(): string[] {
  const st = useApp.getState();
  const custom = typeof st.settings.voiceWakeWords === "string" ? st.settings.voiceWakeWords.split(",").map((w) => w.trim()).filter(Boolean) : [];
  const operator = st.assistants.find((a) => a.power === "operator")?.name;
  const words = [...custom, ...(operator ? [operator] : [])];
  return [...new Set(words.length ? words : ["Computer"])];
}

let current = "";
/** Start, restart or stop listening to match the settings. */
export async function syncWake() {
  const st = useApp.getState();
  const want = st.settings.voiceWakeWord === true && st.settings.voiceEnabled !== false;
  const key = want ? wakeWords().join("|") : "";
  if (key === current) return;
  current = key;
  try {
    if (!want) {
      await api.wakeStop();
      useWake.setState({ on: false, error: null });
      return;
    }
    await api.wakeStart(wakeWords());
    useWake.setState({ on: true, error: null });
  } catch (e) {
    current = "";
    useWake.setState({ on: false, error: errMsg(e) });
  }
}

/** Where a woken command goes: the operator (started if needed), else the focused pane. */
async function target(): Promise<string | null> {
  if (voiceHooks.ensureOperator && useApp.getState().assistants.some((a) => a.power === "operator")) {
    const id = await voiceHooks.ensureOperator();
    if (id && useApp.getState().settings.voiceOperatorTalk !== false) useApp.setState({ talkSession: id });
    return id;
  }
  const st = useApp.getState();
  return st.panes[st.focused] ?? null;
}

async function onWake(command: string) {
  const text = command.trim();
  // „Atlas, sei still“ / „Atlas, sprich wieder“: how much it talks, before anything else
  const speech = text && useApp.getState().settings.voiceCommands !== false ? spokenSpeechControl(text) : null;
  if (speech) {
    logVoice({ heard: text, to: "Cockpit", what: `wake word · speech: ${speech}` });
    await applySpeechControl(speech);
    return;
  }
  const control = text && useApp.getState().settings.voiceCommands !== false ? parseControl(text) : null;
  if (control) {
    logVoice({ heard: text, to: "Cockpit", what: "wake word · command" });
    await runControl(control);
    return;
  }
  const id = await target();
  if (!id) {
    useApp.getState().toast("Heard you — but there is no operator and no agent in the focused pane", "info");
    return;
  }
  if (!text) {
    // Just the name: answer and listen — the microphone opens only after „Ja?“ has been played, else
    // it calibrates on (and transcribes) its own voice.
    await callout(useApp.getState().settings.voiceLanguage === "en" ? "Yes?" : "Ja?", true);
    window.setTimeout(() => void startDictation(id, { conversation: true }), 150);
    return;
  }
  logVoice({ heard: text, to: useApp.getState().sessions[id]?.name ?? "?", what: "wake word" });
  await deliver(id, text, true);
}

let started = false;
export async function initWake() {
  if (started) return;
  started = true;
  await listen("wake-heard", () => {
    playSfx("start");
    useWake.setState({ heard: Date.now() });
  });
  await listen<{ command: string }>("wake", (e) => {
    useWake.setState({ heard: 0 });
    void onWake(e.payload.command ?? "");
  });
  // Pause while the cockpit itself records or speaks (it would hear its own name) — but not just because
  // a conversation is open: while it thinks or waits for results the microphone is closed, and its
  // name must still work then (before, the wake word stayed deaf until the conversation ended).
  let busy: boolean | null = null;
  useApp.subscribe((st) => {
    const b = wakePaused(st.voice.state, !!st.speaking);
    if (b !== busy) {
      busy = b;
      void api.wakeBusy(b).catch(() => {});
    }
  });
  useApp.subscribe((st, prev) => {
    if (st.settings !== prev.settings || st.assistants !== prev.assistants) void syncWake();
  });
  await syncWake();
}
