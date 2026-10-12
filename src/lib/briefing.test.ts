import { describe, expect, it, vi } from "vitest";

vi.mock("../store", () => ({ useApp: { getState: vi.fn(), subscribe: vi.fn() } }));
vi.mock("./workflow", () => ({ turnJustEnded: vi.fn() }));
vi.mock("./tts", () => ({ phrase: (k: string) => (k === "welcome" ? "Willkommen zurück." : k), speak: vi.fn() }));
const { briefingText } = await import("./briefing");

describe("welcome-back briefing", () => {
  it("tells what happened, once per agent", () => {
    expect(briefingText({ finished: ["Claude B", "Codex", "Claude B"], asking: ["Datei-Agent"], limited: [] }, 2, false)).toBe(
      "Willkommen zurück. Während du weg warst: Claude B und Codex sind fertig geworden. Datei-Agent braucht deine Entscheidung. 2 Aufgaben warten auf dein Review.",
    );
    expect(briefingText({ finished: ["A"], asking: [], limited: ["B"] }, 0, true)).toBe("Willkommen zurück. While you were away: A has finished. B hit a usage limit.");
  });
  it("says nothing when nothing happened", () => {
    expect(briefingText({ finished: [], asking: [], limited: [] }, 0, false)).toBe("");
  });
});
