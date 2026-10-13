/**
 * Picks the in-flight run a `/live` viewer may cancel, so a tab that reattached
 * mid-run (reload / navigate-back) can still Stop it.
 *
 * A driving tab learns the run id from the `run` SSE event of POST /run/stream.
 * A viewer only ever sees the `/live` snapshot, so without this it has no id to
 * pass to POST /run/stream/cancel and its Stop button only detaches (XYNE-66347).
 *
 * Only the requester's OWN running runs qualify — an admin watching someone
 * else's run (`allRuns=1`) stays watch-only. The cancel endpoint re-checks
 * ownership against agent_runs, so this is a convenience, not the ACL.
 */
export interface LiveRunCandidate {
  sessionId: string;
  userId: string;
  agentSlug: string;
  status: string;
  completedAt?: Date | string | null;
  chatMessageId?: string | null;
}

export function pickCancellableLiveRun(
  runs: readonly LiveRunCandidate[],
  opts: {
    /** Every verified id of the requester (canonical + raw Spaces id). */
    requesterAliases: readonly string[];
    slug: string;
    /** Id of the assistant placeholder the viewer is rendering, when known. */
    runningMsgId?: string;
  },
): string | undefined {
  const own = runs.filter(
    (r) => r.status === "running" && !r.completedAt && opts.requesterAliases.includes(r.userId),
  );
  if (own.length === 0) return undefined;
  // Exact: the run linked to the placeholder the viewer is streaming into.
  if (opts.runningMsgId) {
    const linked = own.find((r) => r.chatMessageId === opts.runningMsgId);
    if (linked) return linked.sessionId;
  }
  // No link yet (the placeholder link is written as the run starts): newest
  // own UNLINKED run on this agent. A run linked to a different message is
  // never returned. Input is ordered startedAt desc by the repository.
  return own.find((r) => !r.chatMessageId && r.agentSlug === opts.slug)?.sessionId;
}
