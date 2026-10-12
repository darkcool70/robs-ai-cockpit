import { describe, expect, it } from "vitest";
import { activityKind, activityLines, nextProgressLine, progressGap, type ProgressInput } from "./progress";

const base: ProgressInput = { elapsedMs: 4000, sinceSpokeMs: 3000, gapMs: 7000, count: 0, activity: null, said: [], lang: "de" };

describe("progress lines", () => {
  it("knows what the agent is doing from its live activity", () => {
    expect(activityKind("Fetching https://developer.mozilla.org/x")).toBe("fetch");
    expect(activityKind("Web search: wasm 2026")).toBe("search");
    expect(activityKind("Reading notes.md")).toBe("readDoc");
    expect(activityKind("Reading store.ts")).toBe("readCode");
    expect(activityKind("Searching TODO")).toBe("find");
    expect(activityKind("Editing a.ts")).toBe("edit");
    expect(activityKind("Subagent: research pricing")).toBe("helper");
    expect(activityKind("Run the unit tests")).toBe("tests");
    expect(activityKind("Build the frontend")).toBe("build");
    expect(activityKind("Lay out the board cards")).toBe("board");
    expect(activityKind("Thinking…")).toBeNull();
    expect(activityKind("Updating the todo list")).toBeNull();
    expect(activityKind(null)).toBeNull();
    expect(activityKind("Tool github__create_pr")).toBeNull();
  });

  it("names the site first, in natural German or English", () => {
    expect(activityLines("Fetching https://github.com/rust-lang/rust", "de")[0]).toBe("Ich lese gerade bei GitHub nach.");
    expect(activityLines("Fetching https://github.com/x", "en")[0]).toBe("Reading up on GitHub.");
    expect(activityLines("Lay out the board cards", "de")[0]).toBe("Ich baue die Karten auf.");
    expect(activityLines("Thinking…", "de")).toEqual([]);
    for (const a of ["Fetching https://x.org", "Web search: q", "Editing a.ts", "Run tests", "Reading a.md"]) {
      for (const l of activityLines(a, "de")) expect(l).toMatch(/^[A-ZÄÖÜ].*[.…]$/);
    }
  });

  it("waits ~2.5 s, then reports real activity first", () => {
    expect(nextProgressLine({ ...base, elapsedMs: 2000, activity: "Web search: q" })).toBeNull();
    expect(nextProgressLine({ ...base, activity: "Web search: q" })).toEqual({ text: "Ich suche kurz im Netz.", source: "activity" });
    // right after the acknowledgement or its own words: not yet
    expect(nextProgressLine({ ...base, sinceSpokeMs: 1000, activity: "Web search: q" })).toBeNull();
  });

  it("at most one line every gap, never the same line twice", () => {
    const o = { ...base, count: 1, activity: "Web search: q", said: ["Ich suche kurz im Netz."] };
    expect(nextProgressLine({ ...o, sinceSpokeMs: 5000 })).toBeNull();
    const next = nextProgressLine({ ...o, sinceSpokeMs: 7000 });
    expect(next?.source).toBe("activity");
    expect(next?.text).not.toBe("Ich suche kurz im Netz.");
  });

  it("falls back to a light filler only when there is nothing to report", () => {
    expect(nextProgressLine({ ...base, elapsedMs: 4000, sinceSpokeMs: 4000 })).toBeNull(); // too early for a filler
    const f = nextProgressLine({ ...base, elapsedMs: 6000, sinceSpokeMs: 5800 }, () => 0);
    expect(f).toEqual({ text: "Moment.", source: "filler" });
    // „sprich weniger“: no fillers, only real progress
    expect(nextProgressLine({ ...base, elapsedMs: 6000, sinceSpokeMs: 5800, brief: true })).toBeNull();
    expect(nextProgressLine({ ...base, brief: true, activity: "Editing a.ts" })?.source).toBe("activity");
    // longer waits: calmer, longer lines
    const late = nextProgressLine({ ...base, elapsedMs: 30000, sinceSpokeMs: 8000, count: 3 }, () => 0);
    expect(late?.text.length).toBeGreaterThan(20);
  });

  it("runs out instead of repeating itself", () => {
    const said: string[] = [];
    for (let i = 0; i < 40; i++) {
      const l = nextProgressLine({ ...base, elapsedMs: 6000 + i * 8000, sinceSpokeMs: 20000, count: i, said, activity: i < 6 ? "Web search: q" : null });
      if (!l) break;
      said.push(l.text);
    }
    expect(new Set(said).size).toBe(said.length);
    expect(said.length).toBeGreaterThan(5);
    expect(said.length).toBeLessThan(20);
  });

  it("spaces lines ~6–8 s, calmer after a long wait and when it should talk less", () => {
    expect(progressGap(5000, () => 0)).toBe(6000);
    expect(progressGap(5000, () => 1)).toBe(8000);
    expect(progressGap(60000, () => 0)).toBe(11000);
    expect(progressGap(5000, () => 0, true)).toBe(9000);
  });
});
