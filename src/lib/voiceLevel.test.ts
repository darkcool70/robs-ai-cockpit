import { describe, expect, it } from "vitest";
import { controlEffect } from "./speechControl";
import {
  VOICE_LEVELS, controlOfLevel, levelChanges, levelLabel, levelOfControl, levelTitle, phaseLabel, settingsForLevel, talkPhaseOf, voiceLevelOf,
} from "./voiceLevel";

describe("voice level ↔ settings", () => {
  it("reads the segment from the settings", () => {
    expect(voiceLevelOf({})).toBe("short"); // default: „Nur wenn ich frage“
    expect(voiceLevelOf({ voiceSpeakWhen: "asked", voiceBrief: true })).toBe("short");
    expect(voiceLevelOf({ voiceSpeakWhen: "asked", voiceBrief: false })).toBe("short");
    expect(voiceLevelOf({ voiceSpeakWhen: "important" })).toBe("normal");
    expect(voiceLevelOf({ voiceSpeakWhen: "all" })).toBe("all");
    expect(voiceLevelOf({ ttsWhen: "always" })).toBe("all"); // the old setting
    expect(voiceLevelOf({ voiceMuted: true, voiceSpeakWhen: "all" })).toBe("mute");
    expect(voiceLevelOf({ ttsEnabled: false, voiceSpeakWhen: "important" })).toBe("mute");
  });

  it("every segment round-trips through its settings", () => {
    for (const l of VOICE_LEVELS) expect(voiceLevelOf(settingsForLevel(l))).toBe(l);
  });

  it("writes exactly the speak mode and brevity of each segment", () => {
    expect(settingsForLevel("mute")).toEqual({ voiceMuted: true });
    expect(settingsForLevel("short")).toEqual({ voiceMuted: false, voiceSpeakWhen: "asked", voiceBrief: true, ttsEnabled: true });
    expect(settingsForLevel("normal")).toEqual({ voiceMuted: false, voiceSpeakWhen: "important", voiceBrief: false, ttsEnabled: true });
    expect(settingsForLevel("all")).toEqual({ voiceMuted: false, voiceSpeakWhen: "all", voiceBrief: false, ttsEnabled: true });
  });

  it("muting keeps the level underneath, so unmuting goes back to it", () => {
    const s = { voiceSpeakWhen: "all", voiceBrief: false, ttsEnabled: true };
    expect(levelChanges(s, "mute")).toEqual({ voiceMuted: true });
    expect(levelOfControl("unmute", { ...s, voiceMuted: true })).toBe("all");
  });

  it("only changed settings are written", () => {
    expect(levelChanges(settingsForLevel("normal"), "normal")).toEqual({});
    expect(levelChanges({ voiceMuted: false, voiceSpeakWhen: "asked", voiceBrief: false, ttsEnabled: true }, "short")).toEqual({ voiceBrief: true });
  });

  it("agrees with the spoken / typed controls", () => {
    for (const l of VOICE_LEVELS) {
      const cmd = controlOfLevel(l);
      expect(levelOfControl(cmd, {})).toBe(l);
      // what „sei still“ / „sprich weniger“ / „sag mir alles“ / „lies alles vor“ writes shows the same segment
      expect(voiceLevelOf(controlEffect(cmd).settings)).toBe(l);
      // and is a subset of what the segment writes
      expect(settingsForLevel(l)).toMatchObject(controlEffect(cmd).settings);
    }
  });

  it("labels and tooltips in both languages", () => {
    expect(VOICE_LEVELS.map((l) => levelLabel(l, false))).toEqual(["Stumm", "Kurz", "Normal", "Alles"]);
    expect(VOICE_LEVELS.map((l) => levelLabel(l, true))).toEqual(["Mute", "Brief", "Normal", "All"]);
    expect(levelTitle("mute", false)).toContain("Strg+Umschalt+M");
    expect(levelTitle("mute", false, true)).toContain("sprich wieder");
    expect(levelTitle("short", false)).toContain("nur, wenn du");
    expect(levelTitle("all", true)).toContain("everything");
  });
});

describe("talk phase", () => {
  const base = { sessionId: "a", talkSession: null, voiceState: "idle", voiceTarget: null, speakingSession: null, busy: false };
  it("nothing going on: no phase", () => {
    expect(talkPhaseOf(base)).toBeNull();
    expect(talkPhaseOf({ ...base, sessionId: null })).toBeNull();
    expect(talkPhaseOf({ ...base, busy: true })).toBeNull(); // working on a typed message is not a conversation
  });
  it("the same phases as the voice pill, for this assistant only", () => {
    expect(talkPhaseOf({ ...base, voiceState: "recording", voiceTarget: "a" })).toBe("listening");
    expect(talkPhaseOf({ ...base, voiceState: "recording", voiceTarget: "b" })).toBeNull();
    expect(talkPhaseOf({ ...base, voiceState: "transcribing", voiceTarget: "a" })).toBe("understanding");
    expect(talkPhaseOf({ ...base, voiceState: "sending", voiceTarget: "a" })).toBe("understanding");
    expect(talkPhaseOf({ ...base, speakingSession: "a" })).toBe("speaking"); // also outside a conversation: Unterbrechen
    expect(talkPhaseOf({ ...base, speakingSession: "b", talkSession: "a" })).toBe("waiting");
    expect(talkPhaseOf({ ...base, talkSession: "a", busy: true })).toBe("thinking");
    expect(talkPhaseOf({ ...base, talkSession: "a" })).toBe("waiting");
  });
  it("labels", () => {
    expect(phaseLabel("listening", false)).toBe("Hört zu");
    expect(phaseLabel("speaking", true)).toBe("Speaking");
  });
});
