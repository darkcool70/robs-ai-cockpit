import { describe, expect, it } from "vitest";
import { freshKey, randomKey, savedKeys, ttlHours, untilLabel } from "./remoteKeys";

const H = 3_600_000;
const key = "A".repeat(32);
const view = "B".repeat(32);

describe("phone remote keys", () => {
  it("offers only the known lifetimes (default 24 h)", () => {
    expect(ttlHours({})).toBe(24);
    expect(ttlHours({ remoteKeyTtl: 8 })).toBe(8);
    expect(ttlHours({ remoteKeyTtl: 168 })).toBe(168);
    expect(ttlHours({ remoteKeyTtl: 99999 })).toBe(24);
    expect(freshKey({ remoteKeyTtl: 8 }, 1000).expires).toBe(1000 + 8 * H);
  });

  it("makes long random keys the server accepts", () => {
    const a = randomKey(), b = randomKey();
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(a).not.toBe(b);
  });

  it("gives a key from before expiry the chosen lifetime from now, once", () => {
    const old = savedKeys({ remoteKey: key, remoteKeyTtl: 8 }, 5000);
    expect(old.keys).toEqual({ key, expires: 5000 + 8 * H, viewKey: null, viewExpires: 0 });
    expect(old.fix).toEqual({ remoteKeyExpires: 5000 + 8 * H });
    const kept = savedKeys({ remoteKey: key, remoteKeyExpires: 42 }, 5000);
    expect(kept.keys?.expires).toBe(42);
    expect(kept.fix).toEqual({});
    expect(savedKeys({ remoteKey: "short" }).keys).toBeNull();
  });

  it("keeps a valid view-only key, never the same as the owner's", () => {
    expect(savedKeys({ remoteKey: key, remoteKeyExpires: 9, remoteViewKey: view, remoteViewExpires: 7 }).keys).toMatchObject({ viewKey: view, viewExpires: 7 });
    expect(savedKeys({ remoteKey: key, remoteKeyExpires: 9, remoteViewKey: key, remoteViewExpires: 7 }).keys).toMatchObject({ viewKey: null, viewExpires: 0 });
    expect(savedKeys({ remoteKey: key, remoteKeyExpires: 9, remoteViewKey: "" }).keys?.viewKey).toBeNull();
    const fix = savedKeys({ remoteKey: key, remoteKeyExpires: 9, remoteViewKey: view }, 100).fix;
    expect(fix).toEqual({ remoteViewExpires: 100 + 24 * H });
  });

  it("says calmly how long a key is left", () => {
    expect(untilLabel(0, 1)).toBe("expired");
    expect(untilLabel(40 * 60_000, 0)).toBe("in 40 min");
    expect(untilLabel(5 * H, 0)).toBe("in 5 h");
    expect(untilLabel(7 * 24 * H, 0)).toBe("in 7 days");
  });
});
