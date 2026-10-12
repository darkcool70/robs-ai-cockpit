import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(), listen: vi.fn() }));
vi.mock("./api", () => ({ api: {} }));
vi.mock("../store", () => ({ useApp: { getState: vi.fn(), subscribe: vi.fn() } }));
vi.mock("./voice", () => ({ toggleDictation: vi.fn(), voiceChoices: vi.fn() }));
const { orbOf } = await import("./notify");

const s = (name: string, status: string, notice?: string) => ({ name, kind: "agent", runtime: { running: true, status, notice } }) as never;

describe("ambient orb", () => {
  it("shows the most important state", () => {
    expect(orbOf([s("A", "working"), s("B", "waiting-for-input")], true, false)).toMatchObject({ show: true, mood: "working", working: 1, total: 2 });
    expect(orbOf([s("A", "working"), s("B", "waiting-for-input", "Claude needs your permission")], true, false)).toMatchObject({ mood: "waiting", waiting: 1 });
    expect(orbOf([s("A", "rate-limited"), s("B", "working", "x")], true, false).mood).toBe("trouble");
    expect(orbOf([s("A", "waiting-for-input")], true, false).mood).toBe("calm");
  });
  it("stays out of the way", () => {
    expect(orbOf([s("A", "working")], true, true).show).toBe(false); // the cockpit is in front
    expect(orbOf([s("A", "working")], false, false).show).toBe(false); // switched off
    expect(orbOf([], true, false).show).toBe(false); // nothing running
  });
});
