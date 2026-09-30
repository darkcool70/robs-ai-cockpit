// Markdown usage report (week / month), pure so it can be unit tested.
import type { SessionStats, Task, UsageSummary } from "./api";
import { compact, duration, pct, usd } from "./format";

export function buildReport(opts: {
  title: string;
  from: Date;
  to: Date;
  summary: UsageSummary;
  stats: SessionStats[];
  tasks: Task[];
}): string {
  const { summary: s, stats, tasks } = opts;
  const t = s.totals;
  const day = (d: Date) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const lines: string[] = [];
  lines.push(`# ${opts.title}`, "", `Zeitraum: ${day(opts.from)} – ${day(opts.to)}`, "");
  lines.push("## Überblick", "");
  lines.push(`| Kennzahl | Wert |`, `|---|---|`);
  lines.push(`| Tokens gesamt | ${compact(t.total)} (${t.total.toLocaleString("de-DE")}) |`);
  lines.push(`| Input / Output | ${compact(t.input)} / ${compact(t.output)} |`);
  lines.push(`| Cache gelesen / geschrieben | ${compact(t.cacheRead)} / ${compact(t.cacheWrite)} |`);
  lines.push(`| Cache-Trefferquote | ${pct(s.cacheHitRatio)} |`);
  lines.push(`| API-Gegenwert (geschätzt) | ${usd(s.apiValue.valueUsd)}${s.apiValue.unpricedModels.length ? ` (ohne Preis: ${s.apiValue.unpricedModels.join(", ")})` : ""} |`);
  const turns = stats.reduce((a, x) => a + x.turns, 0);
  const work = stats.reduce((a, x) => a + x.workingMs, 0);
  const wait = stats.reduce((a, x) => a + x.waitingMs, 0);
  lines.push(`| Aufträge (Turns) | ${turns} |`);
  lines.push(`| Arbeitszeit der Agenten | ${duration(work)} |`);
  lines.push(`| Wartezeit auf dich | ${duration(wait)} |`);
  lines.push("");

  if (s.byAccount.length) {
    lines.push("## Nach Account", "", "| Account | Tokens | Anteil |", "|---|---|---|");
    for (const g of s.byAccount) lines.push(`| ${g.label} | ${compact(g.totals.total)} | ${pct(t.total ? g.totals.total / t.total : 0)} |`);
    lines.push("");
  }
  if (s.byModel.length) {
    lines.push("## Nach Modell", "", "| Modell | Tokens | API-Gegenwert |", "|---|---|---|");
    for (const g of s.byModel) lines.push(`| ${g.label} | ${compact(g.totals.total)} | ${g.apiValueUsd != null ? usd(g.apiValueUsd) : "–"} |`);
    lines.push("");
  }
  const agents = stats.filter((x) => x.turns > 0).sort((a, b) => b.workingMs - a.workingMs);
  if (agents.length) {
    lines.push("## Agenten", "", "| Agent | Turns | Arbeitszeit | Wartezeit auf dich | Dateien | Rückfragen |", "|---|---|---|---|---|---|");
    for (const x of agents) lines.push(`| ${x.sessionName ?? x.sessionId} | ${x.turns} | ${duration(x.workingMs)} | ${duration(x.waitingMs)} | ${x.files} | ${x.inputs} |`);
    lines.push("");
  }
  if (s.byProject.length) {
    lines.push("## Nach Projekt", "", "| Projekt | Tokens |", "|---|---|");
    for (const g of s.byProject.slice(0, 15)) lines.push(`| ${g.label} | ${compact(g.totals.total)} |`);
    lines.push("");
  }
  const fromMs = opts.from.getTime();
  const done = tasks.filter((x) => x.status === "done" && (x.finishedAt ?? 0) >= fromMs);
  const open = tasks.filter((x) => x.status !== "done");
  if (done.length || open.length) {
    lines.push("## Aufgaben", "");
    if (done.length) {
      lines.push(`Erledigt (${done.length}):`, "");
      for (const x of done) lines.push(`- ${x.title}${x.startedAt && x.finishedAt ? ` (${duration(x.finishedAt - x.startedAt)})` : ""}`);
      lines.push("");
    }
    if (open.length) {
      lines.push(`Offen / in Arbeit (${open.length}):`, "");
      for (const x of open) lines.push(`- ${x.title} — ${x.status}`);
      lines.push("");
    }
  }
  if (s.byDay.length) {
    lines.push("## Tokens pro Tag", "", "| Tag | Tokens |", "|---|---|");
    for (const p of s.byDay) lines.push(`| ${p.key} | ${compact(p.total)} |`);
    lines.push("");
  }
  lines.push(`_Erstellt mit Robs AI Cockpit am ${day(opts.to)}. Alle Tokenzahlen gemessen aus den lokalen Logs der CLIs._`);
  return lines.join("\n");
}
