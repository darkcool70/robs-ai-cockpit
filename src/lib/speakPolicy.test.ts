import { describe, expect, it } from "vitest";
import { Once, causeOfTurn, kindOfCause, listenAfter, shortSpeech, speakModeOf, speechDecision, spokenText, wakePaused } from "./speakPolicy";

describe("when it speaks", () => {
  it("„Nur wenn ich frage“: answers to your voice, one short sentence when it needs you, else silent", () => {
    expect(speechDecision("answer", "asked")).toBe("full");
    expect(speechDecision("needsYou", "asked")).toBe("short");
    for (const k of ["typedAnswer", "event", "look", "digest"] as const) expect(speechDecision(k, "asked")).toBe("silent");
  });
  it("„Wichtiges auch melden“ adds news in one sentence, typed answers stay silent", () => {
    expect(speechDecision("event", "important")).toBe("short");
    expect(speechDecision("digest", "important")).toBe("full");
    expect(speechDecision("look", "important")).toBe("short");
    expect(speechDecision("typedAnswer", "important")).toBe("silent");
    expect(speechDecision("answer", "important")).toBe("full");
  });
  it("„Alles vorlesen“ is the old behaviour", () => {
    for (const k of ["answer", "typedAnswer", "event", "needsYou", "look", "digest"] as const) expect(speechDecision(k, "all")).toBe("full");
  });
  it("reads the setting, the old „every agent“ means everything, default is asked", () => {
    expect(speakModeOf({})).toBe("asked");
    expect(speakModeOf({ ttsWhen: "voice" })).toBe("asked");
    expect(speakModeOf({ ttsWhen: "always" })).toBe("all");
    expect(speakModeOf({ voiceSpeakWhen: "important", ttsWhen: "always" })).toBe("important");
    expect(speakModeOf({ voiceSpeakWhen: "nonsense" })).toBe("asked");
  });
  it("shortens to one sentence", () => {
    expect(shortSpeech("Codex braucht dich: es will den Ordner löschen. Soll ich zustimmen? Details im Chat.")).toBe("Codex braucht dich: es will den Ordner löschen.");
    expect(shortSpeech("  Fertig  ")).toBe("Fertig");
    expect(shortSpeech("")).toBe("");
    const long = shortSpeech(`${"Das ist ein sehr langer Satz ohne Ende, ".repeat(8)}und so weiter.`);
    expect(long.length).toBeLessThanOrEqual(162);
    expect(long.endsWith("…")).toBe(true);
    expect(spokenText("event", "asked", "Scout ist fertig. Drei Quellen.")).toBe("");
    expect(spokenText("event", "important", "Scout ist fertig. Drei Quellen.")).toBe("Scout ist fertig.");
    expect(spokenText("event", "all", "Scout ist fertig. Drei Quellen.")).toBe("Scout ist fertig. Drei Quellen.");
  });
});

describe("who started a turn", () => {
  it("tells voice, typed, events and their follow-up rounds apart", () => {
    expect(causeOfTurn("🎙 Wie ist der Stand?\n\n[snapshot]", null, [])).toBe("voice");
    expect(causeOfTurn("Wie ist der Stand?\n\n## Cockpit snapshot …", null, ["wie ist der  Stand?"])).toBe("voice");
    expect(causeOfTurn("Mach ein Dashboard", null, ["Wie ist der Stand?"])).toBe("typed");
    expect(causeOfTurn("📡 Event:\n\"Scout\" finished.", "voice", [])).toBe("event");
    expect(causeOfTurn("📡 Event:\n\"Scout\" needs a decision", "voice", [], true)).toBe("urgent");
    expect(causeOfTurn("📡 Results:\nfile read", "voice", [])).toBe("voice");
    expect(causeOfTurn("📡 Results:\nfile read", "typed", [])).toBe("typed");
    expect(causeOfTurn("📡 Results:\nfile read", "urgent", [])).toBe("event");
    expect(causeOfTurn("📡 Results:\nfile read", null, [])).toBe("typed");
    expect(causeOfTurn(null, null, [])).toBe("typed");
  });
  it("maps causes to kinds and listens again only when you are spoken to", () => {
    expect(kindOfCause("voice")).toBe("answer");
    expect(kindOfCause("typed")).toBe("typedAnswer");
    expect(kindOfCause("event")).toBe("event");
    expect(kindOfCause("urgent")).toBe("needsYou");
    expect(listenAfter("answer")).toBe(true);
    expect(listenAfter("needsYou")).toBe(true);
    expect(listenAfter("event")).toBe(false);
    expect(listenAfter("typedAnswer")).toBe(false);
  });
  it("says a thing once", () => {
    const o = new Once(1000);
    expect(o.first("a", 0)).toBe(true);
    expect(o.first("a", 500)).toBe(false);
    expect(o.first("b", 500)).toBe(true);
    expect(o.first("a", 2000)).toBe(true);
  });
  it("keeps the wake word listening while a conversation waits", () => {
    expect(wakePaused("idle", false)).toBe(false);
    expect(wakePaused("recording", false)).toBe(true);
    expect(wakePaused("idle", true)).toBe(true);
  });
});
