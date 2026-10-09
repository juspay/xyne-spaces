import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { claimOrQueue } from "../../lib/conversation-gate.js";
import { attachSlotSession, releaseSlot } from "../../lib/message-queue.js";
import { rememberActiveRun, rememberChatTarget } from "./commands.js";
import { enqueueOutbound, typingFinished, typingStarted } from "./delivery.js";
import { buildChannelRun, postChannelRun, type ChannelRunInput } from "./dispatch.js";
import { channelConversationId } from "./ids.js";
import { getChannel, type ChannelDeliveryTarget } from "./plugin.js";
import { findDefaultAgent, findOrgAgentBySlug, getAccount, toChannelAccount } from "./store.js";

const log = createLogger("messaging-busy");

export const LOCKED_NOTICE = "⚠️ I was still finishing your previous message and couldn't start this one. Please send it again.";

export type ChannelDispatchOutcome =
  | { kind: "dispatched"; sessionId: string }
  | { kind: "queued"; accepted: boolean; notice: string };

export async function dispatchOrQueueChannelRun(input: ChannelRunInput): Promise<ChannelDispatchOutcome> {
  const run = await buildChannelRun(input);
  // Anything that later only knows the conversation (an /experiment epoch, an
  // /eval arm, a /goal turn) finds its way back to this chat through this.
  await rememberChatTarget(input.conversationId, input.target);
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
    ...(input.explicitQueueOnly ? { explicitQueueOnly: true } : {}),
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

/**
 * Start a run in a chat without a new message from the person — the agent
 * picking the conversation back up after something it was waiting on
 * happened elsewhere (a connector sign-in finishing in the browser). Same
 * dispatch, typing and busy rules as a message would get.
 */
export async function continueInChat(input: {
  target: ChannelDeliveryTarget;
  userId: string;
  agentSlug?: string;
  task: string;
  idempotencyKey: string;
}): Promise<void> {
  const { target } = input;
  const row = await getAccount(target.connectedSurfaceId);
  if (!row || row.status !== "ACTIVE") return;
  const account = toChannelAccount(row);
  const agent = input.agentSlug
    ? await findOrgAgentBySlug(input.agentSlug, account.orgId)
    : ((await findDefaultAgent(account, account.surfaceId))?.agent ?? null);
  if (!agent || !agent.enabled) return;
  const plugin = getChannel(account.channel);
  if (plugin?.capabilities.typing) {
    await typingStarted(account.id, target.chatId);
    await enqueueOutbound(account.id, {
      kind: "typing",
      chatId: target.chatId,
      on: true,
      ...(target.quoted?.messageId ? { messageId: target.quoted.messageId } : {}),
    });
  }
  const outcome = await dispatchOrQueueChannelRun({
    agent,
    userId: input.userId,
    task: input.task,
    conversationId: channelConversationId(account.channel, account.accountKey, agent.slug, target.chatId),
    eventType: target.isGroup ? "APP_MENTIONED" : "DIRECT_MESSAGE",
    idempotencyKey: `${account.channel}:${account.id}:${input.idempotencyKey}`,
    target,
  });
  if (outcome.kind === "queued") {
    await enqueueOutbound(account.id, { kind: "text", chatId: target.chatId, text: outcome.notice });
    return;
  }
  await rememberActiveRun(account.id, target.chatId, { sessionId: outcome.sessionId, agentSlug: agent.slug, startedAt: Date.now() });
  log.info(`[busy] continued in chat session=${outcome.sessionId} agent=${agent.slug} account=${account.id}`);
}

/**
 * The next turn of a /goal loop, dispatched straight away: the turn that just
 * finished still owns the conversation's slot (the result handler keeps it
 * while a goal continues), so this must not queue behind it.
 */
export async function dispatchGoalTurn(input: {
  target: ChannelDeliveryTarget;
  userId: string;
  agentSlug: string;
  task: string;
  idempotencyKey: string;
}): Promise<string | null> {
  const { target } = input;
  const row = await getAccount(target.connectedSurfaceId);
  if (!row || row.status !== "ACTIVE") return null;
  const account = toChannelAccount(row);
  const agent = await findOrgAgentBySlug(input.agentSlug, account.orgId);
  if (!agent || !agent.enabled) return null;
  const conversationId = channelConversationId(account.channel, account.accountKey, agent.slug, target.chatId);
  const sessionId = await postChannelRun(
    await buildChannelRun({
      agent,
      userId: input.userId,
      task: input.task,
      conversationId,
      eventType: target.isGroup ? "APP_MENTIONED" : "DIRECT_MESSAGE",
      idempotencyKey: `${account.channel}:${account.id}:${input.idempotencyKey}`,
      target,
    }),
  );
  await attachSlotSession(conversationId, agent.slug, sessionId).catch(() => undefined);
  await rememberActiveRun(account.id, target.chatId, { sessionId, agentSlug: agent.slug, startedAt: Date.now() });
  if (getChannel(account.channel)?.capabilities.typing) {
    await typingStarted(account.id, target.chatId);
    await enqueueOutbound(account.id, {
      kind: "typing",
      chatId: target.chatId,
      on: true,
      ...(target.quoted?.messageId ? { messageId: target.quoted.messageId } : {}),
    });
  }
  return sessionId;
}

