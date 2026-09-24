/**
 * runReplay.ts — where clicking a run should take you.
 *
 * The Runs page, an agent's run history and the home recent-runs card all want
 * the same rule, and drifted apart while each held its own copy of it.
 *
 * The rule: a run replays in its own agent's thread. That holds for a DELEGATED
 * run too, because the callee gets a conversation of its own with the delegated
 * question and answer persisted in it.
 */

/** Satisfied by both AgentRun and the light list projection, so every caller
 *  can pass its own row shape. */
export interface ReplayableRun {
  agentSlug: string;
  conversationId: string | null;
}

/**
 * In-app replay path, or null when the run has no conversation to open
 * (API and scheduled runs), which callers use to leave the row unclickable.
 *
 * `allRuns` opts the chat view into the cross-user read path; the backend still
 * gates that on admin, so passing it is a request, not a grant.
 */
export function runReplayPath(run: ReplayableRun, opts: { allRuns?: boolean } = {}): string | null {
  if (!run.conversationId) return null;
  const qs = new URLSearchParams({
    agent: run.agentSlug,
    conversation: run.conversationId,
    ...(opts.allRuns ? { allRuns: "1" } : {}),
  });
  return `/v3/chat?${qs.toString()}`;
}
