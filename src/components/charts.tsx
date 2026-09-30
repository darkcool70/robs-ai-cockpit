// Small dependency-free SVG charts. Dense, no animations.
import { useState } from "react";
import type { Point } from "../lib/api";
import { compact, localDateKey } from "../lib/format";

const SERIES = [
  { key: "input", label: "Input", color: "#6ea8fe" },
  { key: "output", label: "Output", color: "#c792ea" },
  { key: "cacheRead", label: "Cache read", color: "#3f5f86" },
  { key: "cacheWrite", label: "Cache write", color: "#e6c07b" },
] as const;

export function Legend() {
  return (
    <div className="flex gap-3 text-[11px] text-muted">
      {SERIES.map((s) => (
        <span key={s.key} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Stacked bars (input/output/cache) over a categorical x-axis. */
export function StackedBars({ data, height = 160, labelEvery }: { data: Point[]; height?: number; labelEvery?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <div className="flex items-center justify-center text-[12px] text-faint" style={{ height }}>No data</div>;
  const max = Math.max(1, ...data.map((d) => d.total));
  const W = 1000;
  const H = height;
  const pad = { l: 44, r: 6, t: 8, b: 18 };
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v: number) => (v / max) * (H - pad.t - pad.b);
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / 12));
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const h = hover != null ? data[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={H - pad.b - y(t)} y2={H - pad.b - y(t)} stroke="#222932" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {data.map((d, i) => {
          let acc = 0;
          const x = pad.l + i * bw;
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={pad.t} width={bw} height={H - pad.t - pad.b} fill={hover === i ? "#ffffff08" : "transparent"} />
              {SERIES.map((s) => {
                const v = d[s.key];
                const hh = y(v);
                acc += hh;
                return <rect key={s.key} x={x + bw * 0.12} width={Math.max(1, bw * 0.76)} y={H - pad.b - acc} height={hh} fill={s.color} />;
              })}
            </g>
          );
        })}
      </svg>
      {/* Axis labels as HTML so text isn't distorted by preserveAspectRatio=none */}
      <div className="pointer-events-none absolute inset-0 text-[10px] text-faint">
        {ticks.map((t) => (
          <span key={t} className="absolute left-0 w-10 text-right tabular" style={{ top: `${((H - pad.b - y(t)) / H) * 100}%`, transform: "translateY(-50%)" }}>
            {compact(t)}
          </span>
        ))}
        {data.map((d, i) =>
          i % every === 0 ? (
            <span key={d.key} className="absolute bottom-0 whitespace-nowrap" style={{ left: `${((pad.l + i * bw + bw / 2) / W) * 100}%`, transform: "translateX(-50%)" }}>
              {shortKey(d.key)}
            </span>
          ) : null,
        )}
      </div>
      {h && (
        <div className="pointer-events-none absolute top-0 right-0 rounded border border-line-strong bg-raised px-2 py-1 text-[11px] tabular shadow">
          <div className="font-medium">{h.key}</div>
          <div>Total {compact(h.total)}</div>
          <div className="text-faint">in {compact(h.input)} · out {compact(h.output)} · cr {compact(h.cacheRead)} · cw {compact(h.cacheWrite)}</div>
        </div>
      )}
    </div>
  );
}

function shortKey(k: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return k.slice(5);
  if (/^\d{4}-W\d{2}$/.test(k)) return k.slice(5);
  return k;
}

/** Horizontal bar list for breakdowns. */
export function HBars({ rows, max, color = "#6ea8fe" }: { rows: { label: string; value: number; sub?: string; color?: string; title?: string }[]; max?: number; color?: string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="py-3 text-[12px] text-faint">No data</div>;
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="text-[12px]" title={r.title ?? r.label}>
          <div className="mb-0.5 flex justify-between gap-2">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular text-muted">
              {compact(r.value)}
              {r.sub && <span className="text-faint"> · {r.sub}</span>}
            </span>
          </div>
          <div className="h-1 rounded-full bg-hover">
            <div className="h-full rounded-full" style={{ width: `${(r.value / m) * 100}%`, background: r.color ?? color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** GitHub-style contribution heatmap for the last ~53 weeks. */
export function Heatmap({ data, weeks = 53 }: { data: Point[]; weeks?: number }) {
  const map = new Map(data.map((d) => [d.key, d.total]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1) - ((today.getDay() + 6) % 7) + 6 - 6);
  // Align start to Monday.
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  const values = data.map((d) => d.total).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => values[Math.floor(p * (values.length - 1))] ?? 0;
  const levels = [q(0.25), q(0.5), q(0.75)];
  const colors = ["#1a2029", "#1e3a5c", "#2d5f99", "#4a8ae0", "#8dbbff"];
  const level = (v: number) => (v <= 0 ? 0 : v <= levels[0] ? 1 : v <= levels[1] ? 2 : v <= levels[2] ? 3 : 4);
  const cell = 11;
  const gap = 2;
  const cols: { date: Date; v: number }[][] = [];
  const d = new Date(start);
  while (d <= today) {
    const week: { date: Date; v: number }[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: new Date(d), v: map.get(localDateKey(d)) ?? 0 });
      d.setDate(d.getDate() + 1);
    }
    cols.push(week);
  }
  const [hover, setHover] = useState<{ date: Date; v: number } | null>(null);
  return (
    <div>
      <svg width={cols.length * (cell + gap) + 24} height={7 * (cell + gap) + 16}>
        {["Mon", "Wed", "Fri"].map((l, i) => (
          <text key={l} x={0} y={16 + (i * 2) * (cell + gap) + cell - 2} fontSize={9} fill="#5d6773">{l}</text>
        ))}
        {cols.map((w, ci) => (
          <g key={ci} transform={`translate(${24 + ci * (cell + gap)}, 14)`}>
            {w[0].date.getDate() <= 7 && (
              <text x={0} y={-4} fontSize={9} fill="#5d6773">{w[0].date.toLocaleDateString(undefined, { month: "short" })}</text>
            )}
            {w.map((c, ri) =>
              c.date > today ? null : (
                <rect
                  key={ri}
                  y={ri * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={2}
                  fill={colors[level(c.v)]}
                  onMouseEnter={() => setHover(c)}
                  onMouseLeave={() => setHover(null)}
                />
              ),
            )}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex h-4 items-center gap-2 text-[11px] text-faint">
        {hover ? (
          <span className="tabular">{hover.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: {compact(hover.v)} tokens</span>
        ) : (
          <>
            Less
            {colors.map((c) => <span key={c} className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />)}
            More
          </>
        )}
      </div>
    </div>
  );
}
