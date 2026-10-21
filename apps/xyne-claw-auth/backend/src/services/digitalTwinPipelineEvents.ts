/**
 * Persistence + derivation helpers for Digital Twin pipeline observability.
 *
 * Every curator invocation (backfill window, daily source, upload,
 * twin-approval) records ONE DigitalTwinPipelineEvent so the pipeline viewer
 * can show the LLM exchange, the fed records, and per-run counts without
 * re-running anything. All writes are best-effort: a failed insert must never
 * break the pipeline it is observing.
 */

import type { ClassifierExchange, MemoryUpdateCheck, SynthesizeFileTrace, UserMemoryCuratorTrace } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { errMsg } from "../lib/errors.js";
import { createLogger, createTraceId } from "../logger.js";

const logger = createLogger("digital-twin-pipeline-events", createTraceId());

/** Rolling retention window for the event feed. */
const DEFAULT_PRUNE_DAYS = 30;

const RUN_TYPES = ["backfill", "daily", "upload", "twin-approval", "synthesize", "gate", "retry"] as const;
const SOURCE_KINDS = ["messages", "calls", "canvases"] as const;
type PipelineEventRunType = (typeof RUN_TYPES)[number];
type PipelineEventSourceKind = (typeof SOURCE_KINDS)[number];
/** `running`/`retry` are IN-FLIGHT states (a curator batch mid-LLM-call) so the
 *  pipeline feed isn't silent for 15 min; terminal states are ok/empty/error. */
export type PipelineEventStatus = "ok" | "empty" | "error" | "running" | "retry";

/** Stored in DigitalTwinPipelineEvent.trace WHILE a curator batch is in flight
 *  (parallel to SynthTrace) so the UI can show "running / retrying attempt N/M"
 *  during the long distill call, surviving a reload. Replaced by the real
 *  UserMemoryCuratorTrace once the batch finishes. */
interface CuratorBatchTrace {
  kind: "curate";
  running?: boolean;
  attempt?: number;
  maxAttempts?: number;
  lastError?: string | null;
}

/** Per-file outcome of one soul-synthesis run (Memory v2, Phase 4). */
export interface SynthFileResult extends Partial<SynthesizeFileTrace> {
  name: string;
  factsUsed: number;
  /** "held" = the rewrite was generated but the update check kept the old file. */
  action: "updated" | "skipped" | "error" | "held";
  chars?: number;
  /** Classifier verdict on the rewrite (nightly runs, R10). */
  check?: MemoryUpdateCheck;
  error?: string;
}

/** Stored in DigitalTwinPipelineEvent.trace for runType="synthesize" runs, so
 *  the activity panel can render synthesis progress (and it survives a reload). */
interface SynthTrace {
  kind: "synthesize";
  trigger: "daily" | "manual";
  running?: boolean;
  files: SynthFileResult[];
}

/** Preview of one fed record. `textPreview` is the first 300 chars. */
export interface PipelineRecordPreview {
  id: string;
  type: string;
  ts: string;
  channelId?: string;
  channelName?: string;
  title?: string;
  textPreview: string;
}

interface RecordPipelineEventInput {
  userId: string;
  source: string;
  window: { from: Date; to: Date };
  status: PipelineEventStatus;
  recordCount: number;
  records?: PipelineRecordPreview[] | null;
  existingMemoryCount?: number;
  emittedCount?: number;
  keptCount?: number;
  candidatesCreated?: number;
  autoApproved?: number;
  durationMs?: number;
  error?: string | null;
  trace?: UserMemoryCuratorTrace | null;
}

/**
 * Derive the run type from the source-string prefix. Falls back to "daily" for
 * anything unrecognized so a malformed source never trips the not-null column.
 */
function deriveRunType(source: string): PipelineEventRunType {
  return RUN_TYPES.find((t) => source.startsWith(`${t}:`)) ?? "daily";
}

/**
 * Derive the source kind (messages|calls|canvases) from the source string.
 *
 * The backfill jobId itself contains colons (dt-backfill:<userId>:<source>), so
 * the backfill source is
 *   backfill:dt-backfill:<userId>:<source>:<YYYY-MM>
 * → the kind is the second-to-last segment. Daily is
 *   daily:<date>:<source>
 * → the kind is the third segment. Upload / twin-approval have no kind.
 */
function deriveSourceKind(source: string): PipelineEventSourceKind | null {
  const parts = source.split(":");
  if (source.startsWith("backfill:")) {
    return asSourceKind(parts[parts.length - 2]);
  }
  // daily:<YYYY-MM-DD>:<kind> and retry:<YYYY-MM-DD>:<kind> share a shape.
  if (source.startsWith("daily:") || source.startsWith("retry:")) {
    return asSourceKind(parts[2]);
  }
  return null;
}

function asSourceKind(seg: string | undefined): PipelineEventSourceKind | null {
  return SOURCE_KINDS.find((k) => k === seg) ?? null;
}


/**
 * Best-effort write: any failure is logged as `[digital-twin-pipeline-events] <msg>`
 * (with `ctx` + the error) and swallowed, returning `fallback`, so the caller's
 * return value and control flow are unaffected — a failed insert must never
 * break the pipeline it is observing.
 */
async function bestEffort<T>(msg: string, ctx: Record<string, unknown>, fallback: T, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    logger.warn(`[digital-twin-pipeline-events] ${msg}`, { ...ctx, err: errMsg(err) });
    return fallback;
  }
}

// `trace` / `records` are typed interfaces, not Prisma.InputJsonValue, so the
// delegate is called through `any` (call form kept so `this` stays bound).
async function insertEvent(data: Record<string, unknown>): Promise<string | null> {
  const created = await (prisma.digitalTwinPipelineEvent.create as any)({ data, select: { id: true } });
  return (created?.id as string | undefined) ?? null;
}

async function updateEvent(id: string, data: Record<string, unknown>): Promise<void> {
  await (prisma.digitalTwinPipelineEvent.update as any)({ where: { id }, data });
}

/** Row identity derived from the source string: who, which run type/kind, which window. */
function sourceColumns({ userId, source, window }: Pick<RecordPipelineEventInput, "userId" | "source" | "window">) {
  return {
    userId,
    runType: deriveRunType(source),
    source,
    sourceKind: deriveSourceKind(source),
    windowFrom: window.from,
    windowTo: window.to,
  };
}

/** Terminal columns (status, counts, preview, trace): the body of both the
 *  direct insert and the finish-an-in-flight-row update. */
function outcomeColumns(input: RecordPipelineEventInput) {
  return {
    status: input.status,
    recordCount: input.recordCount,
    records: input.records ?? undefined,
    existingMemoryCount: input.existingMemoryCount ?? 0,
    emittedCount: input.emittedCount ?? 0,
    keptCount: input.keptCount ?? 0,
    candidatesCreated: input.candidatesCreated ?? 0,
    autoApproved: input.autoApproved ?? 0,
    durationMs: input.durationMs ?? 0,
    error: input.error ?? null,
    trace: input.trace ?? undefined,
  };
}

/**
 * Insert one pipeline event. Returns the created event id (so callers can stamp
 * it onto the candidates the run emitted), or null when the insert failed /
 * was swallowed.
 */
export async function recordPipelineEvent(input: RecordPipelineEventInput): Promise<string | null> {
  return bestEffort("recordPipelineEvent failed", { userId: input.userId, source: input.source }, null, () =>
    insertEvent({ ...sourceColumns(input), ...outcomeColumns(input) }),
  );
}

/**
 * Record the START of a soul-synthesis run as a pipeline event (status
 * "running") so the activity panel shows it immediately and it survives a
 * reload. Returns the event id; call finishSynthesisEvent when done.
 */
export async function startSynthesisEvent(
  userId: string,
  trigger: "daily" | "manual",
): Promise<string | null> {
  return bestEffort("startSynthesisEvent failed", { userId }, null, () => {
    const now = new Date();
    return insertEvent({
      userId,
      runType: "synthesize",
      source: `synthesize:${trigger}`,
      sourceKind: null,
      windowFrom: now,
      windowTo: now,
      status: "running",
      recordCount: 0,
      trace: { kind: "synthesize", trigger, running: true, files: [] } satisfies SynthTrace,
    });
  });
}

/** Finalize a synthesis event created by startSynthesisEvent. */
export async function finishSynthesisEvent(
  id: string,
  trigger: "daily" | "manual",
  result: { files: SynthFileResult[]; durationMs: number; error?: string | null },
): Promise<void> {
  await bestEffort("finishSynthesisEvent failed", { id }, undefined, () => {
    const updated = result.files.filter((f) => f.action === "updated");
    const errored = result.files.filter((f) => f.action === "error");
    const factsTotal = result.files.reduce((s, f) => s + f.factsUsed, 0);
    const synthesisError = result.error ?? (errored.length > 0
      ? `${errored.length} persona file${errored.length === 1 ? "" : "s"} failed to compile`
      : null);
    return updateEvent(id, {
      status: synthesisError ? "error" : updated.length > 0 ? "ok" : "empty",
      recordCount: factsTotal,
      emittedCount: result.files.length,
      keptCount: updated.length,
      candidatesCreated: updated.length,
      durationMs: result.durationMs,
      error: synthesisError,
      trace: { kind: "synthesize", trigger, files: result.files } satisfies SynthTrace,
    });
  });
}

/**
 * Record the START of a curator batch as a "running" pipeline event BEFORE the
 * (slow) distill LLM call, so the pipeline feed shows it immediately instead of
 * going silent for minutes. Returns the event id — use it to stamp candidates
 * AND to finish the same row (no double-write). Mirrors startSynthesisEvent.
 */
export async function startCuratorBatchEvent(input: {
  userId: string;
  source: string;
  window: { from: Date; to: Date };
  recordCount: number;
  records?: PipelineRecordPreview[] | null;
  maxAttempts: number;
}): Promise<string | null> {
  return bestEffort("startCuratorBatchEvent failed", { userId: input.userId, source: input.source }, null, () =>
    insertEvent({
      ...sourceColumns(input),
      status: "running",
      recordCount: input.recordCount,
      records: input.records ?? undefined,
      trace: { kind: "curate", running: true, attempt: 1, maxAttempts: input.maxAttempts } satisfies CuratorBatchTrace,
    }),
  );
}

/** Update the in-flight attempt state of a running curator batch (per distill
 *  retry). No-op when id is null. */
export async function updateCuratorBatchAttempt(
  id: string | null,
  attempt: number,
  maxAttempts: number,
  lastError?: string | null,
): Promise<void> {
  if (!id) return;
  await bestEffort("updateCuratorBatchAttempt failed", { id }, undefined, () =>
    updateEvent(id, {
      status: attempt > 1 ? "retry" : "running",
      trace: { kind: "curate", running: true, attempt, maxAttempts, lastError: lastError ?? null } satisfies CuratorBatchTrace,
    }),
  );
}

/**
 * Finalize the curator-batch event started by startCuratorBatchEvent — UPDATE
 * the same row with terminal status + counts + the real curator trace. Falls
 * back to a fresh insert (recordPipelineEvent) when the start row is missing, so
 * the feed never loses a terminal event. Returns the effective event id.
 */
export async function finishCuratorBatchEvent(
  id: string | null,
  input: RecordPipelineEventInput,
): Promise<string | null> {
  if (!id) return recordPipelineEvent(input);
  const done = await bestEffort("finishCuratorBatchEvent failed — creating fresh", { id }, null, async () => {
    await updateEvent(id, outcomeColumns(input));
    return id;
  });
  return done ?? recordPipelineEvent(input);
}

/** Stored on a runType="gate" event: one respond/ignore decision + (for LLM
 *  decisions) the full exchange, so the pipeline UI can show input message,
 *  system prompt, user prompt, response, and thinking. */
interface GateTrace {
  kind: "gate";
  respond: boolean;
  confidence: number;
  reason: string;
  /** rule-dm / rule-thread / insufficient-data / no-patterns / llm / fail-open */
  decisionSource: string;
  incoming: string;
  channelName?: string;
  channelType?: string;
  senderName?: string;
  // Present only for LLM decisions (the rails have no exchange):
  systemPrompt?: string;
  userPrompt?: string;
  response?: string;
  thinking?: string;
  model?: string;
  /** Set when the gate FAILED (timeout / HTTP error / bad response) and
   *  fail-opened. Recorded with status="error" so failures are visible in the
   *  pipeline UI instead of being silently dropped. */
  error?: string;
  /** Every classifier (Jev) call the gate made, in full — present whether Jev
   *  decided or handed off to the LLM. */
  classifier?: ClassifierExchange[];
}

/**
 * Record ONE respond/ignore gate decision as a pipeline event (runType="gate")
 * so it shows in the activity feed alongside curator runs, filterable on its own.
 * status = "ok" when the twin replied, "empty" when it stayed silent (reuses the
 * feed's status chip).
 */
export async function recordGateEvent(input: {
  userId: string;
  incoming: string;
  channelName?: string;
  senderName?: string;
  sourceMessageId?: string;
  decision: { respond: boolean; confidence: number; reason: string; source: string };
  llm?: { systemPrompt: string; userPrompt: string; response: string; thinking?: string; model: string } | null;
  classifier?: ClassifierExchange[] | null;
  /** Set when the gate failed (timeout / HTTP error / bad response). Records the
   *  event with status="error" so it's visible + filterable in the pipeline UI. */
  error?: string;
  durationMs: number;
}): Promise<string | null> {
  return bestEffort("recordGateEvent failed", { userId: input.userId }, null, () => {
    const now = new Date();
    const trace: GateTrace = {
      kind: "gate",
      respond: input.decision.respond,
      confidence: input.decision.confidence,
      reason: input.decision.reason,
      decisionSource: input.decision.source,
      incoming: input.incoming.slice(0, 2000),
      ...(input.channelName ? { channelName: input.channelName } : {}),
      ...(input.senderName ? { senderName: input.senderName } : {}),
      ...(input.error ? { error: input.error } : {}),
      ...(input.classifier?.length ? { classifier: input.classifier } : {}),
      ...(input.llm
        ? {
            systemPrompt: input.llm.systemPrompt,
            userPrompt: input.llm.userPrompt,
            response: input.llm.response,
            ...(input.llm.thinking ? { thinking: input.llm.thinking } : {}),
            model: input.llm.model,
          }
        : {}),
    };
    return insertEvent({
      userId: input.userId,
      runType: "gate",
      source: `gate:${input.sourceMessageId ?? now.getTime()}`,
      sourceKind: null,
      windowFrom: now,
      windowTo: now,
      status: input.error ? "error" : input.decision.respond ? "ok" : "empty",
      recordCount: 1,
      records: [
        {
          id: input.sourceMessageId ?? "incoming",
          type: "mention",
          ts: now.toISOString(),
          ...(input.channelName ? { channelName: input.channelName } : {}),
          textPreview: input.incoming.slice(0, 300),
        },
      ],
      durationMs: input.durationMs,
      trace,
    });
  });
}

/** Delete pipeline events older than `days`. Returns the deleted count. */
export async function prunePipelineEvents(days = DEFAULT_PRUNE_DAYS): Promise<number> {
  return bestEffort("prunePipelineEvents failed", { days }, 0, async () => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return (await prisma.digitalTwinPipelineEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
  });
}
