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
import { chunkText, stripCitationMarkup } from "./format.js";
import { fitCard, renderCardAsText } from "./cards.js";
import type { AnyChannelPlugin, ChannelDeliveryTarget, FormMessage, InteractiveCard, MessageRef, MessageTemplate } from "./plugin.js";

const log = createLogger("channel-delivery");

/** The claw result-payload attachment shape (base64 bytes). */
export interface OutboxAttachment {
  fileName: string;
  mimeType: string;
  data: string;
}

export type OutboxItem =
  | {
      kind: "text";
      chatId: string;
      text: string;
      quoted?: MessageRef;
      markdown?: boolean;
      mentions?: string[];
      /** Send this instead when the reply window has closed (notifications
       *  can land days after the person last wrote). */
      template?: MessageTemplate;
      /** What the template carries, when it should differ from `text` (no
       *  files follow a template, so a "see the PDF" line must not either). */
      templateText?: string;
    }
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
  | { kind: "card"; chatId: string; card: InteractiveCard; quoted?: MessageRef }
  /** One file on its own, outside a run result (a long code block or diff
   *  a widget turned into a document). */
  | { kind: "file"; chatId: string; attachment: OutboxAttachment; caption?: string }
  | { kind: "form"; chatId: string; form: FormMessage };

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
  | {
      ok: true;
      ref?: MessageRef;
      targetId?: string;
      groups?: Array<{ id: string; name: string; participants: number }>;
      /** The text went out as the account's template, not as written. */
      viaTemplate?: boolean;
    }
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
      // Best-effort: an indicator that cannot be shown is never worth a retry
      // loop, and must not hold up the message queued behind it.
      if (plugin.setTyping && caps.typing) {
        await plugin
          .setTyping(handle, item.chatId, item.on, { ...(item.messageId ? { messageId: item.messageId } : {}) })
          .catch((err) => log.warn(`[channel-delivery] typing ${item.on ? "on" : "off"} failed chat=${item.chatId}: ${errMsg(err)}`));
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
      // The body is the one card field shown as formatted text.
      const card = { ...item.card, body: outboundText(plugin, item.card.body) };
      if (plugin.sendInteractive && limits) {
        const ref = await plugin.sendInteractive(handle, item.chatId, fitCard(card, limits), {
          ...(item.quoted ? { quoted: item.quoted } : {}),
        });
        return { ok: true, ref };
      }
      const rendered = renderCardAsText(card);
      const ref = await sendChunked(plugin, handle, item.chatId, rendered, item.quoted);
      return ref ? { ok: true, ref } : { ok: true };
    }
    case "form": {
      if (!plugin.sendForm) return { ok: false, error: "forms are not supported on this channel" };
      return { ok: true, ref: await plugin.sendForm(handle, item.chatId, item.form) };
    }
    case "file": {
      if (item.caption) await sendChunked(plugin, handle, item.chatId, plugin.formatText?.(item.caption) ?? item.caption);
      await sendAttachments(plugin, handle, item.chatId, [item.attachment]);
      return { ok: true };
    }
    case "text": {
      const text = item.markdown === false ? item.text : outboundText(plugin, item.text);
      try {
        const ref = await sendChunked(plugin, handle, item.chatId, text, item.quoted, item.mentions, sent);
        return ref ? { ok: true, ref } : { ok: true };
      } catch (err) {
        // Nothing landed and the window is shut: the template is the only
        // way through. Anything else (or a half-sent message) is a real error.
        if (sent.chunks > 0 || !item.template || !plugin.sendTemplate || !plugin.isReplyWindowClosed?.(err)) throw err;
        log.info(`[channel-delivery] reply window closed chat=${item.chatId}; sending template ${item.template.name}`);
        const ref = await plugin.sendTemplate(handle, item.chatId, item.template, [templateParam(item.templateText ?? item.text)]);
        return { ok: true, ref, viaTemplate: true };
      }
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
      // An answer that would arrive as a wall of messages becomes its opening
      // lines plus the whole thing as a PDF.
      const long = completed && caps.media && plugin.sendMedia ? await asLeadAndDocument(body).catch(() => null) : null;
      const text = outboundText(plugin, long?.text ?? body);
      const files = [...(long ? [long.document] : []), ...(completed ? (item.attachments ?? []) : [])];
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
        if (files.length) await sendAttachments(plugin, handle, item.chatId, files, sent);
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

/** Past this an answer reads as a wall on a phone (several screens of text). */
export const LONG_ANSWER_CHARS = 2_000;
const LEAD_CHARS = 500;

/**
 * A too-long answer as its opening paragraphs plus the full text as a PDF —
 * the agent is asked to do this itself (the channel's send-document tool), so
 * this is the backstop for when it does not. Null when the answer is short.
 */
export async function asLeadAndDocument(
  markdown: string,
  title = "Full answer",
): Promise<{ text: string; document: OutboxAttachment } | null> {
  if (markdown.length <= LONG_ANSWER_CHARS) return null;
  const clean = stripCitationMarkup(markdown);
  let lead = "";
  for (const paragraph of clean.split(/\n{2,}/)) {
    if (lead && lead.length + paragraph.length > LEAD_CHARS) break;
    lead = lead ? `${lead}\n\n${paragraph}` : paragraph;
  }
  if (lead.length > LEAD_CHARS * 1.5) lead = `${lead.slice(0, LEAD_CHARS)}…`;
  const { renderMarkdownToPdf } = await import("../../lib/result-pdf.js");
  const pdf = await renderMarkdownToPdf(clean, { title });
  return {
    text: `${lead}\n\nThe full version is in the PDF.`,
    document: { fileName: `${title.replace(/\s+/g, "-").toLowerCase()}.pdf`, mimeType: "application/pdf", data: pdf.toString("base64") },
  };
}

/** What every agent-written message goes through on its way out: citation
 *  markup no messenger can render is dropped, then the plugin's dialect. */
function outboundText(plugin: AnyChannelPlugin, markdown: string): string {
  const clean = stripCitationMarkup(markdown);
  return plugin.formatText?.(clean) ?? clean;
}

/** A template body parameter may not hold newlines, tabs or runs of spaces,
 *  and is capped well under the body limit. */
export function templateParam(text: string): string {
  const flat = stripCitationMarkup(text)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\s*\n+\s*/g, " · ")
    .replace(/\t/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
  return flat.length <= 900 ? flat : `${flat.slice(0, 899)}…`;
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
    await plugin.sendText(handle, chatId, `${attachments.length} attachment(s) could not be sent on this channel.`);
    return;
  }
  const already = sent?.attachments ?? 0;
  const skipped: string[] = [];
  const empty: string[] = [];
  const wrongType: string[] = [];
  const failed: string[] = [];
  const linked: Array<{ name: string; url: string }> = [];
  /** A file the messenger refuses (type or size) is still the answer: park
   *  it and send a link. False when even that fails. */
  const linkInstead = async (attachment: OutboxAttachment, data: Buffer): Promise<boolean> => {
    try {
      const { hostFile } = await import("./hosted-files.js");
      const url = await hostFile({ channel: plugin.key, fileName: attachment.fileName, mimeType: attachment.mimeType, data });
      linked.push({ name: attachment.fileName, url });
      return true;
    } catch (err) {
      log.warn(`[channel-delivery] could not host ${attachment.fileName}: ${errMsg(err)}`);
      return false;
    }
  };
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
      const refusedType = plugin.acceptsFile?.(attachment.mimeType) === false;
      if (refusedType || (cap !== undefined && data.length > cap)) {
        log.info(
          `[channel-delivery] attachment sent as a link`,
          { fileName: attachment.fileName, mimeType: attachment.mimeType, bytes: data.length, cap },
        );
        if (!(await linkInstead(attachment, data))) (refusedType ? wrongType : skipped).push(attachment.fileName);
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
  if (linked.length > 0) {
    const lines = linked.map((file) => `${file.name}: ${file.url}`);
    await plugin
      .sendText(
        handle,
        chatId,
        `${linked.length === 1 ? "This one opens" : "These open"} in your browser (links work for 7 days):\n${lines.join("\n")}`,
      )
      .catch(() => undefined);
  }
  if (skipped.length > 0) {
    await plugin
      .sendText(handle, chatId, `Too large to send here: ${skipped.join(", ")}.`)
      .catch(() => undefined);
  }
  if (wrongType.length > 0) {
    await plugin
      .sendText(handle, chatId, `This chat doesn't accept that file type, so I couldn't send: ${wrongType.join(", ")}.`)
      .catch(() => undefined);
  }
  if (failed.length > 0) {
    await plugin
      .sendText(handle, chatId, `Couldn't send: ${failed.join(", ")}.`)
      .catch(() => undefined);
  }
  if (empty.length > 0) {
    // Says what is true — the file came through empty — rather than blaming a
    // size limit it never reached.
    await plugin
      .sendText(handle, chatId, `${empty.join(", ")} came through empty, so there was nothing to send.`)
      .catch(() => undefined);
  }
}
