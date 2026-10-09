/**
 * The concurrent, threaded inbound path for WhatsApp. Gated by the plugin's
 * `concurrentThreads` capability and the per-account threads flag; every other
 * surface, and WhatsApp with the flag off, keeps the one-at-a-time path in
 * inbound.ts untouched.
 *
 * It does what the serial path cannot: run several LINKED tasks in one chat at
 * once (each its own conversation id ⇒ its own session and busy slot), relate
 * them through a shared per-chat state the planner fills, and route a
 * quote-reply back to the task it answers.
 */
import { randomUUID } from "node:crypto";
import { createLogger } from "../../../logger.js";
import { errMsg } from "../../../lib/errors.js";
import { dispatchOrQueueChannelRun } from "../busy.js";
import { taskConversationId } from "../ids.js";
import { rememberActiveRun } from "../commands.js";
import { enqueueOutbound } from "../delivery.js";
import type {
  AnyChannelPlugin,
  ChannelAccount,
  ChannelDeliveryTarget,
  InboundAttachment,
  InboundMessage,
} from "../plugin.js";
import type { BoundAgent } from "../store.js";
import { loadChatState, mergeChatState, renderStateBlock } from "./state.js";
import { createTask, openTasks, taskForReply, type ChatTask } from "./registry.js";
import { planInbound } from "./planner.js";

const log = createLogger("channel-threads");

export interface ThreadedInboundArgs {
  plugin: AnyChannelPlugin;
  account: ChannelAccount;
  agent: BoundAgent;
  userId: string;
  msg: InboundMessage;
  /** The resolved request text (transcript / caption / typed), no context. */
  rawTask: string;
  /** Group overheard lines, prepended to each dispatch as today. */
  contextBlock: string;
  /** The base delivery target built by inbound.ts (chat, quoted = this msg). */
  target: ChannelDeliveryTarget;
  attachments?: InboundAttachment[];
  senderName?: string;
}

/** Spread extra requests over at most `n` buckets so nothing is dropped when a
 *  message asks for more than the per-chat concurrency cap allows. */
function bucket(requests: string[], n: number): string[] {
  if (requests.length <= n) return requests;
  const out = requests.slice(0, n);
  for (let i = n; i < requests.length; i++) out[i % n] = `${out[i % n]}\n\nAlso: ${requests[i]}`;
  return out;
}

export async function handleThreaded(args: ThreadedInboundArgs): Promise<{ accepted: boolean }> {
  const { plugin, account, agent, userId, msg, rawTask, contextBlock, target } = args;
  const accountId = account.id;
  const chatId = msg.chatId;

  // 1. A quote-reply to one of our messages continues that task's conversation.
  if (msg.replyToSelf) {
    const existing = await taskForReply(accountId, chatId, msg.replyToMessageId);
    if (existing) {
      const accepted = await dispatchTask(args, existing.conversationId, existing.label, rawTask);
      return { accepted };
    }
  }

  // 2. Plan the message into one or more linked tasks and update shared state.
  const state = await loadChatState(accountId, chatId);
  const open = await openTasks(accountId, chatId);
  const plan = await planInbound(rawTask, state, open);
  const merged = Object.keys(plan.slots).length ? await mergeChatState(accountId, chatId, plan.slots) : state;
  const stateBlock = renderStateBlock(merged);

  const cap = plugin.capabilities.concurrentThreads?.maxParallel ?? 1;

  const continues = plan.actions.filter((a) => a.continueIndex !== null && open[a.continueIndex! - 1]);
  const fresh = bucket(
    plan.actions.filter((a) => !(a.continueIndex !== null && open[a.continueIndex! - 1])).map((a) => a.request),
    Math.max(1, cap),
  );
  const freshLabels = plan.actions
    .filter((a) => !(a.continueIndex !== null && open[a.continueIndex! - 1]))
    .map((a) => a.label);

  let accepted = false;

  for (const action of continues) {
    const task = open[action.continueIndex! - 1]!;
    const request = `${stateBlock}${contextBlock}${action.request}`;
    if (await dispatchTask(args, task.conversationId, task.label, request)) accepted = true;
  }

  for (let i = 0; i < fresh.length; i++) {
    const taskId = randomUUID();
    const conversationId = taskConversationId(account.channel, account.accountKey, agent.slug, chatId, taskId);
    const label = (freshLabels[i] ?? "request").slice(0, 40);
    await createTask(accountId, chatId, {
      conversationId,
      agentSlug: agent.slug,
      label,
      originMessageId: msg.messageId,
      createdAt: Date.now(),
    });
    const request = `${stateBlock}${contextBlock}${fresh[i]!}`;
    if (await dispatchTask(args, conversationId, label, request)) accepted = true;
  }

  return { accepted };
}

async function dispatchTask(
  args: ThreadedInboundArgs,
  conversationId: string,
  label: string,
  task: string,
): Promise<boolean> {
  const { account, agent, userId, msg, target } = args;
  const taskTarget: ChannelDeliveryTarget = { ...target, conversationId, quoted: msg.ref };
  try {
    const outcome = await dispatchOrQueueChannelRun({
      agent,
      userId,
      task,
      conversationId,
      eventType: msg.isGroup ? "APP_MENTIONED" : "DIRECT_MESSAGE",
      idempotencyKey: `${account.channel}:${account.id}:${msg.messageId}:${conversationId}`,
      ...(args.senderName ? { senderName: args.senderName } : {}),
      ...(args.attachments?.length ? { attachments: args.attachments } : {}),
      target: taskTarget,
    });
    if (outcome.kind === "queued") {
      if (outcome.accepted) {
        log.info(`[threads] queued behind active task=${label} conv=${conversationId} account=${account.id}`);
        return true;
      }
      await enqueueOutbound(account.id, { kind: "text", chatId: msg.chatId, text: outcome.notice, quoted: msg.ref });
      return false;
    }
    await rememberActiveRun(account.id, msg.chatId, {
      sessionId: outcome.sessionId,
      agentSlug: agent.slug,
      startedAt: Date.now(),
    });
    log.info(`[threads] dispatched task=${label} session=${outcome.sessionId} conv=${conversationId} account=${account.id}`);
    return true;
  } catch (err) {
    log.error(`[threads] dispatch failed task=${label} conv=${conversationId} account=${account.id}: ${errMsg(err)}`);
    await enqueueOutbound(account.id, {
      kind: "text",
      chatId: msg.chatId,
      text: "Something went wrong handing this to the agent — please try again.",
      quoted: msg.ref,
    });
    return false;
  }
}
