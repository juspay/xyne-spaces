/**
 * Branching helpers shared by /agent-chat/:slug/chat and /run/stream.
 *
 * A conversation is a tree. Each ChatMessage has an optional parentId; the UI
 * projects ONE selected path through the tree. The DB stays append-only — we
 * never rewrite history, we add sibling nodes. The PI session JSONL is forked
 * to match: a branch lives at `${conversationId}__branch__${assistantMsgId}`
 * so the LLM context follows the selected branch and doesn't leak across
 * siblings. `resolvePiConversationIdForPath` walks the selected path and
 * returns the right branch id for a given leaf.
 */

import { CONFIG } from "../../config.js";

export type ChatTreeMessage = {
  id: string;
  role: string;
  parentId: string | null;
  createdAt: Date;
};

/** "full" clones the whole session (no branch point) — used to fork a finished
 *  run into a per-user thread that must keep the run's final reply in context. */
export type BranchMode = "lastUser" | "beforeLastUser" | "full";

/** PI session JSONL id for the branch that hangs off `assistantMessageId`. */
export function branchPiConversationId(conversationId: string, assistantMessageId: string): string {
  return `${conversationId}__branch__${assistantMessageId}`;
}

/** Storage key claw uses for the session dir under data/sessions. */
export function piSessionStoreKey(piConversationId: string, agentSlug: string): string {
  return `${piConversationId}_${agentSlug}`;
}

/**
 * Walk the chat tree from root to the given leaf; return the PI session id
 * that should back the leaf. If the path stays on the "first-child" rail at
 * every fork the original conversation id wins; otherwise the deepest
 * assistant on a non-first branch contributes the branch suffix.
 *
 * Used both to decide which session to clone FROM (regenerate / edit-user)
 * and which session to run on FOR a normal send under a branch the user has
 * paged into.
 */
export function resolvePiConversationIdForPath(
  messages: ChatTreeMessage[],
  leafMessageId: string | null | undefined,
  conversationId: string,
): string {
  if (!leafMessageId) return conversationId;
  const byId = new Map(messages.map((msg) => [msg.id, msg]));
  const childrenByParent = new Map<string, ChatTreeMessage[]>();
  for (const msg of messages) {
    const key = msg.parentId ?? "__root__";
    const list = childrenByParent.get(key) ?? [];
    list.push(msg);
    childrenByParent.set(key, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  const path: ChatTreeMessage[] = [];
  let cursor = byId.get(leafMessageId);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    path.push(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  path.reverse();

  let pendingUserBranch = false;
  for (const msg of path) {
    const siblings = childrenByParent.get(msg.parentId ?? "__root__") ?? [];
    if (msg.role !== "assistant") {
      if (siblings.length > 1 && siblings[0]?.id !== msg.id) pendingUserBranch = true;
      continue;
    }
    if (pendingUserBranch) return branchPiConversationId(conversationId, msg.id);
    if (siblings.length > 1 && siblings[0]?.id !== msg.id) return branchPiConversationId(conversationId, msg.id);
  }
  return conversationId;
}

/**
 * POST /clone-session via the internal S2S proxy. Returns true on success.
 * Callers are expected to mark the pre-created assistant placeholder as
 * "failed" and short-circuit the run dispatch on failure.
 */
export async function cloneSessionViaProxy(args: {
  sourceConversationId: string;
  targetConversationId: string;
  branchMode: BranchMode;
  internalUrl: string;
  s2sKey?: string;
}): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${args.internalUrl}/claw/api/v1/clone-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(args.s2sKey ? { "x-s2s-key": args.s2sKey } : {}),
    },
    body: JSON.stringify({
      sourceConversationId: args.sourceConversationId,
      targetConversationId: args.targetConversationId,
      branchMode: args.branchMode,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok || !body.success) {
    const errResult: { success: boolean; error?: string } = {
      success: false,
      error: body.error ?? `clone-session HTTP ${res.status}`,
    };
    return errResult;
  }
  return { success: true };
}

/**
 * Convenience: clone-session against the platform's INTERNAL_URL (default
 * caller in this codebase). Wraps `cloneSessionViaProxy` so callers don't
 * have to thread CONFIG through. Exists purely as a default-args shim.
 */
export function cloneBranchSession(args: {
  sourceConversationId: string;
  targetConversationId: string;
  branchMode: BranchMode;
}): Promise<{ success: boolean; error?: string }> {
  return cloneSessionViaProxy({
    ...args,
    internalUrl: CONFIG.internalUrl,
    ...(CONFIG.xyneClawS2sKey ? { s2sKey: CONFIG.xyneClawS2sKey } : {}),
  });
}
