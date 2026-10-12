import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: {} }));
vi.mock("../store", () => ({ useApp: { getState: vi.fn(), subscribe: vi.fn(), setState: vi.fn() } }));
vi.mock("./voice", () => ({ lastDictatedTarget: vi.fn(), startDictation: vi.fn() }));
vi.mock("./sfx", () => ({ audioContext: vi.fn(), playSfx: vi.fn() }));
vi.mock("./assistants", () => ({ assistantOf: vi.fn() }));
vi.mock("./hooks", () => ({ voiceHooks: {} }));
const { splitSentences, forSpeech, markersOf, withoutMarkers, withoutReport, moodOf, clampPitch } = await import("./tts");

describe("speech in pieces", () => {
  it("splits into sentences and joins very short ones", () => {
    expect(splitSentences("Okay. Ich starte jetzt zwei Agenten im eigenen Worktree. Der erste baut den Login, der zweite schreibt die Tests!"))
      .toEqual(["Okay. Ich starte jetzt zwei Agenten im eigenen Worktree.", "Der erste baut den Login, der zweite schreibt die Tests!"]);
    expect(splitSentences("Fertig.")).toEqual(["Fertig."]);
    expect(splitSentences("Der Compiler erzeugt eine .wasm-Datei mit Version 1.2 daraus. Danach lädt der Browser sie und prüft alles.")).toEqual([
      "Der Compiler erzeugt eine .wasm-Datei mit Version 1.2 daraus.",
      "Danach lädt der Browser sie und prüft alles.",
    ]);
    expect(splitSentences("")).toEqual([]);
  });
  it("cuts long sentences at a comma", () => {
    const long = `${"Das ist ein sehr langer Satz mit vielen Wörtern".repeat(3)}, und hier geht es weiter mit noch mehr Text ${"bla ".repeat(30)}.`;
    const parts = splitSentences(long, 220);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 220)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " "));
  });
  it("never reads action blocks aloud", () => {
    expect(forSpeech('Mach ich.\n```cockpit-actions\n[{"do":"status"}]\n```')).toBe("Mach ich.");
  });
});

describe("pointing while speaking", () => {
  it("finds card markers and never reads them", () => {
    const t = "Zuerst das Backend [[s1]], dann der Login [[s2]] und [[p-2]].";
    expect(markersOf(t)).toEqual(["s1", "s2", "p-2"]);
    expect(withoutMarkers(t)).toBe("Zuerst das Backend, dann der Login und.");
    expect(forSpeech("Plan [[g1]] steht.")).toBe("Plan [[g1]] steht.");
    expect(splitSentences("Erst das Backend mit der Datenbank [[s1]]. Danach kommt der Login [[s2]].")).toEqual([
      "Erst das Backend mit der Datenbank [[s1]].",
      "Danach kommt der Login [[s2]].",
    ]);
  });

  it("hears good news and keeps the pitch sensible", () => {
    expect(moodOf("Fertig, alle Tests sind grün.")).toBe("success");
    expect(moodOf("Der Build ist kaputt.")).toBe("neutral");
    expect([clampPitch(1.06), clampPitch(3), clampPitch(0.1), clampPitch("x")]).toEqual([1.06, 1.2, 0.8, 1]);
  });
});

describe("withoutReport", () => {
  it("drops Done/Verified lines and keeps the next step as a sentence", () => {
    const out = forSpeech(["Ich habe das Dashboard gebaut.", "", "Done: Dashboard angelegt", "Verified: Noch nicht.", "Next: Echte Zahlen eintragen."].join("\n"));
    expect(out).toBe("Ich habe das Dashboard gebaut. Echte Zahlen eintragen.");
  });
  it("leaves ordinary sentences with the words alone", () => {
    expect(withoutReport("Done is better than perfect.")).toBe("Done is better than perfect.");
  });
});
