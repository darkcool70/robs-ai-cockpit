// Guard: every setting the UI writes must be allowed by the backend (settings_set refuses others).
import { describe, expect, it } from "vitest";

// Node's fs without Node type definitions in this project (tests run in Node).
type Fs = { readFileSync(p: URL, e: "utf8"): string; readdirSync(p: URL): string[]; statSync(p: URL): { isDirectory(): boolean } };
const fsName = "node:fs";
const fs = (await import(/* @vite-ignore */ fsName)) as Fs;
const root = new URL("../../", import.meta.url);

function files(dir: URL): URL[] {
  let out: URL[] = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = new URL(f, dir);
      if (fs.statSync(p).isDirectory()) out = out.concat(files(new URL(`${f}/`, dir)));
      else if (/\.tsx?$/.test(f) && !f.endsWith(".test.ts")) out.push(p);
    }
  } catch {
    /* no such folder (open-source build without ./pro) */
  }
  return out;
}

describe("settings keys", () => {
  it("are all known to the backend", () => {
    const rust = fs.readFileSync(new URL("src-tauri/src/commands.rs", root), "utf8");
    const start = rust.indexOf("const SETTING_KEYS");
    const allowed = new Set([...rust.slice(start, rust.indexOf("];", start)).matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]));
    const written = new Set<string>();
    for (const f of [...files(new URL("src/", root)), ...files(new URL("pro/src/", root))]) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/(?:setSetting|\bput)\(\s*"([A-Za-z]+)"/g)) written.add(m[1]);
    }
    expect(written.size).toBeGreaterThan(20);
    expect([...written].filter((k) => !allowed.has(k))).toEqual([]);
  });
});
