import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: {} }));
// the helper schedules with window.setTimeout: route it to whatever timers are active
(globalThis as unknown as { window: unknown }).window = { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) };
const { whenFree, nextBreakpointMs } = await import("./attention");

describe("speaking at a breakpoint", () => {
  it("waits while you type and speaks when you pause", async () => {
    vi.useFakeTimers();
    let typing = true;
    const said = vi.fn();
    whenFree(said, 45_000, async () => !typing, 500);
    await vi.advanceTimersByTimeAsync(2000);
    expect(said).not.toHaveBeenCalled();
    typing = false;
    await vi.advanceTimersByTimeAsync(600);
    expect(said).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it("does not wait forever", async () => {
    vi.useFakeTimers();
    const said = vi.fn();
    whenFree(said, 3000, async () => false, 500);
    await vi.advanceTimersByTimeAsync(3600);
    expect(said).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it("can be cancelled", async () => {
    vi.useFakeTimers();
    const said = vi.fn();
    const cancel = whenFree(said, 3000, async () => false, 500);
    cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(said).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("learning when to speak up", () => {
  it("waits longer after you cut it short, gets bolder when you listen", () => {
    expect(nextBreakpointMs(3000, true)).toBe(4000);
    expect(nextBreakpointMs(3000, false)).toBe(2750);
    expect(nextBreakpointMs(9800, true)).toBe(10000);
    expect(nextBreakpointMs(2100, false)).toBe(2000);
    expect(nextBreakpointMs(Number.NaN, true)).toBe(4000);
  });
});
