import { describe, expect, it } from "vitest";
import { baselineOf, flowView, hasDeviceLogin, isLoggedIn, loginInstruction, procState } from "./loginFlow";

const out = { status: "logged-out" as const, email: null };
const inn = { status: "connected" as const, email: "a@x.de" };

describe("procState", () => {
  it("is starting without a session", () => {
    expect(procState(undefined)).toBe("starting");
  });
  it("follows the runtime flag", () => {
    expect(procState({ runtime: { running: true } })).toBe("running");
    expect(procState({ runtime: { running: false } })).toBe("exited");
  });
  it("falls back to status without runtime", () => {
    expect(procState({ status: "starting" })).toBe("running");
    expect(procState({ status: "stopped" })).toBe("exited");
  });
});

describe("isLoggedIn", () => {
  it("connected after being logged out counts at once", () => {
    expect(isLoggedIn({ baseline: out, status: "connected", email: null, proc: "running", exitCode: null })).toBe(true);
  });
  it("not connected is never success", () => {
    expect(isLoggedIn({ baseline: out, status: "logged-out", email: null, proc: "exited", exitCode: 0 })).toBe(false);
  });
  it("an already connected account needs the process to finish or another login", () => {
    expect(isLoggedIn({ baseline: inn, status: "connected", email: "a@x.de", proc: "running", exitCode: null })).toBe(false);
    expect(isLoggedIn({ baseline: inn, status: "connected", email: "b@x.de", proc: "running", exitCode: null })).toBe(true);
    expect(isLoggedIn({ baseline: inn, status: "connected", email: "a@x.de", proc: "exited", exitCode: 0 })).toBe(true);
    expect(isLoggedIn({ baseline: inn, status: "connected", email: "a@x.de", proc: "exited", exitCode: 1 })).toBe(false);
  });
  it("baselineOf reads status and email", () => {
    expect(baselineOf({ authStatus: "expired", authEmail: undefined })).toEqual({ status: "expired", email: null });
  });
});

describe("flowView", () => {
  const base = { loggedIn: false, proc: "running" as const, hasLoginUrl: false, elapsedMs: 0, finalChecked: false, startError: false };
  it("starts at step 1", () => {
    expect(flowView(base).steps).toEqual(["active", "pending", "pending"]);
    expect(flowView({ ...base, proc: "starting" }).steps[0]).toBe("active");
  });
  it("moves to step 2 once the link is there or time passed", () => {
    expect(flowView({ ...base, hasLoginUrl: true }).steps).toEqual(["done", "active", "pending"]);
    expect(flowView({ ...base, elapsedMs: 7000 }).steps[1]).toBe("active");
  });
  it("success finishes all steps", () => {
    const v = flowView({ ...base, loggedIn: true });
    expect(v.phase).toBe("success");
    expect(v.steps).toEqual(["done", "done", "done"]);
  });
  it("exit: checks first, then fails", () => {
    expect(flowView({ ...base, proc: "exited" }).phase).toBe("working");
    const f = flowView({ ...base, proc: "exited", finalChecked: true });
    expect(f.phase).toBe("failed");
    expect(f.steps[1]).toBe("failed");
  });
  it("a start error fails step 1", () => {
    expect(flowView({ ...base, proc: "starting", startError: true }).steps[0]).toBe("failed");
  });
});

describe("loginInstruction", () => {
  it("names the account and differs per provider", () => {
    expect(loginInstruction("claude", "Claude A")).toContain("Claude A");
    expect(loginInstruction("codex", "Codex")).toContain("default browser");
    expect(loginInstruction("copilot", "C")).toContain("github.com/login/device");
    expect(loginInstruction("codex", "Codex", true)).toContain("code");
  });
  it("only codex has a device login", () => {
    expect(hasDeviceLogin("codex")).toBe(true);
    expect(hasDeviceLogin("claude")).toBe(false);
  });
});
