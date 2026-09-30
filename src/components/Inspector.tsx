import { useCallback, useEffect, useState } from "react";
import { GitBranch, RefreshCw, Trash2 } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type GitStatus, type UsageSummary, type Worktree } from "../lib/api";
import { compact, shortPath } from "../lib/format";
import { Badge, Button, Empty, IconButton, SectionTitle } from "./ui";

/** Right-hand panel: git state + usage of the focused session. */
export function Inspector() {
  const focusedId = useApp((s) => s.panes[s.focused]);
  const session = useApp((s) => (focusedId ? s.sessions[focusedId] : undefined));
  const project = useApp((s) => s.projects.find((p) => p.id === (session?.projectId ?? s.activeProjectId)));
  const usageVersion = useApp((s) => s.usageVersion);
  const toast = useApp((s) => s.toast);
  const dir = session?.cwd ?? project?.path;

  const [git, setGit] = useState<GitStatus | null>(null);
  const [wts, setWts] = useState<Worktree[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const load = useCallback(async () => {
    if (!dir) return;
    try {
      setGit(await api.gitStatus(dir));
      setWts(project ? await api.gitWorktrees(project.path).catch(() => []) : []);
    } catch {
      setGit(null);
    }
  }, [dir, project?.path]);

  useEffect(() => {
    void load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!session?.accountId) return setUsage(null);
    api.usageSummary("today", { accountId: session.accountId }).then(setUsage).catch(() => setUsage(null));
  }, [session?.accountId, usageVersion]);

  const sessionTotals = usage?.bySession.find((g) => g.key === session?.providerSessionId)?.totals;

  if (!dir) return <Empty>Select a project or focus a session.</Empty>;
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-3 text-[12px]">
      <section>
        <SectionTitle right={<IconButton title="Refresh" onClick={() => void load()}><RefreshCw size={12} /></IconButton>}>Git</SectionTitle>
        {!git?.isRepo ? (
          <p className="text-faint">{shortPath(dir)} is not a git repository.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <GitBranch size={13} className="text-muted" />
              <span className="font-mono text-fg">{git.branch}</span>
              {git.head && <span className="font-mono text-faint">{git.head.slice(0, 7)}</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              {git.ahead > 0 && <Badge tone="accent">↑{git.ahead}</Badge>}
              {git.behind > 0 && <Badge tone="warn">↓{git.behind}</Badge>}
              <Badge tone={git.staged ? "ok" : "neutral"}>{git.staged} staged</Badge>
              <Badge tone={git.modified ? "warn" : "neutral"}>{git.modified} modified</Badge>
              <Badge>{git.untracked} untracked</Badge>
              {git.conflicted > 0 && <Badge tone="err">{git.conflicted} conflicts</Badge>}
            </div>
            {(git.insertions > 0 || git.deletions > 0) && (
              <div className="font-mono text-[11.5px]">
                <span className="text-ok">+{git.insertions}</span> <span className="text-err">−{git.deletions}</span>
                <span className="text-faint"> vs HEAD</span>
              </div>
            )}
            <ul className="max-h-48 overflow-auto font-mono text-[11px]">
              {git.files.slice(0, 80).map((f) => (
                <li key={f.path + f.code} className="flex gap-2 truncate">
                  <span className={f.code === "??" ? "text-faint" : f.code.startsWith(".") ? "text-warn" : "text-ok"}>{f.code}</span>
                  <span className="truncate text-muted" title={f.path}>{f.path}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {project && wts.length > 1 && (
        <section>
          <SectionTitle>Worktrees</SectionTitle>
          <ul className="space-y-1">
            {wts.map((w) => (
              <li key={w.path} className="flex items-center gap-2">
                <span className="flex-1 truncate font-mono text-[11.5px]" title={w.path}>{w.branch ?? "(detached)"}</span>
                {w.isMain ? (
                  <Badge>main</Badge>
                ) : (
                  <IconButton
                    title="Remove worktree (only if clean; branch is kept)"
                    onClick={async () => {
                      try {
                        await api.gitWorktreeRemove(project.id, w.path);
                        toast("Worktree removed (branch kept)", "ok");
                        void load();
                      } catch (e) {
                        toast(errMsg(e), "error");
                      }
                    }}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {session && (
        <section>
          <SectionTitle>Session</SectionTitle>
          <dl className="grid grid-cols-[88px_1fr] gap-y-1 text-[11.5px]">
            <dt className="text-faint">Directory</dt><dd className="truncate" title={session.cwd}>{shortPath(session.cwd, 34)}</dd>
            <dt className="text-faint">Model</dt><dd>{session.runtime?.model ?? session.model ?? "–"}</dd>
            <dt className="text-faint">Conversation</dt><dd className="truncate font-mono text-[10.5px]" title={session.providerSessionId ?? ""}>{session.providerSessionId ?? "–"}</dd>
            <dt className="text-faint">Transcript</dt><dd className="truncate text-[10.5px]" title={session.runtime?.transcriptPath ?? session.transcriptPath ?? ""}>{shortPath(session.runtime?.transcriptPath ?? session.transcriptPath ?? "–", 34)}</dd>
            <dt className="text-faint">PID</dt><dd>{session.runtime?.pid ?? "–"}</dd>
          </dl>
        </section>
      )}

      {session && (
        <section>
          <SectionTitle>Tokens (measured, today)</SectionTitle>
          {sessionTotals ? (
            <dl className="grid grid-cols-2 gap-y-1 tabular text-[11.5px]">
              <dt className="text-faint">This session</dt><dd className="text-right">{compact(sessionTotals.total)}</dd>
              <dt className="text-faint">Input</dt><dd className="text-right">{compact(sessionTotals.input)}</dd>
              <dt className="text-faint">Output</dt><dd className="text-right">{compact(sessionTotals.output)}</dd>
              <dt className="text-faint">Cache read</dt><dd className="text-right">{compact(sessionTotals.cacheRead)}</dd>
              <dt className="text-faint">Cache write</dt><dd className="text-right">{compact(sessionTotals.cacheWrite)}</dd>
            </dl>
          ) : (
            <p className="text-faint">No indexed usage for this conversation yet. Logs are indexed every minute.</p>
          )}
          {usage && <p className="mt-2 text-faint">Account today: <span className="text-muted tabular">{compact(usage.totals.total)}</span></p>}
          <Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={() => void api.usageReindex().then(() => toast("Usage re-indexed", "ok"))}>
            <RefreshCw size={11} /> Index now
          </Button>
        </section>
      )}
    </div>
  );
}
