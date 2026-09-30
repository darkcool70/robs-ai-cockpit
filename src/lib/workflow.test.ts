import { describe, expect, it, vi } from "vitest";
import type { Session, Task } from "./api";

vi.mock("./api", () => ({ api: {}, errMsg: String }));
vi.mock("../store", () => ({ useApp: { getState: vi.fn(), subscribe: vi.fn() }, reconcileTasks: vi.fn() }));
vi.mock("./notify", () => ({ pushNow: vi.fn() }));

const { agentFree, nextTaskFor, shiftEnd, isHanging, testCommandFor } = await import("./workflow");

const session = (over: Partial<Session> = {}, rt: Record<string, unknown> = {}): Session =>
  ({
    id: "s", name: "S", provider: "claude", kind: "agent", accountId: "a", projectId: "p", cwd: "C:/proj", extraArgs: [], options: {},
    autoContinue: true, status: "idle", model: null, requestedModel: null, exitCode: null, providerSessionId: null, transcriptPath: null,
    worktreePath: null, createdAt: "", startedAt: "", endedAt: null, lastActivityAt: null, closed: false,
    runtime: { running: true, status: "waiting-for-input", pendingInput: false, ...rt },
    ...over,
  }) as unknown as Session;
const task = (id: string, over: Partial<Task> = {}): Task =>
  ({ id, title: id, text: "", status: "open", sessionId: null, result: null, sort: 0, createdAt: "", updatedAt: "", startedAt: null, finishedAt: null, ...over }) as Task;

describe("auto-dispatch", () => {
  it("only free agents get work", () => {
    expect(agentFree(session(), [])).toBe(true);
    expect(agentFree(session({}, { status: "working" }), [])).toBe(false);
    expect(agentFree(session({}, { pendingInput: true }), [])).toBe(false);
    expect(agentFree(session({}, { running: false }), [])).toBe(false);
    expect(agentFree(session(), [task("t", { status: "running", sessionId: "s" })])).toBe(false);
  });
  it("takes the first open task in board order that fits the agent's project", () => {
    const tasks = [task("b", { sort: 2 }), task("other", { sort: 0, projectId: "x" }), task("a", { sort: 1 }), task("wt", { sort: -1, worktree: "C:/w" })];
    expect(nextTaskFor(session(), tasks)?.id).toBe("a");
    expect(nextTaskFor(session({ projectId: "x" }), tasks)?.id).toBe("other");
    expect(nextTaskFor(session(), tasks, new Set(["p"]))).toBeNull();
  });
});

describe("night shift", () => {
  it("ends at the next occurrence of the given time", () => {
    const evening = new Date(2026, 8, 28, 22, 30).getTime();
    expect(new Date(shiftEnd("07:00", evening)).toString()).toBe(new Date(2026, 8, 29, 7, 0).toString());
    const early = new Date(2026, 8, 28, 2, 0).getTime();
    expect(new Date(shiftEnd("07:00", early)).toString()).toBe(new Date(2026, 8, 28, 7, 0).toString());
  });
});

describe("hang detection", () => {
  it("flags a working agent without progress for too long", () => {
    const now = 10 * 60 * 60_000;
    const s = session({}, { status: "working", turnStartedAt: now - 20 * 60_000 });
    expect(isHanging(s, now - 18 * 60_000, 15, now)).toBe(true);
    expect(isHanging(s, now - 2 * 60_000, 15, now)).toBe(false);
    expect(isHanging(s, undefined, 0, now)).toBe(false);
    expect(isHanging(session(), undefined, 15, now)).toBe(false);
  });
});

describe("tests after a turn", () => {
  it("uses the command of the project folder the agent works in (also inside worktrees)", () => {
    const cmds = { "C:\\Code\\app": "pnpm test", "C:/Code/app/sub": "cargo test", "C:/Other": "" };
    expect(testCommandFor("C:/Code/app", cmds)).toEqual({ dir: "C:/Code/app", command: "pnpm test" });
    expect(testCommandFor("C:/Code/app/.worktrees/task-1", cmds)).toEqual({ dir: "C:/Code/app/.worktrees/task-1", command: "pnpm test" });
    expect(testCommandFor("c:/code/app/sub", cmds)?.command).toBe("cargo test");
    expect(testCommandFor("C:/Other", cmds)).toBeNull();
    expect(testCommandFor("C:/Code/application", cmds)).toBeNull();
  });
});

describe("turn end", () => {
  it("fires once when a new turn end appears", async () => {
    const { turnJustEnded } = await import("./workflow");
    const a = session({}, { status: "waiting-for-input", turnEndedAt: 5 });
    expect(turnJustEnded(a, session({}, { status: "working", turnEndedAt: null }))).toBe(true);
    expect(turnJustEnded(a, a)).toBe(false);
    expect(turnJustEnded(session({}, { status: "working", turnEndedAt: 5 }), undefined)).toBe(false);
  });
});
