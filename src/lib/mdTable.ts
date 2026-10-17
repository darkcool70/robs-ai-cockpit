// Markdown tables in chat answers („| | Auto | E-Bike |“, „|---|---|“): the rows as cells, which row is
// the head and which columns hold numbers (they stand right-aligned). Pure, for Markdown.tsx.

export interface MdTable {
  head: string[] | null;
  rows: string[][];
  /** per column: right-aligned (numbers, money, percentages) */
  right: boolean[];
}

const ROW = /^\s*\|.*\|\s*$/;
const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const NUM = /^[~≈±+\-–]?\s*[€$]?\s*\d/;

/** A line that belongs to a table. */
export const isTableLine = (line: string) => ROW.test(line) || (SEP.test(line) && line.includes("|"));

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** The table in these lines (all of them table lines), or null when it is not one (fewer than two rows). */
export function parseTable(lines: string[]): MdTable | null {
  const sepAt = lines.findIndex((l) => SEP.test(l));
  const body = lines.filter((_, i) => i !== sepAt).map(cells);
  if (body.length < 2 && sepAt < 0) return null;
  if (!body.length) return null;
  const head = sepAt === 1 ? body[0] : null;
  const rows = head ? body.slice(1) : body;
  const width = Math.max(...body.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(Math.max(0, width - r.length)).fill("")];
  const padded = rows.map(pad);
  const right = Array.from({ length: width }, (_, c) => {
    const vals = padded.map((r) => r[c]).filter(Boolean);
    return vals.length > 0 && vals.every((v) => NUM.test(v));
  });
  return { head: head ? pad(head) : null, rows: padded, right };
}
