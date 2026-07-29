/**
 * Branching parent-link reconstruction for the chat tree projection.
 *
 * Conversations are stored as a tree: each message has a `parentId`, and the UI
 * projects ONE visible path, showing a `< x/y >` pager wherever a parent has
 * multiple children (regenerations / edits).
 *
 * Conversations created BEFORE the branching migration have `parentId = null`
 * on every message. Grouping those purely by `parentId` drops the whole thread
 * into one "root" bucket, so the projection treats the entire conversation as a
 * single message with N variant pages — the squash bug.
 *
 * `resolveEffectiveParents` rebuilds a sane parent link for those legacy
 * messages WITHOUT touching messages that already carry a real `parentId`, so
 * live branching is unaffected. It walks the thread in chronological order and,
 * for each message whose `parentId` is null/undefined:
 *   - the first message stays a root (null parent);
 *   - a message that follows a DIFFERENT-role message chains to it, rebuilding
 *     the linear user → assistant → user → … thread (legacy + mixed convos);
 *   - a message that follows a SAME-role message shares that message's parent,
 *     so it stays a genuine sibling variant (e.g. an edited first prompt, or a
 *     regenerated root).
 *
 * Returns a Map of messageId → effective parentId (or null for roots). Callers
 * substitute this for the raw `parentId` when building their adjacency map.
 */
export interface BranchNode {
  id: string;
  role: string;
  createdAt: string;
  parentId?: string | null;
}

export function resolveEffectiveParents<T extends BranchNode>(messages: T[]): Map<string, string | null> {
  const chrono = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const result = new Map<string, string | null>();
  for (let i = 0; i < chrono.length; i++) {
    const m = chrono[i]!;
    if (m.parentId != null) {
      result.set(m.id, m.parentId);
      continue;
    }
    const prev = i > 0 ? chrono[i - 1] : undefined;
    if (!prev) {
      result.set(m.id, null);
    } else if (prev.role !== m.role) {
      // Legacy linear chaining: this turn follows the previous turn.
      result.set(m.id, prev.id);
    } else {
      // Same-role sibling: an alternative version of the same turn — share the
      // predecessor's parent so they group as variants, not a sequence.
      result.set(m.id, result.get(prev.id) ?? null);
    }
  }
  return result;
}
