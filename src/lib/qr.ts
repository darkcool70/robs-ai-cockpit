// A small QR code encoder (byte mode, error correction level M, versions 1–10) for the phone
// remote's link: point the phone's camera at the settings page instead of mailing yourself a URL.
// Follows ISO/IEC 18004 (structure after Project Nayuki's qrcodegen, MIT). No dependencies.

/** Error correction codewords per block and number of blocks, level M, versions 1–10. */
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const QR_MAX_VERSION = 10;

/** A QR code as rows of modules (true = dark). */
export type QrMatrix = boolean[][];

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    r -= (25 * align - 10) * align - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

/** Data codewords a version holds at level M. */
export function dataCodewords(ver: number): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver - 1] * BLOCKS[ver - 1];
}

// --- Reed–Solomon over GF(2^8) with the polynomial 0x11D -------------------------------------------

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < out.length) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return out;
}

/** The error correction codewords of one block. */
export function rsRemainder(data: number[], degree: number): number[] {
  const div = rsDivisor(degree);
  const out = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ (out.shift() as number);
    out.push(0);
    div.forEach((c, i) => (out[i] ^= gfMul(c, factor)));
  }
  return out;
}

// --- Encoding ------------------------------------------------------------------------------------

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** The data codewords (mode, length, bytes, terminator, padding) for a version. */
export function encodeData(bytes: number[], ver: number): number[] {
  const cap = dataCodewords(ver) * 8;
  const bits: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  if (bits.length > cap) throw new Error("Text too long for a QR code");
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data: number[], ver: number): number[] {
  const blocks = BLOCKS[ver - 1], ecc = ECC_PER_BLOCK[ver - 1];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const short = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - ecc + (i < short ? 0 : 1));
    k += dat.length;
    const rem = rsRemainder(dat, ecc);
    if (i < short) dat.push(0);
    all.push(dat.concat(rem));
  }
  const out: number[] = [];
  for (let i = 0; i < all[0].length; i++) {
    all.forEach((b, j) => { if (i !== shortLen - ecc || j >= short) out.push(b[i]); });
  }
  return out;
}

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** The 15 format bits for level M and a mask. */
export function formatBits(mask: number): number {
  const data = (0 << 3) | mask; // level M = 0b00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

class Grid {
  ver: number;
  size: number;
  dark: boolean[][];
  fixed: boolean[][];
  constructor(ver: number) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  set(x: number, y: number, on: boolean) {
    this.dark[y][x] = on;
    this.fixed[y][x] = true;
  }
  functionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [s - 4, 3], [3, s - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < s && y >= 0 && y < s) this.set(x, y, d !== 2 && d !== 4);
      }
    }
    const pos = alignmentPositions(this.ver, s), last = pos.length - 1;
    pos.forEach((px, i) => pos.forEach((py, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    this.format(0);
    if (this.ver >= 7) {
      let rem = this.ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const on = ((bits >>> i) & 1) === 1, a = s - 11 + (i % 3), b = Math.floor(i / 3);
        this.set(a, b, on);
        this.set(b, a, on);
      }
    }
  }
  format(mask: number) {
    const bits = formatBits(mask), s = this.size;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true);
  }
  codewords(data: number[]) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < s; v++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? s - 1 - v : v;
          if (!this.fixed[y][x] && i < data.length * 8) {
            this.dark[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }
  mask(m: number) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      if (this.fixed[y][x]) continue;
      const flip = [
        (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0,
        (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0,
        (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
      ][m];
      if (flip) this.dark[y][x] = !this.dark[y][x];
    }
  }
}

/** How hard a matrix is to read (the four penalty rules of the standard); lower is better. */
export function penalty(m: QrMatrix): number {
  const s = m.length;
  let score = 0;
  const lines: boolean[][] = [...m, ...m[0].map((_, x) => m.map((r) => r[x]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= s; i++) {
      if (i < s && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    const str = line.map((b) => (b ? "1" : "0")).join("");
    for (const p of ["10111010000", "00001011101"]) for (let i = str.indexOf(p); i >= 0; i = str.indexOf(p, i + 1)) score += 40;
  }
  for (let y = 0; y < s - 1; y++) for (let x = 0; x < s - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  const dark = m.reduce((a, r) => a + r.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((dark * 100) / (s * s) - 50) / 5) * 10;
  return score;
}

/** Encode text (UTF-8, byte mode, level M) as a QR matrix; the smallest version that fits. */
export function qrEncode(text: string): QrMatrix {
  const bytes = utf8(text);
  const ver = [...Array(QR_MAX_VERSION).keys()].map((i) => i + 1).find((v) => 4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8);
  if (!ver) throw new Error("Text too long for a QR code");
  const words = interleave(encodeData(bytes, ver), ver);
  let best: QrMatrix | null = null, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const g = new Grid(ver);
    g.functionPatterns();
    g.codewords(words);
    g.mask(m);
    g.format(m);
    const p = penalty(g.dark);
    if (p < bestScore) { best = g.dark; bestScore = p; }
  }
  return best as QrMatrix;
}

/** SVG path data for the dark modules, with a quiet zone of `border` modules. */
export function qrPath(m: QrMatrix, border = 4): string {
  const parts: string[] = [];
  m.forEach((row, y) => row.forEach((on, x) => { if (on) parts.push(`M${x + border} ${y + border}h1v1h-1z`); }));
  return parts.join("");
}
