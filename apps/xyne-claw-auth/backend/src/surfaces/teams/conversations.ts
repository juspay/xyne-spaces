/**
 * Conversation references: what it takes to post into a Teams conversation
 * again. The Bot Connector endpoint (`serviceUrl`) differs by tenant region
 * and is only ever learned from an inbound activity, while replies leave from
 * whichever pod owns the account's outbox — so it is written to the account's
 * auth state (Postgres) before the inbound message is handed to the core, and
 * read back at send time.
 *
 * SEAM (XYNE-66908): proactive messages start from these rows — a person or
 * channel the bot has heard from can be messaged again later.
 */
import type { AuthStateStore } from "../messaging/plugin.js";
import type { ConversationRef } from "./activity.js";

export const CONVERSATION_REF_CATEGORY = "conversation-ref";

/** Last value written per (account, conversation): a busy chat must not cost
 *  a Postgres write per message when nothing changed. Bounded. */
const written = new Map<string, string>();
const MAX_CACHED = 5_000;

function remember(key: string, value: string): void {
  if (written.size >= MAX_CACHED) {
    const oldest = written.keys().next().value;
    if (oldest !== undefined) written.delete(oldest);
  }
  written.set(key, value);
}

export async function saveConversationRef(
  accountId: string,
  authState: AuthStateStore,
  conversationId: string,
  ref: ConversationRef,
): Promise<void> {
  const value = JSON.stringify(ref);
  const key = `${accountId}\u0000${conversationId}`;
  if (written.get(key) === value) return;
  await authState.set(CONVERSATION_REF_CATEGORY, conversationId, value);
  remember(key, value);
}

export async function loadConversationRef(
  accountId: string,
  authState: AuthStateStore,
  conversationId: string,
): Promise<ConversationRef | null> {
  // Only what THIS pod wrote is trusted from memory; anything else is read
  // fresh, so a serviceUrl that moved is picked up from the row.
  const cached = written.get(`${accountId}\u0000${conversationId}`);
  const raw = cached ?? (await authState.get(CONVERSATION_REF_CATEGORY, conversationId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConversationRef>;
    if (typeof parsed.serviceUrl !== "string" || typeof parsed.botId !== "string") return null;
    return {
      serviceUrl: parsed.serviceUrl,
      botId: parsed.botId,
      tenantId: typeof parsed.tenantId === "string" ? parsed.tenantId : "",
      conversationType:
        parsed.conversationType === "channel" || parsed.conversationType === "groupChat" ? parsed.conversationType : "personal",
    };
  } catch {
    return null;
  }
}

/** Test hook. */
export function clearConversationRefCache(): void {
  written.clear();
}
