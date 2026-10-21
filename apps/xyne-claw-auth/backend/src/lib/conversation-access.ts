import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("conversation-access");

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

export type ConversationAccessVerdict = "ok" | "denied" | "unknown";

/**
 * Ask Spaces (the ACL owner) whether `userId` may access `conversationId`.
 * "unknown" (→ callers pass) covers a brand-new/non-existent conversation and
 * any transport failure — this is a defense-in-depth layer; userId is already
 * pinned server-side.
 */
export async function checkConversationAccess(
  conversationId: string,
  userId: string,
): Promise<ConversationAccessVerdict> {
  if (!CONFIG.spacesInternalUrl) return "unknown";
  try {
    const res = await fetch(`${CONFIG.spacesInternalUrl}/api/internal/conversation-access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-s2s-key": process.env["INTERNAL_S2S_KEY"] ?? "",
      },
      body: JSON.stringify({ conversationId, userId }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      log.warn(`[conversation-access] spaces returned ${res.status} convId=${conversationId}`);
      return "unknown";
    }
    const data = (await res.json()) as { exists?: boolean; canAccess?: boolean };
    if (!data.exists) return "unknown";
    return data.canAccess ? "ok" : "denied";
  } catch (err) {
    log.warn(`[conversation-access] spaces call failed convId=${conversationId} err=${errMsg(err)}`);
    return "unknown";
  }
}

/**
 * Returns an error string when the authenticated user may NOT access one of the
 * supplied conversation ids, else null. A "denied" verdict from any id fails;
 * "unknown" (new/non-existent conversation or Spaces unreachable) passes.
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
    const verdict = await checkConversationAccess(base, userId);
    if (verdict === "denied") {
      return "You don't have access to that conversation";
    }
  }
  return null;
}
