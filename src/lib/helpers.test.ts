import { describe, expect, it, vi } from "vitest";

vi.mock("../store", () => ({ useApp: { getState: vi.fn(() => ({ settings: {} })), subscribe: vi.fn() }, reconcileTasks: vi.fn() }));
vi.mock("./voice", () => ({ lastDictatedTarget: () => null }));
vi.mock("./api", () => ({ api: {}, errMsg: String }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

const { summarize } = await import("./tts");
const { withPrompt } = await import("./prompts");
const { pathsForTerminal } = await import("./filedrop");
const { pinsMarkdown } = await import("../views/PinsView");

describe("read aloud", () => {
  it("drops code and markdown and keeps the first sentences", () => {
    const text = "## Fertig\n\nIch habe **zwei** Dateien geändert.\n\n```ts\nconst x = 1;\n```\n\nDie Tests sind grün. " + "Mehr Details folgen hier. ".repeat(20);
    const s = summarize(text, 120);
    expect(s).toContain("Ich habe zwei Dateien geändert.");
    expect(s).not.toContain("const x");
    expect(s).not.toContain("**");
    expect(s.length).toBeLessThanOrEqual(122);
  });
});

describe("prompt history", () => {
  it("keeps the newest first without duplicates", () => {
    expect(withPrompt(["b", "a"], " a ")).toEqual(["a", "b"]);
    expect(withPrompt(["a"], "  ")).toEqual(["a"]);
    expect(withPrompt(["c", "b", "a"], "d", 3)).toEqual(["d", "c", "b"]);
  });
});

describe("dropped files", () => {
  it("quotes paths with spaces", () => {
    expect(pathsForTerminal(["C:\\a.png", "C:\\My Files\\b.txt"])).toBe('C:\\a.png "C:\\My Files\\b.txt"');
  });
});

describe("pins export", () => {
  it("groups by project with notes as quotes", () => {
    const md = pinsMarkdown(
      [
        { id: "1", projectId: "p", sessionId: null, sessionName: "Claude B", text: "Antwort A", note: "wichtig", createdAt: "2026-09-28T10:00:00Z" },
        { id: "2", projectId: null, sessionId: null, sessionName: null, text: "Antwort B", note: null, createdAt: "2026-09-28T11:00:00Z" },
      ],
      (id) => (id === "p" ? "Cockpit" : "Ohne Projekt"),
    );
    expect(md).toContain("## Cockpit");
    expect(md).toContain("> wichtig");
    expect(md).toContain("## Ohne Projekt");
    expect(md.indexOf("Antwort A")).toBeLessThan(md.indexOf("Antwort B"));
  });
});
