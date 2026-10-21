/**
 * The Spaces "agent is working" pill — the one place that lights it and the one
 * place that clears it.
 *
 * Why this module exists (prod 2026-09-28): the emit was open-coded at five
 * call sites, and the invariants that keep the pill honest are cross-cutting,
 * so each site got them slightly wrong.
 *
 *  1. EVERY payload must carry `sessionId`. Spaces keys its straggler
 *     suppression on it (apps/backend chatController: `doneSessionKey`), and a
 *     payload without one silently disables that guard — the field is optional
 *     in the Spaces schema, so omitting it is not an error, it is a slow leak.
 *     A late `working` tick then resurrects a pill that was correctly cleared
 *     and nothing ever clears it again. Late ticks are real: a subagent's
 *     4s sticky-label timer can outlive its parent run by seconds
 *     (apps/xyne-claw/src/subagent-tools.ts).
 *  2. EVERY terminal path must clear, not just the happy one. The clear used to
 *     live inline in the `completed` branch of /webhook/result, so `/stop`,
 *     cancels and failures never reached it and the pill sat until its 10-minute
 *     Redis TTL.
 *
 * Both are now structural: `sessionId` is a required field, and `clear()` is a
 * named export a terminal path can call directly instead of having to fall
 * through several hundred lines of delivery logic to reach it.
 */
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { spacesAppFetch } from "./client.js";

const log = createLogger("agent-progress");

/**
 * Session key for a pill lit BEFORE its run is dispatched (the `/goal` start
 * announce), when no run sessionId exists yet.
 *
 * Such a tick cannot be a straggler — nothing has finished, so there is no
 * `done` tombstone it could need suppressing against — but it still needs a
 * key, and it must be one that can never collide with a real sessionId. It is
 * derived from the conversation so it stays stable if the announce retries.
 */
export function preDispatchSessionKey(conversationId: string): string {
  return `pre-dispatch:${conversationId}`;
}

/**
 * Identity of the surface whose pill is being driven. `sessionId` is required
 * and deliberately not optional — see the module header. When the run does not
 * exist yet, use preDispatchSessionKey() rather than inventing a blank.
 */
export interface AgentProgressTarget {
  sessionId: string;
  conversationId?: string | undefined;
  channelId?: string | undefined;
  agentSlug?: string | undefined;
  agentName?: string | undefined;
  spacesAppUserId?: string | undefined;
  appToken?: string | undefined;
}

/**
 * Spaces-side progress needs a real Spaces surface. Two populations produce
 * thousands of guaranteed-4xx calls a day (prod 2026-08-11) and are skipped:
 *  - digital-twin: the shared twin app user isn't a participant of most channels
 *    its runs fire in (403 per tool step). The twin has its own draft/DM surface.
 *  - claw-only conversations (agent-chat/v3): a claw-auth UUID with no Spaces
 *    row (404). Spaces-origin runs always carry channelId from the webhook
 *    payload, so a missing channelId marks a conversation Spaces can't resolve.
 *
 * Exported because the clear must use the SAME predicate as the light: a pill
 * that was never lit needs no clearing, and a pill that WAS lit must never be
 * left behind by a stricter clear-side check.
 */
export function isSpacesProgressDeliverable(
  target: Pick<AgentProgressTarget, "agentSlug" | "channelId" | "appToken">,
): boolean {
  return Boolean(target.appToken) && target.agentSlug !== "digital-twin" && Boolean(target.channelId);
}

function payloadFor(target: AgentProgressTarget, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: target.sessionId,
    conversationId: target.conversationId,
    channelId: target.channelId,
    agentSlug: target.agentSlug,
    agentName: target.agentName,
    userId: target.spacesAppUserId,
    ...extra,
  };
}

/** Light (or refresh) the pill with a tool label. Best-effort; never throws. */
export async function emitAgentProgressWorking(
  target: AgentProgressTarget,
  toolLabel: string,
): Promise<void> {
  if (!isSpacesProgressDeliverable(target)) return;
  try {
    await spacesAppFetch(
      "/chat/agentProgress",
      payloadFor(target, { toolLabel, status: "working" }),
      target.appToken,
    );
  } catch (err) {
    // The pill is cosmetic — a failed tick must never fail the run.
    log.warn("Failed to emit agent progress", { error: errMsg(err) });
  }
}

/**
 * Clear the pill. Call this from EVERY terminal path — completed, failed,
 * cancelled, stopped. Idempotent: clearing a pill that is already gone is a
 * cheap no-op on the Spaces side, so callers should prefer clearing twice over
 * reasoning about whether some other path already did it.
 *
 * Best-effort and never throws: a terminal path must finish even if Spaces is
 * unreachable (the 10-minute TTL is the backstop for that case).
 */
export async function emitAgentProgressDone(target: AgentProgressTarget): Promise<void> {
  if (!isSpacesProgressDeliverable(target)) return;
  try {
    await spacesAppFetch(
      "/chat/agentProgress",
      payloadFor(target, { status: "done" }),
      target.appToken,
    );
  } catch (err) {
    log.warn("Failed to clear agent progress signal", { error: errMsg(err) });
  }
}
