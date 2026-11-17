import { describe, expect, it } from "vitest";
import { MAX_STORED, MAX_VISIBLE, WINDOW_PAD, addNote, autoDismissMs, detailLine, fullText, orbSignature, resolveTheme, stackHeight, visibleNotes, windowHeight, windowWidth } from "./hudModel";

describe("autoDismissMs", () => {
  it("lets info notes fade after 8 s", () => {
    for (const k of ["done", "loop", "goal"] as const) expect(autoDismissMs(k)).toBe(8000);
  });
  it("keeps notes that need the user longer, but never forever", () => {
    for (const k of ["input", "limit", "failed"] as const) expect(autoDismissMs(k)).toBe(30_000);
    expect(autoDismissMs("input", 600)).toBe(120_000);
  });
  it("honours a shorter user setting for info and a longer one for urgent notes", () => {
    expect(autoDismissMs("done", 5)).toBe(5000);
    expect(autoDismissMs("done", 60)).toBe(8000);
    expect(autoDismissMs("input", 60)).toBe(60_000);
    expect(autoDismissMs("input", 5)).toBe(30_000);
    expect(autoDismissMs("done", 0)).toBe(8000);
  });
});

describe("visibleNotes", () => {
  it("shows everything up to the limit", () => {
    expect(visibleNotes([1, 2, 3])).toEqual({ visible: [1, 2, 3], more: 0 });
    expect(visibleNotes([])).toEqual({ visible: [], more: 0 });
  });
  it("collapses the oldest into +N more", () => {
    expect(visibleNotes([1, 2, 3, 4, 5])).toEqual({ visible: [3, 4, 5], more: 2 });
    expect(MAX_VISIBLE).toBe(3);
  });
});

describe("addNote", () => {
  it("replaces an older note of the same session and appends the new one", () => {
    const r = addNote([{ sessionId: "a", n: 1 }, { sessionId: "b", n: 2 }], { sessionId: "a", n: 3 });
    expect(r).toEqual([{ sessionId: "b", n: 2 }, { sessionId: "a", n: 3 }]);
  });
  it("caps the stack", () => {
    let cur: { sessionId: string }[] = [];
    for (let i = 0; i < MAX_STORED + 5; i++) cur = addNote(cur, { sessionId: `s${i}` });
    expect(cur).toHaveLength(MAX_STORED);
    expect(cur[cur.length - 1].sessionId).toBe(`s${MAX_STORED + 4}`);
  });
});

describe("detailLine / fullText", () => {
  it("uses the first non-empty message line, collapsed", () => {
    expect(detailLine({ message: "\n\n  All   tests pass.\nSecond line", subtitle: "x" })).toBe("All tests pass.");
  });
  it("falls back to the subtitle", () => {
    expect(detailLine({ message: " ", subtitle: "Acme · took 3m" })).toBe("Acme · took 3m");
    expect(detailLine({})).toBe("");
  });
  it("keeps the whole text for the tooltip", () => {
    expect(fullText({ title: "A", subtitle: "", message: "m1\nm2" })).toBe("A\nm1\nm2");
  });
});

describe("window size", () => {
  it("hides the window when there is no content", () => {
    expect(windowHeight(0)).toBe(0);
    expect(windowHeight(-3)).toBe(0);
    expect(stackHeight(0, 0)).toBe(0);
  });
  it("rounds up and caps the measured height", () => {
    expect(windowHeight(100.2)).toBe(101);
    expect(windowHeight(5000)).toBe(900);
  });
  it("grows with the number of cards", () => {
    expect(stackHeight(1, 0)).toBe(44 + 2 * WINDOW_PAD);
    expect(stackHeight(2, 0)).toBeGreaterThan(stackHeight(1, 0) + 44);
    expect(stackHeight(3, 2)).toBeGreaterThan(stackHeight(3, 0) - 1);
  });
  it("is as narrow as possible", () => {
    expect(windowWidth({ cards: true, voice: false })).toBe(336);
    expect(windowWidth({ cards: false, voice: true })).toBe(336);
    expect(windowWidth({ cards: false, voice: false })).toBeLessThan(80);
    expect(windowWidth({ cards: false, voice: false, orbHover: true })).toBeLessThan(336);
  });
});

describe("orb and theme", () => {
  it("changes the signature when the orb has news", () => {
    const a = orbSignature({ mood: "working", waiting: 0, total: 2 });
    expect(orbSignature({ mood: "working", waiting: 0, total: 2 })).toBe(a);
    expect(orbSignature({ mood: "waiting", waiting: 1, total: 2 })).not.toBe(a);
  });
  it("resolves the theme setting", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme(undefined, true)).toBe("dark");
  });
});
