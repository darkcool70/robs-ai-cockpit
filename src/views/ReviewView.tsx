import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronRight, GitBranch, GitCommitHorizontal, RefreshCw } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type RecentFile, type Review } from "../lib/api";
import { compact } from "../lib/format";
import { Badge, Button, Card, cx, Empty, ProviderMark } from "../components/ui";

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** One diff per file (split at "diff --git"). */
export function splitDiff(diff: string): { file: string; text: string; added: number; removed: number }[] {
  const parts = diff.split(/^(?=diff --git )/m).filter((p) => p.trim());
  return parts.map((text) => {
    const m = text.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const lines = text.split("\n");
    return {
      file: m ? m[2] : "(diff)",
      text,
      added: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
      removed: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
    };
  });
}

/** Everything the agents changed in one repository: read the diff, then commit (yourself or by an agent). */
export function ReviewView() {
  const projects = useApp((s) => s.projects);
  const sessions = useApp((s) => s.sessions);
  const toast = useApp((s) => s.toast);
  const filesVersion = useApp((s) => s.filesVersion);
  const dirs = useMemo(() => {
    const seen = new Map<string, { path: string; label: string }>();
    for (const p of projects) seen.set(norm(p.path), { path: p.path, label: p.name });
    for (const s of Object.values(sessions)) {
      for (const d of [s.worktreePath, s.cwd]) {
        if (d && !seen.has(norm(d))) seen.set(norm(d), { path: d, label: d.split(/[\\/]/).filter(Boolean).pop() ?? d });
      }
    }
    return [...seen.values()];
  }, [projects, sessions]);
  const [dir, setDir] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!dir && dirs.length) setDir(useApp.getState().projects.find((p) => p.id === useApp.getState().activeProjectId)?.path ?? dirs[0].path);
  }, [dirs, dir]);
  const load = async (d = dir) => {
    if (!d) return;
    setLoading(true);
    setError(null);
    try {
      setReview(await api.reviewGet(d));
    } catch (e) {
      setReview(null);
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.recentFiles(500).then(setRecent).catch(() => {}); }, [filesVersion]);

  const files = useMemo(() => splitDiff(review?.diff ?? ""), [review]);
  const byAgent = (file: string) => {
    const f = norm(file);
    return recent.find((r) => norm(r.file).endsWith(`/${f}`) || norm(r.file) === f);
  };
  const agentsHere = Object.values(sessions).filter((s) => s.kind === "agent" && s.runtime?.running && dir && (norm(s.cwd) === norm(dir) || (s.worktreePath && norm(s.worktreePath) === norm(dir))));
  const commit = async () => {
    if (!dir || !review) return;
    const n = review.status.files.length;
    if (!window.confirm(`Commit all ${n} changed file(s) in ${dir}?\n\n"${message.trim()}"`)) return;
    try {
      const hash = await api.reviewCommit(dir, message);
      toast(`Committed ${hash}`, "ok");
      setMessage("");
      await load();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const agentCommit = async (id: string) => {
    const ok = await useApp.getState().queueInput(id, "Prüfe mit git status und git diff, was sich geändert hat, und committe es in sinnvollen Schritten mit aussagekräftigen Commit-Nachrichten. Committe nichts, was nicht dazugehört (Secrets, temporäre Dateien).");
    if (ok) toast(`${sessions[id]?.name} commits the changes`, "ok");
  };

  const s = review?.status;
  return (
    <div className="flex h-full min-h-0">
      <aside className="w-[240px] shrink-0 overflow-auto border-r border-line bg-panel p-2">
        <div className="px-1 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Repositories</div>
        {dirs.map((d) => (
          <button
            key={d.path}
            onClick={() => setDir(d.path)}
            title={d.path}
            className={cx("block w-full truncate rounded px-2 py-1.5 text-left text-[12.5px]", dir === d.path ? "bg-accent/10 text-fg" : "text-muted hover:bg-hover hover:text-fg")}
          >
            {d.label}
            <span className="block truncate text-[10.5px] text-faint">{d.path}</span>
          </button>
        ))}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="text-[16px] font-semibold">Review</h1>
            <p className="truncate text-[12px] text-muted">{dir ?? "Pick a repository"}</p>
          </div>
          {s && (
            <div className="ml-4 flex flex-wrap items-center gap-1.5">
              {s.branch && <Badge><GitBranch size={10} className="mr-1" />{s.branch}</Badge>}
              <Badge>{s.files.length} file{s.files.length === 1 ? "" : "s"}</Badge>
              <Badge tone="ok">+{compact(files.reduce((a, f) => a + f.added, 0))}</Badge>
              <Badge tone="err">−{compact(files.reduce((a, f) => a + f.removed, 0))}</Badge>
              {s.ahead > 0 && <Badge tone="accent">{s.ahead} to push</Badge>}
            </div>
          )}
          <Button className="ml-auto" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw size={12} /> Refresh</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error && <Card className="p-4 text-[12.5px] text-err">{error}</Card>}
          {!error && review && s && s.files.length === 0 && <Card className="p-8"><Empty>No uncommitted changes — everything is committed.</Empty></Card>}
          {!error && review && (
            <div className="space-y-2">
              {files.map((f) => {
                const who = byAgent(f.file);
                const isOpen = openFiles[f.file] ?? files.length <= 6;
                return (
                  <Card key={f.file}>
                    <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px]" onClick={() => setOpenFiles((o) => ({ ...o, [f.file]: !isOpen }))}>
                      <ChevronRight size={13} className={cx("shrink-0 text-faint transition-transform", isOpen && "rotate-90")} />
                      <span className="min-w-0 flex-1 truncate font-mono">{f.file}</span>
                      {who && <Badge title={`Last edited by ${who.sessionName}`}>{who.provider && <ProviderMark provider={who.provider as "claude" | "codex"} />}<span className="ml-1">{who.sessionName}</span></Badge>}
                      <span className="text-[11px] text-ok tabular">+{f.added}</span>
                      <span className="text-[11px] text-err tabular">−{f.removed}</span>
                    </button>
                    {isOpen && (
                      <pre className="max-h-[50vh] overflow-auto border-t border-line bg-term p-2 font-mono text-[11.5px] leading-[1.45]">
                        {f.text.split("\n").map((l, i) => (
                          <div key={i} className={cx(l.startsWith("+") && !l.startsWith("+++") && "bg-ok/10 text-ok", l.startsWith("-") && !l.startsWith("---") && "bg-err/10 text-err", l.startsWith("@@") && "text-accent", (l.startsWith("diff ") || l.startsWith("index ")) && "text-faint")}>
                            {l || " "}
                          </div>
                        ))}
                      </pre>
                    )}
                  </Card>
                );
              })}
              {review.untracked.map(([path, content]) => (
                <Card key={path}>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px]" onClick={() => setOpenFiles((o) => ({ ...o, [path]: !o[path] }))}>
                    <ChevronRight size={13} className={cx("shrink-0 text-faint transition-transform", openFiles[path] && "rotate-90")} />
                    <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
                    <Badge tone="accent">new</Badge>
                  </button>
                  {openFiles[path] && <pre className="max-h-[40vh] overflow-auto border-t border-line bg-term p-2 font-mono text-[11.5px] text-ok">{content}</pre>}
                </Card>
              ))}
              {review.truncated && <p className="text-[11.5px] text-warn">The diff is very large and was shortened.</p>}
            </div>
          )}
        </div>
        {s && s.files.length > 0 && (
          <div className="flex items-end gap-2 border-t border-line bg-panel px-4 py-2.5">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="Commit message…"
              className="min-w-0 flex-1 rounded border border-line-strong bg-bg px-2 py-1.5 text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
            />
            <div className="flex flex-col gap-1.5">
              <Button variant="primary" disabled={!message.trim()} onClick={() => void commit()}><GitCommitHorizontal size={13} /> Commit all</Button>
              {agentsHere.length > 0 && (
                <div className="flex gap-1">
                  {agentsHere.slice(0, 2).map((a) => (
                    <Button key={a.id} size="sm" onClick={() => void agentCommit(a.id)} title={`${a.name} reviews and commits the changes itself`}>
                      <Bot size={11} /> {a.name} commits
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
