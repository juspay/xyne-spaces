/**
 * Debug trace types — the contract every other module in `debug/` builds against.
 *
 * Two formats live here on purpose:
 *
 * - **v2** (`RunHeader` + `DebugEventV2` + blob refs) is the WRITE path: an
 *   append-only trio of files per run. Payloads over a threshold are interned
 *   into a content-addressed blob log and referenced by hash, so the same 20 KB
 *   system prompt costs 20 KB once per run instead of once per turn.
 * - **v1** (`DebugSessionSnapshot`) is the READ path, produced on demand by
 *   `materialize.ts`. It is byte-compatible with what the debugger UI has always
 *   consumed, so the write-path rewrite is invisible to every existing reader.
 *
 * The v1 interfaces moved here verbatim from agent.ts. Do not "clean them up" —
 * DebugDrawer, the dashboard trace panel, the debug HTML exporter and the
 * webhook `/debug` command all read these field names.
 */

import type { Citation } from "xyne-claw-shared";

// ── Shared value types (moved verbatim from agent.ts) ───────────────────────

export type ModelSpeed = "standard" | "fast";

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ToolInvocation {
  toolName: string;
  args: unknown;
  result: string;
  isError: boolean;
  startedAt: string;
  durationMs: number;
  status?: "running" | "completed";
  parentToolCallId?: string;
  subagentName?: string;
  toolCallId?: string;
  citations?: Citation[];
  debug?: Record<string, unknown>;
  background?: boolean;
  backgroundState?: "running" | "completed" | "error";
  backgroundTaskId?: string;
}

export interface LatencyMetrics {
  totalMs: number;
  llmDecodeMs: number;
  llmWaitMs: number;
  llmTotalMs: number;
  llmTurns: number;
  llmRetries: number;
  lastRetryReason?: string;
  firstTurnTtftMs?: number;
  tokensPerSec?: number;
  streamCharsPerSec?: number;
  streamChars?: number;
  streamThinkingChars?: number;
  streamTextChars?: number;
  toolMs: number;
}

export interface StreamRateSample {
  offsetMs: number;
  streamsPerSec: number;
  streamsCollected: number;
}

export interface DebugThinkingConfiguration {
  /** Value selected by agent model settings / provider config / default policy. */
  requestedLevel: string;
  /** Pi's final value after capability clamping for the resolved model. */
  effectiveLevel: string;
  /** Where the requested setting came from, so precedence is inspectable. */
  source:
    | "agent_model_settings"
    | "provider_credential"
    | "codex_default"
    | "server_default"
    | "temperature_override";
  /** Whether the resolved Pi model was registered as reasoning-capable. */
  modelSupportsReasoning: boolean;
  /** The provider request shape that disables/enables thinking for this model. */
  wireMode: string;
}

/** Provider fast mode (modelSettings.speed) as it was resolved for this run. */
export interface DebugSpeedConfiguration {
  requested: ModelSpeed;
  applied: boolean;
  reason: string;
}

// ── Capture policy ──────────────────────────────────────────────────────────

/**
 * How much of a run is persisted.
 *
 * - `full`     — everything, payloads included (dev default).
 * - `metadata` — every event, every measurement, every blob *hash and size*,
 *                but no blob content. The timeline renders; the payloads don't.
 * - `off`      — header plus session_start/session_end only.
 *
 * Mirrors the OpenTelemetry GenAI stance that prompt/tool content capture is a
 * separate, switchable layer rather than something baked into the span.
 */
export type CaptureLevel = "off" | "metadata" | "full";

export function isCaptureLevel(v: unknown): v is CaptureLevel {
  return v === "off" || v === "metadata" || v === "full";
}

// ── v2 write format ─────────────────────────────────────────────────────────

/**
 * A pointer into `blobs.jsonl`.
 *
 * Refs live in a SIBLING field (`<field>Ref`), never in the field itself, so a
 * reader never has to guess whether a string is content or a pointer.
 */
export interface BlobRef {
  /** sha256 of the serialized content, first 16 hex chars. */
  hash: string;
  /** Stored bytes (post-truncation). */
  bytes: number;
  /** Present only when the value exceeded the blob cap. */
  originalBytes?: number;
  /** Present only when truncated — never truncate silently. */
  truncated?: true;
  /** First ~200 chars, so a collapsed UI row renders without a fetch. */
  preview?: string;
}

export function isBlobRef(v: unknown): v is BlobRef {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { hash?: unknown }).hash === "string" &&
    typeof (v as { bytes?: unknown }).bytes === "number"
  );
}

export interface DebugEventV2 {
  seq: number;
  at: string;
  kind: string;
  turn?: number;
  llmCall?: number;
  toolCallId?: string;
  parentToolCallId?: string;
  subagentName?: string;
  /** Correlates a subagent/child run back to the tool call that spawned it. */
  childRunId?: string;
  data: Record<string, unknown>;
}

export type RunStatus = "running" | "completed" | "cancelled" | "error" | "crashed";

export interface RunCounts {
  events: number;
  blobs: number;
  messages: number;
  toolCalls: number;
}

/**
 * `session.json` — written twice: once at run start with `status: "running"`
 * (this is the guaranteed artifact that makes "no debug file" impossible for a
 * run that started), once at finish with the real status and metrics.
 */
export interface RunHeader {
  schemaVersion: 2;
  /** `${startedAtMs}-${safeSessionId}` — also the run directory name. */
  runId: string;
  /** The SESSION KEY this run ran under. Confusingly this is what `runTask`
   *  receives as `conversationId`; it already encodes the agent slug and, for
   *  branches/twins, more besides. */
  conversationId?: string;
  /** The RAW Spaces conversation id — what a debugger caller actually asks for.
   *  Kept separate because discovery is keyed on it and the two differ for every
   *  real run (`conv9` vs `conv9_ask-ai`). */
  rawConversationId?: string;
  /** The session-dir / GCS path segment this run was written under. */
  storeKey: string;
  sessionId?: string;
  agentSlug?: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  provider?: string;
  model?: string;
  thinking?: DebugThinkingConfiguration;
  speed?: DebugSpeedConfiguration;
  captureLevel: CaptureLevel;
  startedAt: string;
  /** Equals `startedAt` while the run is in flight. */
  finishedAt: string;
  status: RunStatus;
  task: string;
  context?: string;
  systemPromptOverride?: boolean;
  mode?: string;
  /** Set on subagent / delegated child runs. */
  parentRunId?: string;
  parentToolCallId?: string;
  subagentName?: string;
  /** Child-run question, for subagent traces. */
  question?: string;
  counts: RunCounts;
  tokenUsage: TokenUsage;
  latency: LatencyMetrics;
  lastAssistantTextRef?: BlobRef;
}

export function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function emptyLatency(): LatencyMetrics {
  return {
    totalMs: 0,
    llmDecodeMs: 0,
    llmWaitMs: 0,
    llmTotalMs: 0,
    llmTurns: 0,
    llmRetries: 0,
    toolMs: 0,
  };
}

// ── v1 read format (unchanged contract for every existing consumer) ─────────

export interface DebugEventRecord {
  seq: number;
  at: string;
  kind: string;
  turn?: number;
  llmCall?: number;
  toolCallId?: string;
  parentToolCallId?: string;
  subagentName?: string;
  childRunId?: string;
  data: Record<string, unknown>;
}

export interface DebugSessionSnapshot {
  schemaVersion: 1;
  conversationId?: string;
  sessionId?: string;
  agentSlug?: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  provider?: string;
  /** The model resolved for this particular run (not merely the agent default). */
  model?: string;
  /** Requested/effective thinking selection and its provider wire representation. */
  thinking?: DebugThinkingConfiguration;
  /** Requested/applied provider fast mode and the eligibility verdict. */
  speed?: DebugSpeedConfiguration;
  startedAt: string;
  finishedAt: string;
  task: string;
  context?: string;
  systemPromptOverride?: boolean;
  /** Run ended without a clean completion (stop, error, or a crashed pod). */
  cancelled?: boolean;
  /** Run is still in flight; the trace is a partial view. */
  inProgress?: boolean;
  messages: unknown[];
  toolInvocations: ToolInvocation[];
  tokenUsage: TokenUsage;
  latency: LatencyMetrics;
  lastAssistantText: string;
  events: DebugEventRecord[];
  /** Additive: non-fatal problems hit while reading this run (dropped torn
   *  line, unreadable blob log, GCS miss). Surfaced in the UI so a partial
   *  trace never masquerades as a complete one. */
  warnings?: string[];
}
