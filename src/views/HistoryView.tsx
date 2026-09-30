import { useEffect, useState } from "react";
import { useApp } from "../store";
import { api, errMsg, type HistoryFilter, type HistoryRow, type SearchHit } from "../lib/api";
import { compact, dateTime, duration, ago } from "../lib/format";
import { Button, Input, ProviderMark, Select, StatusDot } from "../components/ui";

/** Full-text search in every conversation (the CLIs' own transcripts, read locally). */
function ConversationSearch({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    if (q.trim().length < 3) return;
    setBusy(true);
    setErr(null);
    try {
      setHits(await api.transcriptSearch(q.trim(), 40));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const mark = (text: string) => {
    const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
    if (i < 0) return text;
    return <>{text.slice(0, i)}<mark className="rounded bg-accent/30 px-0.5 text-fg">{text.slice(i, i + q.trim().length)}</mark>{text.slice(i + q.trim().length)}</>;
  };
  return (
    <div className="border-b border-line bg-panel px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium">Search all conversations</span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
          placeholder="e.g. Excel deadlock, login bug, migration… (Enter)"
          className="w-96"
        />
        <Button size="sm" disabled={busy || q.trim().length < 3} onClick={() => void run()}>{busy ? "Searching…" : "Search"}</Button>
        {hits && <button className="text-[11.5px] text-faint hover:text-fg" onClick={() => setHits(null)}>clear</button>}
      </div>
      {err && <p className="mt-1 text-[12px] text-err">{err}</p>}
      {hits && (
        <div className="mt-2 max-h-[40vh] space-y-1 overflow-auto">
          {hits.length === 0 && <p className="text-[12px] text-faint">Nothing found in the conversations.</p>}
          {hits.map((h) => (
            <button key={h.sessionId} onClick={() => onOpen(h.sessionId)} className="block w-full rounded border border-line px-2 py-1.5 text-left hover:border-accent/60 hover:bg-hover">
              <div className="flex items-center gap-1.5 text-[12px]">
                <ProviderMark provider={h.provider} />
                <b className="truncate">{h.sessionName}</b>
                <span className="text-[11px] text-faint">{h.startedAt ? dateTime(h.startedAt) : ""} · {h.hits} hit{h.hits === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{mark(h.snippet)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HistoryView() {
  const projects = useApp((s) => s.projects);
  const accounts = useApp((s) => s.accounts);
  const usageVersion = useApp((s) => s.usageVersion);
  const order = useApp((s) => s.order);
  const toast = useApp((s) => s.toast);
  const [f, setF] = useState<HistoryFilter>({ limit: 200 });
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => {
      api.historyQuery(f).then((r) => { setRows(r.rows); setTotal(r.total); }).catch((e) => toast(errMsg(e), "error"));
    }, 150);
    return () => window.clearTimeout(t);
  }, [f, usageVersion, order.length, toast]);

  const set = (patch: Partial<HistoryFilter>) => setF((x) => ({ ...x, ...patch, offset: 0 }));
  const reopen = async (r: HistoryRow) => {
    const st = useApp.getState();
    if (st.sessions[r.id]) return st.showSession(r.id);
    try {
      const s = await api.sessionReopen(r.id);
      st.upsertSession(s);
      useApp.setState((x) => ({ order: [...x.order, s.id] }));
      st.showSession(s.id);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ConversationSearch onOpen={(id) => { const r = rows.find((x) => x.id === id); if (r) void reopen(r); else if (useApp.getState().sessions[id]) useApp.getState().showSession(id); else void api.sessionReopen(id).then((s) => { useApp.getState().upsertSession(s); useApp.setState((x) => ({ order: [...x.order, s.id] })); useApp.getState().showSession(s.id); }).catch((e) => toast(errMsg(e), "error")); }} />
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-2">
        <h1 className="mr-2 text-[15px] font-semibold">Session history</h1>
        <Input placeholder="Search name or directory" value={f.search ?? ""} onChange={(e) => set({ search: e.target.value })} className="w-52" />
        <Select value={f.projectId ?? ""} onChange={(e) => set({ projectId: e.target.value || undefined })}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select value={f.accountId ?? ""} onChange={(e) => set({ accountId: e.target.value || undefined })}>
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={f.provider ?? ""} onChange={(e) => set({ provider: e.target.value || undefined })}>
          <option value="">Claude + Codex</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </Select>
        <Input placeholder="Model" value={f.model ?? ""} onChange={(e) => set({ model: e.target.value || undefined })} className="w-28" />
        <label className="flex items-center gap-1 text-[11.5px] text-muted">
          from <Input type="date" value={f.from?.slice(0, 10) ?? ""} onChange={(e) => set({ from: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : undefined })} />
        </label>
        <label className="flex items-center gap-1 text-[11.5px] text-muted">
          to <Input type="date" value={f.to?.slice(0, 10) ?? ""} onChange={(e) => set({ to: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : undefined })} />
        </label>
        <span className="ml-auto text-[11.5px] text-faint tabular">{total.toLocaleString()} sessions</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-panel text-left text-[11px] text-faint">
            <tr className="border-b border-line">
              {["", "Session", "Project", "Agent", "Account", "Model", "Created", "Duration", "Last activity", "Tokens", ""].map((h, i) => (
                <th key={i} className={`px-2 py-1.5 font-medium ${h === "Tokens" ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => {
              const tokens = r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
              const end = r.endedAt ? Date.parse(r.endedAt) : r.lastActivityAt ? Date.parse(r.lastActivityAt) : null;
              const dur = r.startedAt && end ? end - Date.parse(r.startedAt) : null;
              return (
                <tr key={r.id} className="border-b border-line/60 hover:bg-hover/50">
                  <td className="w-6 px-2"><StatusDot status={r.status} /></td>
                  <td className="max-w-[240px] truncate px-2 py-1.5" title={r.cwd}>{r.name}</td>
                  <td className="px-2 text-muted">{r.projectName ?? "–"}</td>
                  <td className="px-2"><ProviderMark provider={r.provider} /></td>
                  <td className="px-2 text-muted">{r.accountName ?? "(removed)"}</td>
                  <td className="px-2 text-muted">{r.model ?? r.usageModel ?? "–"}</td>
                  <td className="px-2 text-muted">{dateTime(r.createdAt)}</td>
                  <td className="px-2 text-muted">{duration(dur)}</td>
                  <td className="px-2 text-muted">{ago(r.lastActivityAt)}</td>
                  <td
                    className="px-2 text-right"
                    title={tokens ? `in ${compact(r.inputTokens)} · out ${compact(r.outputTokens)} · cache read ${compact(r.cacheReadTokens)} · cache write ${compact(r.cacheWriteTokens)}` : "No usage indexed for this conversation"}
                  >
                    {tokens ? compact(tokens) : <span className="text-faint">–</span>}
                  </td>
                  <td className="px-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => reopen(r)}>{r.closed ? "Reopen" : "Show"}</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-8 text-center text-[12px] text-faint">No sessions match.</div>}
        {total > rows.length && (
          <div className="p-3 text-center">
            <Button size="sm" onClick={() => setF((x) => ({ ...x, limit: (x.limit ?? 200) + 200 }))}>Load more</Button>
          </div>
        )}
      </div>
    </div>
  );
}
