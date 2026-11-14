import { describe, expect, it } from "vitest";
import { REPEAT_MS, STALE_TURN_MS, shouldNotify, type SentLog } from "./notifyDedup";

const NOW = 1_800_000_000_000;

describe("shouldNotify", () => {
  it("shows a fresh note once and records it", () => {
    const log: SentLog = {};
    expect(shouldNotify(log, "s1:done", "All tests pass.", NOW - 1000, NOW)).toBe(true);
    expect(log["s1:done"]).toEqual({ message: "all tests pass.", at: NOW, turn: NOW - 1000 });
  });

  it("skips a turn that ended long ago (transcript re-read after a start or resume)", () => {
    expect(shouldNotify({}, "s1:done", "Old answer", NOW - STALE_TURN_MS - 1, NOW)).toBe(false);
    expect(shouldNotify({}, "s1:done", "Recent answer", NOW - STALE_TURN_MS + 1000, NOW)).toBe(true);
  });

  it("shows one note per turn, even when the status flips again later", () => {
    const log: SentLog = {};
    const turn = NOW - 2000;
    expect(shouldNotify(log, "s1:done", "Done.", turn, NOW)).toBe(true);
    expect(shouldNotify(log, "s1:done", "Done, plus a summary.", turn, NOW + 60_000)).toBe(false);
    expect(shouldNotify(log, "s1:done", "Next turn done.", NOW + 120_000, NOW + 125_000)).toBe(true);
  });

  it("does not repeat the same text for the same session within the repeat window", () => {
    const log: SentLog = {};
    expect(shouldNotify(log, "s1:input", "Allow edit of store.ts?", null, NOW)).toBe(true);
    expect(shouldNotify(log, "s1:input", "  allow edit of   store.ts? ", null, NOW + 60_000)).toBe(false);
    expect(shouldNotify(log, "s1:input", "Allow running npm test?", null, NOW + 70_000)).toBe(true);
    expect(shouldNotify(log, "s1:input", "Allow running npm test?", null, NOW + 70_000 + REPEAT_MS + 1)).toBe(true);
  });

  it("drops bursts but keeps sessions and kinds apart", () => {
    const log: SentLog = {};
    expect(shouldNotify(log, "s1:limit", "Limit reached", null, NOW)).toBe(true);
    expect(shouldNotify(log, "s1:limit", "Other text", null, NOW + 1000)).toBe(false);
    expect(shouldNotify(log, "s2:limit", "Limit reached", null, NOW + 1000)).toBe(true);
    expect(shouldNotify(log, "s1:failed", "Limit reached", null, NOW + 1000)).toBe(true);
  });
});
