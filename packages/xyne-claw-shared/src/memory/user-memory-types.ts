/**
 * Shared types for the User-Memory (Digital Twin) curator.
 *
 * Implementation lives in xyne-claw (where LITELLM_API_KEY is). claw-auth
 * imports only the types and calls claw's /internal/user-memory/distill over
 * HTTP. Same "LLM on claw only" invariant as the session curator.
 *
 * Difference from the shared-memory curator:
 *   - Input is the *user's authored Spaces records* (messages, hosted calls,
 *     authored canvases), not an agent's transcript.
 *   - Output is facts ABOUT the user, scoped to one user, grouped by a
 *     fixed taxonomy of subsystems describing facets of the person.
 *   - Approval is by the user themselves, not an admin.
 */

/** Behaviourally-distinct surfaces. Threaded conversation units carry this so
 *  the curator can tell a private DM from a public-channel post — the same
 *  words mean different things in each. */
export type UserMemoryChannelType = "dm" | "group_dm" | "public" | "private";

/** One message inside an assembled conversation unit (Context Assembler). */
export interface UserMemoryThreadMessage {
  /** Display label of the author ("you" for the twin's user). */
  author: string;
  authorIsUser: boolean;
  text: string;
  /** Sortable epoch (ms). */
  tsEpoch: number;
}

/**
 * Thread-complete, behaviour-aware context for a single conversation the user
 * took part in. Produced by the Context Assembler (claw-auth) from the Spaces
 * message/conversation/channel/activity/participation models. Co-participant
 * lines are CONTEXT — the curator extracts facts about the user only.
 */
export interface UserMemoryThreadContext {
  /** The message that spawned this thread (what it replies to), if any. */
  parent?: { author: string; text: string };
  /** Ordered thread messages (co-participants included, as context). */
  messages: UserMemoryThreadMessage[];
  /** The user's role in this conversation. */
  userRole: "author" | "mentioned" | "participant";
  /** Behavioural signal when the user was mentioned: did they answer? The
   *  single richest signal for "what/when/how the user responds vs ignores". */
  behavior?: {
    /** The incoming message that pulled the user in. */
    trigger: string;
    outcome: "responded" | "ignored";
    /** Response latency (responded only), when derivable. */
    latencyMs?: number;
    /** For "ignored": how long since the trigger with no reply. */
    ignoredForMs?: number;
    /** How the outcome was determined:
     *   - "participation": exact truth from ConversationParticipant.lastReplyAt.
     *   - "derived": inferred from the presence of a later user message. */
    source: "participation" | "derived";
  };
}

/**
 * One record fed to the curator. Source-agnostic shape so the LLM sees the
 * same envelope for messages, calls, canvases, and assembled conversations.
 */
export interface UserMemoryRecord {
  /** Stable ID from Spaces. For message/call/canvas: that record's ID. For
   *  mention_reply: the ID of the user's OWN reply message. For conversation:
   *  the conversationId (the thread the unit summarises). */
  id: string;
  /** Source kind for the curator's grounding + the candidate's sourceRefs.
   *  mention_reply = an incoming message directed at the user paired with the
   *  user's actual reply (forward pipeline, sourced from twin AgentRuns).
   *  conversation = a thread-complete unit assembled by the Context Assembler
   *  (full thread + parent + channel type + responded/ignored signal). */
  type: "message" | "call" | "canvas" | "mention_reply" | "conversation";
  /** ISO timestamp the record was authored (for conversation: the latest turn). */
  ts: string;
  /** Sortable epoch (ms). Present on records the Context Assembler produces. */
  tsEpoch?: number;
  /** Channel ID if the record is bound to a channel (message, canvas, conversation). */
  channelId?: string;
  /** Human-readable channel name, for the curator's prompt context. */
  channelName?: string;
  /** DM vs public/private/group — behaviourally distinct contexts. Present on
   *  assembled conversation units. */
  channelType?: UserMemoryChannelType;
  /** The thread/conversation this record belongs to (type="conversation"). */
  conversationId?: string;
  /** Title for calls / canvases. Empty for messages. */
  title?: string;
  /** The text the curator reads. For messages: the message body. For calls:
   *  the AI summary + transcript excerpt. For canvases: the markdown content
   *  (truncated). For mention_reply: the incoming message and the user's reply,
   *  clearly delimited. For conversation: a rendered transcript block — so the
   *  curator works with no prompt change; Phase 2 renders from `thread` directly. */
  text: string;
  /** Structured thread context for type="conversation" (Context Assembler). */
  thread?: UserMemoryThreadContext;
}

/**
 * Cluster labels used to group candidates for cluster-batched user review.
 * Fixed taxonomy — curator MUST pick one of these eight, never invent.
 */
export type UserMemorySubsystem =
  | "style"          // voice + response mechanics: length, structure, openers, sign-offs, emoji, punctuation, register, how they ack/ask/disagree
  | "triage"         // respond-vs-ignore behaviour: which senders / channels / channel-types / topics / message-types they ENGAGE with vs stay SILENT on (the respond/ignore gate reads this facet directly)
  | "expertise"      // domain knowledge, systems/files/tools they demonstrably know
  | "projects"       // ongoing work, codenames, what they drive/own now
  | "relationships"  // collaborators, manager, reports — AND how the tone shifts per person
  | "preferences"    // tools, workflow, formatting conventions they prefer or reject
  | "decisions"      // captured judgment calls + reasoning + date
  | "context"        // identity, role, tenure, team, working hours
  | "docs";          // references to authored canvases / uploaded .md files

export const USER_MEMORY_SUBSYSTEMS: readonly UserMemorySubsystem[] = [
  "style",
  "triage",
  "expertise",
  "projects",
  "relationships",
  "preferences",
  "decisions",
  "context",
  "docs",
] as const;

/**
 * One candidate fact about the user that the curator emits. Server attaches
 * `sourceRefs` from the input batch; curator only emits text + subsystem +
 * signalScore + the IDs it grounded on.
 */
export interface UserMemoryCandidatePayload {
  /** Written in third person ("the user…") for clarity. */
  text: string;
  subsystem: UserMemorySubsystem;
  /** 0-1, where 1 = strongly evidenced across multiple records, 0 = single
   *  weak signal. Used to sort the review cluster top-down. */
  signalScore: number;
  /** Record IDs from the input batch that grounded this candidate. The route
   *  handler resolves these to {type, id, channelId, ts} for sourceRefs. */
  groundedOnIds: string[];
}

/**
 * An already-retained memory for this user, passed into a distill call so the
 * curator can SEE what's already known and avoid re-emitting a near-duplicate
 * (emit-time dedup). Non-destructive: storage-side consolidation of overlapping
 * facts is left to the provider (Hindsight); we never delete from here.
 */
export interface ExistingUserMemory {
  /** Hindsight memory id (from listMemories). */
  id: string;
  /** One of the eight fixed labels. */
  subsystem: string;
  /** The current memory text. */
  text: string;
}

/**
 * One candidate exactly as the LLM emitted it, before server-side filtering,
 * plus the verdict the filter reached. This is what lets a user reason "why
 * was this memory missed / phrased this way" from the pipeline viewer.
 */
export interface UserMemoryCuratorEmittedCandidate {
  text: string;
  /** As emitted — may be an invalid label (that's a dropReason). */
  subsystem?: string;
  signalScore?: number;
  groundedOnIds?: string[];
  verdict: "kept" | "dropped";
  /** Why the server-side filter dropped it (verdict="dropped" only).
   *  empty: blank text.
   *  empty-or-too-long: legacy value from traces created before the per-candidate
   *  length limit was removed.
   *  bad-subsystem: not one of the eight fixed labels.
   *  low-signal: signalScore < 0.7.
   *  ungrounded: no groundedOnIds matching an input record.
   *  malformed: not an object / unparseable entry. */
  dropReason?: "empty" | "empty-or-too-long" | "bad-subsystem" | "low-signal" | "ungrounded" | "malformed";
}

/**
 * Full observability trace of one distill (= one LLM call). Returned by
 * /internal/user-memory/distill when includeTrace=true and persisted by
 * claw-auth as a DigitalTwinPipelineEvent so the pipeline is not a black box.
 */
export interface UserMemoryCuratorTrace {
  /** Model name the call was made with (CURATOR_MODEL). */
  model: string;
  durationMs: number;
  /** How many LLM attempts this distill took (1 = first-try). >1 means a
   *  transient/output-quality failure was retried; absent for the empty-batch
   *  and no-api-key short-circuits (no call made). */
  attempts?: number;
  /** Static system prompt sent to the curator, capped at 120k chars. Present
   *  whenever an LLM call was attempted; absent for the empty-batch and
   *  no-api-key short-circuits (no call made). */
  systemPrompt?: string;
  /** The full user prompt sent to the LLM (records + already-known context),
   *  capped at 120k chars. The system prompt is static — see
   *  user-memory-curator.ts SYSTEM_PROMPT. */
  prompt: string;
  promptChars: number;
  /** Model reasoning / "thinking" when the provider returns it (e.g. glm
   *  `reasoning_content`), capped at 120k chars. Absent for models that don't
   *  expose reasoning. */
  reasoning?: string;
  /** `finish_reason` from the model's first choice ("stop" | "tool_calls" |
   *  "length" | …). Useful to spot truncation or a refusal. */
  finishReason?: string;
  /** Non-tool assistant text the model returned alongside/instead of the tool
   *  call, capped at 120k chars. Normally empty for a clean tool_call;
   *  populated when a model answers in content (toolCallSource =
   *  "recovered-content"). */
  rawContent?: string;
  /** Name of the tool the model called (always emit_user_candidates on
   *  success). */
  toolCallName?: string;
  /** How the candidate arguments were obtained:
   *   - "tool_calls": a proper OpenAI tool_calls entry (the happy path).
   *   - "recovered-content": parsed out of message.content because the model
   *     ignored the forced tool_choice — seen intermittently with glm-latest,
   *     whose native tool markup LiteLLM occasionally fails to normalize. */
  toolCallSource?: "tool_calls" | "recovered-content";
  /** Raw tool-call `arguments` JSON string exactly as the LLM returned it,
   *  capped at 120k chars. Absent when the call failed before a response. */
  rawResponse?: string;
  /** Token usage as reported by the gateway, when present. */
  usage?: { promptTokens?: number; completionTokens?: number };
  /** Every candidate the LLM emitted, in order, with keep/drop verdicts. */
  emitted: UserMemoryCuratorEmittedCandidate[];
  /** Failure stage when the call produced no candidates for a non-content
   *  reason: "no-api-key" | "llm-http-<status>" | "no-tool-call" |
   *  "bad-json" | "malformed-candidates" | the thrown error message. */
  error?: string;
}

/**
 * Request body for claw's POST /internal/user-memory/distill.
 * Sent by claw-auth's BullMQ workers (backfill + daily) and route handlers.
 */
export interface UserMemoryDistillRequest {
  userId: string;
  /** Window the records belong to. Curator uses this for "is this a stale
   *  observation?" decisions and to set context in the prompt. */
  window: { from: string; to: string };
  /** Caps prompt size. Hard limit 200; caller should batch above that. */
  records: UserMemoryRecord[];
  /** This user's already-retained memories (from listMemories). Lets the
   *  curator SEE what's already known so it doesn't re-emit a near-duplicate
   *  (emit-time dedup). Non-destructive — provider owns storage consolidation.
   *  Optional — when absent the curator has no dedup context. */
  existingMemories?: ExistingUserMemory[];
  /** When true the response carries the full UserMemoryCuratorTrace. claw-auth
   *  always sets this so the pipeline viewer can show the LLM exchange. */
  includeTrace?: boolean;
}

export interface UserMemoryDistillResponse {
  success: boolean;
  candidates?: UserMemoryCandidatePayload[];
  /** Present when the request set includeTrace=true. */
  trace?: UserMemoryCuratorTrace;
  error?: string;
}
