import { afterEach, describe, expect, it, vi } from "vitest";

const state = { speaking: null as unknown, voice: { state: "idle" }, sessions: {} as Record<string, unknown> };
vi.mock("../store", () => ({ useApp: { getState: () => state, subscribe: vi.fn() } }));
vi.mock("./workflow", () => ({ turnJustEnded: () => false }));
const { fillerKind, fillerTimes, fillerPool, pickFiller, learnDuration, expectedMs, startFillers, stopFillers, siteName, activityPhrase, interimSpeech, fillerUpdate } = await import("./fillers");

describe("fillers", () => {
  afterEach(() => {
    stopFillers();
    vi.useRealTimers();
  });

  it("knows a question from a task, in both languages", () => {
    expect(fillerKind("🎙 Wie funktioniert WebAssembly", "de")).toBe("question");
    expect(fillerKind("mach die Tests grün", "de")).toBe("task");
    expect(fillerKind("das klappt nicht?", "de")).toBe("question");
    expect(fillerKind("what does this do", "en")).toBe("question");
    expect(fillerKind("fix the build", "en")).toBe("task");
  });

  it("speaks at once, then further and further apart, never like a timer", () => {
    const t = fillerTimes(() => 0.5);
    expect(t[0]).toBeLessThan(400);
    expect(t[1]).toBeGreaterThan(5000);
    expect(t[1]).toBeLessThan(7000);
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    for (let i = 2; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1] - 1);
    expect(fillerTimes(() => 0.1)).not.toEqual(fillerTimes(() => 0.9));
    expect(t).toHaveLength(5);
  });

  it("words the acknowledgement for what was asked and how long it usually takes", () => {
    expect(fillerPool(0, "task", null, "de")).toContain("Mach ich.");
    expect(fillerPool(0, "question", null, "de")).toContain("Gute Frage.");
    expect(fillerPool(0, "question", 2000, "de")).toContain("Alles klar.");
    expect(fillerPool(0, "task", 50000, "de").some((x) => x.length > 25)).toBe(true);
    expect(fillerPool(2, "task", null, "en")).toContain("Still working on it.");
    // only sounds Piper pronounces: never "Hmm", "Mhm" or "Mmh"
    for (const lang of ["de", "en"] as const)
      for (let n = 0; n < 4; n++) for (const x of fillerPool(n, "question", null, lang)) expect(x).not.toMatch(/\b(hmm+|mhm|mm+h?)\b/i);
  });

  it("rotates through the pool before repeating", () => {
    const pool = fillerPool(1, "task", null, "de");
    const recent: string[] = [];
    const said = new Set<string>();
    let r = 0;
    for (let i = 0; i < pool.length; i++) {
      const { base } = pickFiller(pool, recent, "de", false, () => ((r += 0.37) % 1));
      said.add(base);
      recent.push(base);
    }
    expect(said.size).toBe(pool.length);
  });

  it("puts a small sound in front now and then", () => {
    const { text, base } = pickFiller(["Ich bin noch dran."], [], "de", true, () => 0.1);
    expect(base).toBe("Ich bin noch dran.");
    expect(text).toBe("Hm, ich bin noch dran.");
    expect(pickFiller(["Hm, fast."], [], "de", true, () => 0.1).text).toBe("Hm, fast.");
    expect(pickFiller(["Moment."], [], "de", false, () => 0.1).text).toBe("Moment.");
  });

  it("learns how long an agent takes", () => {
    learnDuration("s1", 10000);
    learnDuration("s1", 20000);
    expect(expectedMs("s1")).toBe(14000);
    expect(expectedMs("nobody")).toBeNull();
  });

  it("acknowledges, follows up while waiting, and keeps quiet over an answer", () => {
    vi.useFakeTimers();
    const said: string[] = [];
    startFillers("s2", "Wie spät ist es?", "de", (t) => said.push(t));
    vi.advanceTimersByTime(500);
    expect(said).toHaveLength(1);
    vi.advanceTimersByTime(7000);
    expect(said).toHaveLength(2);
    expect(said[0]).not.toBe(said[1]);
    state.speaking = { sessionId: "s2" };
    vi.advanceTimersByTime(12000);
    expect(said).toHaveLength(2);
    state.speaking = null;
    stopFillers();
    vi.advanceTimersByTime(60000);
    expect(said).toHaveLength(2);
    startFillers("s3", "mach was", "de", (t) => said.push(t), false);
    vi.advanceTimersByTime(60000);
    expect(said).toHaveLength(3);
  });

  it("says what it is doing, in words a person would use", () => {
    expect(siteName("https://developer.mozilla.org/en-US/docs/WebAssembly")).toBe("MDN");
    expect(siteName("https://www.webassembly.org/")).toBe("webassembly.org");
    expect(siteName("nonsense")).toBeNull();
    expect(activityPhrase("Fetching https://github.com/rust-lang/rust", "de")).toBe("Ich lese gerade bei GitHub nach.");
    expect(activityPhrase("Web search: wasm component model 2026", "en")).toBe("Searching the web.");
    expect(activityPhrase("Editing store.ts", "de")).toBe("Ich schreib gerade am Code.");
    expect(activityPhrase("Run the unit tests", "de")).toBe("Ich lass kurz die Tests laufen.");
    expect(activityPhrase("Install the dependencies", "de")).toBe("Ich lass kurz was laufen.");
    expect(activityPhrase("Thinking…", "de")).toBeNull();
    expect(activityPhrase("Updating the todo list", "de")).toBeNull();
  });

  it("speaks its own interim words cleanly", () => {
    expect(interimSpeech("Ich schau kurz bei **MDN** nach [[w1]]. Dann baue ich das Board. Und dann noch etwas Drittes.")).toBe("Ich schau kurz bei MDN nach. Dann baue ich das Board.");
    expect(interimSpeech("```js\nx\n```")).toBeNull();
    expect(interimSpeech(null)).toBeNull();
  });

  it("prefers its own words, then what it does, never too often", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const said: [string, boolean][] = [];
    state.sessions = { s4: { runtime: { interim: "Alte Antwort." } } };
    startFillers("s4", "Erklär mir WebAssembly", "de", (t, _id, own) => said.push([t, !!own]));
    vi.advanceTimersByTime(400); // the acknowledgement
    fillerUpdate("s4", "Thinking…", "Alte Antwort."); // the old answer is not new
    expect(said).toHaveLength(1);
    fillerUpdate("s4", "Web search: wasm", "Ich recherchiere kurz zwei Quellen.");
    expect(said[1]).toEqual(["Ich recherchiere kurz zwei Quellen.", true]);
    vi.advanceTimersByTime(1000);
    expect(said).toHaveLength(2); // too soon after its own words
    vi.advanceTimersByTime(1600); // ~2.5 s in: what it is doing
    expect(said[2]).toEqual(["Ich suche kurz im Netz.", false]);
    fillerUpdate("s4", "Fetching https://developer.mozilla.org/x", "Ich recherchiere kurz zwei Quellen.");
    vi.advanceTimersByTime(3000);
    expect(said).toHaveLength(3); // at most one line every ~6–8 s
    vi.advanceTimersByTime(3500);
    expect(said[3][0]).toBe("Ich lese gerade bei MDN nach.");
    for (let i = 0; i < 6; i++) {
      fillerUpdate("s4", "Fetching https://developer.mozilla.org/z", null);
      vi.advanceTimersByTime(7000);
    }
    const texts = said.map((x) => x[0]);
    expect(texts.filter((x) => x.includes("MDN"))).toHaveLength(1); // the same thing only once
    expect(new Set(texts).size).toBe(texts.length); // never a line twice in one wait
    stopFillers();
    state.sessions = {};
    vi.restoreAllMocks();
  });

  it("falls back to a light filler only without activity, and stops at once for the answer", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const said: string[] = [];
    state.sessions = { s5: { runtime: { currentActivity: "Thinking…" } } };
    startFillers("s5", "Was meinst du?", "de", (t) => said.push(t));
    vi.advanceTimersByTime(2600);
    expect(said).toHaveLength(1); // only the acknowledgement: nothing to report yet
    vi.advanceTimersByTime(4000);
    expect(said).toHaveLength(2); // a filler after ~6 s
    state.sessions = { s5: { runtime: { currentActivity: "Reading notes.md" } } };
    vi.advanceTimersByTime(6100);
    expect(said[2]).toBe("Ich lese gerade die Unterlagen.");
    state.speaking = { sessionId: "s5" };
    vi.advanceTimersByTime(20000);
    expect(said).toHaveLength(3); // never over the answer
    state.speaking = null;
    stopFillers();
    state.sessions = {};
    vi.restoreAllMocks();
  });

  it("stays silent while muted", () => {
    vi.useFakeTimers();
    const said: string[] = [];
    (state as Record<string, unknown>).settings = { voiceMuted: true };
    startFillers("s6", "Wie spät ist es?", "de", (t) => said.push(t));
    vi.advanceTimersByTime(30000);
    expect(said).toHaveLength(0);
    stopFillers();
    (state as Record<string, unknown>).settings = {};
  });
});
