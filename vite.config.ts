import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Pro edition: the private repository checked out at ./pro (see docs/PRO.md). Without it the
// public build uses the stubs in src/pro-stub.
const root = fileURLToPath(new URL(".", import.meta.url));
const pro = existsSync(`${root}pro/src`);

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@app": `${root}src`,
      "@pro": pro ? `${root}pro/src` : `${root}src/pro-stub`,
    },
  },
  define: { __PRO__: JSON.stringify(pro) },
  // Keep Rust errors visible; Tauri expects a fixed port.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "pro/src/**/*.test.ts"],
  },
}));
