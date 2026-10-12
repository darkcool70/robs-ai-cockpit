import { describe, expect, it } from "vitest";
import { dataCodewords, encodeData, formatBits, qrEncode, qrPath, rsRemainder } from "./qr";

describe("qr", () => {
  it("computes Reed–Solomon codewords like the standard's example (HELLO WORLD, 1-M)", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it("knows the capacities and format bits of level M", () => {
    expect([1, 4, 5, 7, 10].map(dataCodewords)).toEqual([16, 64, 86, 124, 216]);
    expect(formatBits(0)).toBe(0b101010000010010);
    expect(formatBits(5)).toBe(0b100000011001110);
    expect(formatBits(7)).toBe(0b100101010100000);
  });

  it("pads the data with 0xEC / 0x11", () => {
    const d = encodeData([0x41], 1);
    expect(d).toHaveLength(16);
    expect(d.slice(0, 3)).toEqual([0x40, 0x14, 0x10]);
    expect(d.slice(3, 7)).toEqual([0xec, 0x11, 0xec, 0x11]);
  });

  it("picks the smallest version and draws finder patterns and the dark module", () => {
    const url = "http://192.168.178.23:8765/?k=ABCDEFGHJKLMNPQRSTUVWXYZabcdefgh";
    const m = qrEncode(url);
    expect(m.length).toBe(4 * 4 + 17); // 62 bytes → version 4
    const s = m.length;
    for (const [x, y] of [[0, 0], [s - 7, 0], [0, s - 7]]) {
      expect(m[y][x] && m[y][x + 6] && m[y + 6][x] && m[y + 3][x + 3]).toBe(true);
      expect(m[y + 1][x + 1]).toBe(false);
    }
    expect(m[s - 8][8]).toBe(true);
    expect(qrEncode("hi").length).toBe(21);
    expect(() => qrEncode("x".repeat(400))).toThrow();
    expect(qrPath([[true, false]], 1)).toBe("M1 1h1v1h-1z");
  });
});
