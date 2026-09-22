/**
 * Outbound side of the messaging core.
 *
 * Anything that wants to send to a channel account — the /webhook/result
 * handler, the agent's own tools, dispatch-failure notes — ENQUEUES an item into the
 * account's Redis outbox. Only the pod that owns the account's lease drains
 * that outbox (account-manager.ts) and talks to the plugin. That keeps the
 * "which pod has the socket" question in exactly one place and lets a reply
 * survive a failover instead of being lost.
 */
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { redisService } from "../../redis.js";
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { FAILURE_TEXT, OUTBOX_TTL_S, REDIS_PREFIX } from "./const.js";
import { chunkText } from "./format.js";
import { fitCard, renderCardAsText } from "./cards.js";
import type { AnyChannelPlugin, ChannelDeliveryTarget, InteractiveCard, MessageRef } from "./plugin.js";

const log = createLogger("channel-delivery");

/** The claw result-payload attachment shape (base64 bytes). */
export interface OutboxAttachment {
  fileName: string;
  mimeType: string;
  data: string;
}

export type OutboxItem =
  | { kind: "text"; chatId: string; text: string; quoted?: MessageRef; markdown?: boolean; mentions?: string[] }
  | { kind: "resolve-target"; target: string }
  | { kind: "list-groups" }
  | { kind: "result"; chatId: string; status: string; result: string; attachments?: OutboxAttachment[]; quoted?: MessageRef }
  | { kind: "typing"; chatId: string; on: boolean; messageId?: string }
  | { kind: "react"; ref: MessageRef; emoji: string }
  | { kind: "card"; chatId: string; card: InteractiveCard; quoted?: MessageRef };

/** An outbox item that wants its outcome back (agent tool calls). */
export type OutboxRequest = OutboxItem & { replyKey?: string };

export type OutboxReply =
  | { ok: true; ref?: MessageRef; targetId?: string; groups?: Array<{ id: string; name: string; participants: number }> }
  | { ok: false; error: string };

export function outboxKey(accountId: string): string {
  return `${REDIS_PREFIX}:outbox:${accountId}`;
}

const REPLY_TTL_S = 60;

/**
 * Enqueue and wait for the owning pod to execute the item. Tool calls need
 * the messenger's answer (was it sent? what is the group id?), so the owner
 * pushes an OutboxReply onto a one-shot reply list we block on here. A
 * dedicated connection is used because BLPOP blocks it.
 */
export async function enqueueAndWait(accountId: string, item: OutboxItem, timeoutMs = 20_000): Promise<OutboxReply> {
  const replyKey = `${REDIS_PREFIX}:reply:${accountId}:${randomUUID()}`;
  const request: OutboxRequest = { ...item, replyKey };
  const key = outboxKey(accountId);
  await redis().multi().lpush(key, JSON.stringify(request)).expire(key, OUTBOX_TTL_S).exec();
  const waiter = redis().duplicate();
  try {
    const popped = await waiter.blpop(replyKey, Math.ceil(timeoutMs / 1000));
    if (!popped) return { ok: false, error: "No pod is running this account right now (timed out waiting for delivery)" };
    return JSON.parse(popped[1]) as OutboxReply;
  } finally {
    await waiter.quit().catch(() => undefined);
    await redis().del(replyKey).catch(() => undefined);
  }
}

export async function postOutboxReply(replyKey: string, reply: OutboxReply): Promise<void> {
  await redis().multi().lpush(replyKey, JSON.stringify(reply)).expire(replyKey, REPLY_TTL_S).exec();
}

function redis(): Redis {
  return redisService.getConnection();
}

export async function enqueueOutbound(accountId: string, item: OutboxItem): Promise<void> {
  const key = outboxKey(accountId);
  await redis().multi().lpush(key, JSON.stringify(item)).expire(key, OUTBOX_TTL_S).exec();
}

/** Terminal result of a run → the originating chat. Called by /webhook/result. */
export async function deliverChannelResult(input: {
  target: ChannelDeliveryTarget;
  status: string;
  result: string;
  attachments?: OutboxAttachment[];
}): Promise<void> {
  await enqueueOutbound(input.target.connectedSurfaceId, {
    kind: "result",
    chatId: input.target.chatId,
    status: input.status,
    result: input.result,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.target.quoted ? { quoted: input.target.quoted } : {}),
  });
}

/**
 * Execute one outbox item against a live plugin handle. Owner pod only.
 * Never throws for a bad item — a poison message must not wedge the drain
 * loop — but does throw on transport errors so the caller can re-queue.
 * Returns the outcome so request/reply callers get it back.
 */
export async function sendOutbound(plugin: AnyChannelPlugin, handle: unknown, item: OutboxItem): Promise<OutboxReply> {
  const caps = plugin.capabilities;
  switch (item.kind) {
    case "typing":
      if (plugin.setTyping && caps.typing) {
        await plugin.setTyping(handle, item.chatId, item.on, {
          ...(item.messageId ? { messageId: item.messageId } : {}),
        });
      }
      return { ok: true };
    case "react":
      if (!plugin.react || !caps.reactions) return { ok: false, error: "reactions are not supported on this channel" };
      await plugin.react(handle, item.ref, item.emoji);
      return { ok: true };
    case "resolve-target": {
      if (!plugin.resolveTarget) return { ok: false, error: "target resolution is not supported on this channel" };
      const targetId = await plugin.resolveTarget(handle, item.target);
      return targetId ? { ok: true, targetId } : { ok: false, error: `Could not resolve "${item.target}" to a chat` };
    }
    case "list-groups": {
      if (!plugin.listGroups) return { ok: false, error: "group listing is not supported on this channel" };
      return { ok: true, groups: await plugin.listGroups(handle) };
    }
    case "card": {
      // Native where the messenger has cards, words where it does not. The
      // fallback is not a degraded path: the numbered menu it produces is
      // matched back to the same parked options (cards.ts).
      const limits = caps.interactive;
      if (plugin.sendInteractive && limits) {
        const ref = await plugin.sendInteractive(handle, item.chatId, fitCard(item.card, limits), {
          ...(item.quoted ? { quoted: item.quoted } : {}),
        });
        return { ok: true, ref };
      }
      const rendered = renderCardAsText(item.card);
      const ref = await sendChunked(plugin, handle, item.chatId, rendered, item.quoted);
      return ref ? { ok: true, ref } : { ok: true };
    }
    case "text": {
      const text = item.markdown === false ? item.text : (plugin.formatText?.(item.text) ?? item.text);
      const ref = await sendChunked(plugin, handle, item.chatId, text, item.quoted, item.mentions);
      return ref ? { ok: true, ref } : { ok: true };
    }
    case "result": {
      const completed = item.status === "completed";
      const text = completed
        ? (plugin.formatText?.(item.result || "The run completed without a response.") ??
          (item.result || "The run completed without a response."))
        : FAILURE_TEXT;
      try {
        await sendChunked(plugin, handle, item.chatId, text, item.quoted);
        if (completed && item.attachments?.length) await sendAttachments(plugin, handle, item.chatId, item.attachments);
      } finally {
        if (plugin.setTyping && caps.typing) await plugin.setTyping(handle, item.chatId, false).catch(() => undefined);
      }
      return { ok: true };
    }
  }
}

async function sendChunked(
  plugin: AnyChannelPlugin,
  handle: unknown,
  chatId: string,
  text: string,
  quoted?: MessageRef,
  mentions?: string[],
): Promise<MessageRef | null> {
  const chunks = chunkText(text, plugin.capabilities.maxTextChars);
  let first = true;
  let firstRef: MessageRef | null = null;
  for (const chunk of chunks) {
    const ref = await plugin.sendText(handle, chatId, chunk, {
      ...(first && quoted ? { quoted } : {}),
      ...(mentions?.length ? { mentions } : {}),
    });
    if (first) firstRef = ref;
    first = false;
  }
  return firstRef;
}

async function sendAttachments(
  plugin: AnyChannelPlugin,
  handle: unknown,
  chatId: string,
  attachments: OutboxAttachment[],
): Promise<void> {
  const caps = plugin.capabilities;
  if (!plugin.sendMedia || !caps.media) {
    await plugin.sendText(handle, chatId, `📎 ${attachments.length} attachment(s) could not be sent on this channel.`);
    return;
  }
  const skipped: string[] = [];
  for (const attachment of attachments) {
    try {
      const data = Buffer.from(attachment.data, "base64");
      const isImage = attachment.mimeType.startsWith("image/");
      const cap = isImage ? (caps.maxImageBytes ?? caps.maxFileBytes) : caps.maxFileBytes;
      if (data.length === 0 || (cap !== undefined && data.length > cap)) {
        skipped.push(attachment.fileName);
        continue;
      }
      await plugin.sendMedia(handle, chatId, { fileName: attachment.fileName, mimeType: attachment.mimeType, data });
    } catch (err) {
      // Per-file isolation: one bad attachment must not sink the rest.
      log.warn(`[channel-delivery] attachment send failed`, { fileName: attachment.fileName, error: errMsg(err) });
      skipped.push(attachment.fileName);
    }
  }
  if (skipped.length > 0) {
    await plugin
      .sendText(handle, chatId, `⚠️ Could not send: ${skipped.join(", ")} (too large or unsupported).`)
      .catch(() => undefined);
  }
}
