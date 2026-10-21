import type { Signal, SignalKind, Span } from "./types.js";

export interface Normalized {
  /** Stripped, whitespace runs collapsed to one space or newline, NFKD with marks removed, look-alikes folded, case kept. */
  folded: string;
  /** `folded` lowercased per unit with newlines as spaces, so `map` serves both. */
  flat: string;
  /** map[i] is the original offset of folded[i]. */
  map: Uint32Array;
  /** Word characters only, lowercased, camelCase split, every other run and every stripped character one space. */
  words: string;
  /** wordsMap[i] is the folded index of words[i]. */
  wordsMap: Uint32Array;
  /** Decoded tag runs, then the bytes carried by variation selectors. */
  hidden: string;
  hiddenSpans: Span[];
  signals: Signal[];
  truncated: boolean;
}

// Latin look-alikes from UTS #39 confusables (BMP subset); NFKD covers full-width, math and enclosed forms. Target -> 4-hex units.
const LOOKALIKES: Record<string, string> = {
  a: "0430 0251 03b1 237a",
  b: "042c 0184 13cf 15af",
  c: "0441 03f2 2ca5 1d04",
  d: "0501 13e7 146f",
  e: "0435 04bd 212e ab32",
  f: "0584 1e9d",
  g: "0261 0581 1d83",
  h: "04bb 0570 13c2",
  i: "0456 03b9 0131 0269 1fbe a647 13a5 026a 0582 2373",
  j: "0458 03f3 0575",
  k: "03ba",
  l: "04cf 2113 05d5 05df 0627 01c0 2223 0661 06f1 16c1",
  n: "0578 057c",
  o: "043e 03bf 03c3 0585 05e1 0647 0665 06f5 0966 0a66 0ae6 0b66 0be6 0c02 0c66 0c82 0ce6 0d02 0d20 0d66 0e50 0ed0 1040 101d 10ff 1d0f 1d11 2c9f 1c82",
  p: "0440 03c1 03f1 2374 2ca3",
  q: "051b 0563 0566",
  r: "1d26 2c85 ab47 ab48 0433",
  s: "0455 a731 01bd",
  t: "03c4 1d1b",
  u: "03c5 057d 1d1c 028b",
  v: "03bd 0475 05d8 1d20 2228 22c1",
  w: "0461 051d 0561 1d21",
  x: "0445 03c7 1541 157d 166e 00d7 2a2f",
  y: "0443 03b3 04af 10e7 0263 028f",
  z: "1d22",
  A: "0410 0391 13aa 15c5 a4ee",
  B: "0412 0392 13f4 15f7 a4d0",
  C: "0421 03f9 13df 2ca4 a4da 1455",
  D: "13a0 15de 15ea a4d3",
  E: "0415 0395 13ac a4f0 22ff 2d39",
  F: "15b4 a4dd 03dc",
  G: "050c 13c0 13f3 a4d6",
  H: "041d 0397 13bb 157c a4e7 2c8e",
  I: "0406 0399 04c0 a4f2 2c92",
  J: "0408 13ab 148d a4d9 037f",
  K: "041a 039a 13e6 16d5 a4d7 2c94",
  L: "13de 14aa a4e1",
  M: "041c 039c 13b7 15f0 16d6 a4df 03fa 2c98",
  N: "039d a4e0 2c9a",
  O: "041e 039f 0555 2c9e a4f3 0b20 2d54 12d0 3007",
  P: "0420 03a1 13e2 2ca2 a4d1",
  Q: "2d55",
  R: "13a1 13d2 1587 a4e3 01a6",
  S: "0405 054f 13d5 13da a4e2",
  T: "0422 03a4 13a2 22a4 27d9 a4d4 2ca6",
  U: "054d 1200 144c a4f4 222a 22c3",
  V: "0474 13d9 142f a4e6 0667 06f7 2d38",
  W: "051c 13b3 13d4 a4ea",
  X: "0425 03a7 2573 2cac a4eb 166d",
  Y: "0423 03a5 04ae 13a9 13bd 2ca8 a4ec 03d2",
  Z: "0396 13c3 a4dc 2c8c",
};
// Punctuation look-alikes fold silently: curly quotes and dashes are everywhere in ordinary prose.
const PUNCTUATION: Record<string, string> = {
  "'": "2018 2019 201b 2032 02b9 02bc 02c8 00b4 055a 05f3",
  '"': "201c 201d 201f 2033 02ba 02dd 05f4",
  "-": "2010 2011 2012 2013 2212 2043",
  ".": "0660 06f0",
  ",": "201a 00b8",
  ":": "0589 05c3 a789 2236 02d0",
  "/": "2044 2215",
  "\\": "2216",
  "!": "01c3 2d51",
  "<": "2039 02c2 1438",
  ">": "203a 02c3 1433",
  "`": "1fef 2035 02cb",
  "~": "223c",
  "%": "066a",
  "*": "066d 204e 2217",
  "+": "2795",
  "=": "a4ff 2e40 1400",
  _: "07fa",
  "^": "02c4 02c6",
};

// Per-code-unit class: 0 unknown, 1 identity, 2 folded, 3 folded through a look-alike, 4 stripped as zero-width,
// 5 stripped as bidi, 6 stripped silently (combining mark), 7 whitespace, 8 newline.
const CLASS = new Uint8Array(0x10000);
const FOLD = new Map<number, string>();
for (const [table, cls] of [
  [LOOKALIKES, 3],
  [PUNCTUATION, 2],
] as const) {
  for (const [to, list] of Object.entries(table)) {
    for (const hex of list.split(" ")) {
      const c = parseInt(hex, 16);
      FOLD.set(c, to);
      CLASS[c] = cls;
    }
  }
}
for (const c of [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff, 0x180e, 0x00ad]) CLASS[c] = 4;
for (const c of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x061c]) CLASS[c] = 5;
for (const c of [0xa0, 0x1680, 0x202f, 0x205f, 0x3000]) CLASS[c] = 7;
for (let c = 0x2000; c <= 0x200a; c++) CLASS[c] = 7;
CLASS[0x2028] = CLASS[0x2029] = 8;

const IGNORABLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/u;
const MARK = /\p{Mn}/u;
const MARKS = /\p{Mn}/gu;
const RGI_FLAGS = new Set(["gbeng\x7f", "gbsct\x7f", "gbwls\x7f"]);

function foldNormalized(nf: string): { s: string; conf: boolean } {
  let s = "";
  let conf = false;
  for (let i = 0; i < nf.length; i++) {
    const u = nf.charCodeAt(i);
    const k = CLASS[u];
    if (k === 2 || k === 3) {
      s += FOLD.get(u)!;
      if (k === 3) conf = true;
    } else s += nf[i]!;
  }
  return { s, conf };
}

function classify(c: number): number {
  const ch = String.fromCharCode(c);
  let k = 1;
  let s: string | undefined;
  if (IGNORABLE.test(ch)) k = 4;
  else if (MARK.test(ch)) k = 6;
  else {
    const r = foldNormalized(ch.normalize("NFKD").replace(MARKS, ""));
    if (r.s !== ch) {
      s = r.s;
      k = r.conf ? 3 : 2;
    } else {
      // A capital whose lowercase is a look-alike folds to that look-alike's capital.
      const l = ch.toLowerCase();
      const lc = l.length === 1 ? l.charCodeAt(0) : c;
      if (lc !== c && (CLASS[lc] || classify(lc)) === 3) {
        s = FOLD.get(lc)!.toUpperCase();
        k = 3;
      }
    }
  }
  CLASS[c] = k;
  if (s !== undefined) FOLD.set(c, s);
  return k;
}

const ASTRAL = new Map<number, { k: number; s: string | null }>();

function foldPair(hi: number, lo: number): { k: number; s: string | null } {
  const cp = (hi - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000;
  const hit = ASTRAL.get(cp);
  if (hit) return hit;
  const ch = String.fromCharCode(hi, lo);
  let r: { k: number; s: string | null };
  if (IGNORABLE.test(ch)) r = { k: 4, s: null };
  else {
    const f = foldNormalized(ch.normalize("NFKD").replace(MARKS, ""));
    r = f.s === ch ? { k: 1, s: null } : { k: f.conf ? 3 : 2, s: f.s };
  }
  if (ASTRAL.size < 4096) ASTRAL.set(cp, r);
  return r;
}

/** End of the ANSI escape sequence starting at s[i] (ESC), or -1 when it is a lone ESC. */
function ansiEnd(s: string, i: number): number {
  const n = s.length;
  const c = s.charCodeAt(i + 1);
  if (c === 0x5b) {
    let k = i + 2;
    for (let p = 0; k < n && p < 32 && s.charCodeAt(k) >= 0x30 && s.charCodeAt(k) <= 0x3f; p++) k++;
    for (let p = 0; k < n && p < 8 && s.charCodeAt(k) >= 0x20 && s.charCodeAt(k) <= 0x2f; p++) k++;
    const f = s.charCodeAt(k);
    return f >= 0x40 && f <= 0x7e ? k + 1 : -1;
  }
  if (c === 0x5d) {
    for (let k = i + 2; k < n && k < i + 514; k++) {
      const d = s.charCodeAt(k);
      if (d === 0x07) return k + 1;
      if (d === 0x1b) return s.charCodeAt(k + 1) === 0x5c ? k + 2 : -1;
    }
    return -1;
  }
  return c >= 0x40 && c <= 0x5f ? i + 2 : -1;
}

function cutToBytes(text: string, maxBytes: number): string | null {
  if (text.length * 3 <= maxBytes || Buffer.byteLength(text, "utf8") <= maxBytes) return null;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0xd800 || c >= 0xe000 ? 3 : c < 0xdc00 ? 4 : 0;
    if (bytes > maxBytes) return text.slice(0, i);
  }
  return null;
}

const isAsciiAlnum = (c: number): boolean => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isAsciiSpace = (c: number): boolean => c === 0x20 || (c >= 0x09 && c <= 0x0d);

export function isWordUnit(c: number): boolean {
  return c > 0x20 && c !== 0x7f && !((c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e));
}

export function normalizeText(text: string, maxBytes: number): Normalized {
  const cut = cutToBytes(text, maxBytes);
  const src = cut ?? text;
  const n = src.length;
  const cap = Math.max(n, maxBytes * 2);
  let truncated = cut !== null;
  let map = new Uint32Array(n + 32);
  let j = 0;
  const parts: string[] = [];
  let runStart = 0;
  let lastAlnum = false;
  let ws = 0;
  let wsStart = 0;
  const strips: number[] = [];
  const hiddenSpans: Span[] = [];
  let tagText = "";
  let vsText = "";
  const vsBytes: number[] = [];
  let vsEnd = -1;
  let ansi = 0;
  let ctrl = 0;
  let tags = 0;
  let bidi = 0;
  let overrides = 0;
  let zw = 0;
  let vs = 0;
  let conf = 0;

  const grow = (need: number): void => {
    if (need > map.length) {
      const bigger = new Uint32Array(Math.max(need + 32, map.length * 2));
      bigger.set(map.subarray(0, j));
      map = bigger;
    }
  };
  const flushRun = (i: number): void => {
    if (i > runStart) parts.push(src.slice(runStart, i));
    runStart = i;
  };
  const push = (s: string, orig: number): void => {
    parts.push(s);
    grow(j + s.length);
    for (let k = 0; k < s.length; k++) map[j++] = orig;
  };
  const flushWs = (): void => {
    if (ws !== 0 && j > 0) push(ws === 2 ? "\n" : " ", wsStart);
    ws = 0;
  };
  const space = (i: number, width: number, newline: boolean): void => {
    flushRun(i);
    if (ws === 0) wsStart = i;
    ws = newline ? 2 : Math.max(ws, 1);
    runStart = i + width;
    lastAlnum = false;
  };
  const drop = (i: number, width: number, record: boolean): void => {
    flushRun(i);
    runStart = i + width;
    if (record && strips[strips.length - 1] !== j) strips.push(j);
  };
  const hide = (i: number, width: number): void => {
    const last = hiddenSpans[hiddenSpans.length - 1];
    if (last && last.end === i) last.end = i + width;
    else hiddenSpans.push({ start: i, end: i + width });
    drop(i, width, true);
  };
  const fold = (i: number, width: number, s: string, lookalike: boolean): void => {
    flushRun(i);
    flushWs();
    if (lookalike && (lastAlnum || isAsciiAlnum(src.charCodeAt(i + width)))) conf++;
    push(s, i);
    runStart = i + width;
    lastAlnum = false;
  };
  const identity = (i: number, width: number): void => {
    if (ws !== 0) {
      flushRun(i);
      flushWs();
    }
    grow(j + width);
    for (let k = 0; k < width; k++) map[j++] = i + k;
    lastAlnum = width === 1 && isAsciiAlnum(src.charCodeAt(i));
  };
  // VS15 and VS16 right after a base character are emoji presentation; everything else carries a byte.
  const selector = (i: number, width: number, byte: number): void => {
    if ((byte === 14 || byte === 15) && vsEnd !== i) drop(i, width, false);
    else {
      vsBytes.push(byte);
      vs++;
      hide(i, width);
    }
    vsEnd = i + width;
  };

  for (let i = 0; i < n; i++) {
    if (j >= cap) {
      flushRun(i);
      runStart = n;
      truncated = true;
      break;
    }
    const c = src.charCodeAt(i);
    if (c < 0x80) {
      if (c > 0x20 && c < 0x7f) identity(i, 1);
      else if ((c === 0x20 || c === 0x0a) && ws === 0 && !isAsciiSpace(src.charCodeAt(i + 1)) && !isAsciiSpace(src.charCodeAt(i - 1))) {
        // A lone space or newline is already collapsed: keep it in the identity run.
        identity(i, 1);
      } else if (c === 0x20 || c === 0x09) space(i, 1, false);
      else if (c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c) space(i, 1, c === 0x0a || c === 0x0d);
      else {
        const e = c === 0x1b ? ansiEnd(src, i) : -1;
        if (e > 0) {
          ansi++;
          drop(i, e - i, true);
          i = e - 1;
        } else {
          ctrl++;
          drop(i, 1, true);
        }
      }
      continue;
    }
    if (c < 0xa0) {
      if (c === 0x85) space(i, 1, true);
      else {
        ctrl++;
        drop(i, 1, true);
      }
      continue;
    }
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < n) {
      const d = src.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        if (c === 0xdb40 && d <= 0xdc7f) {
          let e = i + 2;
          let t = String.fromCharCode(d - 0xdc00);
          while (e + 1 < n && src.charCodeAt(e) === 0xdb40 && src.charCodeAt(e + 1) >= 0xdc00 && src.charCodeAt(e + 1) <= 0xdc7f) {
            t += String.fromCharCode(src.charCodeAt(e + 1) - 0xdc00);
            e += 2;
          }
          // The three subdivision flags are the one legitimate tag sequence: black flag + tag letters + cancel tag.
          if (i >= 2 && src.charCodeAt(i - 2) === 0xd83c && src.charCodeAt(i - 1) === 0xdff4 && RGI_FLAGS.has(t)) drop(i, e - i, false);
          else {
            tags += t.length;
            tagText += t.replace(/\x7f/g, "");
            hide(i, e - i);
          }
          i = e - 1;
          continue;
        }
        if (c === 0xdb40 && d >= 0xdd00 && d <= 0xddef) {
          selector(i, 2, d - 0xdd00 + 16);
          i++;
          continue;
        }
        const r = foldPair(c, d);
        if (r.k === 1) identity(i, 2);
        else if (r.k === 4) {
          zw++;
          drop(i, 2, true);
        } else fold(i, 2, r.s!, r.k === 3);
        i++;
        continue;
      }
    }
    if (c >= 0xfe00 && c <= 0xfe0f) {
      selector(i, 1, c - 0xfe00);
      continue;
    }
    const k = CLASS[c] || classify(c);
    if (k === 1) identity(i, 1);
    else if (k === 2 || k === 3) fold(i, 1, FOLD.get(c)!, k === 3);
    else if (k === 4) {
      zw++;
      drop(i, 1, true);
    } else if (k === 5) {
      bidi++;
      if (c === 0x202d || c === 0x202e) overrides++;
      drop(i, 1, true);
    } else if (k === 6) drop(i, 1, false);
    else space(i, 1, k === 8);
  }
  flushRun(n);
  if (vsBytes.length > 0) vsText = Buffer.from(vsBytes).toString("utf8");

  const folded = parts.join("");
  let flat = folded.toLowerCase();
  if (flat.length !== folded.length) flat = lowerPerUnit(folded);
  flat = flat.replaceAll("\n", " ");
  const words = wordsView(folded, flat, strips);

  const signals: Signal[] = [];
  const signal = (kind: SignalKind, count: number, weight: number): void => {
    if (count > 0) signals.push({ kind, count, weight });
  };
  signal("oversize", cut === null ? (truncated ? 1 : 0) : text.length - src.length, 0.1);
  signal("ansi_escape", ansi, 0.2);
  signal("control_bytes", ctrl, 0.1);
  signal("unicode_tags", tags, 0.5);
  signal("bidi_control", bidi, overrides > 0 || bidi > 4 ? 0.2 : 0.05);
  signal("zero_width", zw, zw > 3 ? 0.15 : 0);
  signal("variation_selectors", vs, vs > 8 ? 0.3 : 0);
  signal("confusables", conf, conf > 5 ? 0.15 : 0.05);

  return {
    folded,
    flat,
    map: map.subarray(0, j),
    words: words.text,
    wordsMap: words.map,
    hidden: tagText + vsText,
    hiddenSpans,
    signals,
    truncated,
  };
}

// Only U+0130 lowercases to two code units; keep it so flat stays aligned with folded.
function lowerPerUnit(s: string): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const l = s[i]!.toLowerCase();
    out.push(l.length === 1 ? l : s[i]!);
  }
  return out.join("");
}

function wordsView(folded: string, flat: string, strips: readonly number[]): { text: string; map: Uint32Array } {
  const n = flat.length;
  const map = new Uint32Array(n * 2 + 1);
  const parts: string[] = [];
  let j = 0;
  let si = 0;
  const word = (start: number, end: number): void => {
    if (end <= start) return;
    if (j > 0) {
      parts.push(" ");
      map[j++] = start;
    }
    parts.push(flat.slice(start, end));
    for (let k = start; k < end; k++) map[j++] = k;
  };
  const isWord = (c: number): boolean => c !== 0x5f && isWordUnit(c);
  for (let i = 0; i < n; ) {
    while (i < n && !isWord(flat.charCodeAt(i))) i++;
    let start = i;
    for (; i < n && isWord(flat.charCodeAt(i)); i++) {
      while (si < strips.length && strips[si]! < i) si++;
      const u = folded.charCodeAt(i);
      const camel = u >= 0x41 && u <= 0x5a && folded.charCodeAt(i - 1) >= 0x61 && folded.charCodeAt(i - 1) <= 0x7a;
      if (i > start && (camel || strips[si] === i)) {
        word(start, i);
        start = i;
      }
    }
    word(start, i);
  }
  return { text: parts.join(""), map: map.subarray(0, j) };
}
