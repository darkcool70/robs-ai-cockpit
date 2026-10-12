import { describe, expect, it } from "vitest";
import { AGENT_PROVIDERS, FREE_PROVIDERS, PROVIDERS, STRONG_PROVIDERS, isFreeTier, otherProvider, providerInfo } from "./providers";

describe("provider registry", () => {
  it("knows every agent CLI and which ones are free", () => {
    expect(AGENT_PROVIDERS).toEqual(["claude", "codex", "copilot", "antigravity"]);
    expect(FREE_PROVIDERS).toEqual(["copilot", "antigravity"]);
    expect(STRONG_PROVIDERS).toEqual(["claude", "codex"]);
    expect(isFreeTier("copilot")).toBe(true);
    expect(isFreeTier("claude")).toBe(false);
    expect(isFreeTier("custom")).toBe(false);
    expect(isFreeTier(undefined)).toBe(false);
  });

  it("describes each one consistently with the backend (cli.rs)", () => {
    expect(PROVIDERS.copilot.configEnv).toBe("COPILOT_HOME");
    expect(PROVIDERS.antigravity.configEnv).toBe("");
    expect(PROVIDERS.antigravity.singleProfile).toBe(true);
    expect(providerInfo("custom")).toBeNull();
    expect(providerInfo("codex")?.short).toBe("CX");
    for (const p of AGENT_PROVIDERS) expect(PROVIDERS[p].id).toBe(p);
  });

  it("reviews go to another provider — a strong one for work done for free", () => {
    expect(otherProvider("claude")).toBe("codex");
    expect(otherProvider("codex")).toBe("claude");
    expect(otherProvider("copilot")).toBe("claude");
    expect(otherProvider("antigravity")).toBe("claude");
    expect(otherProvider(undefined)).toBeUndefined();
  });
});
