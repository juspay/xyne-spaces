import type { ToolOutput as GeniusToolOutput } from '../../../../types/toolOutput';

// ============================================================================
// Input context snapshot
// ============================================================================

export interface SelectedChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface SelectedCanvas {
  id: string;
  title: string;
}

export interface SelectedTicket {
  id: string;
  name: string;
  title?: string;
}

export interface SelectedTranscript {
  id: string;
  title: string;
}

export interface SelectedRecording {
  id: string;
  title: string;
}

export interface SelectionContextInput {
  canvasId: string;
  selectedText: string;
  preview?: string;
  canvasTitle?: string;
}

export interface ResearchContext {
  type: 'product' | 'repository';
  id: string;
  name: string;
}

export interface LastInputContext {
  selectedChannels: SelectedChannel[];
  threadConversationId?: string;
  selectedCanvases?: SelectedCanvas[];
  selectedTickets?: SelectedTicket[];
  selectedTranscripts?: SelectedTranscript[];
  selectedRecordings?: SelectedRecording[];
  canvasId?: string;
  selectionContexts?: SelectionContextInput[];
  webSearchEnabled: boolean;
  deepResearchEnabled: boolean;
  createCanvasEnabled: boolean;
  researchContext?: ResearchContext | null;
}

// ============================================================================
// Stored / persisted types (backend PostgreSQL)
// ============================================================================

export interface StoredMessage {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  streamingContent?: string;
  parsedContent?: {
    summary: string;
    keypoints: string[];
    citations: Record<number, number>;
    isComplete: boolean;
  };
  messageIdMapping?: Record<string, string>;
  conversationIdMapping?: Record<string, string>;
  channelIdMapping?: Record<string, string>;
  toolOutputs?: GeniusToolOutput[];
  feedback?: 0 | 1 | 2; // 0 = no feedback, 1 = like, 2 = dislike
  attachments?: MessageAttachment[];
  parentId?: string | null; // Parent message ID for tree branching

  // ============================================================================
  // v2 Types (xyne-claw integration)
  // ============================================================================

  /**
   * Reasoning/thinking content from the agent (v2)
   */
  reasoning?: string;

  /**
   * Tool invocations made during the response (v2)
   */
  toolInvocations?: ToolInvocation[];

  /**
   * Pending actions requiring human approval (v2)
   */
  pendingActions?: PendingAction[];
}

/**
 * Citation from xyne-claw tools
 */
export interface ClawCitation {
  label?: string;
  kind: 'thread' | 'canvas' | 'ticket' | 'external' | 'collection-item';
  channelId?: string;
  conversationId?: string;
  messageId?: string;
  channelName?: string;
  channelType?: string;
  channelKind?: string;
  canvasId?: string;
  ticketId?: string;
  xyneId?: string;
  mailId?: string;
  url?: string;
  /** For kind="external": source app (Gmail / Google Calendar / Google Drive). */
  app?: 'gmail' | 'gcal' | 'gdrive';
  /** Stable brand-icon key (e.g. "spaces", "gmail"), stamped by claw. The
   *  `/messages` payload ships the SVG bytes ONCE per unique key in a top-level
   *  `icons` map; the chip resolves `iconKey` → bytes via `resolveCitationIconUrl`
   *  (see clawCitationUrl). Adding a new source stays a claw-only change. */
  iconKey?: string;
  /** Inline `data:image/svg+xml,…` brand-icon URI. Still present on legacy rows
   *  and the live streaming path; `/messages` now sends `iconKey` + the shared
   *  `icons` map instead. `resolveCitationIconUrl` prefers this when set, then
   *  falls back to the keyed registry. */
  iconUrl?: string;
  // For kind="collection-item" (KB tools: kb-search / kb-read-file /
  // kb-get-chunks / kb-search-within-doc). The backend (kb-handlers.ts)
  // populates `url` with a deep-link to the v2 file viewer; the other
  // fields are display metadata.
  collectionItemId?: string;
  collectionId?: string;
  fileName?: string;
  /**
   * 1-based index of the chunk in the tool's result text this citation
   * corresponds to. Used to resolve inline `[clf-<toolCallId>#<N>]` tokens
   * back to the (channelId, conversationId, canvasId, ...) tuple they
   * point at via `citations.find(c => c.chunkIndex === N)`. Optional —
   * older agent versions don't emit per-chunk citations.
   */
  chunkIndex?: number;
}

/**
 * Tool invocation from v2 streaming (xyne-claw)
 */
export interface ToolInvocation {
  toolName: string;
  toolCallId?: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  durationMs: number;
  isError?: boolean;
  subagentName?: string;
  parentToolCallId?: string;
  citations?: ClawCitation[];
  /** Background (run_in_background) subagent lifecycle. `background` marks a
   *  wrapper invocation whose subagent runs DETACHED; the spawning tool call
   *  returns immediately (so `status` becomes 'completed' right away), and the
   *  real progress is tracked by `backgroundState`. Rendered as a non-blocking
   *  chip and excluded from the "currently running tool" header. */
  background?: boolean;
  backgroundState?: 'running' | 'completed' | 'error';
  backgroundTaskId?: string;
}

/**
 * Pending action for human-in-the-loop approval (v2)
 */
export type PendingActionResolution = 'approved' | 'declined';

export interface PendingAction {
  id: string;
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  signature: string;
  resolution?: PendingActionResolution;
}

/**
 * v2 Stream Event Types from backend SSE
 */
export type StreamEventType =
  | 'start'
  | 'delta'
  | 'tool_invocation'
  | 'reasoning_delta'
  | 'debug_event'
  | 'debug_artifacts_ready'
  | 'attachment'
  | 'complete'
  | 'error'
  | 'end'
  | 'ping';

export interface DebugEventRecord {
  seq: number;
  at: string;
  kind: string;
  turn?: number;
  llmCall?: number;
  toolCallId?: string;
  parentToolCallId?: string;
  subagentName?: string;
  data: Record<string, unknown>;
}

export interface DebugArtifactBundle {
  conversationId: string;
  debugDir?: string;
  debugSession: Record<string, unknown> | null;
  debugEvents: Record<string, unknown>[] | null;
  runs: Array<{ fileName: string; data: Record<string, unknown> }>;
  subagents: Array<{ fileName: string; data: Record<string, unknown> }>;
}

export interface ConversationHistory {
  id: string;
  channelId: string;
  sessionId: string;
  threadConversationId?: string;
  title: string;
  messages: StoredMessage[];
  createdAt: Date;
  lastUpdated: Date;
  isStarred?: boolean;
  branchSelections?: Record<string, string>; // parentId → selected childId for branching
  lastInputContext?: LastInputContext;
}

// ============================================================================
// Streaming / runtime types
// ============================================================================

export interface StreamingParsedContent {
  summary: string;
  keypoints: string[];
  citations: Record<number, number>;
  isComplete: boolean;
}

// Summarizer-specific interfaces
export interface SummarizerCitation {
  messageIndex: number;
  messageId: string;
  conversationId: string;
  channelId?: string; // Optional - may not be available during streaming
  isTicket?: boolean; // Distinguishes ticket citations from message citations (legacy)

  // NEW: Multi-entity support
  entityType?:
    | 'message'
    | 'attachment'
    | 'call'
    | 'recording'
    | 'canvas'
    | 'ticket'
    | 'web_search'
    | 'knowledge_base';
  entityId?: string;
  canvasId?: string;
  callId?: string;
  ticketId?: string;
  externalUrl?: string;
  isExternal?: boolean;
  // File attachment chunk data
  chunkIndex?: number;
  chunkText?: string;
  chunkPos?: number; // 1-indexed page number (PDFs) or sheet index (Excel)
  fileName?: string;
  mimeType?: string;
}

export interface SummarizerKeyPoint {
  point: string;
  citation?: SummarizerCitation;
}

export interface DraftSource {
  messageIndex: number;
  messageId: string;
  conversationId: string;
  channelId: string;
  prefixedRef: string;
  isTicket?: boolean;
  url?: string;
  entityType?:
    | 'message'
    | 'attachment'
    | 'call'
    | 'recording'
    | 'canvas'
    | 'ticket'
    | 'web_search'
    | 'knowledge_base';
  entityId?: string;
  canvasId?: string;
  externalUrl?: string;
  isExternal?: boolean;
  fileName?: string;
  mimeType?: string;
  chunkIndex?: number;
  chunkText?: string;
  chunkPos?: number;
  ticketTitle?: string;
  ticketXyneId?: string;
  canvasTitle?: string;
  channelName?: string;
}

export interface SummarizerOutput {
  summary: string;
  keyPoints: SummarizerKeyPoint[];
}

export interface UserTag {
  name: string;
  userId: string;
}

export interface Participant {
  id: string;
  name: string;
  email: string;
  picture: string;
}
export interface MessageAttachment {
  /** Unique attachment ID (for persisted attachments from claw-auth) */
  id?: string;
  /** Original filename (from claw-auth API) */
  originalFilename?: string;
  /** Filename (alias for originalFilename, for compatibility) */
  filename?: string;
  /** MIME type */
  mimeType: string;
  /** Base64 data (for streaming attachments during generation) */
  data?: string;
  /** Download URL (optional, for persisted attachments) */
  downloadUrl?: string;
  /** Width (for images) */
  width?: number | null;
  /** Height (for images) */
  height?: number | null;
  /** Metadata for special attachments (e.g., slide JSON for PPTX) */
  metadata?: {
    slideJson?: Array<{
      index: number;
      background?: { color?: string } | string;
      objects: unknown[];
    }>;
  };
}

// Selection context from canvas
export interface SelectionContext {
  canvasId: string;
  selectedText: string;
  canvasTitle?: string;
  preview: string; // Truncated preview for display
}

export interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  streamingContent?: string;
  parsedContent?: StreamingParsedContent;
  messageIdMapping?: Record<string, string>;
  conversationIdMapping?: Record<string, string>;
  channelIdMapping?: Record<string, string>;
  toolOutputs?: GeniusToolOutput[];
  statusMessage?: string | string[]; // Agent status — string or rotating phrases array for long-running tools
  // Tool input tracking
  toolName?: string; // Name of the tool being called
  toolInput?: unknown; // Input parameters for the tool
  // Summarizer-specific fields
  summarizerOutput?: SummarizerOutput;
  fetchedMessages?: string; // Tool output content from fetch_channel_messages
  agentType?: 'genius' | 'summarizer'; // Track which agent is responding
  isGeniusResponse?: boolean; // Flag set when genius_start event is detected
  isAborted?: boolean; // Flag set when message was aborted due to page reload
  traceId?: string; // Langfuse trace ID for feedback
  feedback?: 0 | 1 | 2; // 0 = no feedback, 1 = like, 2 = dislike
  attachments?: MessageAttachment[]; // Attachments sent with the message
  userTags?: Record<string, UserTag>; // Tag -> {name, userId} for user mentions
  participants?: Participant[]; // List of participants for Summarizer responses
  selectionContexts?: SelectionContext[]; // Canvas selection contexts
  parentId?: string | null; // Parent message ID for tree branching
  /**
   * Stable React key that does NOT change when the message's `id` is swapped
   * from a client temp id (`bot-<ts>`) to the server id at completion. Keying
   * the rendered bubble by this (falling back to `id`) prevents the whole
   * bubble from remounting on completion — which is what let the live→done
   * activity block animate its transition instead of hard-swapping.
   */
  stableKey?: string;
  sessionId?: string; // Session ID for v2 streaming
  /** AgentRun.sessionId for the run that produced this assistant message.
   *  Drives branching-safe "Debug this response" selection — chronological
   *  turn index doesn't survive sibling branches. */
  debugSessionId?: string;
  /** Optional comment attached to a 👎 rating (persisted to agent_runs.ratingComment). */
  ratingComment?: string | null;
  sources?: DraftSource[];

  // ============================================================================
  // v2 Types (xyne-claw integration) - mirrored from StoredMessage
  // ============================================================================

  /**
   * Reasoning/thinking content from the agent (v2)
   */
  reasoning?: string;

  /**
   * Tool invocations made during the response (v2)
   */
  toolInvocations?: ToolInvocation[];

  /**
   * Pending actions requiring human approval (v2)
   */
  pendingActions?: PendingAction[];
  errorInfo?: {
    code?: string;
    title: string;
    message: string;
    helpText?: string;
    retryable?: boolean;
    /** Original error text from the backend for debugging / transparency */
    rawError?: string;
  };
}
