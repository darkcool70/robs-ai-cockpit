import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./lib/api";

const mocks = vi.hoisted(() => ({
  api: {
    sessionStart: vi.fn(), sessionRestart: vi.fn(), sessionClose: vi.fn(),
    appInfo: vi.fn(), detectClis: vi.fn(), projectsList: vi.fn(), accountsList: vi.fn(),
    sessionsOpen: vi.fn(), layoutGet: vi.fn(), quotaOverview: vi.fn(),
    settingsGet: vi.fn(), accountCheckAuth: vi.fn(), sessionHandoff: vi.fn(),
  },
  listen: vi.fn(),
  terms: { attach: vi.fn(), prepareForStart: vi.fn(), size: vi.fn(), focus: vi.fn(), dispose: vi.fn() },
}));
vi.mock("./lib/api", () => ({ api: mocks.api, errMsg: (e: unknown) => String(e) }));
vi.mock("./lib/terminals", () => mocks.terms);
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

const session: Session = {
  id: "s", name: "Test", provider: "claude", kind: "agent", accountId: "a", projectId: null,
  cwd: "C:/project", extraArgs: [], options: {}, autoContinue: false, status: "stopped", model: "claude-opus", requestedModel: null,
  exitCode: 0, providerSessionId: "conversation", transcriptPath: null, worktreePath: null,
  createdAt: "t", startedAt: "t", endedAt: "t", lastActivityAt: "t", closed: false,
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  mocks.terms.attach.mockResolvedValue(undefined);
  mocks.terms.size.mockReturnValue({ cols: 80, rows: 24 });
  mocks.listen.mockResolvedValue(vi.fn());
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("session lifecycle", () => {
  it("coalesces rapid Resume clicks and waits for terminal attachment", async () => {
    const { useApp } = await import("./store");
    useApp.setState({ sessions: { s: session } });
    let resolve!: (s: Session) => void;
    mocks.api.sessionStart.mockReturnValue(new Promise<Session>((r) => { resolve = r; }));
    const first = useApp.getState().startSession("s");
    await useApp.getState().startSession("s");
    expect(mocks.api.sessionStart).toHaveBeenCalledTimes(1);
    expect(useApp.getState().launching.s).toBe(true);
    resolve(session);
    await first;
    expect(useApp.getState().launching.s).toBe(false);
    expect(mocks.terms.focus).toHaveBeenCalledWith("s");
  });

  it("keeps a session visible when closing fails", async () => {
    const { useApp } = await import("./store");
    useApp.setState({ sessions: { s: session }, order: ["s"], panes: ["s", null] });
    mocks.api.sessionClose.mockRejectedValue(new Error("backend unavailable"));
    await useApp.getState().closeSession("s");
    expect(useApp.getState().sessions.s).toEqual(session);
    expect(mocks.terms.dispose).not.toHaveBeenCalled();
  });

  it("allows another Resume after a start error", async () => {
    const { useApp } = await import("./store");
    useApp.setState({ sessions: { s: session } });
    mocks.api.sessionStart.mockRejectedValueOnce(new Error("missing CLI")).mockResolvedValueOnce(session);
    await useApp.getState().startSession("s");
    expect(useApp.getState().sessions.s.status).toBe("failed");
    expect(useApp.getState().launching.s).toBe(false);
    await useApp.getState().startSession("s");
    expect(mocks.api.sessionStart).toHaveBeenCalledTimes(2);
  });

  it("shows startup errors and supports retry", async () => {
    const { useApp } = await import("./store");
    mocks.api.appInfo.mockRejectedValueOnce(new Error("database busy")).mockResolvedValueOnce({});
    mocks.api.detectClis.mockResolvedValue([]);
    mocks.api.projectsList.mockResolvedValue([]);
    mocks.api.accountsList.mockResolvedValue([]);
    mocks.api.sessionsOpen.mockResolvedValue([]);
    mocks.api.layoutGet.mockResolvedValue(null);
    mocks.api.quotaOverview.mockResolvedValue({});
    mocks.api.settingsGet.mockResolvedValue({});
    await useApp.getState().init();
    expect(useApp.getState().initError).toContain("database busy");
    expect(useApp.getState().ready).toBe(false);
    await useApp.getState().init();
    expect(useApp.getState().ready).toBe(true);
    expect(useApp.getState().initError).toBeNull();
    expect(mocks.listen).toHaveBeenCalledTimes(7);
  });

  it("hands a conversation over in place of the old pane", async () => {
    const { useApp } = await import("./store");
    const moved: Session = { ...session, id: "n", accountId: "b", status: "idle", startedAt: null };
    useApp.setState({ sessions: { s: session }, order: ["s"], panes: [null, "s"], mode: "2", accounts: [] });
    mocks.api.sessionHandoff.mockResolvedValue(moved);
    await useApp.getState().handoffSession("s", "b", "continue");
    const st = useApp.getState();
    expect(mocks.api.sessionHandoff).toHaveBeenCalledWith("s", "b", "continue");
    expect(st.panes).toEqual([null, "n"]);
    expect(st.order).toEqual(["n"]);
    expect(st.sessions.s).toBeUndefined();
    expect(st.pendingStart.n).toBe(true);
    expect(mocks.terms.dispose).toHaveBeenCalledWith("s");
  });
});
