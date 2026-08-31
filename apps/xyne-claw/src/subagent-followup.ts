/**
 * subagent-followup.ts — primitives for the parent→subagent follow-up feature.
 *
 * A subagent flagged `supportsFollowUp` persists its child pi session under
 * sessions/{conversationId}/subagents/{name}/{handle}/ and returns the `handle`
 * to the parent as `session_id`. A later call passing that `session_id` RESUMES
 * the same child session (full prior context) instead of spawning a fresh one.
 *
 * This module holds the two pieces that must be correct in isolation and are
 * therefore unit-tested without the heavy subagent-tools module graph:
 *   1. handle validation — the value becomes a filesystem path segment, so it
 *      must be strictly validated to prevent traversal/injection.
 *   2. a per-handle async lock — two concurrent resumes of the same child
 *      session would interleave appends to one JSONL and corrupt it.
 */

/**
 * A follow-up handle is a single, safe path segment. We mint them as
 * crypto.randomUUID(), so the accepted alphabet is intentionally narrow:
 * letters, digits, `_` and `-`, length 1–128. This rejects path separators,
 * `.`/`..` traversal, whitespace, and empty strings.
 */
export const SAFE_FOLLOWUP_HANDLE_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** True only for a string that is safe to use as a session-dir path segment. */
export function isValidFollowUpHandle(value: unknown): value is string {
  return typeof value === "string" && SAFE_FOLLOWUP_HANDLE_RE.test(value);
}

// Serializes concurrent follow-up resumes on the SAME persisted child session
// directory. In-process is sufficient because a conversation is pinned to one
// pod per turn (the conversation lock already serializes across turns); the only
// contention is parallel same-handle resumes within a single parent turn.
const followUpHandleLocks = new Map<string, Promise<void>>();

/**
 * Acquire the lock for `key` (the absolute child session dir). Resolves once any
 * prior holder released. Returns a release function — call it exactly once
 * (in a finally). Callers awaiting the same key are served in FIFO order.
 */
export async function acquireFollowUpLock(key: string): Promise<() => void> {
  const prev = followUpHandleLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The tail of the chain is `next`: the following waiter awaits it.
  followUpHandleLocks.set(key, next);
  await prev.catch(() => {});
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    // Best-effort cleanup: only drop the entry if no newer waiter replaced it.
    if (followUpHandleLocks.get(key) === next) followUpHandleLocks.delete(key);
  };
}
