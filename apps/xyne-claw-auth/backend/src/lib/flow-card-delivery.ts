import type { FlowDefinition } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { chatMessageRepository } from "../repositories/chatMessageRepository.js";
import { errMsg } from "./errors.js";
import { publishLiveEvent } from "./live-conversation-bus.js";
import { spacesAppFetch } from "../surfaces/spaces/client.js";

const log = createLogger("flow-card");

export interface SpacesCardTarget {
  kind: "spaces";
  channelId: string;
  conversationId: string | undefined;
  spacesAppUserId: string | undefined;
  appToken: string;
}

export interface XyneAiCardTarget {
  kind: "xyne-ai";
  chatMessageId: string;
  conversationId: string;
  agentSlug: string;
  userId: string;
  orgId: string;
  spacesAppId: string | undefined;
}

export type FlowCardTarget = SpacesCardTarget | XyneAiCardTarget;

const ASSISTANT_ROW_SELECT = {
  id: true,
  conversationId: true,
  agentSlug: true,
  userId: true,
  orgId: true,
} as const;

export async function resolveXyneAiCardTarget(input: {
  assistantMessageId?: string | null | undefined;
  conversationId?: string | null | undefined;
  agentSlug?: string | null | undefined;
}): Promise<XyneAiCardTarget | null> {
  let row: { id: string; conversationId: string; agentSlug: string; userId: string; orgId: string } | null = null;

  if (input.assistantMessageId) {
    row = await prisma.chatMessage
      .findUnique({ where: { id: input.assistantMessageId }, select: ASSISTANT_ROW_SELECT })
      .catch(() => null);
  }

  if (!row && input.conversationId && input.agentSlug) {
    row = await prisma.chatMessage
      .findFirst({
        where: {
          conversationId: input.conversationId,
          agentSlug: input.agentSlug,
          role: "assistant",
          status: "running",
        },
        orderBy: { createdAt: "desc" },
        select: ASSISTANT_ROW_SELECT,
      })
      .catch(() => null);
  }
  if (!row) return null;


  const agent = await prisma.agent
    .findFirst({ where: { slug: row.agentSlug, orgId: row.orgId }, select: { spacesAppId: true } })
    .catch(() => null);

  return {
    kind: "xyne-ai",
    chatMessageId: row.id,
    conversationId: row.conversationId,
    agentSlug: row.agentSlug,
    userId: row.userId,
    orgId: row.orgId,
    spacesAppId: agent?.spacesAppId ?? undefined,
  };
}

function withXyneAiCardData(flow: FlowDefinition, target: XyneAiCardTarget): FlowDefinition {
  return {
    ...flow,
    data: {
      ...(flow.data ?? {}),
      surface: "xyne-ai",
      chatMessageId: target.chatMessageId,
      ...(target.spacesAppId ? { spacesAppId: target.spacesAppId } : {}),
    },
  };
}

export async function deliverXyneAiFlow(
  flow: FlowDefinition,
  target: XyneAiCardTarget,
): Promise<FlowDefinition> {
  const stamped = withXyneAiCardData(flow, target);
  const persisted = await chatMessageRepository.appendUiFlow(target.chatMessageId, stamped).then(
    () => true,
    (err: unknown) => {
      log.warn(`[xyne-ai] persist failed for ${stamped.screenId}: ${errMsg(err)}`);
      return false;
    },
  );
  // The success counterpart to the warns above — without it a delivered card
  // leaves no trace, so "N cards painted on /ai" cannot be counted.
  if (persisted) {
    log.info(`[xyne-ai] card delivered screen=${stamped.screenId} conv=${target.conversationId} agent=${target.agentSlug}`);
  }
  if (CONFIG.liveToolCallsEnabled && target.userId) {
    publishLiveEvent(target.conversationId, {
      type: "ui-flow",
      conversationId: target.conversationId,
      agentSlug: target.agentSlug,
      userId: target.userId,
      flow: stamped,
      ts: Date.now(),
    });
  }
  return stamped;
}

/** No-channel counterpart to Spaces' `/chat/updateMessage`. `chatMessageId`
 *  arrives inside the card the client sent back, so the row is re-checked
 *  against the acting user before anything is written. */
export async function replaceFlowCardOnRow(input: {
  chatMessageId: string;
  screenId: string;
  flow: FlowDefinition;
  userId: string;
}): Promise<boolean> {
  const row = await prisma.chatMessage
    .findUnique({
      where: { id: input.chatMessageId },
      select: { id: true, userId: true, conversationId: true, agentSlug: true },
    })
    .catch(() => null);
  if (!row || row.userId !== input.userId) {
    log.warn(`[xyne-ai] card replace refused for message ${input.chatMessageId}`);
    return false;
  }

  const replaced = await chatMessageRepository
    .replaceUiFlow(row.id, input.screenId, input.flow)
    .catch((err: unknown) => {
      log.warn(`[xyne-ai] card replace failed for ${input.screenId}: ${errMsg(err)}`);
      return false;
    });
  if (!replaced) return false;

  if (CONFIG.liveToolCallsEnabled) {
    publishLiveEvent(row.conversationId, {
      type: "ui-flow",
      conversationId: row.conversationId,
      agentSlug: row.agentSlug,
      userId: row.userId,
      flow: input.flow,
      ts: Date.now(),
    });
  }
  return true;
}

/**
 * The one delivery seam for FlowUI cards. The Spaces branch is the pre-existing
 * `/chat/postMessage` call, through the same client webhook.ts posts with, so a
 * card still retries once on a Spaces 5xx; the Xyne AI branch goes through
 * uiFlows.
 */
export async function postFlowCard(
  flow: FlowDefinition,
  target: FlowCardTarget,
): Promise<FlowDefinition> {
  if (target.kind === "xyne-ai") {
    // The stamped copy — the caller emits THIS on the run stream so the client
    // gets the same card the row holds.
    return deliverXyneAiFlow(flow, target);
  }
  await spacesAppFetch(
    "/chat/postMessage",
    {
      channelId: target.channelId,
      ...(target.conversationId !== undefined ? { conversationId: target.conversationId } : {}),
      flow,
      userId: target.spacesAppUserId,
    },
    target.appToken,
  );
  return flow;
}
