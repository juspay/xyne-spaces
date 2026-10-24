import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { decryptStoredField, spacesAppFetch } from "../surfaces/spaces/client.js";
import { errMsg } from "./errors.js";
import { notice, pluralize } from "./notice-format.js";
import { QUEUE_CAP, type EnqueueResult, type QueuedMessage } from "./message-queue.js";
import { twinScopedKey } from "./twin-scope.js";

const log = createLogger("queue-notice");

const NOTICE_TTL_SEC = Number(process.env["CLAW_MSG_QUEUE_NOTICE_TTL_SEC"] ?? String(24 * 60 * 60));

export interface QueueNoticeScope {
  conversationId: string;
  agentSlug: string;
  twinUserScopeId?: string | undefined;
}

export interface QueueNoticeTarget extends QueueNoticeScope {
  channelId: string;
  orgId?: string | null | undefined;
  spacesAppUserId: string;
  appToken: string;
}

interface QueueNoticeRef {
  messageId: string;
  channelId: string;
  orgId?: string;
  spacesAppUserId: string;
}

export type QueueNoticeEvent =
  | { kind: "queued"; depth: number; interrupted?: boolean; rejected?: "full" | "failed" }
  | { kind: "drained" }
  | { kind: "cleared"; discarded: number };

const noticeKey = (scope: QueueNoticeScope): string =>
  twinScopedKey(`claw:mq:notice:${scope.conversationId}:${scope.agentSlug}`, scope.agentSlug, scope.twinUserScopeId);

export function queueNoticeText(event: QueueNoticeEvent): string {
  if (event.kind === "drained") return notice("Queue done.", "Every queued message has been picked up.");
  if (event.kind === "cleared") {
    return event.discarded > 0
      ? notice("Queue cleared.", `${pluralize(event.discarded, "queued message")} will not be answered.`)
      : notice("Queue cleared.");
  }
  const lines: string[] = [];
  if (event.depth > 0) {
    lines.push(
      event.interrupted
        ? `**Queued (${event.depth}).** Finishing the current reply first, then I'll pick ${event.depth === 1 ? "it" : "them"} up in order.`
        : `**Queued (${event.depth}).** I'll reply to ${event.depth === 1 ? "it" : "each one, in order,"} as soon as the current reply is done.`,
    );
  }
  if (event.rejected === "full") {
    lines.push(`Your latest message was not queued: this thread's queue is full at ${QUEUE_CAP}. Please resend it once I've caught up.`);
  } else if (event.rejected === "failed") {
    lines.push("Your latest message could not be queued. Please resend it in a moment.");
  }
  return lines.map((line) => `_${line}_`).join("\n\n");
}

export function queueEventFor(enq: EnqueueResult, interrupted: boolean): QueueNoticeEvent {
  if (enq.enqueued || enq.deduped) return { kind: "queued", depth: enq.position, interrupted };
  return { kind: "queued", depth: enq.position, rejected: enq.full ? "full" : "failed" };
}

export function droppedNoticeText(count: number, reason: string): string {
  return notice(
    count === 1 ? "A queued message was dropped." : `${count} queued messages were dropped.`,
    `${reason} Please resend ${count === 1 ? "it" : "them"}.`,
  );
}

async function readRef(scope: QueueNoticeScope): Promise<QueueNoticeRef | null> {
  try {
    const raw = await redisService.getConnection().get(noticeKey(scope));
    return raw ? (JSON.parse(raw) as QueueNoticeRef) : null;
  } catch (err) {
    log.warn("readRef failed", { conversationId: scope.conversationId, agentSlug: scope.agentSlug, error: errMsg(err) });
    return null;
  }
}

async function writeRef(scope: QueueNoticeScope, ref: QueueNoticeRef): Promise<void> {
  await redisService.getConnection().set(noticeKey(scope), JSON.stringify(ref), "EX", NOTICE_TTL_SEC).catch((err: unknown) => {
    log.warn("writeRef failed", { conversationId: scope.conversationId, agentSlug: scope.agentSlug, error: errMsg(err) });
  });
}

async function dropRef(scope: QueueNoticeScope): Promise<void> {
  await redisService.getConnection().del(noticeKey(scope)).catch(() => {});
}

async function postNotice(target: QueueNoticeTarget, markdownText: string): Promise<string | undefined> {
  const resp = (await spacesAppFetch(
    "/chat/postMessage",
    {
      channelId: target.channelId,
      conversationId: target.conversationId,
      markdownText,
      userId: target.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    },
    target.appToken,
  )) as { messageId?: string; data?: { messageId?: string } } | null;
  return resp?.messageId ?? resp?.data?.messageId;
}

async function editNotice(ref: QueueNoticeRef, appToken: string, markdownText: string): Promise<void> {
  await spacesAppFetch(
    "/chat/updateMessage",
    {
      messageId: ref.messageId,
      channelId: ref.channelId,
      markdownText,
      userId: ref.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    },
    appToken,
  );
}

async function agentAppToken(orgId: string | null | undefined, agentSlug: string): Promise<string | null> {
  if (!orgId) return null;
  const agent = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId, slug: agentSlug } },
    select: { spacesAppToken: true },
  });
  return agent?.spacesAppToken ? decryptStoredField(agent.spacesAppToken) : null;
}

export async function publishQueueNotice(target: QueueNoticeTarget, event: QueueNoticeEvent): Promise<void> {
  const text = queueNoticeText(event);
  const closing = event.kind !== "queued";
  const ref = await readRef(target);
  try {
    if (ref) {
      try {
        await editNotice(ref, target.appToken, text);
        if (closing) await dropRef(target);
        return;
      } catch (err) {
        log.warn("edit failed, posting a fresh notice", { conversationId: target.conversationId, error: errMsg(err) });
        await dropRef(target);
      }
    }
    if (closing) return;
    const messageId = await postNotice(target, text);
    if (messageId) {
      await writeRef(target, {
        messageId,
        channelId: target.channelId,
        spacesAppUserId: target.spacesAppUserId,
        ...(target.orgId ? { orgId: target.orgId } : {}),
      });
    }
  } catch (err) {
    log.warn("publishQueueNotice failed", { conversationId: target.conversationId, agentSlug: target.agentSlug, error: errMsg(err) });
  }
}

export async function refreshQueueNotice(scope: QueueNoticeScope, event: QueueNoticeEvent): Promise<void> {
  const ref = await readRef(scope);
  if (!ref) return;
  try {
    const appToken = await agentAppToken(ref.orgId, scope.agentSlug);
    if (!appToken) return;
    await editNotice(ref, appToken, queueNoticeText(event));
  } catch (err) {
    log.warn("refreshQueueNotice failed", { conversationId: scope.conversationId, agentSlug: scope.agentSlug, error: errMsg(err) });
    await dropRef(scope);
    return;
  }
  if (event.kind !== "queued") await dropRef(scope);
}

export async function postDroppedNotice(target: QueueNoticeTarget, count: number, reason: string): Promise<void> {
  if (count <= 0) return;
  try {
    await postNotice(target, droppedNoticeText(count, reason));
  } catch (err) {
    log.warn("postDroppedNotice failed", { conversationId: target.conversationId, agentSlug: target.agentSlug, error: errMsg(err) });
  }
}

export async function queueNoticeTargetFor(msg: QueuedMessage): Promise<QueueNoticeTarget | null> {
  const scope = { conversationId: msg.conversationId, agentSlug: msg.agentSlug, twinUserScopeId: msg.twinUserScopeId };
  const ctx = msg.sessionContext as { appToken?: unknown; spacesAppUserId?: unknown } | undefined;
  if (typeof ctx?.appToken === "string" && typeof ctx.spacesAppUserId === "string") {
    return { ...scope, channelId: msg.channelId, orgId: msg.orgId, spacesAppUserId: ctx.spacesAppUserId, appToken: ctx.appToken };
  }
  if (!msg.orgId) return null;
  try {
    const agent = await prisma.agent.findUnique({
      where: { orgId_slug: { orgId: msg.orgId, slug: msg.agentSlug } },
      select: { spacesAppToken: true, spacesAppUserId: true },
    });
    if (!agent?.spacesAppToken || !agent.spacesAppUserId) return null;
    return {
      ...scope,
      channelId: msg.channelId,
      orgId: msg.orgId,
      spacesAppUserId: agent.spacesAppUserId,
      appToken: decryptStoredField(agent.spacesAppToken),
    };
  } catch (err) {
    log.warn("queueNoticeTargetFor failed", { conversationId: msg.conversationId, agentSlug: msg.agentSlug, error: errMsg(err) });
    return null;
  }
}
