/**
 * Per-run on-disk store: `session.json` + `events.jsonl` + `blobs.jsonl`.
 *
 * Everything here is built around one assumption: the pod can die at any
 * instant, including mid-write. That drives three choices.
 *
 * 1. **Append-only, one `appendFile` per drain.** Writes never seek, never
 *    rewrite, never hold a mutable in-memory document that has to be re-emitted.
 *    A process killed between two appends leaves every earlier line intact.
 * 2. **A single serialized queue.** `appendEvent`/`appendBlobLine` are called
 *    from inside pi's synchronous event subscription, so they return `void` and
 *    push onto a promise chain instead of awaiting. Two concurrent
 *    `appendFile`s to one path can interleave partial buffers; the chain makes
 *    that impossible without keeping a handle open across the whole run.
 * 3. **`session.json` is written tmp+rename.** It is the guaranteed artifact —
 *    written once at start with `status: "running"` and once at finish — so it
 *    must never be observable half-written. A reader that finds it garbage gets
 *    "no run" rather than a run with invented fields.
 *
 * The read side is deliberately forgiving: a torn final line is the *expected*
 * shape of a crashed run, not a corruption to reject. `readRun` drops it,
 * reports it in `warnings`, and infers `status: "crashed"` for a run whose
 * header still says "running" but whose files stopped changing long ago.
 */

import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { PATHS } from "../config.js";
import { createLogger } from "../logger.js";
import { metric } from "../metrics.js";
import { BlobIndex, type BlobLine } from "./blobs.js";
import { compareRunIdsNewestFirst } from "./keys.js";
import type { CaptureLevel, DebugEventV2, RunHeader } from "./types.js";

const log = createLogger("debug");

const SESSION_FILE = "session.json";
const SESSION_TMP = "session.json.tmp";
const EVENTS_FILE = "events.jsonl";
const BLOBS_FILE = "blobs.jsonl";
const UPLOADED_MARKER = ".uploaded";

/**
 * How long a "running" run may sit untouched before a reader calls it crashed.
 * Read per call rather than at import so a test (or a redeploy that tightens
 * the window) does not need a fresh module instance.
 */
function crashGraceMs(): number {
  const raw = Number(process.env["DEBUG_CRASH_GRACE_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
}

export function debugDirFor(storeKey: string, dataDir?: string): string {
  // Absolute on purpose: PATHS.dataDir defaults to a relative "./data", and
  // every downstream consumer (archiver, GCS uploader, route handlers) resolves
  // paths from a different cwd than the one the run was written from.
  return path.resolve(dataDir ?? PATHS.dataDir, "sessions", storeKey, "debug");
}

export interface RunStoreOpts {
  storeKey: string;
  runId: string;
  captureLevel: CaptureLevel;
  dataDir?: string;
}

export class RunStore {
  readonly runDir: string;
  readonly debugDir: string;
  readonly runId: string;
  readonly storeKey: string;
  readonly captureLevel: CaptureLevel;

  /** Serializes every write; a rejection is swallowed so the chain survives. */
  private chain: Promise<void> = Promise.resolve();
  /** Lines waiting for their file's next drain, coalesced into one append. */
  private readonly buffers = new Map<string, string[]>();
  private readonly scheduled = new Set<string>();
  private failures = 0;

  private constructor(opts: RunStoreOpts, debugDir: string) {
    this.debugDir = debugDir;
    this.runDir = path.join(debugDir, "runs", opts.runId);
    this.runId = opts.runId;
    this.storeKey = opts.storeKey;
    this.captureLevel = opts.captureLevel;
  }

  static async open(opts: RunStoreOpts): Promise<RunStore> {
    const debugDir = debugDirFor(opts.storeKey, opts.dataDir);
    const store = new RunStore(opts, debugDir);
    await fs.mkdir(store.runDir, { recursive: true });
    return store;
  }

  private get eventsPath(): string {
    return path.join(this.runDir, EVENTS_FILE);
  }

  private get blobsPath(): string {
    return path.join(this.runDir, BLOBS_FILE);
  }

  private get headerPath(): string {
    return path.join(this.runDir, SESSION_FILE);
  }

  appendEvent(e: DebugEventV2): void {
    let line: string;
    try {
      line = JSON.stringify(e);
    } catch (err) {
      // A non-serializable payload is a recorder bug, but it must not take the
      // run down — drop the one event and keep the trace.
      this.onFailure("serialize_event", err);
      return;
    }
    this.enqueueLine(this.eventsPath, line);
  }

  appendBlobLine(line: string): void {
    this.enqueueLine(this.blobsPath, line);
  }

  writeHeader(h: RunHeader): void {
    let body: string;
    try {
      body = JSON.stringify(h);
    } catch (err) {
      this.onFailure("serialize_header", err);
      return;
    }
    const tmp = path.join(this.runDir, SESSION_TMP);
    this.enqueue(async () => {
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, this.headerPath);
    }, "write_header");
  }

  /** Resolves once every write queued *before* this call has hit disk. */
  async flush(): Promise<void> {
    // A queued drain can itself schedule nothing new, but a caller may append
    // while we await, so settle repeatedly until the buffers are empty.
    for (let i = 0; i < 8; i++) {
      await this.chain;
      if (!this.hasPending()) return;
    }
    await this.chain;
  }

  async close(): Promise<void> {
    await this.flush();
  }

  async markUploaded(): Promise<void> {
    try {
      await fs.writeFile(path.join(this.runDir, UPLOADED_MARKER), "", "utf8");
    } catch (err) {
      this.onFailure("mark_uploaded", err);
    }
  }

  async isUploaded(): Promise<boolean> {
    try {
      await fs.stat(path.join(this.runDir, UPLOADED_MARKER));
      return true;
    } catch {
      return false;
    }
  }

  private hasPending(): boolean {
    for (const buf of this.buffers.values()) if (buf.length > 0) return true;
    return false;
  }

  private enqueueLine(file: string, line: string): void {
    const buf = this.buffers.get(file);
    if (buf) buf.push(line);
    else this.buffers.set(file, [line]);
    if (this.scheduled.has(file)) return;
    this.scheduled.add(file);
    this.enqueue(async () => {
      // No await between claiming the buffer and swapping it, so a concurrent
      // append either lands in this batch or schedules the next one.
      this.scheduled.delete(file);
      const pending = this.buffers.get(file);
      if (!pending || pending.length === 0) return;
      this.buffers.set(file, []);
      await fs.appendFile(file, `${pending.join("\n")}\n`, { encoding: "utf8", flag: "a" });
    }, "append");
  }

  private enqueue(task: () => Promise<void>, op: string): void {
    this.chain = this.chain.then(task).catch((err: unknown) => {
      this.onFailure(op, err);
    });
  }

  private onFailure(op: string, err: unknown): void {
    this.failures += 1;
    metric.count("debug_store_write_error", { op });
    // One log line per run is enough to find the pod; a per-event log during a
    // full disk turns a degraded run into an unreadable one.
    if (this.failures <= 3) {
      log.warn(`debug store ${op} failed`, {
        runId: this.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── Read path ───────────────────────────────────────────────────────────────

export interface ReadRun {
  header: RunHeader;
  events: DebugEventV2[];
  blobs: BlobIndex;
  warnings: string[];
}

interface RawRun {
  header: RunHeader;
  events: DebugEventV2[];
  blobLines: BlobLine[];
  warnings: string[];
}

interface ParsedLines<T> {
  values: T[];
  warnings: string[];
  /** Newest mtime seen, or 0 when the file is absent. */
  mtimeMs: number;
}

async function readJsonLines<T>(
  file: string,
  fileName: string,
  keep: (v: unknown) => v is T,
): Promise<ParsedLines<T>> {
  let raw: string;
  let mtimeMs = 0;
  try {
    const [text, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    raw = text;
    mtimeMs = st.mtimeMs;
  } catch {
    // A run that produced no blobs (or died before its first event) is normal.
    return { values: [], warnings: [`${fileName} missing`], mtimeMs: 0 };
  }

  const lines = raw.split("\n");
  const values: T[] = [];
  const warnings: string[] = [];
  let torn = 0;
  let bad = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Only the final line can legitimately be half-written; anything earlier
      // means real corruption and is reported separately.
      if (isLastNonEmpty(lines, i)) torn += 1;
      else bad += 1;
      continue;
    }
    if (keep(parsed)) values.push(parsed);
    else bad += 1;
  }

  if (torn > 0) warnings.push(`dropped ${torn} torn line at end of ${fileName}`);
  if (bad > 0) warnings.push(`dropped ${bad} unreadable line${bad === 1 ? "" : "s"} in ${fileName}`);
  return { values, warnings, mtimeMs };
}

function isLastNonEmpty(lines: string[], index: number): boolean {
  for (let j = index + 1; j < lines.length; j++) {
    const rest = lines[j];
    if (rest !== undefined && rest.trim() !== "") return false;
  }
  return true;
}

function isEventV2(v: unknown): v is DebugEventV2 {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Partial<DebugEventV2>;
  return typeof e.seq === "number" && typeof e.kind === "string";
}

function isBlobLine(v: unknown): v is BlobLine {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Partial<BlobLine>;
  return typeof b.hash === "string" && typeof b.content === "string";
}

function isHeader(v: unknown): v is RunHeader {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Partial<RunHeader>;
  return typeof h.runId === "string" && typeof h.startedAt === "string";
}

async function readHeader(runDir: string): Promise<{ header: RunHeader; mtimeMs: number } | null> {
  try {
    const file = path.join(runDir, SESSION_FILE);
    const [text, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    const parsed: unknown = JSON.parse(text);
    if (!isHeader(parsed)) return null;
    return { header: parsed, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * A run whose header still says "running" but whose files stopped changing is a
 * pod that was killed: relabel it in the RETURNED header only. Rewriting it on
 * disk would race a run that is merely slow (a 20-minute tool call is not a
 * crash), and the on-disk header stays the writer's to own.
 */
function inferCrash(header: RunHeader, newestMtimeMs: number, now: number): RunHeader {
  if (header.status !== "running") return header;
  if (header.finishedAt !== header.startedAt) return header;
  if (newestMtimeMs <= 0) return header;
  if (now - newestMtimeMs <= crashGraceMs()) return header;
  return { ...header, status: "crashed", finishedAt: new Date(newestMtimeMs).toISOString() };
}

async function readRunRaw(runDir: string): Promise<RawRun | null> {
  const head = await readHeader(runDir);
  if (!head) return null;

  const [events, blobs] = await Promise.all([
    readJsonLines(path.join(runDir, EVENTS_FILE), EVENTS_FILE, isEventV2),
    readJsonLines(path.join(runDir, BLOBS_FILE), BLOBS_FILE, isBlobLine),
  ]);

  const newest = Math.max(head.mtimeMs, events.mtimeMs, blobs.mtimeMs);
  const header = inferCrash(head.header, newest, Date.now());
  const warnings = [...events.warnings, ...blobs.warnings];
  if (header.status === "crashed" && head.header.status === "running") {
    warnings.push("run had no finish record; status inferred as crashed");
  }

  return { header, events: events.values, blobLines: blobs.values, warnings };
}

function indexBlobs(lines: BlobLine[], warnings: string[]): BlobIndex {
  try {
    return BlobIndex.fromLines(lines.map((l) => JSON.stringify(l)));
  } catch (err) {
    // The blob log is an optimization; losing it costs payloads, not the trace.
    warnings.push("blob log unreadable; payloads omitted");
    log.warn("debug blob index failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return BlobIndex.empty();
  }
}

export async function readRun(runDir: string): Promise<ReadRun | null> {
  const raw = await readRunRaw(runDir);
  if (!raw) return null;
  const warnings = [...raw.warnings];
  return {
    header: raw.header,
    events: raw.events,
    blobs: indexBlobs(raw.blobLines, warnings),
    warnings,
  };
}

/** Absolute run dirs under `<debugDir>/runs`, newest first. */
export async function listRunDirs(debugDir: string): Promise<string[]> {
  const runsDir = path.join(debugDir, "runs");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(compareRunIdsNewestFirst)
    .map((name) => path.join(runsDir, name));
}

// ── Packing (archive / transport format) ────────────────────────────────────

type PackedLine =
  | { t: "h"; v: RunHeader }
  | { t: "e"; v: DebugEventV2 }
  | { t: "b"; v: BlobLine };

/**
 * Gzipped ndjson: one header line, then events, then blob lines. Blob lines are
 * carried verbatim rather than re-encoded from a `BlobIndex`, so a gzip+base64
 * blob survives the round trip byte-for-byte.
 */
export async function packRun(runDir: string): Promise<Buffer | null> {
  const raw = await readRunRaw(runDir);
  if (!raw) return null;
  const lines: PackedLine[] = [
    { t: "h", v: raw.header },
    ...raw.events.map((v): PackedLine => ({ t: "e", v })),
    ...raw.blobLines.map((v): PackedLine => ({ t: "b", v })),
  ];
  const ndjson = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  try {
    return gzipSync(Buffer.from(ndjson, "utf8"));
  } catch (err) {
    log.warn("debug packRun gzip failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function unpackRun(buf: Buffer): ReadRun | null {
  let text: string;
  try {
    text = gunzipSync(buf).toString("utf8");
  } catch {
    return null;
  }

  let header: RunHeader | null = null;
  const events: DebugEventV2[] = [];
  const blobLines: BlobLine[] = [];
  const warnings: string[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (isLastNonEmpty(lines, i)) warnings.push("dropped 1 torn line at end of packed run");
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const rec = parsed as { t?: unknown; v?: unknown };
    if (rec.t === "h" && isHeader(rec.v)) header = rec.v;
    else if (rec.t === "e" && isEventV2(rec.v)) events.push(rec.v);
    else if (rec.t === "b" && isBlobLine(rec.v)) blobLines.push(rec.v);
  }

  if (!header) return null;
  return { header, events, blobs: indexBlobs(blobLines, warnings), warnings };
}
