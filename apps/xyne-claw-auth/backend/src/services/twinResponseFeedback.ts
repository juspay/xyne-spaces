/**
 * Digital Twin response feedback — the DEFERRED learning loop.
 *
 * When the Twin proposes a response (the approve/decline DM), we record a
 * `pending` TwinResponseFeedback row. On approve/decline we update it; if the
 * user never acts, the daily job reconciles it to `ignored`. The daily job then
 * distils the DECIDED-but-unlearned rows into the twin's memory (via the same
 * curator the message pipeline uses) — so the twin learns which of its drafts
 * got accepted as-is, edited, declined, or ignored.
 *
 * This replaces the old fire-and-forget `learnFromTwinReply` that ran on EVERY
 * accept (too eager, and it fired the moment the user approved).
 */

import { prisma } from "../db.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import type { UserMemoryRecord, TwinDelivery } from "xyne-claw-shared";

const log = createLogger("twin-response-feedback");

/** Cap on how much of each part we feed the curator (mirrors the message path). */
const MAX_PART_CHARS = 650;
/** A pending proposal older than this with no action is treated as "ignored". */
const IGNORE_GRACE_MS = 12 * 60 * 60 * 1000;
/** Safety cap on rows distilled per user per daily run. */
const MAX_FEEDBACK_PER_RUN = 200;

export type TwinApprovalDecision = "accepted" | "accepted_edited" | "declined";

/**
 * Write the `pending` row when the approval DM is sent. Create-only: a retry
 * (same sourceMessageId) must not clobber a row the user already decided.
 * Skipped when we have no stable sourceMessageId — without it we can't reconcile
 * an "ignored" outcome later, so a pending row would be un-resolvable.
 */
export async function recordTwinApprovalPending(row: {
  userId: string;
  conversationId: string;
  channelId?: string;
  channelName?: string;
  sourceMessageId?: string;
  incomingTask?: string;
  delivery: TwinDelivery;
}): Promise<void> {
  if (!row.userId || !row.sourceMessageId) return;
  try {
    await prisma.twinResponseFeedback.upsert({
      where: { userId_sourceMessageId: { userId: row.userId, sourceMessageId: row.sourceMessageId } },
      update: {}, // never overwrite an existing (possibly already-decided) row
      create: {
        userId: row.userId,
        conversationId: row.conversationId,
        channelId: row.channelId ?? null,
        channelName: row.channelName ?? null,
        sourceMessageId: row.sourceMessageId,
        incomingTask: row.incomingTask ? row.incomingTask.slice(0, 2000) : null,
        deliveryAction: row.delivery.action,
        deliveryEmoji: row.delivery.emoji ?? null,
        destinationKind: row.delivery.destination?.kind ?? "origin_thread",
        draftMessage: row.delivery.message ? row.delivery.message.slice(0, 4000) : null,
        status: "pending",
      },
    });
  } catch (err) {
    log.warn("[twin-feedback] pending write failed", {
      userId: row.userId,
      sourceMessageId: row.sourceMessageId,
      err: errMsg(err),
    });
  }
}

/**
 * Record the user's accept/decline of a proposed response, from the flow.data of
 * the approval card. Updates the pending row (upsert as a backstop if the pending
 * write was missed). Fire-and-forget from the flow-action handler.
 */
export async function recordTwinApprovalOutcome(
  data: Record<string, unknown>,
  status: TwinApprovalDecision,
  finalMessage?: string,
): Promise<void> {
  const userId = typeof data["mentionedUserId"] === "string" ? (data["mentionedUserId"] as string) : "";
  if (!userId) return;
  const sourceMessageId = typeof data["sourceMessageId"] === "string" ? (data["sourceMessageId"] as string) : "";
  const conversationId = typeof data["targetConversationId"] === "string" ? (data["targetConversationId"] as string) : "";
  const now = new Date();
  const decided = {
    status,
    decidedAt: now,
    ...(finalMessage ? { finalMessage: finalMessage.slice(0, 4000) } : {}),
  };
  try {
    if (sourceMessageId) {
      await prisma.twinResponseFeedback.upsert({
        where: { userId_sourceMessageId: { userId, sourceMessageId } },
        update: decided,
        create: {
          userId,
          conversationId,
          channelId: (data["targetChannelId"] as string | undefined) ?? null,
          channelName: (data["channelName"] as string | undefined) ?? null,
          sourceMessageId,
          incomingTask: typeof data["incomingTask"] === "string" ? (data["incomingTask"] as string).slice(0, 2000) : null,
          deliveryAction: (data["deliveryAction"] as string | undefined) ?? "reply",
          deliveryEmoji: (data["deliveryEmoji"] as string | undefined) ?? null,
          destinationKind: (data["destinationKind"] as string | undefined) ?? null,
          draftMessage: typeof data["messageContent"] === "string" ? (data["messageContent"] as string).slice(0, 4000) : null,
          ...decided,
        },
      });
    } else {
      await prisma.twinResponseFeedback.create({
        data: {
          userId,
          conversationId,
          deliveryAction: (data["deliveryAction"] as string | undefined) ?? "reply",
          draftMessage: typeof data["messageContent"] === "string" ? (data["messageContent"] as string).slice(0, 4000) : null,
          ...decided,
        },
      });
    }
    log.info("[twin-feedback] recorded outcome", { userId, sourceMessageId: sourceMessageId || "(none)", status });
  } catch (err) {
    log.warn("[twin-feedback] outcome write failed", {
      userId,
      sourceMessageId: sourceMessageId || "(none)",
      status,
      err: errMsg(err),
    });
  }
}

/** Render one feedback row into a curator record. The text spells out the
 *  outcome so the curator can distil "what got accepted vs edited vs declined vs
 *  ignored" without any prompt change. Exported for unit tests. */
export function renderTwinFeedbackRecord(row: {
  id: string;
  channelId: string | null;
  channelName: string | null;
  incomingTask: string | null;
  deliveryAction: string;
  deliveryEmoji: string | null;
  draftMessage: string | null;
  finalMessage: string | null;
  status: string;
  decidedAt: Date | null;
}): UserMemoryRecord {
  const where = row.channelName ? ` in #${row.channelName}` : "";
  const incoming = (row.incomingTask ?? "").slice(0, MAX_PART_CHARS);
  const draft = (row.draftMessage ?? "").slice(0, MAX_PART_CHARS);
  const final = (row.finalMessage ?? "").slice(0, MAX_PART_CHARS);
  const reacted = row.deliveryAction === "react" || row.deliveryAction === "react_and_reply";
  const reactNote = reacted && row.deliveryEmoji ? ` (with a ${row.deliveryEmoji} reaction)` : "";

  const head = `Someone messaged the user${where}: "${incoming}"`;
  let body: string;
  switch (row.status) {
    case "accepted":
      body = `The Digital Twin proposed a reply${reactNote}, and the user APPROVED it and posted it AS-IS:\n"${final || draft}"\nThe twin's draft matched how this user actually responds — reinforce this style and judgment.`;
      break;
    case "accepted_edited":
      body = `The Digital Twin proposed${reactNote}:\n"${draft}"\nThe user EDITED it before posting, to:\n"${final}"\nLearn from what the user changed — that delta is how their real voice differs from the draft.`;
      break;
    case "declined":
      body = `The Digital Twin proposed a reply${reactNote}:\n"${draft}"\nThe user DECLINED it — this is NOT how they would respond here. Avoid this kind of response for this sender/topic.`;
      break;
    case "ignored":
    default:
      body = `The Digital Twin proposed a reply${reactNote}:\n"${draft}"\nThe user IGNORED the suggestion (took no action) — the proposal wasn't compelling enough to act on. Treat this as weak/negative signal for responding this way.`;
      break;
  }
  return {
    id: `twin-feedback:${row.id}`,
    type: "mention_reply",
    ts: (row.decidedAt ?? new Date()).toISOString(),
    ...(row.channelId ? { channelId: row.channelId } : {}),
    ...(row.channelName ? { channelName: row.channelName } : {}),
    text: `${head}\n\n${body}`,
  };
}

/**
 * For the daily job: reconcile stale `pending` rows to `ignored`, then return the
 * decided-but-unlearned rows as curator records (with their ids so the caller can
 * mark them learned AFTER a successful curate). Does NOT mark learned itself, so
 * a curation failure never silently drops a signal.
 */
export async function assembleTwinFeedbackRecords(
  userId: string,
): Promise<{ records: UserMemoryRecord[]; ids: string[] }> {
  // 1. Stale pending (no action within the grace window) → ignored.
  const graceCutoff = new Date(Date.now() - IGNORE_GRACE_MS);
  const reconciled = await prisma.twinResponseFeedback.updateMany({
    where: { userId, status: "pending", proposedAt: { lt: graceCutoff } },
    data: { status: "ignored", decidedAt: new Date() },
  });
  if (reconciled.count > 0) {
    log.info("[twin-feedback] reconciled stale pending → ignored", { userId, count: reconciled.count });
  }

  // 2. Decided, not-yet-learned rows.
  const rows = await prisma.twinResponseFeedback.findMany({
    where: {
      userId,
      learnedAt: null,
      status: { in: ["accepted", "accepted_edited", "declined", "ignored"] },
    },
    orderBy: { decidedAt: "asc" },
    take: MAX_FEEDBACK_PER_RUN,
  });
  return { records: rows.map(renderTwinFeedbackRecord), ids: rows.map((r) => r.id) };
}

/** Mark feedback rows as learned so a later daily run doesn't re-distil them. */
export async function markTwinFeedbackLearned(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await prisma.twinResponseFeedback.updateMany({
      where: { id: { in: ids } },
      data: { learnedAt: new Date() },
    });
  } catch (err) {
    log.warn("[twin-feedback] mark-learned failed", { count: ids.length, err: errMsg(err) });
  }
}
