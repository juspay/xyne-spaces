import { buildTicketProposalFlow, buildWriteApprovalFlow, type FlowDefinition } from "xyne-claw-shared";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { postFlowCard, type XyneAiCardTarget } from "./flow-card-delivery.js";

const log = createLogger("write-card");

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

/** Tickets rendered in full inside the bulk approval card. The rest are
 *  summarised by count — every ticket in `params` is still created on approve,
 *  since the executed payload comes from the HMAC-signed action, not the card. */
const BULK_TICKETS_CARD_LIMIT = 25;

export function formatActionDescription(tool: string, params: Record<string, unknown>, options?: { channelName?: string }): string {
  if (tool === "user-send-message") {
    const content = (params["content"] as string ?? "").slice(0, 300);
    const conversationId = params["conversationId"] as string | undefined;
    const channelId = params["channelId"] as string | undefined;
    const lines = [`**Send Message as You**`, ``];
    if (channelId) {
      lines.push(`**Destination:** post NEW message to #${options?.channelName ?? channelId}`);
    } else if (conversationId) {
      lines.push(`**Destination:** reply in existing thread ${conversationId}`);
    }
    if (content) lines.push(``, `**Message:** ${content}${(params["content"] as string ?? "").length > 300 ? "..." : ""}`);
    return lines.join("\n");
  }

  if (tool === "spaces-create-ticket") {
    const title = params["title"] as string ?? "";
    const desc = (params["description"] as string ?? "").slice(0, 300);
    const lines = [`**Create Ticket**`, ``, `**Title:** ${title}`];
    if (desc) lines.push(`**Description:** ${desc}${(params["description"] as string ?? "").length > 300 ? "..." : ""}`);
    return lines.join("\n");
  }

  if (tool === "spaces-create-bulk-tickets") {
    const tickets = Array.isArray(params["tickets"]) ? params["tickets"] as Array<Record<string, unknown>> : [];
    const lines = [
      `**Create ${tickets.length} Tickets**`,
      ``,
      `**Project/Board/Channel:** ${String(params["projectId"] ?? "")} / ${String(params["boardId"] ?? "")} / ${options?.channelName ? `#${options.channelName}` : String(params["channelId"] ?? "")}`,
      ``,
    ];
    // Everything the approver needs lives in THIS card — no companion file
    // upload. Same shape as spaces-create-ticket above (title + trimmed
    // description), repeated per ticket. The card body scrolls past 280px
    // (buildWriteApprovalFlow), so a long batch stays readable in-thread.
    tickets.slice(0, BULK_TICKETS_CARD_LIMIT).forEach((ticket, index) => {
      const title = String(ticket["title"] ?? "(untitled)");
      const priority = String(ticket["priority"] ?? params["defaultPriority"] ?? "");
      const assignee = String(ticket["assignedTo"] ?? params["defaultAssignedTo"] ?? "");
      const tags = Array.isArray(ticket["tags"]) ? (ticket["tags"] as unknown[]).join(", ") : "";
      const rawDesc = String(ticket["description"] ?? "");
      const desc = rawDesc.slice(0, 200);
      const meta = [priority, assignee && `→ ${assignee}`, tags && `[${tags}]`].filter(Boolean).join(" · ");
      lines.push(`**${index + 1}. ${title}**${meta ? ` — ${meta}` : ""}`);
      if (desc) lines.push(`${desc}${rawDesc.length > 200 ? "…" : ""}`);
      lines.push(``);
    });
    if (tickets.length > BULK_TICKETS_CARD_LIMIT) {
      lines.push(`_…and ${tickets.length - BULK_TICKETS_CARD_LIMIT} more — all ${tickets.length} are created on approve._`);
    }
    return lines.join("\n");
  }

  if (tool === "spaces-update-bulk-tickets") {
    const tickets = Array.isArray(params["tickets"]) ? params["tickets"] as Array<Record<string, unknown>> : [];
    const lines = [`**Update ${tickets.length} Tickets**`, ``];

    const defaults: string[] = [];
    if (params["defaultStatus"]) defaults.push(`status \u2192 ${String(params["defaultStatus"])}`);
    if (params["defaultStage"]) defaults.push(`stage \u2192 ${String(params["defaultStage"])}`);
    if (params["defaultPriority"]) defaults.push(`priority \u2192 ${String(params["defaultPriority"])}`);
    if (params["defaultAssigneeId"]) defaults.push(`assignee \u2192 ${String(params["defaultAssigneeId"])}`);
    if (Array.isArray(params["defaultTags"]) && (params["defaultTags"] as unknown[]).length) {
      defaults.push(`tags [${(params["defaultTags"] as unknown[]).join(", ")}]`);
    }
    if (defaults.length) lines.push(`**Defaults:** ${defaults.join(" \u00b7 ")}`, ``);

    tickets.slice(0, BULK_TICKETS_CARD_LIMIT).forEach((ticket, index) => {
      const ticketId = String(ticket["ticketId"] ?? "(no id)");
      const changes: string[] = [];
      const status = ticket["status"] ?? params["defaultStatus"];
      const stage = ticket["stage"] ?? params["defaultStage"];
      const priority = ticket["priority"] ?? params["defaultPriority"];
      const assignee = ticket["assigneeId"] ?? params["defaultAssigneeId"];
      if (status) changes.push(`status \u2192 ${String(status)}`);
      if (stage) changes.push(`stage \u2192 ${String(stage)}`);
      if (priority) changes.push(`priority \u2192 ${String(priority)}`);
      if (assignee) changes.push(`assignee \u2192 ${String(assignee)}`);
      if (ticket["title"]) changes.push(`title`);
      if (ticket["description"]) changes.push(`description`);
      if (ticket["eta"]) changes.push(`eta \u2192 ${String(ticket["eta"])}`);
      if (Array.isArray(ticket["tags"]) || Array.isArray(params["defaultTags"])) changes.push(`tags`);
      lines.push(`**${index + 1}. ${ticketId}**${changes.length ? ` \u2014 ${changes.join(" \u00b7 ")}` : ""}`);
    });
    if (tickets.length > BULK_TICKETS_CARD_LIMIT) {
      lines.push(``, `_\u2026and ${tickets.length - BULK_TICKETS_CARD_LIMIT} more \u2014 all ${tickets.length} are updated on approve._`);
    }
    return lines.join("\n");
  }

  if (tool === "spaces-schedule-call") {
    const title = params["title"] as string ?? "Call";
    const startsAt = params["startsAt"] as string ?? "";
    const endsAt = params["endsAt"] as string ?? "";
    const lines = [`**Schedule Call**`, ``, `**Title:** ${title}`];
    if (startsAt) lines.push(`**Starts:** ${new Date(startsAt).toLocaleString()}`);
    if (endsAt) lines.push(`**Ends:** ${new Date(endsAt).toLocaleString()}`);
    return lines.join("\n");
  }

  if (tool === "spaces-memory-create") {
    const docType = (params["docType"] as string ?? "fact").toUpperCase();
    const query = params["query"] as string ?? "";
    const tags = params["tags"] as string[] ?? [];
    const lines = [`**Save to Knowledge Base (${docType})**`];
    if (query) lines.push(``, `**Summary:** ${query}`);
    if (tags.length > 0) lines.push(`**Tags:** ${tags.join(", ")}`);
    lines.push(``, `_See attached file for full content._`);
    return lines.join("\n");
  }

  if (tool === "create-skill") {
    const name = (params["name"] as string) ?? "";
    const slug = (params["slug"] as string) ?? "";
    const description = (params["description"] as string) ?? "";
    const content = (params["content"] as string) ?? "";
    const lines = [`**Create Skill**`, ``, `**Name:** ${name}`];
    if (slug) lines.push(`**Slug:** \`${slug}\``);
    if (description) lines.push(`**Description:** ${description}`);
    lines.push(``, `**Content (${content.length} chars):**`, "```md", content.slice(0, 1500) + (content.length > 1500 ? "\n…(truncated)" : ""), "```");
    return lines.join("\n");
  }

  // Fallback for unknown tools
  const entries = Object.entries(params).filter(([, v]) => v != null).slice(0, 8);
  const lines = [`**${tool}**`, ``];
  for (const [key, value] of entries) {
    const val = typeof value === "string" ? value.slice(0, 200) : JSON.stringify(value).slice(0, 200);
    lines.push(`**${key}:** ${val}`);
  }
  return lines.join("\n");
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

/** `usedTicketCard` tells the Spaces caller whether a flow-schema rejection can
 *  be retried with generic components. */
export function buildWriteApprovalCardFlow(
  action: WriteCardAction,
  actionDesc: string,
): { flow: FlowDefinition; usedTicketCard: boolean } {
  const ticket = buildTicketProposalCardFlow(action);
  return ticket
    ? { flow: ticket, usedTicketCard: true }
    : { flow: buildWriteApprovalFlow(actionDesc, action), usedTicketCard: false };
}

/** Null is the fail-safe: no card, so the client suppresses nothing and the
 *  pending action stays approvable where it already is. */
export async function renderXyneAiWriteApprovalCard(args: {
  action: PendingWriteAction;
  target: XyneAiCardTarget;
}): Promise<FlowDefinition | null> {
  const { action, target } = args;

  let cardAction: WriteCardAction;
  try {
    cardAction = await mintWriteCardAction(action, {
      agentSlug: target.agentSlug,
      spacesAppId: target.spacesAppId ?? "",
      conversationId: target.conversationId,
    });
  } catch (err) {
    log.warn(`[write-card] xyne-ai card not minted: ${errMsg(err)}`);
    return null;
  }

  const { flow } = buildWriteApprovalCardFlow(
    cardAction,
    formatActionDescription(cardAction.tool, cardAction.params),
  );
  const posted = await postFlowCard(
    { ...flow, data: { ...(flow.data ?? {}), pendingSignature: cardAction.pendingSignature } },
    target,
  );
  log.info(`[write-card] posted ${cardAction.tool} approval card conv=${target.conversationId}`);
  return posted;
}
