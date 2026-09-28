import { buildTicketProposalFlow, type FlowDefinition } from "xyne-claw-shared";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { postFlowCard, type XyneAiCardTarget } from "./flow-card-delivery.js";

const log = createLogger("ticket-card");

type TicketCardPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
const TICKET_CARD_PRIORITIES: TicketCardPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** The signed write action claw returns on a run result. */
export interface PendingWriteAction {
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  signature: string;
}

/** Routing the card is bound to. Empty strings give absent fields one form. */
export interface WriteCardIdentity {
  agentSlug: string;
  spacesAppId: string;
  channelId?: string | undefined;
  conversationId?: string | undefined;
}

export interface WriteCardAction {
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  signature: string;
  agentSlug: string;
  channelId?: string;
  conversationId?: string;
  /** Claw's original signature — how a surface that also renders raw pending
   *  actions knows which one this card stands in for. */
  pendingSignature: string;
}

export function readPendingWriteAction(raw: unknown): PendingWriteAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const serverType = typeof r["serverType"] === "string" ? r["serverType"] : "";
  const tool = typeof r["tool"] === "string" ? r["tool"] : "";
  const userId = typeof r["userId"] === "string" ? r["userId"] : "";
  const signature = typeof r["signature"] === "string" ? r["signature"] : "";
  if (!serverType || !tool || !userId || !signature) return null;
  return {
    serverType,
    tool,
    params: r["params"] && typeof r["params"] === "object" ? (r["params"] as Record<string, unknown>) : {},
    userId,
    signature,
  };
}

/** Binds the trusted session agent to the signature, so the card cannot be
 *  replayed with another org's app credentials. */
export async function mintWriteCardAction(
  action: PendingWriteAction,
  id: WriteCardIdentity,
): Promise<WriteCardAction> {
  const { signAction, verifyActionSignature } = await import("../routes/mcp.js");
  const pendingActionPayload = {
    serverType: action.serverType,
    tool: action.tool,
    params: action.params,
    userId: action.userId,
  };
  if (!verifyActionSignature(pendingActionPayload, action.signature)) {
    throw new Error("Invalid pending write-action signature");
  }
  return {
    ...pendingActionPayload,
    signature: signAction({
      ...pendingActionPayload,
      agentSlug: id.agentSlug,
      spacesAppId: id.spacesAppId,
    }),
    agentSlug: id.agentSlug,
    ...(id.channelId !== undefined ? { channelId: id.channelId } : {}),
    ...(id.conversationId !== undefined ? { conversationId: id.conversationId } : {}),
    pendingSignature: action.signature,
  };
}

/** Null for any other write tool, and for a ticket with no title — both keep
 *  the generic approval card. */
export function buildTicketProposalCardFlow(action: WriteCardAction): FlowDefinition | null {
  if (action.tool !== "spaces-create-ticket") return null;
  const rawTitle = action.params["title"];
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (!title) return null;
  const priority = action.params["priority"];
  const eta = action.params["eta"];
  const assignedTo = action.params["assignedTo"];
  return buildTicketProposalFlow(
    {
      title,
      ...(TICKET_CARD_PRIORITIES.includes(priority as TicketCardPriority)
        ? { priority: priority as TicketCardPriority }
        : {}),
      ...(typeof eta === "string" && eta ? { eta } : {}),
      ...(typeof assignedTo === "string" && assignedTo ? { assigneeId: assignedTo } : {}),
    },
    action,
  );
}

/** Ticket approval card for a surface with no channel. Null is the fail-safe:
 *  no card, so the client suppresses nothing. */
export async function renderXyneAiTicketProposalCard(args: {
  action: PendingWriteAction;
  target: XyneAiCardTarget;
}): Promise<FlowDefinition | null> {
  const { action, target } = args;
  if (action.tool !== "spaces-create-ticket") return null;

  let cardAction: WriteCardAction;
  try {
    cardAction = await mintWriteCardAction(action, {
      agentSlug: target.agentSlug,
      spacesAppId: target.spacesAppId ?? "",
      conversationId: target.conversationId,
    });
  } catch (err) {
    log.warn(`[ticket-card] xyne-ai card not minted: ${errMsg(err)}`);
    return null;
  }

  const flow = buildTicketProposalCardFlow(cardAction);
  if (!flow) return null;

  const posted = await postFlowCard(
    { ...flow, data: { ...(flow.data ?? {}), pendingSignature: cardAction.pendingSignature } },
    target,
  );
  log.info(`[ticket-card] posted ticket proposal card conv=${target.conversationId}`);
  return posted;
}
