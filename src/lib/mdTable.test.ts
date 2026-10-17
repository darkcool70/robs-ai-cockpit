import { describe, expect, it } from "vitest";
import { isTableLine, parseTable } from "./mdTable";

describe("Markdown tables in chat answers", () => {
  it("reads head, rows and the number columns", () => {
    const lines = ["| | Auto | E-Bike |", "|---|---|---|", "| Kosten pro km | ~0,35 € | ~0,05 € |", "| Jährlich | ~1.900 € | ~300 € |"];
    expect(lines.every(isTableLine)).toBe(true);
    const t = parseTable(lines)!;
    expect(t.head).toEqual(["", "Auto", "E-Bike"]);
    expect(t.rows).toEqual([["Kosten pro km", "~0,35 €", "~0,05 €"], ["Jährlich", "~1.900 €", "~300 €"]]);
    expect(t.right).toEqual([false, true, true]);
  });

  it("a table without a head row, short rows filled up", () => {
    const t = parseTable(["| a | 1 |", "| b |"])!;
    expect(t.head).toBeNull();
    expect(t.rows).toEqual([["a", "1"], ["b", ""]]);
  });

  it("not a table: one row alone, or ordinary text", () => {
    expect(parseTable(["| nur eine Zeile |"])).toBeNull();
    expect(isTableLine("Kosten | Nutzen")).toBe(false);
    expect(isTableLine("|:--|--:|")).toBe(true);
  });
});
