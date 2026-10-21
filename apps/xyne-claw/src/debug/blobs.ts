/**
 * Content-addressed blob log for debug traces.
 *
 * The v1 writer embedded every large payload inline in every event, so a 20 KB
 * system prompt sent on 12 turns cost 240 KB on disk and the transcript re-embed
 * made whole files grow O(turns^2). Here a payload is hashed once and written
 * once; events carry a 16-hex `BlobRef` instead. Twelve turns of an identical
 * prompt cost 20 KB total.
 *
 * The log is `blobs.jsonl`, one `BlobLine` per line, append-only. It is written
 * through an injected `appendLine` rather than a file handle so the recorder can
 * stay synchronous and the store can own all the I/O sequencing.
 *
 * Two invariants everything else depends on:
 *   - A ref is NEVER silently lossy. Oversized content is cut at
 *     `BLOB_MAX_BYTES` with `truncated: true` and the real `originalBytes`.
 *   - `serializeForBlob` never throws. A cyclic tool result or a BigInt in a
 *     provider response must not be able to kill a run for the sake of a trace.
 */

import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { metric } from "../metrics.js";
import type { BlobRef, CaptureLevel } from "./types.js";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Hard cap on stored blob bytes. Beyond this we truncate and say so. */
export const BLOB_MAX_BYTES = envInt("DEBUG_BLOB_MAX_BYTES", 2_000_000);

/** Above this, try gzip+base64 — below it the base64 overhead usually wins. */
export const BLOB_GZIP_OVER = envInt("DEBUG_BLOB_GZIP_OVER", 4_096);

/** Gzip is synchronous and runs on the agent loop; big payloads take the fast
 *  level, where the ratio loss is small and the CPU saving is not. */
const GZIP_FAST_OVER = 256 * 1024;

const PREVIEW_CHARS = 200;

export interface BlobLine {
  /** sha256 of the *serialized source value*, first 16 hex chars. */
  hash: string;
  /** Byte length of the decoded content (post-truncation), not of `content`. */
  bytes: number;
  enc: "utf8" | "gzip+base64";
  truncated?: true;
  originalBytes?: number;
  /** utf8 text, or base64 of its gzip, per `enc`. */
  content: string;
}

export function hashContent(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

/**
 * Cycle- and BigInt-tolerant fallback. The WeakSet marks any *repeated* object
 * as circular, not only true ancestors — a shared (non-cyclic) reference is
 * therefore reported as `[Circular]`. That over-report is the price of a
 * single-pass stringify that cannot recurse forever, and this path only runs
 * after plain `JSON.stringify` has already failed.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_k, v: unknown) => {
      if (typeof v === "bigint") return v.toString();
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      if (typeof v === "function" || typeof v === "symbol") return String(v);
      return v;
    }) ?? String(value)
  );
}

/** Never throws, always returns a string. */
export function serializeForBlob(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const s = JSON.stringify(value);
    // undefined/function/symbol stringify to `undefined`, not to a string.
    if (typeof s === "string") return s;
  } catch {
    // Cycles and BigInt land here.
  }
  try {
    return safeStringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

/**
 * Cut a utf8 buffer at `max` bytes on a character boundary.
 *
 * Slicing mid-sequence and calling `toString` would splice a U+FFFD into the
 * content, which is exactly the kind of silent corruption that makes a 2 MB MCP
 * envelope unparseable for the reader.
 */
function truncateUtf8(buf: Buffer, max: number): string {
  let end = Math.min(max, buf.length);
  // Back off while the first EXCLUDED byte is a utf8 continuation byte (10xxxxxx);
  // once it is a lead or ascii byte, [0, end) is a complete sequence.
  while (end > 0) {
    const b = buf[end];
    if (b === undefined || (b & 0xc0) !== 0x80) break;
    end--;
  }
  let s = buf.subarray(0, end).toString("utf8");
  // Defensive: a lone high surrogate can only survive if the source string had
  // one, but a half-pair here would break JSON.stringify of the blob line.
  const last = s.charCodeAt(s.length - 1);
  if (s.length > 0 && last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  return s;
}

function previewOf(content: string): string {
  return content.slice(0, PREVIEW_CHARS).replace(/[\r\n]+/g, " ");
}

function encode(content: string, byteLen: number): { enc: BlobLine["enc"]; body: string } {
  if (byteLen <= BLOB_GZIP_OVER) return { enc: "utf8", body: content };
  try {
    const level = byteLen > GZIP_FAST_OVER ? 1 : 6;
    const packed = gzipSync(Buffer.from(content, "utf8"), { level }).toString("base64");
    // base64 inflates by 4/3; only worth it when the compression still wins.
    if (packed.length < content.length) return { enc: "gzip+base64", body: packed };
  } catch {
    // Fall through to plain utf8 — a trace is worth more than a compressed one.
  }
  return { enc: "utf8", body: content };
}

export class BlobWriter {
  private readonly appendLine: (line: string) => void;
  private readonly captureLevel: CaptureLevel;
  private readonly seen = new Set<string>();

  constructor(opts: { appendLine: (line: string) => void; captureLevel: CaptureLevel }) {
    this.appendLine = opts.appendLine;
    this.captureLevel = opts.captureLevel;
  }

  /** Distinct blobs interned so far. */
  get size(): number {
    return this.seen.size;
  }

  has(hash: string): boolean {
    return this.seen.has(hash);
  }

  /**
   * Intern a value and return its ref. Returns undefined only when capture is
   * off. At `metadata` the hash/size/truncation are still computed and returned
   * — the timeline stays complete, only the payload is withheld.
   */
  intern(value: unknown): BlobRef | undefined {
    if (this.captureLevel === "off") return undefined;

    const serialized = serializeForBlob(value);
    const buf = Buffer.from(serialized, "utf8");
    const originalBytes = buf.length;
    const truncated = originalBytes > BLOB_MAX_BYTES;
    const content = truncated ? truncateUtf8(buf, BLOB_MAX_BYTES) : serialized;
    const bytes = truncated ? Buffer.byteLength(content, "utf8") : originalBytes;

    // Key on the FULL serialized value, not the stored prefix: two different
    // oversized payloads that share a 2 MB head must not alias to one blob.
    const hash = hashContent(serialized);

    const ref: BlobRef = {
      hash,
      bytes,
      ...(truncated ? { truncated: true as const, originalBytes } : {}),
      ...(this.captureLevel === "full" ? { preview: previewOf(content) } : {}),
    };

    if (this.seen.has(hash)) return ref;

    /** The dedupe set is a promise that the content is IN the log: once a hash
     *  is in it, every later intern of the same value returns a ref and writes
     *  nothing. Marking it before the line is accepted turns one failed write
     *  into a run-long trail of refs pointing at content that was never
     *  written. */
    const markSeen = (): void => {
      this.seen.add(hash);
      if (truncated) {
        metric.count("debug_blob_truncated");
        metric.observe("debug_blob_dropped_bytes", originalBytes - bytes);
      }
    };

    // At `metadata` there is no line to accept: the ref is the whole record.
    if (this.captureLevel !== "full") {
      markSeen();
      return ref;
    }

    const { enc, body } = encode(content, bytes);
    const line: BlobLine = {
      hash,
      bytes,
      enc,
      ...(truncated ? { truncated: true as const, originalBytes } : {}),
      content: body,
    };
    try {
      this.appendLine(JSON.stringify(line));
      markSeen();
    } catch {
      // Not marked seen: the next intern of this value tries the write again,
      // and until one succeeds the reader reports the miss as a warning rather
      // than the run failing over a trace line.
    }
    return ref;
  }

  /**
   * Registry `ref(n)` policy: keep the value inline while it is small, otherwise
   * intern it. `inlineUnder: 0` means "always intern".
   */
  maybeIntern(
    value: unknown,
    inlineUnder: number,
  ): { inline: unknown } | { ref: BlobRef } | { omitted: true } {
    if (this.captureLevel === "off") return { omitted: true };
    if (inlineUnder > 0) {
      const bytes = Buffer.byteLength(serializeForBlob(value), "utf8");
      if (bytes <= inlineUnder) return { inline: value };
    }
    const ref = this.intern(value);
    return ref ? { ref } : { omitted: true };
  }
}

function parseLine(raw: string): BlobLine | null {
  const line = raw.trim();
  if (!line) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null; // Torn tail from a crashed pod, or a partially flushed line.
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Partial<BlobLine>;
  if (typeof o.hash !== "string" || typeof o.content !== "string") return null;
  if (o.enc !== "utf8" && o.enc !== "gzip+base64") return null;
  return {
    hash: o.hash,
    bytes: typeof o.bytes === "number" ? o.bytes : Buffer.byteLength(o.content, "utf8"),
    enc: o.enc,
    ...(o.truncated === true ? { truncated: true as const } : {}),
    ...(typeof o.originalBytes === "number" ? { originalBytes: o.originalBytes } : {}),
    content: o.content,
  };
}

/** Read side of `blobs.jsonl`. Decoding is lazy and memoized. */
export class BlobIndex {
  private readonly lines = new Map<string, BlobLine>();
  private readonly decoded = new Map<string, string>();

  private constructor(lines: readonly BlobLine[]) {
    // First write wins: the writer only emits one line per hash, and a duplicate
    // can only come from a concatenated/re-appended log.
    for (const l of lines) if (!this.lines.has(l.hash)) this.lines.set(l.hash, l);
  }

  static fromLines(lines: string[]): BlobIndex {
    const parsed: BlobLine[] = [];
    for (const raw of lines) {
      const l = parseLine(raw);
      if (l) parsed.push(l);
    }
    return new BlobIndex(parsed);
  }

  static empty(): BlobIndex {
    return new BlobIndex([]);
  }

  get size(): number {
    return this.lines.size;
  }

  get hashes(): string[] {
    return [...this.lines.keys()];
  }

  meta(hash: string): Omit<BlobLine, "content"> | undefined {
    const l = this.lines.get(hash);
    if (!l) return undefined;
    const { content: _content, ...rest } = l;
    return rest;
  }

  get(hash: string): string | undefined {
    const cached = this.decoded.get(hash);
    if (cached !== undefined) return cached;
    const l = this.lines.get(hash);
    if (!l) return undefined;
    let out: string;
    if (l.enc === "gzip+base64") {
      try {
        out = gunzipSync(Buffer.from(l.content, "base64")).toString("utf8");
      } catch {
        return undefined; // Corrupt payload reads as a miss, not a throw.
      }
    } else {
      out = l.content;
    }
    this.decoded.set(hash, out);
    return out;
  }
}
