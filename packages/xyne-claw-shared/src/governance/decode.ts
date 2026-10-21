import type { Span } from "./types.js";

export type DecodedKind = "base64" | "hex" | "percent" | "entities" | "letter_spacing";

export interface DecodedView {
  text: string;
  /** The encoded run, in folded coordinates. */
  span: Span;
  kind: DecodedKind;
}

export interface Decoded {
  views: DecodedView[];
  /** A decoder had more readable candidates than its quota, so some encoded text was not scanned. */
  capped: boolean;
}

const PER_KIND = 16;
const MAX_DECODED = 256 * 1024;

/** Exported so the recheck test proves them linear with the rule regexes; base64 and hex runs are found by loops. */
export const DECODER_PATTERNS = {
  entity: "&(#[xX]?[0-9A-Fa-f]{1,6}|[A-Za-z]{2,8});",
  spaced: "(?<![A-Za-z0-9_])(?:[A-Za-z][\\s._*|/\\\\-]{1,5}){5,}[A-Za-z](?![A-Za-z0-9])",
} as const;

const ENTITY = new RegExp(DECODER_PATTERNS.entity, "g");
const SPACED = new RegExp(DECODER_PATTERNS.spaced, "g");
const NAMED: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", sol: "/", colon: ":", semi: ";", comma: ",",
  period: ".", excl: "!", num: "#", equals: "=", lpar: "(", rpar: ")", lowbar: "_", Tab: "\t", NewLine: "\n",
};

const isHex = (c: number): boolean => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isB64 = (c: number): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x2b || c === 0x2f;

type OnRun = (start: number, end: number) => void;

/** Maximal runs of member units, at least `min` long. */
function classRuns(text: string, member: (c: number) => boolean, min: number, onRun: OnRun): void {
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && member(text.charCodeAt(i))) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= min) onRun(start, i);
      start = -1;
    }
  }
}

/** Maximal sequences of back-to-back fixed-width tokens, at least `min` tokens long. */
function tokenRuns(text: string, width: number, token: (i: number) => boolean, min: number, onRun: OnRun): void {
  for (let i = 0; i + width <= text.length; ) {
    let n = 0;
    while (i + (n + 1) * width <= text.length && token(i + n * width)) n++;
    if (n >= min) onRun(i, i + n * width);
    i += n > 0 ? n * width : 1;
  }
}

/** Two or more consecutive lines that are nothing but base64, wrapped at a fixed width; the last may be short or padded. */
function wrappedRuns(text: string, onRun: OnRun): void {
  let start = -1;
  let count = 0;
  let last = 0;
  const close = (): void => {
    if (count >= 2) onRun(start, last);
    start = -1;
    count = 0;
  };
  for (let pos = 0; pos <= text.length; ) {
    const nl = text.indexOf("\n", pos);
    const end = nl < 0 ? text.length : nl;
    let i = pos;
    while (i < end && isB64(text.charCodeAt(i))) i++;
    const body = i - pos;
    while (i < end && i - pos - body < 2 && text.charCodeAt(i) === 0x3d) i++;
    const whole = body > 0 && i === end;
    if (whole && i === pos + body && body >= 20) {
      if (start < 0) start = pos;
      count++;
      last = end;
    } else {
      if (whole && start >= 0) {
        count++;
        last = end;
      }
      close();
    }
    if (nl < 0) break;
    pos = nl + 1;
  }
  close();
}

function readable(s: string): boolean {
  let p = 0;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    if ((k >= 0x20 && k < 0x7f) || k === 0x0a || k === 0x0d || k === 0x09) p++;
  }
  return s.length > 0 && p / s.length > 0.9;
}

function percentText(s: string): string | null {
  const bytes: number[] = [];
  let escapes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const b = c === 0x25 && i + 3 <= s.length ? parseInt(s.slice(i + 1, i + 3), 16) : Number.NaN;
    if (Number.isNaN(b) || !isHex(s.charCodeAt(i + 1)) || !isHex(s.charCodeAt(i + 2))) {
      bytes.push(c < 0x80 ? c : 0x3f);
      continue;
    }
    bytes.push(b);
    escapes++;
    i += 2;
  }
  return escapes >= 1 ? Buffer.from(bytes).toString("utf8") : null;
}

function entityText(s: string): string {
  return s.replace(ENTITY, (m, body: string) => {
    if (body[0] !== "#") return NAMED[body] ?? m;
    const hex = body[1] === "x" || body[1] === "X";
    const cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isNaN(cp) || cp > 0x10ffff ? "" : String.fromCodePoint(cp);
  });
}

export function decodeSegments(folded: string): Decoded {
  const views: DecodedView[] = [];
  const seen = new Set<string>();
  let budget = MAX_DECODED;
  let capped = false;
  const counts = new Map<DecodedKind, number>();
  const add = (kind: DecodedKind, start: number, end: number, text: string | null): void => {
    if (text === null || text.length === 0 || seen.has(text) || !readable(text)) return;
    const count = counts.get(kind) ?? 0;
    if (count >= PER_KIND || budget <= 0) {
      capped = true;
      return;
    }
    seen.add(text);
    counts.set(kind, count + 1);
    text = text.slice(0, budget);
    budget -= text.length;
    views.push({ text, span: { start, end }, kind });
  };
  const each = (re: RegExp, kind: DecodedKind, decode: (run: string) => string | null): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(folded)) !== null) {
      if (m[0].length === 0) re.lastIndex++;
      add(kind, m.index, m.index + m[0].length, decode(m[0]));
    }
  };
  const hexText = (start: number, end: number): string => Buffer.from(folded.slice(start, end).replace(/\\x/g, ""), "hex").toString("latin1");
  const hexAt = (i: number): boolean => isHex(folded.charCodeAt(i)) && isHex(folded.charCodeAt(i + 1));

  const b64 = (start: number, end: number): string => Buffer.from(folded.slice(start, end).replaceAll("\n", ""), "base64").toString("latin1");
  classRuns(folded, isB64, 20, (start, end) => {
    let e = end;
    while (e < folded.length && e < end + 2 && folded.charCodeAt(e) === 0x3d) e++;
    add("base64", start, e, b64(start, e));
  });
  if (folded.includes("\n")) wrappedRuns(folded, (start, end) => add("base64", start, end, b64(start, end)));
  classRuns(folded, isHex, 32, (start, end) => add("hex", start, end, hexText(start, end)));
  if (folded.includes("\\x")) tokenRuns(folded, 4, (i) => folded.startsWith("\\x", i) && hexAt(i + 2), 12, (s, e) => add("hex", s, e, hexText(s, e)));
  if (folded.includes("%")) add("percent", 0, folded.length, percentText(folded));
  each(SPACED, "letter_spacing", (run) => run.replace(/[^A-Za-z]/g, ""));
  // One numeric entity, or two named ones, is enough to decode the whole text once.
  const entities = folded.includes("&") ? (folded.match(ENTITY) ?? []) : [];
  if (entities.length >= 2 || entities.some((e) => e.startsWith("&#"))) add("entities", 0, folded.length, entityText(folded));
  return { views, capped };
}
