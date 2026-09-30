import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { claimOrQueue } from "../../lib/conversation-gate.js";
import { attachSlotSession, releaseSlot } from "../../lib/message-queue.js";
import { enqueueOutbound, typingFinished } from "./delivery.js";
import { buildChannelRun, postChannelRun, type ChannelRunInput } from "./dispatch.js";
import type { ChannelDeliveryTarget } from "./plugin.js";

const log = createLogger("messaging-busy");

export const LOCKED_NOTICE = "⚠️ I was still finishing your previous message and couldn't start this one. Please send it again.";

export type ChannelDispatchOutcome =
  | { kind: "dispatched"; sessionId: string }
  | { kind: "queued"; accepted: boolean; notice: string };

export async function dispatchOrQueueChannelRun(input: ChannelRunInput): Promise<ChannelDispatchOutcome> {
  const run = await buildChannelRun(input);
  const gate = await claimOrQueue({
    message: {
      eventId: input.idempotencyKey,
      conversationId: input.conversationId,
      channelId: input.target.chatId,
      userId: input.userId,
      ...(input.senderName ? { senderName: input.senderName } : {}),
      agentSlug: input.agent.slug,
      orgId: input.agent.orgId,
      task: input.task,
      eventType: input.eventType,
      responseMode: "conversation",
      dispatchPayload: run.body,
      sessionContext: run.sessionContext as unknown as Record<string, unknown>,
    },
    place: "chat",
  });
  if (gate.kind === "queued") return { kind: "queued", accepted: gate.accepted, notice: gate.notice };
  let sessionId: string;
  try {
    sessionId = await postChannelRun(run);
  } catch (err) {
    await handOnSlot(input.conversationId, input.agent.slug, gate.slotToken);
    throw err;
  }
  await attachSlotSession(input.conversationId, input.agent.slug, sessionId);
  return { kind: "dispatched", sessionId };
}

export async function notifyChannelRunLocked(target: ChannelDeliveryTarget): Promise<void> {
  await enqueueOutbound(target.connectedSurfaceId, {
    kind: "result",
    chatId: target.chatId,
    status: "completed",
    result: LOCKED_NOTICE,
    ...(target.quoted ? { quoted: target.quoted } : {}),
    stopTyping: await typingFinished(target.connectedSurfaceId, target.chatId),
  });
}

async function handOnSlot(conversationId: string, agentSlug: string, slotToken: string): Promise<void> {
  try {
    const { drainNextQueued } = await import("../../routes/webhook.js");
    await drainNextQueued(conversationId, agentSlug, slotToken);
  } catch (err) {
    log.warn(`[busy] drain after failed dispatch failed conv=${conversationId}: ${errMsg(err)}`);
    await releaseSlot(conversationId, agentSlug, slotToken).catch(() => undefined);
  }
}
