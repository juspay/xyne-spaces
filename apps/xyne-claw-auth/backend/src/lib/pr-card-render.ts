import {
  buildPrFlow,
  prScreenId,
  type FlowDefinition,
  type PrCardInput,
  type PrProvider,
  type PrStatus,
} from "xyne-claw-shared";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import {
  deliverXyneAiFlow,
  replaceFlowCardOnRow,
  type XyneAiCardTarget,
} from "./flow-card-delivery.js";

const log = createLogger("pr-card");

const PR_PROVIDERS: PrProvider[] = ["github", "bitbucket", "gitlab", "other"];
const PR_STATUSES: PrStatus[] = ["created", "merged", "reverted", "deleted", "declined"];

/** Coerced here rather than imported from the Spaces handler, which owns its
 *  own copy and stays untouched. */
export interface PrProgressFact extends PrCardInput {
  repo?: string;
  number?: string | number;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function readPrProgressFact(raw: unknown): PrProgressFact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const provider = PR_PROVIDERS.find((p) => p === r["provider"]);
  const status = PR_STATUSES.find((s) => s === r["status"]);
  const title = str(r["title"]);
  if (!provider || !status || !title) return null;

  const number = r["number"];
  return {
    provider,
    status,
    title,
    ...(str(r["url"]) ? { url: str(r["url"]) } : {}),
    ...(str(r["desc"]) ? { desc: str(r["desc"]) } : {}),
    ...(str(r["ticketId"]) ? { ticketId: str(r["ticketId"]) } : {}),
    ...(str(r["repo"]) ? { repo: str(r["repo"]) } : {}),
    ...(typeof number === "string" && number.trim()
      ? { number: number.trim() }
      : typeof number === "number" && Number.isFinite(number)
        ? { number }
        : {}),
  };
}

/**
 * `prScreenId` is deterministic per PR, so a later status upserts the same card:
 * replace first, append only when this PR has none on the row yet. Appending
 * first would lose the update, since appendUiFlow dedupes by screenId.
 */
export async function renderXyneAiPrCard(args: {
  pr: PrProgressFact;
  target: XyneAiCardTarget;
}): Promise<FlowDefinition | null> {
  const { pr, target } = args;
  const identity = {
    provider: pr.provider,
    ...(pr.repo ? { repo: pr.repo } : {}),
    ...(pr.number !== undefined ? { number: pr.number } : {}),
    ...(pr.url ? { url: pr.url } : {}),
  };
  const screenId = prScreenId(identity);

  const flow = buildPrFlow(
    {
      provider: pr.provider,
      status: pr.status,
      title: pr.title,
      ...(pr.url ? { url: pr.url } : {}),
      ...(pr.desc ? { desc: pr.desc } : {}),
      ...(pr.ticketId ? { ticketId: pr.ticketId } : {}),
    },
    {
      screenId,
      data: { agentSlug: target.agentSlug, conversationId: target.conversationId },
    },
  );

  try {
    const replaced = await replaceFlowCardOnRow({
      chatMessageId: target.chatMessageId,
      screenId,
      flow,
      userId: target.userId,
    });
    if (replaced) {
      log.info(`[pr-card] xyne-ai updated ${screenId} → ${pr.status} conv=${target.conversationId}`);
      return flow;
    }
    const posted = await deliverXyneAiFlow(flow, target);
    log.info(`[pr-card] xyne-ai posted ${screenId} status=${pr.status} conv=${target.conversationId}`);
    return posted;
  } catch (err) {
    log.warn(`[pr-card] xyne-ai render failed for ${screenId}: ${errMsg(err)}`);
    return null;
  }
}
