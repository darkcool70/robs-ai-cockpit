import { describe, expect, it } from "vitest";
import { briefSpeech, controlEffect, isMutedIn, speechControl } from "./speechControl";

describe("speech control", () => {
  it("mutes on short spoken or typed requests, in German and English", () => {
    for (const t of [
      "Sprich erstmal nicht.", "sprich erst mal nicht", "Sei still!", "sei mal still", "Atlas, sei bitte ruhig.", "Psst.", "pssst", "Ruhe bitte",
      "Hey Atlas, psst", "mute", "Mute.", "stumm", "Schalte dich stumm", "nicht mehr sprechen", "sprich jetzt nicht", "🎙 Sei still",
      "be quiet", "Stop talking.", "shut up", "Mute yourself for now",
    ]) expect(speechControl(t), t).toBe("mute");
  });

  it("unmutes", () => {
    for (const t of ["Du darfst wieder sprechen.", "sprich wieder", "Du kannst wieder reden", "Atlas, sprich wieder mit mir", "Ton an", "unmute", "You can talk again"]) {
      expect(speechControl(t), t).toBe("unmute");
    }
  });

  it("talks less, more, or reads everything", () => {
    for (const t of ["Sprich weniger.", "rede bitte weniger", "Nur das Wichtigste", "nur noch das Wichtigste bitte", "Fass dich kürzer", "talk less", "keep it short"]) {
      expect(speechControl(t), t).toBe("less");
    }
    for (const t of ["Sag mir alles.", "Sprich mehr", "Halt mich auf dem Laufenden", "tell me everything", "keep me posted"]) expect(speechControl(t), t).toBe("more");
    for (const t of ["Lies alles vor.", "lies mir alles vor", "Alles vorlesen", "read everything"]) expect(speechControl(t), t).toBe("all");
  });

  it("does not misfire on normal sentences", () => {
    for (const t of [
      "Sprich mit dem Agenten über die Tests.",
      "sprich mit Codex über das Board",
      "Sag mir alles über WebAssembly",
      "Lies alles vor, was im Board steht und fasse es zusammen",
      "Sag nichts über die Preise im Bericht",
      "Erzähl mir mehr",
      "Sei still und mach die Tests grün",
      "Warum ist es so still im Log?",
      "Mach die Antworten im Board kürzer",
      "Nur das Wichtigste aus dem Paper zusammenfassen bitte für morgen",
      "stopp", "weiter", "warte", "pause",
      "Stummschaltung im Video entfernen und neu hochladen",
      "",
    ]) expect(speechControl(t), t).toBeNull();
  });

  it("knows the operator's own name in front", () => {
    expect(speechControl("Jarvis, sei still", ["Jarvis"])).toBe("mute");
    expect(speechControl("Jarvis, sei still", [])).toBeNull();
  });

  it("changes the settings and confirms briefly", () => {
    expect(controlEffect("mute")).toMatchObject({ settings: { voiceMuted: true }, say: "" });
    expect(controlEffect("unmute")).toMatchObject({ settings: { voiceMuted: false }, say: "Okay." });
    expect(controlEffect("less").settings).toEqual({ voiceMuted: false, voiceSpeakWhen: "asked", voiceBrief: true });
    expect(controlEffect("more").settings).toMatchObject({ voiceMuted: false, voiceSpeakWhen: "important", voiceBrief: false });
    expect(controlEffect("all").settings).toMatchObject({ voiceSpeakWhen: "all", voiceBrief: false });
    for (const c of ["mute", "unmute", "less", "more", "all"] as const) {
      expect(controlEffect(c).toast.length).toBeGreaterThan(5);
      expect(controlEffect(c, true).toast).not.toBe(controlEffect(c).toast);
      expect(controlEffect(c).say.split(" ").length).toBeLessThanOrEqual(1);
    }
    expect(isMutedIn({ voiceMuted: true })).toBe(true);
    expect(isMutedIn({})).toBe(false);
  });

  it("keeps an answer to two sentences when it should talk less", () => {
    expect(briefSpeech("Erster Satz. Zweiter Satz [[p1]]. Dritter Satz.")).toBe("Erster Satz. Zweiter Satz [[p1]].");
    expect(briefSpeech("Version 1.2 ist da. Sie kann mehr. Und noch mehr.")).toBe("Version 1.2 ist da. Sie kann mehr.");
    expect(briefSpeech("")).toBe("");
    const long = `${"Wort ".repeat(80)}Ende.`;
    expect(briefSpeech(long).length).toBeLessThanOrEqual(242);
  });
});
