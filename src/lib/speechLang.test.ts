import { describe, expect, it } from "vitest";
import { type VoiceInfo, detectLang, missingGermanVoice, voiceForLang } from "./speechLang";

const v = (id: string, lang: string, hint: string, installed = true): VoiceInfo => ({ id, lang, hint, installed });
const AMY = v("en_US-amy-medium", "en", "American English · female");
const ALAN = v("en_GB-alan-medium", "en", "British English · male · the butler");
const KERSTIN = v("de_DE-kerstin-low", "de", "German · female · bright");
const RAMONA = v("de_DE-ramona-low", "de", "German · female");
const THORSTEN = v("de_DE-thorsten-medium", "de", "German · male · clear and calm");

describe("language of a sentence", () => {
  it("tells German from English", () => {
    expect(detectLang("Hallo Rob, ich bin Jana und spreche jetzt Deutsch.")).toBe("de");
    expect(detectLang("Agent zwei ist fertig, die Tests sind grün.")).toBe("de");
    expect(detectLang("Gesendet.")).toBe("de");
    expect(detectLang("Überprüfe Änderungen")).toBe("de");
    expect(detectLang("Agent two has finished and the tests are green.")).toBe("en");
    expect(detectLang("I'm done, it's all ready.")).toBe("en");
    expect(detectLang("Der Build ist done und der Merge läuft.")).toBe("de");
  });
  it("gives no answer without a hint", () => {
    expect(detectLang("Standby.")).toBeNull();
    expect(detectLang("Okay.")).toBeNull();
    expect(detectLang("")).toBeNull();
  });
});

describe("voice for German text", () => {
  const all = [AMY, ALAN, KERSTIN, RAMONA, THORSTEN];
  it("moves German from Amy to Kerstin, a little higher to match her", () => {
    expect(voiceForLang(AMY.id, "de", all, {})).toEqual({ voice: KERSTIN.id, pitch: 1.12 });
    expect(voiceForLang(AMY.id, "en", all, {})).toEqual({ voice: AMY.id, pitch: 1 });
  });
  it("keeps a male voice male and a German voice as it is", () => {
    expect(voiceForLang(ALAN.id, "de", all, {})).toEqual({ voice: THORSTEN.id, pitch: 1 });
    expect(voiceForLang(THORSTEN.id, "de", all, {})).toEqual({ voice: THORSTEN.id, pitch: 1 });
  });
  it("follows the settings", () => {
    // „Amy · Deutsch mit Akzent“ is retired: an old `ttsAutoLanguage: false` no longer keeps German with Amy
    expect(voiceForLang(AMY.id, "de", all, { ttsAutoLanguage: false })).toEqual({ voice: KERSTIN.id, pitch: 1.12 });
    expect(voiceForLang(AMY.id, "de", all, { ttsGermanVoice: RAMONA.id })).toEqual({ voice: RAMONA.id, pitch: 1 });
    expect(voiceForLang(AMY.id, "de", all, { ttsGermanPitch: 1.06 })).toEqual({ voice: KERSTIN.id, pitch: 1.06 });
    expect(voiceForLang(AMY.id, "de", all, { ttsGermanPitch: "auto" })).toEqual({ voice: KERSTIN.id, pitch: 1.12 });
    const EVA = v("de_DE-eva_k-x_low", "de", "German · female · friendly, small (20 MB), a little muffled");
    expect(voiceForLang(AMY.id, "de", [...all, EVA], { ttsGermanVoice: EVA.id })).toEqual({ voice: EVA.id, pitch: 1.06 });
  });
  it("falls back to an installed German voice, else stays with Amy", () => {
    expect(voiceForLang(AMY.id, "de", [AMY, { ...KERSTIN, installed: false }, THORSTEN, RAMONA], {}).voice).toBe(RAMONA.id);
    expect(voiceForLang(AMY.id, "de", [AMY, { ...KERSTIN, installed: false }], {})).toEqual({ voice: AMY.id, pitch: 1 });
  });
  it("names the German voice to download when none is there", () => {
    expect(missingGermanVoice(AMY.id, [AMY, { ...KERSTIN, installed: false }], {})).toBe(KERSTIN.id);
    expect(missingGermanVoice(ALAN.id, [ALAN], {})).toBe(THORSTEN.id);
    expect(missingGermanVoice(AMY.id, [AMY, KERSTIN], {})).toBeNull();
    expect(missingGermanVoice(AMY.id, [AMY], { ttsAutoLanguage: false })).toBe(KERSTIN.id);
  });
});

describe("natural and cloud voices", () => {
  const ST_F = { ...v("st-F1", "de", "German · female · natural"), engine: "supertonic" };
  const ST_M = { ...v("st-M4", "de", "German · male · natural"), engine: "supertonic" };
  const AZ = { ...v("az-de-DE-KatjaNeural", "de", "German · female · clear"), engine: "azure" };
  it("prefers the natural local voice for German text, matched by gender, without a pitch trick", () => {
    expect(voiceForLang(AMY.id, "de", [AMY, KERSTIN, ST_F, ST_M], {})).toEqual({ voice: ST_F.id, pitch: 1 });
    expect(voiceForLang(ALAN.id, "de", [ALAN, THORSTEN, ST_F, ST_M], {})).toEqual({ voice: ST_M.id, pitch: 1 });
    // a natural voice speaks English itself
    expect(voiceForLang(ST_F.id, "en", [AMY, ST_F], {})).toEqual({ voice: ST_F.id, pitch: 1 });
  });
  it("never picks a cloud voice unless it was chosen", () => {
    expect(voiceForLang(AMY.id, "de", [AMY, AZ], {})).toEqual({ voice: AMY.id, pitch: 1 });
    expect(voiceForLang(AMY.id, "de", [AMY, AZ, RAMONA], {}).voice).toBe(RAMONA.id);
    expect(voiceForLang(AMY.id, "de", [AMY, AZ], { ttsGermanVoice: AZ.id }).voice).toBe(AZ.id);
    expect(missingGermanVoice(AMY.id, [AMY, AZ], {})).toBe(KERSTIN.id);
  });
  it("downloads only a small Piper voice by itself", () => {
    expect(missingGermanVoice(AMY.id, [AMY, { ...ST_F, installed: false }], { ttsGermanVoice: ST_F.id })).toBe(KERSTIN.id);
  });
});
