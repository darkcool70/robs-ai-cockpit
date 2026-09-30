import { describe, expect, it, vi } from "vitest";

vi.mock("../store", () => ({ useApp: () => null }));
vi.mock("../lib/api", () => ({ api: {}, errMsg: String }));
const { suggestStopPhrase } = await import("./LoopsView");

describe("suggestStopPhrase", () => {
  it("finds the upper-case answer the prompt asks for", () => {
    expect(suggestStopPhrase("Wenn nichts mehr offen ist, antworte nur mit ALLE PUNKTE ERLEDIGT.")).toBe("ALLE PUNKTE ERLEDIGT");
    expect(suggestStopPhrase("When finished, reply only with DONE")).toBe("DONE");
    expect(suggestStopPhrase("Antworte mit einer kurzen Zusammenfassung")).toBeNull();
  });
});
