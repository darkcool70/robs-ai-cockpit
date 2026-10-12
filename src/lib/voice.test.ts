import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register: vi.fn(), unregisterAll: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./api", () => ({ api: {}, errMsg: String }));
vi.mock("../store", () => ({ useApp: { getState: vi.fn(), subscribe: vi.fn() } }));
vi.mock("./tts", () => ({ phrase: String, signal: vi.fn(), speak: vi.fn(), stopSpeaking: vi.fn(), summarize: String, acknowledge: vi.fn(), dropHeldSpeech: vi.fn(), hasHeldSpeech: () => false, resumeSpeech: vi.fn(), callout: vi.fn(), neuralVoice: vi.fn(), outputLevel: vi.fn() }));
vi.mock("./sfx", () => ({ playSfx: vi.fn() }));

const { hotkeyFromEvent, prettyHotkey, altGrConflict, hotkeyProblem, silenceDetector, routeSpoken, parseControl, bargeInDetector, backchannelDetector, pauseOrResume } = await import("./voice");

describe("addressing a session by name", () => {
  const cands = [
    { id: "a", names: ["Claude A #1", "Claude A", "pane 1"] },
    { id: "b", names: ["Claude B", "pane 2"] },
    { id: "x", names: ["Codex · proj", "Codex", "pane 3"] },
  ];
  it("routes a leading name with punctuation", () => {
    expect(routeSpoken("Claude B, führe die Tests aus.", cands)).toEqual({ id: "b", text: "Führe die Tests aus." });
    expect(routeSpoken("Cloud B: mach weiter", cands)).toEqual({ id: "b", text: "Mach weiter" });
    expect(routeSpoken("Kodex, review the diff", cands)).toEqual({ id: "x", text: "Review the diff" });
    expect(routeSpoken("An Claude A. Commit bitte.", cands)).toEqual({ id: "a", text: "Commit bitte." });
    expect(routeSpoken("Fenster zwei, stopp", cands)).toEqual({ id: "b", text: "Stopp" });
  });
  it("leaves normal sentences alone", () => {
    expect(routeSpoken("Claude B soll danach die Tests machen", cands)).toBeNull();
    expect(routeSpoken("Frag Codex, ob das geht", cands)).toBeNull();
    expect(routeSpoken("Claude B,", cands)).toBeNull();
  });
});
const ev = (code: string, m: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m });

describe("voice shortcuts", () => {
  it("builds layout-independent accelerators from key presses", () => {
    expect(hotkeyFromEvent(ev("Digit1", { ctrlKey: true, altKey: true }))).toBe("Control+Alt+Digit1");
    expect(hotkeyFromEvent(ev("KeyM", { shiftKey: true, metaKey: true }))).toBe("Shift+Super+KeyM");
    expect(hotkeyFromEvent(ev("F13"))).toBe("F13");
  });
  it("waits while only modifiers are held and rejects bare keys", () => {
    expect(hotkeyFromEvent(ev("ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(hotkeyFromEvent(ev("KeyA"))).toBeNull();
  });
  it("rejects combinations that are AltGr characters on German keyboards", () => {
    expect(altGrConflict("Control+Alt+Digit9")).toBe("]");
    expect(altGrConflict("Control+Alt+KeyQ")).toBe("@");
    expect(altGrConflict("Control+Alt+Digit1")).toBeNull();
    expect(altGrConflict("Control+Shift+Digit9")).toBeNull();
    expect(altGrConflict("Alt+Shift+Space")).toBeNull();
  });

  it("rejects shortcuts that would break typing or editing in every program", () => {
    expect(hotkeyProblem("Shift+KeyA")).toMatch(/typing/);
    expect(hotkeyProblem("Shift+Digit1")).toMatch(/typing/);
    expect(hotkeyProblem("Control+KeyA")).toMatch(/standard shortcut/);
    expect(hotkeyProblem("Control+KeyV")).toMatch(/standard shortcut/);
    expect(hotkeyProblem("Control+Alt+KeyQ")).toMatch(/AltGr/);
    expect(hotkeyProblem("Alt+Shift+Space")).toBeNull();
    expect(hotkeyProblem("Control+Shift+KeyA")).toBeNull();
    expect(hotkeyProblem("Control+Alt+Space")).toBeNull();
    expect(hotkeyProblem("F9")).toBeNull();
  });
  it("shows readable labels", () => {
    expect(prettyHotkey("Control+Alt+Digit1")).toBe("Ctrl + Alt + 1");
    expect(prettyHotkey("Super+KeyD")).toBe("Win + D");
    expect(prettyHotkey(null)).toBe("");
  });
});

describe("spoken control commands", () => {
  it("recognises short steering commands", () => {
    expect(parseControl("Fenster 3 stopp.")).toEqual({ action: "stop", pane: 3 });
    expect(parseControl("Fenster zwei groß")).toEqual({ action: "zoom", pane: 2 });
    expect(parseControl("Zeig Fenster vier")).toEqual({ action: "focus", pane: 4 });
    expect(parseControl("Zeige die Übersicht!")).toEqual({ action: "view", view: "overview" });
    expect(parseControl("Alle weiter, bitte.")).toEqual({ action: "continue-all" });
    expect(parseControl("alle Fenster")).toEqual({ action: "show-all" });
    expect(parseControl("Öffne Aufgaben")).toEqual({ action: "view", view: "tasks" });
  });
  it("knows status, read, continue, mute and goodbye", () => {
    expect(parseControl("Status")).toEqual({ action: "status" });
    expect(parseControl("Was ist los?")).toEqual({ action: "status" });
    expect(parseControl("Lagebericht bitte")).toEqual({ action: "status" });
    expect(parseControl("Fenster 2 vorlesen")).toEqual({ action: "read", pane: 2 });
    expect(parseControl("Lies Fenster drei vor")).toEqual({ action: "read", pane: 3 });
    expect(parseControl("Fenster 4 weiter")).toEqual({ action: "continue", pane: 4 });
    expect(parseControl("Antworten aus.")).toEqual({ action: "mute" });
    expect(parseControl("Antworten an")).toEqual({ action: "unmute" });
    expect(parseControl("Neuer Agent")).toEqual({ action: "new-agent" });
    expect(parseControl("Tschüss!")).toEqual({ action: "end-talk" });
    expect(parseControl("Zeig Fenster 2")).toEqual({ action: "focus", pane: 2 });
  });
  it("types everything else", () => {
    expect(parseControl("Fenster 3 soll die Tests stoppen und neu starten")).toBeNull();
    expect(parseControl("Mach alle Tests weiter grün")).toBeNull();
    expect(parseControl("Fenster 9 stopp")).toBeNull();
    expect(parseControl("")).toBeNull();
  });
});

describe("silenceDetector", () => {
  it("stops only after speech followed by enough quiet", () => {
    const d = silenceDetector(400, 80);
    const feed = (levels: number[]) => levels.map((l) => d(l));
    expect(feed([0.002, 0.003, 0.002, 0.002, 0.002]).some(Boolean)).toBe(false); // room noise
    expect(feed(Array(20).fill(0.002)).some(Boolean)).toBe(false); // silence before speaking never stops
    expect(feed([0.05, 0.08, 0.06, 0.07]).some(Boolean)).toBe(false); // speaking
    expect(feed([0.003, 0.003, 0.003, 0.003]).some(Boolean)).toBe(false); // short pause
    expect(feed([0.003])).toEqual([true]); // 5 × 80 ms quiet
  });

  it("reports a timeout when nobody speaks", () => {
    const d = silenceDetector(400, 80, 800);
    const out = Array(10).fill(0.002).map(d);
    expect(out.slice(0, 9).every((x) => x === false)).toBe(true);
    expect(out[9]).toBe("timeout");
    const talking = silenceDetector(400, 80, 800);
    expect([0.002, 0.002, 0.002, 0.002, 0.002, 0.05, 0.06, 0.05, 0.05, 0.05, 0.05].map(talking).includes("timeout")).toBe(false);
  });

  it("adapts to a noisy room", () => {
    const d = silenceDetector(160, 80);
    [0.03, 0.03, 0.03, 0.03, 0.03].forEach(d); // fan noise
    expect([0.05, 0.05, 0.05].map(d).some(Boolean)).toBe(false); // below 3× noise: not speech
    expect([0.03, 0.03, 0.03].map(d).some(Boolean)).toBe(false);
  });
});

describe("barge-in (talking while the assistant speaks)", () => {
  // the assistant's voice: output level swinging between 0.1 and 0.5
  const out = (i: number) => 0.3 + 0.2 * Math.sin(i / 2);
  const run = (mic: (i: number) => number, frames: number) => {
    const d = bargeInDetector(1200, 80);
    let hit = -1;
    for (let i = 0; i < frames && hit < 0; i++) if (d(mic(i), out(i))) hit = i;
    return hit;
  };
  it("ignores its own voice coming back from the speakers", () => {
    expect(run((i) => 0.004 + 0.08 * out(i), 120)).toBe(-1); // echo only, ~10 s
    expect(run((i) => 0.004 + 0.08 * out(i) * (i > 60 ? 1.3 : 1), 120)).toBe(-1); // a bit louder later
  });
  it("stops for the user within about a third of a second", () => {
    const start = 40; // after calibration
    const hit = run((i) => 0.004 + 0.08 * out(i) + (i >= start ? 0.09 : 0), 120);
    expect(hit).toBeGreaterThanOrEqual(start);
    expect((hit - start + 1) * 80).toBeLessThanOrEqual(400);
  });
  it("works with headphones (no echo at all)", () => {
    expect(run((i) => (i >= 30 ? 0.05 : 0.003), 60)).toBeGreaterThanOrEqual(30);
  });
  it("ignores the echo that arrives late, in the gaps between words (speakers)", () => {
    // real speech: words with short gaps; the room and the audio buffers delay the echo by ~160 ms
    const words = (i: number) => (i < 0 ? 0 : i % 5 === 4 ? 0 : 0.3 + 0.15 * Math.sin(i));
    const late = (delay: number) => {
      const d = bargeInDetector(1200, 80);
      for (let i = 0; i < 150; i++) if (d(0.004 + 0.08 * words(i - delay), words(i))) return i;
      return -1;
    };
    expect(late(1)).toBe(-1);
    expect(late(2)).toBe(-1);
    expect(late(3)).toBe(-1);
  });
  it("still hears the user over late echo", () => {
    const words = (i: number) => (i < 0 ? 0 : i % 5 === 4 ? 0 : 0.3 + 0.15 * Math.sin(i));
    const d = bargeInDetector(1200, 80);
    let hit = -1;
    for (let i = 0; i < 120 && hit < 0; i++) if (d(0.004 + 0.08 * words(i - 2) + (i >= 40 ? 0.12 : 0), words(i))) hit = i;
    expect(hit).toBeGreaterThanOrEqual(40);
    expect((hit - 40 + 1) * 80).toBeLessThanOrEqual(480);
  });
});

describe("silence detector after a barge-in", () => {
  it("uses the known room level instead of calibrating on the user's own voice", () => {
    const d = silenceDetector(400, 80, 8000, 0.004);
    expect([0.05, 0.06, 0.05, 0.05].map(d).some(Boolean)).toBe(false);
    expect([0.003, 0.003, 0.003, 0.003, 0.003].map(d).pop()).toBe(true);
  });
});

describe("mhm while you talk", () => {
  const talk = (ms: number) => Array(Math.round(ms / 80)).fill(0.06);
  const quiet = (ms: number) => Array(Math.round(ms / 80)).fill(0.003);
  it("hums in a breath pause after a few seconds of talking", () => {
    const d = backchannelDetector();
    const seq = [...quiet(400), ...talk(5200), ...quiet(400)];
    const hits = seq.map(d);
    expect(hits.filter(Boolean).length).toBe(1);
  });
  it("stays quiet for short sentences and at the end of a sentence", () => {
    const d = backchannelDetector();
    expect([...quiet(400), ...talk(2000), ...quiet(400)].map(d).some(Boolean)).toBe(false);
    const e = backchannelDetector();
    // the pause is already long (the sentence ended): no hum after the moment for it has passed
    const seq = [...quiet(400), ...talk(5200)];
    seq.forEach(e);
    const late = [...quiet(1200)].map(e);
    expect(late.filter(Boolean).length).toBe(1); // only once, in the first moments of the pause
  });

  it("waits on “warte” and goes on with “weiter” — whole utterances only", () => {
    expect(["Warte.", "Moment mal", "stopp", "hold on", "Sekunde bitte"].map(pauseOrResume)).toEqual(["pause", "pause", "pause", "pause", "pause"]);
    expect(["Weiter.", "mach weiter", "erzähl weiter", "go on"].map(pauseOrResume)).toEqual(["resume", "resume", "resume", "resume"]);
    expect(pauseOrResume("warte mal, ich hab noch eine Frage zu den Tests")).toBeNull();
    expect(pauseOrResume("weiter mit Schritt drei")).toBeNull();
  });
});
