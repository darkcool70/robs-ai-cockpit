import type { Autonomy } from "./api";

export const AUTONOMY: { value: Autonomy; label: string; hint: Record<"claude" | "codex", string> }[] = [
  { value: "", label: "CLI default", hint: { claude: "Whatever your Claude settings say", codex: "Whatever your Codex config says" } },
  { value: "manual", label: "Manual", hint: { claude: "Asks before edits and commands", codex: "Read-only sandbox, asks for everything" } },
  { value: "plan", label: "Plan", hint: { claude: "Plans first, changes nothing until approved", codex: "Read-only sandbox (analyse & plan)" } },
  { value: "accept-edits", label: "Edits auto", hint: { claude: "File edits without asking, commands ask", codex: "Writes in the workspace, asks for the rest" } },
  { value: "auto", label: "Auto mode", hint: { claude: "Claude's auto mode: a classifier approves safe actions", codex: "Codex reviews approvals automatically (workspace-write)" } },
  { value: "full", label: "Full access", hint: { claude: "Skips ALL permission checks — only in sandboxes", codex: "No sandbox, no approvals — only in sandboxes" } },
];

export function autonomyLabel(a: Autonomy | null | undefined): string | null {
  if (!a) return null;
  return AUTONOMY.find((x) => x.value === a)?.label ?? a;
}
