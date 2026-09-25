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
import { DONE_REACTION, EMPTY_RESULT_TEXT, ERROR_REACTION, FAILURE_TEXT, OUTBOX_TTL_S, REDIS_PREFIX, TYPING_COUNT_TTL_S } from "./const.js";
import { forgetActiveRun } from "./commands.js";
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
  | {
      kind: "result";
      chatId: string;
      status: string;
      result: string;
      attachments?: OutboxAttachment[];
      quoted?: MessageRef;
      /** Swap the ack reaction for an outcome one on the way out. */
      statusReactions?: boolean;
      /** False while another run is still working in this chat. */
      stopTyping?: boolean;
    }
  | { kind: "typing"; chatId: string; on: boolean; messageId?: string }
  | { kind: "react"; ref: MessageRef; emoji: string }
  | { kind: "card"; chatId: string; card: InteractiveCard; quoted?: MessageRef };

/** How much of a multi-part send already landed. A long reply goes out as
 *  several messages; if the third fails, re-sending from the first would
 *  deliver the first two twice. */
export interface OutboxProgress {
  chunks: number;
  attachments: number;
}

/** Thrown when a send failed partway, carrying what did land so the retry can
 *  pick up where it stopped. */
export class PartialSendError extends Error {
  constructor(
    message: string,
    readonly progress: OutboxProgress,
  ) {
    super(message);
    this.name = "PartialSendError";
  }
}

/** An outbox item that wants its outcome back (agent tool calls). */
export type OutboxRequest = OutboxItem & { replyKey?: string; __progress?: OutboxProgress };

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
/** BLPOP holds its connection for the whole wait, so a waiter cannot be the
 *  shared client. Keeping a few idle ones costs almost nothing and saves a
 *  full TCP connect and auth on every agent tool call. */
const waiterPool: Redis[] = [];
const MAX_IDLE_WAITERS = 4;

function takeWaiter(): Redis {
  return waiterPool.pop() ?? redis().duplicate();
}

function releaseWaiter(waiter: Redis, healthy: boolean): void {
  // A connection that just errored is not worth handing to the next caller.
  if (!healthy || waiterPool.length >= MAX_IDLE_WAITERS) {
    void waiter.quit().catch(() => undefined);
    return;
  }
  waiterPool.push(waiter);
}

export async function enqueueAndWait(accountId: string, item: OutboxItem, timeoutMs = 20_000): Promise<OutboxReply> {
  const replyKey = `${REDIS_PREFIX}:reply:${accountId}:${randomUUID()}`;
  const request: OutboxRequest = { ...item, replyKey };
  const key = outboxKey(accountId);
  await redis().multi().lpush(key, JSON.stringify(request)).expire(key, OUTBOX_TTL_S).exec();
  const waiter = takeWaiter();
  let healthy = true;
  try {
    const popped = await waiter.blpop(replyKey, Math.ceil(timeoutMs / 1000));
    if (!popped) return { ok: false, error: "No pod is running this account right now (timed out waiting for delivery)" };
    return JSON.parse(popped[1]) as OutboxReply;
  } catch (err) {
    healthy = false;
    throw err;
  } finally {
    releaseWaiter(waiter, healthy);
    await redis().del(replyKey).catch(() => undefined);
  }
}

/** Close pooled waiters on shutdown so the process can exit. */
export async function closeOutboxWaiters(): Promise<void> {
  const pooled = waiterPool.splice(0, waiterPool.length);
  await Promise.all(pooled.map((waiter) => waiter.quit().catch(() => undefined)));
}

export async function postOutboxReply(replyKey: string, reply: OutboxReply): Promise<void> {
  await redis().multi().lpush(replyKey, JSON.stringify(reply)).expire(replyKey, REPLY_TTL_S).exec();
}

function redis(): Redis {
  return redisService.getConnection();
}

/**
 * How many runs are working in one chat.
 *
 * The indicator is per chat, but runs are not: two messages close together
 * produce two runs, and the first to finish used to switch typing off while
 * the second was still working — so it stopped, and nothing turned it back
 * on. Counting means the last one out turns off the light.
 *
 * Best-effort and TTL-bounded: a lost result must not pin a number typing,
 * so a stale counter expires rather than leaking.
 */
function typingKey(accountId: string, chatId: string): string {
  return `${REDIS_PREFIX}:typing:${accountId}:${chatId}`;
}

export async function typingStarted(accountId: string, chatId: string): Promise<void> {
  try {
    const key = typingKey(accountId, chatId);
    await redis().multi().incr(key).expire(key, TYPING_COUNT_TTL_S).exec();
  } catch {
    // A counter we cannot keep just means we fall back to stopping eagerly.
  }
}

/** True when this was the last run working here, so typing may stop. */
export async function typingFinished(accountId: string, chatId: string): Promise<boolean> {
  try {
    const key = typingKey(accountId, chatId);
    const left = await redis().decr(key);
    if (left <= 0) {
      await redis().del(key).catch(() => undefined);
      return true;
    }
    return false;
  } catch {
    // Redis down: stop typing rather than risk leaving it on forever.
    return true;
  }
}

/** Forget the count outright — /stop means stop, whatever else is running. */
export async function typingCancelled(accountId: string, chatId: string): Promise<void> {
  await redis()
    .del(typingKey(accountId, chatId))
    .catch(() => undefined);
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
    ...(input.target.statusReactions ? { statusReactions: true } : {}),
    stopTyping: await typingFinished(input.target.connectedSurfaceId, input.target.chatId),
  });
  // Whatever happened, nothing is running here any more.
  await forgetActiveRun(input.target.connectedSurfaceId, input.target.chatId);
}

/**
 * Execute one outbox item against a live plugin handle. Owner pod only.
 * Never throws for a bad item — a poison message must not wedge the drain
 * loop — but does throw on transport errors so the caller can re-queue.
 * Returns the outcome so request/reply callers get it back.
 */
export async function sendOutbound(
  plugin: AnyChannelPlugin,
  handle: unknown,
  item: OutboxItem,
  resume?: OutboxProgress,
): Promise<OutboxReply> {
  const caps = plugin.capabilities;
  // Mutated as parts land, so a failure can say how far it got.
  const sent: OutboxProgress = { chunks: resume?.chunks ?? 0, attachments: resume?.attachments ?? 0 };
  try {
    return await sendItem(plugin, handle, item, sent);
  } catch (err) {
    if (sent.chunks > (resume?.chunks ?? 0) || sent.attachments > (resume?.attachments ?? 0)) {
      throw new PartialSendError(errMsg(err), sent);
    }
    throw err;
  }
}

async function sendItem(
  plugin: AnyChannelPlugin,
  handle: unknown,
  item: OutboxItem,
  sent: OutboxProgress,
): Promise<OutboxReply> {
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
      const ref = await sendChunked(plugin, handle, item.chatId, text, item.quoted, item.mentions, sent);
      return ref ? { ok: true, ref } : { ok: true };
    }
    case "result": {
      const completed = item.status === "completed";
      // A completed run with no text is not the same as a failed one, and
      // saying so out loud matters: without this line an empty answer looks
      // exactly like a delivery that never happened. It means the model
      // finished its turn without writing anything — usually after working
      // out an answer it then did not say.
      if (completed && !item.result.trim()) {
        log.warn(`[channel-delivery] completed run produced no text chat=${item.chatId}`);
      }
      // Files with no words are still an answer — saying "I didn't come back
      // with anything" over the top of them would be wrong.
      const silentWithFiles = completed && !item.result.trim() && !!item.attachments?.length;
      const body = completed ? item.result.trim() || EMPTY_RESULT_TEXT : FAILURE_TEXT;
      const text = plugin.formatText?.(body) ?? body;
      try {
        // The outcome reaction first: it replaces the 👀 that has been sitting
        // there since the run started, so it should land with the answer
        // rather than after however long the text takes to chunk out.
        if (item.statusReactions && item.quoted && plugin.react && caps.reactions) {
          await plugin
            .react(handle, item.quoted, completed ? DONE_REACTION : ERROR_REACTION)
            .catch((err) => log.warn(`[channel-delivery] status reaction failed: ${errMsg(err)}`));
        }
        if (!silentWithFiles) await sendChunked(plugin, handle, item.chatId, text, item.quoted, undefined, sent);
        if (completed && item.attachments?.length) await sendAttachments(plugin, handle, item.chatId, item.attachments, sent);
      } finally {
        // Another run is still working here — leaving the indicator alone is
        // the whole point of the count.
        if (item.stopTyping !== false && plugin.setTyping && caps.typing) {
          await plugin.setTyping(handle, item.chatId, false).catch(() => undefined);
        }
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
  sent?: OutboxProgress,
): Promise<MessageRef | null> {
  const chunks = chunkText(text, plugin.capabilities.maxTextChars);
  const already = sent?.chunks ?? 0;
  let firstRef: MessageRef | null = null;
  for (let i = 0; i < chunks.length; i++) {
    // Already delivered on an earlier attempt — skipping is the whole point.
    if (i < already) continue;
    const first = i === 0;
    const ref = await plugin.sendText(handle, chatId, chunks[i]!, {
      ...(first && quoted ? { quoted } : {}),
      ...(mentions?.length ? { mentions } : {}),
    });
    if (first) firstRef = ref;
    if (sent) sent.chunks = i + 1;
  }
  return firstRef;
}

/** Meta's wording when an upload's MIME type is not on its allowlist. */
const UNSUPPORTED_TYPE_RE = /file of type|one of the following types/i;

async function sendAttachments(
  plugin: AnyChannelPlugin,
  handle: unknown,
  chatId: string,
  attachments: OutboxAttachment[],
  sent?: OutboxProgress,
): Promise<void> {
  const caps = plugin.capabilities;
  if (!plugin.sendMedia || !caps.media) {
    await plugin.sendText(handle, chatId, `📎 ${attachments.length} attachment(s) could not be sent on this channel.`);
    return;
  }
  const already = sent?.attachments ?? 0;
  const skipped: string[] = [];
  const empty: string[] = [];
  const wrongType: string[] = [];
  const failed: string[] = [];
  for (const [index, attachment] of attachments.entries()) {
    if (index < already) continue;
    try {
      // Buffer.from never throws on bad base64 — it just returns something
      // short or empty. So a file that arrived without its bytes looks
      // identical to one that was never encoded, and both used to be reported
      // as "too large", which sent people looking for a size problem that was
      // not there.
      const data = Buffer.from(attachment.data ?? "", "base64");
      const isImage = attachment.mimeType.startsWith("image/");
      const cap = isImage ? (caps.maxImageBytes ?? caps.maxFileBytes) : caps.maxFileBytes;
      if (data.length === 0) {
        log.warn(
          `[channel-delivery] attachment arrived with no bytes`,
          { fileName: attachment.fileName, mimeType: attachment.mimeType, encodedChars: attachment.data?.length ?? 0 },
        );
        empty.push(attachment.fileName);
        if (sent) sent.attachments = index + 1;
        continue;
      }
      if (cap !== undefined && data.length > cap) {
        log.warn(
          `[channel-delivery] attachment over the channel cap`,
          { fileName: attachment.fileName, bytes: data.length, cap },
        );
        skipped.push(attachment.fileName);
        if (sent) sent.attachments = index + 1;
        continue;
      }
      await plugin.sendMedia(handle, chatId, { fileName: attachment.fileName, mimeType: attachment.mimeType, data });
      if (sent) sent.attachments = index + 1;
    } catch (err) {
      // Per-file isolation: one bad attachment must not sink the rest.
      const error = errMsg(err);
      log.warn(`[channel-delivery] attachment send failed`, { fileName: attachment.fileName, error });
      (UNSUPPORTED_TYPE_RE.test(error) ? wrongType : failed).push(attachment.fileName);
    }
  }
  if (skipped.length > 0) {
    await plugin
      .sendText(handle, chatId, `⚠️ Too large to send here: ${skipped.join(", ")}.`)
      .catch(() => undefined);
  }
  if (wrongType.length > 0) {
    await plugin
      .sendText(handle, chatId, `⚠️ This chat doesn't accept that file type, so I couldn't send: ${wrongType.join(", ")}.`)
      .catch(() => undefined);
  }
  if (failed.length > 0) {
    await plugin
      .sendText(handle, chatId, `⚠️ Couldn't send: ${failed.join(", ")}.`)
      .catch(() => undefined);
  }
  if (empty.length > 0) {
    // Says what is true — the file came through empty — rather than blaming a
    // size limit it never reached.
    await plugin
      .sendText(handle, chatId, `⚠️ ${empty.join(", ")} came through empty, so there was nothing to send.`)
      .catch(() => undefined);
  }
}
