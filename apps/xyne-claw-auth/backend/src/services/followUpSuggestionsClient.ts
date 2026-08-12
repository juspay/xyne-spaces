/**
 * S2S client for claw's follow-up-suggestion endpoint — lets the instant KB
 * answer flow (lib/instant-ask.ts) offer the same suggested next-message
 * chips the full agentic loop already generates (xyne-claw's run.ts), without
 * claw-auth needing its own LiteLLM credential (see routes/follow-up.ts on
 * the claw side for why this runs there, not here).
 */

import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("follow-up-suggestions-client");

const CLAW_TIMEOUT_MS = 65_000;

export interface FollowUpAgentContext {
  name?: string;
  description?: string;
}

export interface FollowUpConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface FollowUpGenerationResult {
  suggestions: string[];
  source: "model" | "fallback";
  model: string;
  failureCode?: "missing_api_key" | "http_error" | "invalid_payload" | "request_error";
  failureMessage?: string;
  httpStatus?: number;
}

/** Never throws — a failed/timed-out generation degrades to `null`, which the
 *  caller treats the same as "follow-ups disabled" for this turn. */
export async function generateFollowUpSuggestionsViaClaw(
  task: string,
  agentContext?: FollowUpAgentContext,
  conversationHistory?: FollowUpConversationMessage[],
): Promise<FollowUpGenerationResult | null> {
  if (!CONFIG.xyneClawS2sKey) {
    log.warn("[follow-up-suggestions-client] XYNE_CLAW_S2S_KEY not set — skipping follow-up generation");
    return null;
  }

  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/follow-up-suggestions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify({
        task,
        ...(agentContext ? { agentContext } : {}),
        ...(conversationHistory?.length ? { conversationHistory } : {}),
      }),
      signal: AbortSignal.timeout(CLAW_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`[follow-up-suggestions-client] claw ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { success?: boolean; generation?: FollowUpGenerationResult };
    return data.success && data.generation ? data.generation : null;
  } catch (err) {
    log.warn(`[follow-up-suggestions-client] failed to reach claw at ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
