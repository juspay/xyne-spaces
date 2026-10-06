import { canUserAccessConversation } from "./spaces-db.js";

const BRANCH_MARKER = "__branch__";

/** Recover the base conversationId from a (possibly branched) PI session id
 *  `${conversationId}__branch__${assistantMsgId}` — the branch suffix is not a
 *  real conversation row, so ownership is checked against the base. */
export function baseConversationId(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  const i = id.indexOf(BRANCH_MARKER);
  const base = i === -1 ? id : id.slice(0, i);
  const trimmed = base.trim();
  return trimmed || undefined;
}

/**
 * Returns an error string when the authenticated user may NOT access one of the
 * supplied conversation ids, else null. A "denied" verdict from any id fails;
 * "unknown" (new/non-existent conversation or Spaces DB unreachable) passes.
 *
 * Callers must gate this on the interactive-user path only — skip for S2S,
 * automation/scheduled, service-token and callers with no authenticated user.
 */
export async function conversationAccessError(
  userId: string,
  conversationIds: ReadonlyArray<string | undefined | null>,
): Promise<string | null> {
  const seen = new Set<string>();
  for (const raw of conversationIds) {
    const base = baseConversationId(raw);
    if (!base || seen.has(base)) continue;
    seen.add(base);
    const verdict = await canUserAccessConversation(base, userId);
    if (verdict === "denied") {
      return "You don't have access to that conversation";
    }
  }
  return null;
}
