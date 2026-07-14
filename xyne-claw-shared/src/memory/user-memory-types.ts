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

/**
 * One record fed to the curator. Source-agnostic shape so the LLM sees the
 * same envelope for messages, calls, and canvases.
 */
export interface UserMemoryRecord {
  /** Stable ID from Spaces. For message/call/canvas: that record's ID. For
   *  mention_reply: the ID of the user's OWN reply message (so the candidate
   *  grounds on a real message the user authored). */
  id: string;
  /** Source kind for the curator's grounding + the candidate's sourceRefs.
   *  mention_reply = an incoming message directed at the user paired with the
   *  user's actual reply (forward pipeline, sourced from twin AgentRuns). */
  type: "message" | "call" | "canvas" | "mention_reply";
  /** ISO timestamp the record was authored. */
  ts: string;
  /** Channel ID if the record is bound to a channel (message, canvas). */
  channelId?: string;
  /** Human-readable channel name, for the curator's prompt context. */
  channelName?: string;
  /** Title for calls / canvases. Empty for messages. */
  title?: string;
  /** The text the curator reads. For messages: the message body. For calls:
   *  the AI summary + transcript excerpt. For canvases: the markdown content
   *  (truncated). For mention_reply: the incoming message and the user's reply,
   *  clearly delimited so the curator can read the trigger → response pair. */
  text: string;
}

/**
 * Cluster labels used to group candidates for cluster-batched user review.
 * Fixed taxonomy — curator MUST pick one of these eight, never invent.
 */
export type UserMemorySubsystem =
  | "style"          // voice + response mechanics: length, structure, openers, sign-offs, emoji, punctuation, register, how they ack/ask/disagree
  | "expertise"      // domain knowledge, systems/files/tools they demonstrably know
  | "projects"       // ongoing work, codenames, what they drive/own now
  | "relationships"  // collaborators, manager, reports — AND how the tone shifts per person
  | "preferences"    // tools, workflow, formatting conventions they prefer or reject
  | "decisions"      // captured judgment calls + reasoning + date
  | "context"        // identity, role, tenure, team, working hours
  | "docs";          // references to authored canvases / uploaded .md files

export const USER_MEMORY_SUBSYSTEMS: readonly UserMemorySubsystem[] = [
  "style",
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
  /** ≤ 1500 chars. Written in third person ("the user…") for clarity. */
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
}

export interface UserMemoryDistillResponse {
  success: boolean;
  candidates?: UserMemoryCandidatePayload[];
  error?: string;
}
