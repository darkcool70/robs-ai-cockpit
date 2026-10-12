import { describe, expect, it, vi } from "vitest";

const voices = [
  { id: "de_DE-thorsten-medium", label: "Thorsten", lang: "de", hint: "German · male", sizeMb: 63, installed: true, engine: "piper" },
  { id: "st-M4", label: "Supertonic Max", lang: "de", hint: "German · male · natural", sizeMb: 415, installed: true, engine: "supertonic", multilingual: true },
  { id: "az-de-DE-ConradNeural", label: "Conrad (Azure)", lang: "de", hint: "German · male", sizeMb: 0, installed: true, engine: "azure", styles: ["cheerful", "sad"] },
];
const ttsSpeak = vi.fn();
const toast = vi.fn();
const settings: Record<string, unknown> = { voiceLanguage: "de" };
vi.mock("./api", () => ({
  api: { ttsStatus: async () => ({ engineInstalled: true, voices, installing: false, running: null }), ttsSpeak: (...a: unknown[]) => ttsSpeak(...a) },
  errMsg: (e: unknown) => String(e),
}));
vi.mock("../store", () => ({ useApp: { getState: () => ({ settings, toast }), subscribe: vi.fn(), setState: vi.fn() } }));
vi.mock("./voice", () => ({ lastDictatedTarget: vi.fn(), startDictation: vi.fn() }));
vi.mock("./sfx", () => ({ audioContext: vi.fn(), playSfx: vi.fn() }));
vi.mock("./assistants", () => ({ assistantOf: vi.fn() }));
vi.mock("./hooks", () => ({ voiceHooks: {} }));
const { refreshNeural, synth, neuralVoice, piperFallback, engineOf, styleFor } = await import("./tts");
await refreshNeural();

describe("voice engines", () => {
  it("knows which engine speaks a voice", () => {
    expect(engineOf("st-M4")).toBe("supertonic");
    expect(engineOf("az-de-DE-ConradNeural")).toBe("azure");
    expect(engineOf("de_DE-thorsten-medium")).toBe("piper");
    expect(engineOf("st-unknown")).toBe("supertonic");
  });

  it("uses a cloud voice only when it was chosen", () => {
    settings.ttsNeuralVoice = "az-de-DE-ConradNeural";
    expect(neuralVoice()).toBe("az-de-DE-ConradNeural");
    settings.ttsNeuralVoice = "gone";
    // default Piper voice installed → that one, never the cloud
    expect(neuralVoice()).toBe("de_DE-thorsten-medium");
    expect(piperFallback("de")).toBe("de_DE-thorsten-medium");
  });

  it("says a failed sentence with the local Piper voice and tells you once", async () => {
    ttsSpeak.mockReset();
    toast.mockReset();
    const wav = new ArrayBuffer(8);
    ttsSpeak.mockImplementation(async (_t: string, voice: string) => {
      if (voice.startsWith("az-")) throw "Azure rejected the key (wrong key or region)";
      return wav;
    });
    await expect(synth("Hallo Rob.", "az-de-DE-ConradNeural", 1, "cheerful", "de")).resolves.toBe(wav);
    expect(ttsSpeak).toHaveBeenLastCalledWith("Hallo Rob.", "de_DE-thorsten-medium", 1, undefined, "de");
    await synth("Noch ein Satz.", "az-de-DE-ConradNeural", 1, undefined, "de");
    expect(toast).toHaveBeenCalledTimes(1);
    // a Piper error is not hidden behind another Piper voice
    ttsSpeak.mockImplementation(async () => { throw "engine stopped"; });
    await expect(synth("x", "de_DE-thorsten-medium", 1, undefined, "de")).rejects.toBe("engine stopped");
  });

  it("passes the sentence's language to a multilingual engine", async () => {
    ttsSpeak.mockReset();
    ttsSpeak.mockResolvedValue(new ArrayBuffer(4));
    await synth("All tests passed.", "st-M4", 1.05, undefined, "en");
    expect(ttsSpeak).toHaveBeenCalledWith("All tests passed.", "st-M4", 1.05, undefined, "en");
  });

  it("maps moods onto the styles a voice has", () => {
    settings.ttsStyle = "auto";
    expect(styleFor("az-de-DE-ConradNeural", "success", 12)).toBe("cheerful");
    expect(styleFor("az-de-DE-ConradNeural", "neutral", 12)).toBeUndefined();
    expect(styleFor("az-de-DE-ConradNeural", "quiet", 12)).toBeUndefined();
    expect(styleFor("st-M4", "success", 12)).toBeUndefined();
  });
});
