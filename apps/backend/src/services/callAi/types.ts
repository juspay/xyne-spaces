/**
 * One prompt-in / text-out task from the call, recording or summary-template
 * pipelines. Engine-agnostic: the legacy path sends it straight to LiteLLM, the
 * Claw path runs it on a Claw agent.
 */
export interface CallAiTask {
  /** Stable operation name (e.g. 'call_summary'); used in logs and the Claw run. */
  operation: string;
  userPrompt: string;
  systemPrompt?: string;
  /**
   * External call id the task belongs to. Only tasks on a real call run on Claw
   * (as the call's creator); the rest always use the legacy engine.
   */
  callId?: string;
  abortSignal?: AbortSignal;
}

export type ClawCallAiFailureReason =
  | 'cancelled'
  | 'dispatch_failed'
  | 'run_failed'
  | 'timeout'
  | 'empty_content';

export type ClawCallAiResult =
  | { ok: true; content: string; sessionId: string }
  | { ok: false; reason: ClawCallAiFailureReason; error?: string };

/** The Spaces identity a Claw run acts as. */
export interface ClawCallAiIdentity {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string;
  workspaceId: string;
}

/** Terminal state of a run as reported by Claw (callback or run-status poll). */
export interface ClawCallAiRunOutcome {
  status: 'completed' | 'failed' | 'cancelled';
  result: string;
  error?: string;
}
