/**
 * Claw-auth-side pieces of instant mode that must stay on claw-auth because
 * they're Postgres reads (isInstantAgent reads the Agent row already in
 * scope at the dispatch site; resolvePreviousTurnContext and the history/
 * follow-up-context builders below read ChatMessage/AgentRun). Everything
 * else about instant mode's orchestration — classify, search, deep-dive,
 * answer, follow-up generation — lives on claw now (apps/xyne-claw/src/
 * instant-run.ts), reached via the SAME `/internal/run` -> claw `/run`
 * dispatch every agentic run already uses. See routes/run.ts's `/internal/run`
 * proxy for where these get called and folded into `forwardBody`.
 */

import { agentRunRepository } from "../repositories/agentRunRepository.js";
import { chatMessageRepository } from "../repositories/chatMessageRepository.js";
import { createLogger } from "../logger.js";

const log = createLogger("instant-context");

/**
 * Whether this agent is configured to ONLY ever run in instant mode — a
 * persisted per-agent setting (`agent.config.instantAgent`, a plain key on
 * the existing free-form `Agent.config` Json column, no schema migration),
 * not a per-message opt-in. The `/internal/run` proxy treats this as the
 * sole source of truth for whether a given request runs instant — a
 * client-sent `instant` request flag is not honored on its own, in either
 * direction: an instant agent always runs instant even if the client omits
 * the flag, and a non-instant agent never runs instant even if the client
 * sends one, so there's no way to bypass the setting from either side.
 */
export function isInstantAgent(config: unknown): boolean {
  return Boolean(config) && typeof config === "object" && !Array.isArray(config) &&
    (config as Record<string, unknown>)["instantAgent"] === true;
}

/**
 * Pulls the immediately preceding completed run's raw retrieved snippets
 * (the actual <search_results>/<doc_search> XML, not the final answer text)
 * for this conversation+agent — approximates what an agentic session's
 * persistent tool-result history already gives the model "for free" on
 * every subsequent turn, without instant mode needing a real multi-turn
 * tool loop or its own persistent session on claw. Called unconditionally
 * past the first turn (never gated on classify's isFollowUp — same as
 * agentic, which doesn't gate on it either). Fails open (null) on anything
 * missing or malformed; claw's instant-run.ts just runs its normal fresh
 * search with no prior-turn context carried forward in that case.
 */
export async function resolvePreviousTurnContext(conversationId: string, agentSlug: string): Promise<string | null> {
  try {
    const previousRun = await agentRunRepository.findLatestToolInvocations(conversationId, agentSlug);
    const invocations = previousRun?.toolInvocations;
    if (!Array.isArray(invocations) || invocations.length === 0) return null;
    const parts = (invocations as Array<{ result?: unknown }>)
      .map((inv) => (typeof inv?.result === "string" ? inv.result : null))
      .filter((r): r is string => r !== null);
    return parts.length > 0 ? parts.join("\n\n") : null;
  } catch (err) {
    log.warn(`[instant-context] previous-turn context lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface InstantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Caps how much prior conversation gets forwarded into claw's classify/answer calls. */
const MAX_HISTORY_MESSAGES = 20;

/**
 * Plain role+content conversation history for instant mode's (stateless,
 * no persistent PI session on claw) classify/answer calls — same shape and
 * source `run-stream.ts`/`agent-chat.ts` already built locally before this
 * moved to claw. Scoped to this agent within the conversation (a thread can
 * mix turns from multiple agents; instant mode should only ever see its
 * own).
 */
export async function resolveInstantHistory(conversationId: string, agentSlug: string): Promise<InstantHistoryMessage[]> {
  try {
    const rows = await chatMessageRepository.findByConversation(conversationId);
    return rows
      .filter((m) => m.agentSlug === agentSlug && (m.role === "user" || m.role === "assistant") && m.content.trim())
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  } catch (err) {
    log.warn(`[instant-context] history lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
