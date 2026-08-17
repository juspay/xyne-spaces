/**
 * Platform-agnostic Ask AI stream core — TYPES.
 *
 * This is the shared contract for the "Ask AI" (Xyne AI / Claw-agent) streaming
 * chat. It is deliberately transport- and platform-free so it can be consumed
 * by BOTH the dashboard (web: Web Worker + fetch + cookies + IndexedDB) and the
 * native mobile app (RN: native mTLS stream + Bearer + MMKV/SQLite).
 *
 * Nothing in this module touches `fetch`, `window`, `self`, IndexedDB, or React.
 * Keep it that way — the transport and persistence live behind the
 * {@link StreamTransport} / {@link StreamStore} interfaces defined below and are
 * implemented per platform.
 *
 * The camelCase request shape here is the single source of truth for the wire
 * body; {@link buildAskAIRequestBody} maps it to the snake_case payload the
 * backend (`POST /api/xyne-ai`) expects.
 */

// ============================================================================
// Request input (camelCase) — the platform-agnostic Ask AI request
// ============================================================================

/** A single attached-context item the composer can pin to a request. */
export interface AskAIAttachedContextItem {
  type: "channel" | "ticket" | "canvas" | "call" | "activity";
  id: string;
  title: string;
  threadId?: string;
  eventName?: string;
  eventCategory?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  relatedData?: Record<string, unknown>;
}

/** A binary attachment uploaded inline with the request (base64 data). */
export interface AskAIAttachmentInput {
  data: string;
  mimeType: string;
  filename: string;
}

/** Research-agent context selection (product/repository). */
export interface AskAIResearchContextInput {
  type: string;
  id?: string;
  name: string;
}

/**
 * Platform-agnostic Ask AI request. Mirrors, field-for-field, the payload the
 * dashboard Web Worker used to build inline. Serialize it with
 * {@link buildAskAIRequestBody} before sending.
 */
export interface AskAIRequestInput {
  query: string;
  displayQuery?: string;
  channelIds: string[];
  collectionIds?: string[];
  fileIds?: string[];
  canvasIds?: string[];
  ticketIds?: string[];
  callIds?: string[];
  attachedContext?: AskAIAttachedContextItem[];
  conversationId: string;
  sessionId: string;
  webSearchEnabled: boolean;
  deepResearchEnabled?: boolean;
  createCanvasEnabled?: boolean;
  /**
   * Single search + single answer pass instead of the full agentic tool loop —
   * see xyne-claw-auth's run-stream.ts POST / instant branch.
   */
  instant?: boolean;
  researchContext?: AskAIResearchContextInput | null;
  canvasId?: string;
  messageAttachmentIds?: string[];
  attachments?: AskAIAttachmentInput[];
  parentMessageId?: string;
  isRegenerate?: boolean;
  /**
   * Branching: edit-user signals that the new user message is a sibling of
   * `editedUserMessageId` under `parentAssistantMessageId` (the assistant parent
   * the original lived under). claw-auth uses these to clone the PI session
   * BEFORE the original user msg so the LLM session doesn't include the old turn.
   */
  isEditUserMessage?: boolean;
  editedUserMessageId?: string;
  parentAssistantMessageId?: string;
  draftMode?: boolean;
  version?: "v1" | "v2";
  disableTools?: boolean;
  agentSlug?: string;
  /** Per-run model pin from the composer's model picker. */
  model?: string;
}

// ============================================================================
// SSE stream events (the live answer stream)
// ============================================================================

/**
 * The discriminated `type` values the Ask AI SSE stream emits on the main
 * (answer) channel. `ping` frames are heartbeats and are dropped by the parser.
 */
export type AskAIStreamEventType =
  | "start"
  | "delta"
  | "content"
  | "tool_input"
  | "tool_output"
  | "reasoning_delta"
  | "tool_invocation"
  | "debug_event"
  | "debug_artifacts_ready"
  | "complete"
  | "done"
  | "error"
  | "agent_update"
  | "genius_start"
  | "ping";

/**
 * A single decoded SSE frame. The payload is intentionally open (`unknown` per
 * key): the backend adds fields over time and the platform reducers read them
 * defensively. The named payload interfaces below document the important shapes;
 * they are NOT enforced on the raw event so new fields never break parsing.
 */
export interface AskAIStreamEvent {
  // Widened with `(string & {})` so unknown/future event types still type-check
  // while keeping editor autocomplete for the known ones.
  // eslint-disable-next-line @typescript-eslint/ban-types
  type: AskAIStreamEventType | (string & {});
  [key: string]: unknown;
}

/**
 * Tool-invocation payload carried on `tool_invocation` events (under the
 * `toolInvocation` key). Documents the shape the reducers dedupe by
 * `toolCallId`. Kept here so mobile can reuse it without re-deriving it.
 */
export interface AskAIToolInvocationPayload {
  toolName: string;
  toolCallId?: string;
  args: Record<string, unknown>;
  result?: string;
  status: "running" | "completed" | "error";
  durationMs: number;
  isError?: boolean;
  subagentName?: string;
  parentToolCallId?: string;
  citations?: Array<{
    label?: string;
    kind: "thread" | "canvas" | "ticket" | "external";
    channelId?: string;
    conversationId?: string;
    channelName?: string;
    channelType?: string;
    canvasId?: string;
    ticketId?: string;
    url?: string;
  }>;
  /** Background (run_in_background) subagent lifecycle. */
  background?: boolean;
  backgroundState?: "running" | "completed" | "error";
  backgroundTaskId?: string;
}

// ============================================================================
// Live re-attach events (resuming an answer that kept running while away)
// ============================================================================

/**
 * The `type` values emitted by the `/v2/.../live` re-attach channel, used to
 * rebuild an in-flight answer after the client reconnects (e.g. the mobile app
 * returns from background). Distinct vocabulary from the main SSE stream.
 */
export type AskAILiveEventType =
  | "snapshot"
  | "delta"
  | "reasoning"
  | "invocation"
  | "label"
  | "done"
  | "live-disabled";

/** A single decoded live re-attach frame. Same open-payload rule as SSE. */
export interface AskAILiveEvent {
  // eslint-disable-next-line @typescript-eslint/ban-types
  type: AskAILiveEventType | (string & {});
  [key: string]: unknown;
}

// ============================================================================
// Transport seam (per-platform: web worker+fetch+cookies vs native mTLS+Bearer)
// ============================================================================

/** Callbacks a {@link StreamTransport} invokes as an answer streams in. */
export interface AskAIStreamHandlers {
  /** One decoded, non-ping SSE event. */
  onChunk: (event: AskAIStreamEvent) => void;
  /** The stream closed successfully. */
  onComplete: () => void;
  /** The stream failed; `error` is a human-readable message. */
  onError: (error: string) => void;
}

/** Parameters to open a stream. */
export interface AskAIStreamStartParams {
  streamId: string;
  url: string;
  input: AskAIRequestInput;
}

/**
 * The platform-specific streaming transport. The dashboard implements this with
 * a Web Worker (`fetch` + `ReadableStream` + cookies); mobile will implement it
 * with the native mTLS stream module (Bearer auth). The shared core never calls
 * `fetch` directly — it only speaks this interface.
 */
export interface StreamTransport {
  start(params: AskAIStreamStartParams, handlers: AskAIStreamHandlers): void;
  abort(streamId: string): void;
}

// ============================================================================
// Persistence seam (per-platform: IndexedDB vs MMKV/SQLite)
// ============================================================================

/**
 * Abstract persistence for in-flight/finished streams so an answer survives
 * navigation, reload, or app backgrounding. The dashboard implements this over
 * IndexedDB; mobile will implement it over MMKV / expo-sqlite. Records and
 * chunks are left generic so each platform keeps its own concrete shapes.
 */
export interface StreamStore<TRecord = unknown, TChunk = unknown> {
  save(record: TRecord): Promise<void> | void;
  appendChunk(streamId: string, chunk: TChunk): Promise<void> | void;
  updateStatus(streamId: string, status: string): Promise<void> | void;
  get(streamId: string): Promise<TRecord | null> | TRecord | null;
  remove(streamId: string): Promise<void> | void;
  list(): Promise<TRecord[]> | TRecord[];
}
