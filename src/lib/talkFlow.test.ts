import { describe, expect, it } from "vitest";
import { closingRemark, expectsReply, followUpMs, FOLLOW_UP_MS } from "./talkFlow";

describe("the end of a conversation", () => {
  it("a closing remark is not a request", () => {
    for (const t of [
      "Ne, das passt so.", "🎙 Ne, das passt so.", "Fertig.", "Passt.", "Passt so.", "Das passt schon.", "Nee, passt schon, danke.", "Danke, das war's.",
      "Danke!", "Vielen Dank, Jana.", "Jana, danke.", "Alles gut.", "Nein danke.", "Okay, danke.", "Gut so.", "Das reicht.", "Reicht erstmal.", "Kannst du so lassen.",
      "Lass es so.", "Tschüss.", "Das wär's dann.", "Nö, alles gut.", "Super, danke dir.", "Perfekt, passt.", "Bin fertig.", "Mehr nicht.", "Sonst nichts, danke.",
      "That's all, thanks.", "No, that's it.", "All good.", "Thanks!", "Never mind.",
    ]) expect(closingRemark(t, ["Jana"]), t).toBe(true);
  });

  it("answers and requests go to the assistant", () => {
    for (const t of [
      "Ja.", "Okay.", "Gut.", "Nein.", "Ne.", "Ja, mach das.", "Passt das so mit dem Titel?", "Mach das fertig.", "Mach die Karte kleiner.", "Danke, und jetzt noch ein Bild vom Hund daneben.",
      "Das passt nicht, mach es größer.", "Fertig ist das noch nicht.", "Wann bist du fertig?", "Jana", "", "der zieht die", "Zeig mir das Board Katzen.",
      "Nein, nimm einen anderen Suchbegriff.", "Reicht das Kontingent noch?",
    ]) expect(closingRemark(t, ["Jana"]), t).toBe(false);
  });

  it("only a question waits for an answer", () => {
    expect(expectsReply("Das Bild bleibt. Soll ich es größer machen?")).toBe(true);
    expect(expectsReply("Soll ich das so lassen? Sag einfach Bescheid.")).toBe(true);
    expect(expectsReply("[[c1]] Welche Farbe möchtest du?")).toBe(true);
    expect(expectsReply("Alles klar, das Bild bleibt. Das Board steht.")).toBe(false);
    expect(expectsReply("War das eine Frage? Nein. Das Board steht. Die Karte ist kleiner.")).toBe(false);
    expect(expectsReply("")).toBe(false);
  });

  it("the follow-up window has a default and can be switched off", () => {
    expect(followUpMs(undefined)).toBe(FOLLOW_UP_MS);
    expect(followUpMs(0)).toBe(0);
    expect(followUpMs("3000")).toBe(3000);
    expect(followUpMs("x")).toBe(FOLLOW_UP_MS);
  });
});
