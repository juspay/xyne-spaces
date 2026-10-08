import type { FlowDefinition } from "xyne-claw-shared";
import { createLogger } from "../logger.js";
import { redisService } from "../redis.js";
import type { DraftAgentSpec } from "./agent-card.js";
import { errMsg } from "./errors.js";

const log = createLogger("xyne-ai-agent-draft");

/** Turn text when a propose-agent draft could not be put up for approval. */
export const AGENT_DRAFT_DELIVERY_FAILED = "I drafted the agent but couldn't post it for approval. Please try again.";

export interface PendingAgentCardPayload {
  variant?: string;
  slug?: string;
  slugs?: string[];
  agent?: DraftAgentSpec;
}

export interface XyneAiAgentDraftResult {
  /** Text to persist as the turn's content (replaces the empty run result). */
  content: string;
  /** Stamped card to emit on the live stream; undefined when nothing was posted
   *  (delivery failed, or a retried callback lost the dedup claim). */
  flow?: FlowDefinition;
}

/**
 * propose-agent ends its run with an EMPTY result on purpose — the draft card
 * is the deliverable. Every Xyne AI callback route (run-stream for the live
 * sidebar turn, agent-chat for the question-card / approval continuation) must
 * turn that into an AgentRequest + an approval card on the assistant row, or
 * the turn is persisted as "No response" and the draft is lost.
 *
 * Returns null when the callback is not a draft turn, so the caller keeps its
 * normal content. Call BEFORE persisting the assistant row.
 *
 * Idempotent across claw's callback retries via a Redis NX claim keyed per
 * assistant reply (`dedupKey`); a retry still gets the lead-in text so the row
 * content is identical, but never creates a second AgentRequest/card. Redis
 * being down fails open (same as message persistence).
 */
export async function deliverXyneAiAgentDraft(input: {
  pendingAgentCard: PendingAgentCardPayload | undefined;
  status: string | undefined;
  rawResult: string | undefined;
  assistantMessageId: string | undefined;
  /** Fallbacks for resolving the assistant row when the id is missing. */
  conversationId?: string | undefined;
  agentSlug?: string | undefined;
  dedupKey: string | undefined;
  logContext: string;
}): Promise<XyneAiAgentDraftResult | null> {
  const card = input.pendingAgentCard;
  if (card?.variant !== "draft" || !card.agent || input.status !== "completed" || (input.rawResult ?? "").trim()) {
    return null;
  }
  const spec = card.agent;
  const claimed = input.dedupKey
    ? await redisService
        .getConnection()
        .set(input.dedupKey, "1", "EX", 86_400, "NX")
        .catch(() => "OK" as const)
    : "OK";
  try {
    const { prepareAgentDraftCard, agentDraftLeadIn } = await import("./agent-card-render.js");
    const leadIn = agentDraftLeadIn(spec);
    if (claimed !== "OK") {
      log.info(`[agent-card] xyne-ai draft already delivered (${input.logContext}) — retry ignored`);
      return { content: leadIn };
    }
    const { resolveXyneAiCardTarget, postFlowCard } = await import("./flow-card-delivery.js");
    const target = await resolveXyneAiCardTarget({
      assistantMessageId: input.assistantMessageId,
      conversationId: input.conversationId,
      agentSlug: input.agentSlug,
    });
    if (!target) {
      log.warn(`[agent-card] xyne-ai draft skipped — no assistant row (${input.logContext})`);
      return { content: AGENT_DRAFT_DELIVERY_FAILED };
    }
    const prepared = await prepareAgentDraftCard(spec, {
      agentSlug: target.agentSlug,
      orgId: target.orgId,
      userId: target.userId,
      conversationId: target.conversationId,
      channelId: "",
      spacesAppId: target.spacesAppId,
    });
    if (!prepared.ok) return { content: prepared.message };
    // postFlowCard stamps surface/chatMessageId (so approval is routed back to
    // this row) and persists it in uiFlows, so the card survives a reload.
    const flow = await postFlowCard(prepared.flow, target);
    log.info(
      `[agent-card] xyne-ai draft card slug=${spec.slug} request=${prepared.requestId} conv=${target.conversationId} (${input.logContext})`,
    );
    return { content: leadIn, flow };
  } catch (err) {
    log.error(`[agent-card] xyne-ai draft card failed slug=${spec.slug} (${input.logContext}):`, errMsg(err));
    return { content: AGENT_DRAFT_DELIVERY_FAILED };
  }
}
