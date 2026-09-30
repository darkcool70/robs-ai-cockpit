import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register: vi.fn(), unregisterAll: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./api", () => ({ api: {}, errMsg: String }));
vi.mock("../store", () => ({ useApp: { getState: vi.fn(), subscribe: vi.fn() } }));

const { hotkeyFromEvent, prettyHotkey, altGrConflict, routeSpoken, parseControl } = await import("./voice");

describe("addressing a session by name", () => {
  const cands = [
    { id: "a", names: ["Claude A #1", "Claude A", "pane 1"] },
    { id: "b", names: ["Claude B", "pane 2"] },
    { id: "x", names: ["Codex · proj", "Codex", "pane 3"] },
  ];
  it("routes a leading name with punctuation", () => {
    expect(routeSpoken("Claude B, führe die Tests aus.", cands)).toEqual({ id: "b", text: "Führe die Tests aus." });
    expect(routeSpoken("Cloud B: mach weiter", cands)).toEqual({ id: "b", text: "Mach weiter" });
    expect(routeSpoken("Kodex, review the diff", cands)).toEqual({ id: "x", text: "Review the diff" });
    expect(routeSpoken("An Claude A. Commit bitte.", cands)).toEqual({ id: "a", text: "Commit bitte." });
    expect(routeSpoken("Fenster zwei, stopp", cands)).toEqual({ id: "b", text: "Stopp" });
  });
  it("leaves normal sentences alone", () => {
    expect(routeSpoken("Claude B soll danach die Tests machen", cands)).toBeNull();
    expect(routeSpoken("Frag Codex, ob das geht", cands)).toBeNull();
    expect(routeSpoken("Claude B,", cands)).toBeNull();
  });
});
const ev = (code: string, m: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m });

describe("voice shortcuts", () => {
  it("builds layout-independent accelerators from key presses", () => {
    expect(hotkeyFromEvent(ev("Digit1", { ctrlKey: true, altKey: true }))).toBe("Control+Alt+Digit1");
    expect(hotkeyFromEvent(ev("KeyM", { shiftKey: true, metaKey: true }))).toBe("Shift+Super+KeyM");
    expect(hotkeyFromEvent(ev("F13"))).toBe("F13");
  });
  it("waits while only modifiers are held and rejects bare keys", () => {
    expect(hotkeyFromEvent(ev("ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(hotkeyFromEvent(ev("KeyA"))).toBeNull();
  });
  it("rejects combinations that are AltGr characters on German keyboards", () => {
    expect(altGrConflict("Control+Alt+Digit9")).toBe("]");
    expect(altGrConflict("Control+Alt+KeyQ")).toBe("@");
    expect(altGrConflict("Control+Alt+Digit1")).toBeNull();
    expect(altGrConflict("Control+Shift+Digit9")).toBeNull();
    expect(altGrConflict("Alt+Shift+Space")).toBeNull();
  });
  it("shows readable labels", () => {
    expect(prettyHotkey("Control+Alt+Digit1")).toBe("Ctrl + Alt + 1");
    expect(prettyHotkey("Super+KeyD")).toBe("Win + D");
    expect(prettyHotkey(null)).toBe("");
  });
});

describe("spoken control commands", () => {
  it("recognises short steering commands", () => {
    expect(parseControl("Fenster 3 stopp.")).toEqual({ action: "stop", pane: 3 });
    expect(parseControl("Fenster zwei groß")).toEqual({ action: "zoom", pane: 2 });
    expect(parseControl("Zeig Fenster vier")).toEqual({ action: "focus", pane: 4 });
    expect(parseControl("Zeige die Übersicht!")).toEqual({ action: "view", view: "overview" });
    expect(parseControl("Alle weiter, bitte.")).toEqual({ action: "continue-all" });
    expect(parseControl("alle Fenster")).toEqual({ action: "show-all" });
    expect(parseControl("Öffne Aufgaben")).toEqual({ action: "view", view: "tasks" });
  });
  it("types everything else", () => {
    expect(parseControl("Fenster 3 soll die Tests stoppen und neu starten")).toBeNull();
    expect(parseControl("Mach alle Tests weiter grün")).toBeNull();
    expect(parseControl("Fenster 9 stopp")).toBeNull();
    expect(parseControl("")).toBeNull();
  });
});
