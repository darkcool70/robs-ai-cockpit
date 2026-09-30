import { useEffect, useMemo, useState } from "react";
import { FileDown, RefreshCw } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { buildReport } from "../lib/report";
import { useApp } from "../store";
import { api, errMsg, type Point, type UsageSummary } from "../lib/api";
import { compact, pct, shortPath, usd } from "../lib/format";
import { Button, Card, SectionTitle, Select, cx } from "../components/ui";
import { HBars, Heatmap, Legend, StackedBars } from "../components/charts";

const RANGES = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

export function UsageView() {
  const accounts = useApp((s) => s.accounts);
  const usageVersion = useApp((s) => s.usageVersion);
  const toast = useApp((s) => s.toast);
  const setView = useApp((s) => s.setView);
  const [range, setRange] = useState("7d");
  const [accountId, setAccountId] = useState("");
  const [provider, setProvider] = useState("");
  const [data, setData] = useState<UsageSummary | null>(null);
  const [heat, setHeat] = useState<Point[]>([]);
  const [busy, setBusy] = useState(false);

  const filter = useMemo(() => ({ accountId: accountId || undefined, provider: provider || undefined }), [accountId, provider]);
  useEffect(() => {
    api.usageSummary(range, filter).then(setData).catch((e) => toast(errMsg(e), "error"));
    api.usageHeatmap(371, filter).then(setHeat).catch(() => {});
  }, [range, filter, usageVersion, toast]);

  const reindex = async () => {
    setBusy(true);
    try {
      const r = await api.usageReindex();
      toast(`Indexed ${r.filesRead} changed file(s), ${r.records} record(s)${r.errors.length ? `, ${r.errors.length} error(s)` : ""}`, r.errors.length ? "warn" : "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async () => {
    try {
      const r = range === "today" || range === "all" ? "7d" : range;
      const summary = await api.usageSummary(r, filter);
      const from = new Date(summary.fromMs ?? Date.now() - 7 * 86_400_000);
      const stats = await api.activityStats(from.getTime());
      const title = r === "30d" ? "Monatsbericht" : "Wochenbericht";
      const md = buildReport({ title, from, to: new Date(), summary, stats, tasks: useApp.getState().tasks });
      const path = await saveDialog({ title: "Save report", defaultPath: `${title}-${new Date().toISOString().slice(0, 10)}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (!path) return;
      await api.saveTextFile(path, md);
      toast(`Report saved: ${path}`, "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const t = data?.totals;
  const days = useMemo(() => fillDays(data?.byDay ?? [], range), [data, range]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1280px] space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-[16px] font-semibold">Usage analytics</h1>
          <div className="flex rounded border border-line-strong">
            {RANGES.map((r) => (
              <button key={r.id} onClick={() => setRange(r.id)} className={cx("h-7 px-2.5 text-[12px]", range === r.id ? "bg-hover text-fg" : "text-muted hover:text-fg")}>
                {r.label}
              </button>
            ))}
          </div>
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">All providers</option>
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </Select>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Button className="ml-auto" onClick={() => void exportReport()} title="Markdown report for the last 7 days (or the selected range): tokens, accounts, models, agents, tasks">
            <FileDown size={12} /> Report
          </Button>
          <Button onClick={reindex} disabled={busy}>
            <RefreshCw size={12} className={cx(busy && "animate-spin")} /> Index logs now
          </Button>
        </div>

        <p className="text-[11.5px] text-faint">
          All figures are <b className="text-muted">measured</b> from the providers' own local session logs (read-only). Nothing here is estimated.
          Codex reasoning tokens are part of output; input excludes cached input for both providers.
        </p>

        <div className="grid grid-cols-[1.2fr_repeat(4,1fr)] gap-2">
          <Card className="p-3">
            <div className="text-[11px] tracking-wide text-muted uppercase">Total tokens</div>
            <div className="mt-1 text-[26px] font-semibold tabular">{compact(t?.total)}</div>
            <div className="text-[11px] text-faint tabular">{t?.records.toLocaleString() ?? 0} API responses</div>
          </Card>
          <Stat label="Input" value={t?.input} />
          <Stat label="Output" value={t?.output} sub={t?.reasoning ? `${compact(t.reasoning)} reasoning` : undefined} />
          <Stat label="Cache read" value={t?.cacheRead} sub={`hit ratio ${pct(data?.cacheHitRatio)}`} />
          <Stat label="Cache write" value={t?.cacheWrite} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(data?.byAccount ?? []).slice(0, 6).map((g) => (
            <Card key={g.key} className="flex items-center justify-between px-3 py-2">
              <span className="text-[12.5px]">{g.label}</span>
              <span className="text-[15px] font-semibold tabular">{compact(g.totals.total)}</span>
            </Card>
          ))}
        </div>

        <Card className="p-3">
          <SectionTitle>API-equivalent value</SectionTitle>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-[12.5px]">
            <div>
              <div className="text-faint">Subscription usage</div>
              <div className="text-[18px] font-semibold tabular">{compact(t?.total)} tokens</div>
            </div>
            <div>
              <div className="text-faint">Estimated API-equivalent value</div>
              <div className="text-[18px] font-semibold tabular">{data ? usd(data.apiValue.valueUsd) : "–"}</div>
              <div className="text-[10.5px] text-faint">estimate using your configured prices · covers {compact(data?.apiValue.pricedTokens)} tokens</div>
            </div>
            <div>
              <div className="text-faint">Actual additional API spend</div>
              <div className="text-[18px] font-semibold text-ok tabular">$0</div>
              <div className="text-[10.5px] text-faint">subscription logins, no API keys</div>
            </div>
            {data && data.apiValue.unpricedModels.length > 0 && (
              <div className="text-[11.5px] text-warn">
                No price configured for: {data.apiValue.unpricedModels.slice(0, 4).join(", ")}
                {data.apiValue.unpricedModels.length > 4 && "…"} ·{" "}
                <button className="underline" onClick={() => setView("settings")}>set prices</button>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-3">
          <SectionTitle right={<Legend />}>Tokens per day</SectionTitle>
          <StackedBars data={days} height={170} />
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3">
            <SectionTitle>Tokens per week</SectionTitle>
            <StackedBars data={data?.byWeek ?? []} height={140} />
          </Card>
          <Card className="p-3">
            <SectionTitle>Busiest hours (local time)</SectionTitle>
            <StackedBars data={data?.byHour ?? []} height={140} labelEvery={3} />
          </Card>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3">
            <SectionTitle>By model</SectionTitle>
            <HBars rows={(data?.byModel ?? []).slice(0, 10).map((g) => ({ label: g.label, value: g.totals.total, sub: g.apiValueUsd != null ? usd(g.apiValueUsd) : undefined, color: g.provider === "codex" ? "#4fb897" : "#d9825b" }))} />
          </Card>
          <Card className="p-3">
            <SectionTitle>By project</SectionTitle>
            <HBars rows={(data?.byProject ?? []).slice(0, 10).map((g) => ({ label: shortPath(g.label, 40), title: g.label, value: g.totals.total }))} />
          </Card>
          <Card className="p-3">
            <SectionTitle>By account</SectionTitle>
            <HBars rows={(data?.byAccount ?? []).map((g) => ({ label: g.label, value: g.totals.total, sub: `cache ${pct(cacheRatio(g.totals))}`, color: g.provider === "codex" ? "#4fb897" : "#d9825b" }))} />
          </Card>
        </div>

        <Card className="p-3">
          <SectionTitle>Largest sessions</SectionTitle>
          <table className="w-full text-[12px]">
            <thead className="text-left text-[11px] text-faint">
              <tr><th className="py-1 font-medium">Session</th><th className="font-medium">Provider</th><th className="text-right font-medium">Input</th><th className="text-right font-medium">Output</th><th className="text-right font-medium">Cache read</th><th className="text-right font-medium">Cache write</th><th className="text-right font-medium">Total</th></tr>
            </thead>
            <tbody className="tabular">
              {(data?.bySession ?? []).slice(0, 15).map((g) => (
                <tr key={g.key} className="border-t border-line">
                  <td className="max-w-[340px] truncate py-1" title={g.key}>{g.label === g.key ? <span className="font-mono text-[11px] text-muted">{g.key.slice(0, 13)}…</span> : g.label}</td>
                  <td className="text-muted">{g.provider}</td>
                  <td className="text-right">{compact(g.totals.input)}</td>
                  <td className="text-right">{compact(g.totals.output)}</td>
                  <td className="text-right">{compact(g.totals.cacheRead)}</td>
                  <td className="text-right">{compact(g.totals.cacheWrite)}</td>
                  <td className="text-right font-medium">{compact(g.totals.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto p-3">
          <SectionTitle>Activity (last 12 months)</SectionTitle>
          <Heatmap data={heat} />
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value?: number; sub?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-[18px] font-semibold tabular">{compact(value)}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </Card>
  );
}

function cacheRatio(t: { input: number; cacheRead: number; cacheWrite: number }) {
  const d = t.input + t.cacheRead + t.cacheWrite;
  return d > 0 ? t.cacheRead / d : null;
}

/** Insert zero days so gaps are visible. */
function fillDays(points: Point[], range: string): Point[] {
  if (points.length === 0) return points;
  const map = new Map(points.map((p) => [p.key, p]));
  const n = range === "today" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : Math.min(400, daysBetween(points[0].key));
  const out: Point[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(map.get(k) ?? { key: k, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function daysBetween(first: string) {
  const a = new Date(`${first}T00:00:00`);
  return Math.max(1, Math.round((Date.now() - a.getTime()) / 86_400_000) + 1);
}
