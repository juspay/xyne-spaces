/**
 * Shared types for the session curator.
 *
 * Implementation lives in xyne-claw (where LITELLM_API_KEY is available).
 * claw-auth imports only the types — it calls claw's /internal/curator/distill
 * over HTTP to actually run the curator.
 *
 * Keeping the curator runtime on claw means LITELLM_API_KEY stays scoped to
 * one pod, claw-auth has no LLM credentials, and "all LLM calls happen on
 * claw" stays a clean invariant.
 */

export interface SessionTranscriptForCurator {
  sessionId: string;
  agentSlug: string;
  userId: string;
  task: string;
  /// Final assistant response.
  result: string;
  /// Names of tools the agent invoked.
  toolsUsed: string[];
  /// Concatenated turns + tool calls. Truncated by the curator at ~12k chars.
  transcript?: string;
}

/**
 * Memory is agent-wide and stored as one memory per subsystem. The curator
 * proposes either a brand-new subsystem (action=create, isNewSubsystem=true)
 * or an update to an existing subsystem's memory (action=update).
 */
export interface SubsystemUpdate {
  subsystem: string;
  action: "create" | "update";
  /** Full proposed memory text, ≤ 1500 chars. Replaces the existing memory entirely on approve. */
  proposedContent: string;
  /** Short why-this-update note for admin review. */
  reasoning: string;
  /** 0-1, ≥ 0.7 to surface. */
  confidence: number;
  /** Hindsight memory ID being replaced (action=update). NULL on create. */
  replacesMemoryId: string | null;
  /** True when the curator proposed a brand-new subsystem name (admin should scrutinise). */
  isNewSubsystem: boolean;
}
