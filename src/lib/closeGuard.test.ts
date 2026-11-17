import { describe, expect, it } from "vitest";
import { closeDecision, closeTexts, FORCE_CLOSE_AFTER_MS, workingAgentNames } from "./closeGuard";

const s = (name: string, status: string, running = true, kind = "agent") => ({ name, kind, runtime: { running, status } }) as never;

describe("close guard", () => {
  it("counts only running agents that are mid-turn", () => {
    const names = workingAgentNames({
      a: s("A", "working"),
      b: s("B", "waiting-for-input"),
      c: s("C", "idle"),
      d: s("D", "working", false),
      e: s("E", "working", true, "login"),
      f: { name: "F", kind: "agent" } as never,
    });
    expect(names).toEqual(["A"]);
  });
  it("asks once, ignores quick repeats, closes on a deliberate repeat", () => {
    expect(closeDecision(0, null, 10)).toBe("close");
    expect(closeDecision(0, 5, 10)).toBe("close");
    expect(closeDecision(2, null, 10)).toBe("ask");
    expect(closeDecision(2, 1000, 1000 + FORCE_CLOSE_AFTER_MS - 1)).toBe("ignore");
    expect(closeDecision(2, 1000, 1000 + FORCE_CLOSE_AFTER_MS)).toBe("close");
  });
  it("speaks German unless English is chosen", () => {
    expect(closeTexts(["A", "B"], false)).toMatchObject({ close: "Trotzdem schließen", keep: "Offen lassen" });
    expect(closeTexts(["A", "B"], false).body).toContain("2 Agenten arbeiten noch: A, B");
    expect(closeTexts(["A"], true)).toMatchObject({ close: "Close anyway", keep: "Keep running" });
    expect(closeTexts(["A"], true).body).toContain("1 agent is still working: A");
  });
});
