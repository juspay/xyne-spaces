/**
 * Recorder — the one door every debug event goes through.
 *
 * It exists so that "emit an event" is a single call with a single failure
 * mode. The old code emitted from a dozen sites, each deciding for itself what
 * to trim; the two bugs that produced were (a) transcripts embedded per turn,
 * making trace files grow O(turns^2), and (b) a throw from inside pi's event
 * queue taking the whole run down. Both are structurally impossible here:
 * trimming is the registry's job, and `record()` cannot throw.
 */

import { createLogger } from "../logger.js";
import { metric } from "../metrics.js";
import type { BlobWriter } from "./blobs.js";
import { policyFor, specFor, type EventSpec } from "./registry.js";
import type { RunStore } from "./store.js";
import type { BlobRef, CaptureLevel, DebugEventRecord, DebugEventV2 } from "./types.js";

const log = createLogger("debug");

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A caller may date an event to when it really happened rather than to when it
 * reached the recorder — agent.ts stamps `session_start` with the run's true
 * start, which is earlier than the first `record()` by however long setup took.
 * Anything unparseable falls back to our own clock: a wrong timestamp reorders
 * the whole timeline.
 */
function isoAt(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/**
 * In-memory retention for `snapshotEvents()`. A long-running agent can emit
 * tens of thousands of events; the on-disk log stays complete, this window is
 * only what an in-process reader (live drawer, crash reporter) can still see.
 */
const MAX_RETAINED_EVENTS = 5_000;

/** Long enough to coalesce a burst of tool events, short enough that a reader
 *  arriving mid-run sees a near-current file. */
const FLUSH_DEBOUNCE_MS = 250;

/** Envelope fields copied onto every event of a child/subagent run. */
const ENVELOPE_KEYS = ["parentToolCallId", "subagentName", "childRunId"] as const;

/** Meta fields a caller may stamp per event. `seq`, `kind` and `data` are owned
 *  by the recorder and ignored if passed; `at` is honoured when it parses (see
 *  `isoAt`) but is not copied through `#stamp`. */
const META_KEYS = [
  "turn",
  "llmCall",
  "toolCallId",
  "parentToolCallId",
  "subagentName",
  "childRunId",
] as const;

/** At `off` we still stream live, but only the run's bookends reach disk. */
const OFF_LEVEL_PERSISTED_KINDS = new Set(["session_start", "session_end"]);

export interface RecorderOpts {
  store: RunStore | null;
  blobs: BlobWriter;
  captureLevel: CaptureLevel;
  live?: { push: (event: DebugEventRecord) => void };
  envelope?: { parentToolCallId?: string; subagentName?: string; childRunId?: string };
}

export class Recorder {
  readonly #store: RunStore | null;
  readonly #blobs: BlobWriter;
  readonly #captureLevel: CaptureLevel;
  readonly #live: { push: (event: DebugEventRecord) => void } | undefined;
  readonly #envelope: RecorderOpts["envelope"];

  #seq = 0;
  #eventCount = 0;
  #messageCount = 0;
  #toolCallCount = 0;
  #events: DebugEventV2[] = [];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(o: RecorderOpts) {
    this.#store = o.store;
    this.#blobs = o.blobs;
    this.#captureLevel = o.captureLevel;
    this.#live = o.live;
    this.#envelope = o.envelope;
  }

  get seq(): number {
    return this.#seq;
  }
  get eventCount(): number {
    return this.#eventCount;
  }
  get messageCount(): number {
    return this.#messageCount;
  }
  get toolCallCount(): number {
    return this.#toolCallCount;
  }
  get blobCount(): number {
    return this.#blobs.size;
  }

  /**
   * Record an event. Never throws — it runs inside pi's event queue, where an
   * exception aborts the run rather than losing a trace line.
   */
  record(kind: string, data?: Record<string, unknown>, meta?: Partial<DebugEventV2>): void {
    try {
      const spec = specFor(kind);
      const event: DebugEventV2 = {
        seq: ++this.#seq,
        at: isoAt(meta?.at) ?? new Date().toISOString(),
        kind,
        data: this.#applyPolicy(spec, data),
      };
      this.#stamp(event, meta);
      this.#eventCount += 1;
      if (kind === "tool_execution_end") this.#toolCallCount += 1;

      this.#retain(event);
      if (!spec.liveOnly && this.#shouldPersist(kind)) this.#store?.appendEvent(event);
      // Bulk bookkeeping (message_append) would drown an SSE reader in exactly
      // the payload the ref policy just moved out of the event file.
      if (!spec.persistOnly) this.#live?.push(event);
    } catch (err) {
      metric.count("debug_record_error", { kind });
      log.debug(`[debug] dropped event kind=${kind}: ${errText(err)}`);
    }
  }

  /**
   * Live-channel-only emission: no seq is consumed and nothing is written, so
   * high-frequency telemetry (stream_rate ticks) cannot punch holes in the
   * persisted sequence the way it used to.
   */
  recordLive(kind: string, data: Record<string, unknown>, meta?: Partial<DebugEventV2>): void {
    try {
      if (!this.#live) return;
      const event: DebugEventRecord = {
        seq: this.#seq,
        at: new Date().toISOString(),
        kind,
        data: { ...data },
      };
      this.#stamp(event, meta);
      this.#live.push(event);
    } catch (err) {
      metric.count("debug_record_error", { kind });
      log.debug(`[debug] dropped live event kind=${kind}: ${errText(err)}`);
    }
  }

  /**
   * Append-only transcript capture: emits ONLY the messages added since the
   * last call. Recording the whole array per turn is what made traces
   * quadratic. A shorter incoming array means the list was replaced
   * (compaction), so we restate it in full and flag the discontinuity.
   */
  recordTranscript(messages: readonly unknown[]): void {
    try {
      const total = messages.length;
      if (total === this.#messageCount) return;
      if (total < this.#messageCount) {
        this.#messageCount = 0;
        this.record("message_append", {
          from: 0,
          to: total,
          count: total,
          reset: true,
          messages: messages.slice(),
        });
        this.#messageCount = total;
        return;
      }
      const from = this.#messageCount;
      const delta = messages.slice(from);
      this.record("message_append", { from, to: total, count: delta.length, messages: delta });
      this.#messageCount = total;
    } catch (err) {
      metric.count("debug_record_error", { kind: "message_append" });
      log.debug(`[debug] dropped transcript delta: ${errText(err)}`);
    }
  }

  /** Intern a value into the blob log without recording an event (header
   *  fields such as `lastAssistantTextRef`). */
  internText(value: unknown): BlobRef | undefined {
    try {
      return this.#blobs.intern(value);
    } catch (err) {
      log.debug(`[debug] failed to intern a blob: ${errText(err)}`);
      return undefined;
    }
  }

  /** Shallow copy: callers get the tail without a handle on recorder state. */
  snapshotEvents(): DebugEventV2[] {
    return this.#events.slice();
  }

  /** Debounced, fire-and-forget durability nudge. Never awaited, never throws. */
  flushHint(): void {
    try {
      if (!this.#store || this.#flushTimer) return;
      const timer = setTimeout(() => {
        this.#flushTimer = null;
        void this.#store?.flush().catch(() => {});
      }, FLUSH_DEBOUNCE_MS);
      // A pending hint must not keep the process alive at shutdown.
      timer.unref?.();
      this.#flushTimer = timer;
    } catch {
      this.#flushTimer = null;
    }
  }

  /** Envelope first, then per-event meta: a call site can always override the
   *  run-wide envelope (a parent run recording one child's tool call). */
  #stamp(event: DebugEventV2 | DebugEventRecord, meta: Partial<DebugEventV2> | undefined): void {
    const target = event as unknown as Record<string, unknown>;
    const envelope = this.#envelope;
    if (envelope) {
      for (const k of ENVELOPE_KEYS) {
        const v = envelope[k];
        if (v !== undefined) target[k] = v;
      }
    }
    if (meta) {
      for (const k of META_KEYS) {
        const v = meta[k];
        if (v !== undefined) target[k] = v;
      }
    }
  }

  #shouldPersist(kind: string): boolean {
    return this.#captureLevel !== "off" || OFF_LEVEL_PERSISTED_KINDS.has(kind);
  }

  #retain(event: DebugEventV2): void {
    this.#events.push(event);
    if (this.#events.length > MAX_RETAINED_EVENTS) {
      this.#events = this.#events.slice(this.#events.length - MAX_RETAINED_EVENTS);
    }
  }

  /**
   * Apply the registry policy field by field. A `ref` field that spills becomes
   * a sibling `<field>Ref` and the original is not carried, so a reader never
   * has to guess whether it is holding content or a pointer.
   */
  #applyPolicy(spec: EventSpec, data: Record<string, unknown> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!data) return out;
    for (const [field, value] of Object.entries(data)) {
      // An absent field is absent; `"x": null` reads as "we measured null".
      if (value === undefined || value === null) continue;
      const policy = policyFor(spec, field);
      if (policy.t === "drop") continue;
      if (policy.t === "plain" || policy.t === "range") {
        out[field] = value;
        continue;
      }
      const held = this.#blobs.maybeIntern(value, policy.inlineUnder);
      if ("inline" in held) out[field] = held.inline;
      else if ("ref" in held) out[`${field}Ref`] = held.ref;
      // `omitted` (capture level off / metadata drop): neither field is written.
    }
    return out;
  }
}
