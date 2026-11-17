import { describe, expect, it } from "vitest";
import { cantAnswer, cantAnswerSpeech, holdsMessages, limitResetAt } from "./cantAnswer";

const session = (status: string, error?: { kind: string; message: string; at: number }) => ({ runtime: { status, error, attention: null, turnEndedAt: 5 } }) as never;
// Saturday 14.11.2026, 21:44 local time
const AT = new Date(2026, 10, 14, 21, 44, 41).getTime();
const LIMIT = "You've hit your 5-hour limit · resets 2:20am (Europe/Berlin)";

describe("the assistant cannot answer", () => {
  it("knows why: a limit, a failed turn — or nothing is wrong", () => {
    expect(cantAnswer(session("rate-limited", { kind: "limit", message: LIMIT, at: AT }))).toEqual({ kind: "limit", message: LIMIT, at: AT });
    expect(cantAnswer(session("error", { kind: "auth", message: "Login expired", at: 9 }))).toMatchObject({ kind: "auth" });
    expect(cantAnswer(session("error"))).toMatchObject({ kind: "unknown", at: 5 });
    expect(cantAnswer(session("working"))).toBeNull();
    expect(cantAnswer(session("waiting"))).toBeNull();
    expect(cantAnswer(undefined)).toBeNull();
  });

  it("reads when a limit resets from the CLI's words", () => {
    const next = limitResetAt(LIMIT, AT)!;
    expect(new Date(next).getDate()).toBe(15);
    expect([new Date(next).getHours(), new Date(next).getMinutes()]).toEqual([2, 20]);
    expect(new Date(limitResetAt("You've hit your weekly limit · resets 11pm", AT)!).getHours()).toBe(23);
    expect(new Date(limitResetAt("limit reached, resets at 14:30", AT)!).getDate()).toBe(15);
    expect(limitResetAt("usage limit reached", AT)).toBeNull();
  });

  it("says it once and plainly — no waiting phrases", () => {
    const c = cantAnswer(session("rate-limited", { kind: "limit", message: LIMIT, at: AT }))!;
    expect(cantAnswerSpeech(c)).toBe("Mein Kontingent ist aufgebraucht. Ab 2:20 Uhr kann ich weitermachen.");
    expect(cantAnswerSpeech(c, true)).toBe("My usage limit is used up. I can go on at 2:20 am.");
    expect(cantAnswerSpeech({ kind: "limit", message: "limit", at: AT })).toContain("Kontingent ist aufgebraucht");
    for (const kind of ["auth", "model", "server", "network", "request", "unknown"] as const) {
      const say = cantAnswerSpeech({ kind, message: "", at: 0 });
      expect(say.length).toBeGreaterThan(20);
      expect(say).not.toMatch(/moment|gleich|warte|bescheid/i);
    }
  });

  it("holds new messages only while the limit is in force", () => {
    const c = cantAnswer(session("rate-limited", { kind: "limit", message: LIMIT, at: AT }))!;
    expect(holdsMessages(c, AT + 60_000)).toBe(true);
    expect(holdsMessages(c, limitResetAt(LIMIT, AT)! + 1000)).toBe(false);
    expect(holdsMessages({ kind: "limit", message: "limit", at: AT }, AT + 60_000)).toBe(true);
    expect(holdsMessages({ kind: "server", message: "", at: AT }, AT)).toBe(false);
    expect(holdsMessages(null)).toBe(false);
  });
});
