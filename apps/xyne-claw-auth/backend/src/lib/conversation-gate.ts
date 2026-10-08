import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { systemNote } from "./notice-format.js";
import { isChatBufferingEnabled } from "./message-buffer.js";
import {
  QUEUE_CAP,
  claimInterruptOnce,
  enqueueMessage,
  getSlotOwner,
  tryAcquireSlot,
  type EnqueueResult,
  type QueuedMessage,
} from "./message-queue.js";

const log = createLogger("conversation-gate");

export type ConversationGate =
  | { kind: "run"; slotToken: string }
  | { kind: "queued"; accepted: boolean; interrupted: boolean; notice: string; enq: EnqueueResult };

export async function claimOrQueue(input: {
  message: Omit<QueuedMessage, "queueReason" | "interruptMode" | "ts">;
  explicitQueueOnly?: boolean;
  place?: "thread" | "chat";
}): Promise<ConversationGate> {
  const { conversationId, agentSlug, userId } = input.message;
  const slotToken = await tryAcquireSlot(conversationId, agentSlug, undefined, userId);
  if (slotToken) return { kind: "run", slotToken };

  const owner = await getSlotOwner(conversationId, agentSlug).catch(() => null);
  const interruptSessionId = !input.explicitQueueOnly ? owner?.sessionId : undefined;
  const enq = await enqueueMessage({
    ...input.message,
    queueReason: interruptSessionId ? "interrupt_followup" : input.explicitQueueOnly ? "explicit_queue" : "busy",
    interruptMode: interruptSessionId ? "interrupt_with_reply" : "queue_only",
    ts: Date.now(),
  });
  // Chat buffering: only the FIRST follow-up in a busy window interrupts the
  // active run; later ones just join the buffer and are answered together.
  const shouldInterrupt = enq.enqueued && Boolean(interruptSessionId) &&
    (!isChatBufferingEnabled() || (await claimInterruptOnce(interruptSessionId!)));
  const interrupted = shouldInterrupt ? await requestInterruptWithReply(interruptSessionId!, userId) : false;
  const buffered = isChatBufferingEnabled() && enq.enqueued && !interrupted && enq.position > 1;
  log.info(
    `[msg-queue] conv ${conversationId} busy — queued eventId=${input.message.eventId} interrupted=${interrupted} (enqueued=${enq.enqueued} pos=${enq.position} deduped=${enq.deduped} full=${enq.full})`,
  );
  return {
    kind: "queued",
    accepted: enq.enqueued || enq.deduped,
    interrupted,
    notice: buffered && !input.explicitQueueOnly
      ? systemNote(`Queued at position ${enq.position} — I'll answer your follow-ups together once I finish the current reply.`)
      : queuedNotice(enq, interrupted, input.explicitQueueOnly ?? false, input.place ?? "thread"),
    enq,
  };
}

export async function requestInterruptWithReply(sessionId: string, userId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(sessionId)}/interrupt-with-reply`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
          "x-user-id": userId,
        },
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`[msg-queue] interrupt-with-reply rejected session=${sessionId} by=${userId} status=${res.status} body=${body.slice(0, 200)}`);
    }
    return res.ok;
  } catch (err) {
    log.warn("Failed to request interrupt-with-reply", { error: errMsg(err) });
    return false;
  }
}

/** See lib/notice-format.ts for the house style these follow — italic, so the
 *  reader can tell claw's voice from the agent's. */
export function queuedNotice(enq: EnqueueResult, interrupted: boolean, explicitQueueOnly: boolean, place: "thread" | "chat"): string {
  return systemNote(queuedNoticeText(enq, interrupted, explicitQueueOnly, place));
}

function queuedNoticeText(enq: EnqueueResult, interrupted: boolean, explicitQueueOnly: boolean, place: "thread" | "chat"): string {
  if (enq.enqueued && interrupted) return "Finishing the current reply first, then picking up your new message.";
  if (enq.enqueued) {
    return explicitQueueOnly
      ? `Queued behind the current run, at position ${enq.position}.`
      : `Still working on your previous message — this one is queued at position ${enq.position}, and I'll get to it as soon as I'm done.`;
  }
  if (enq.deduped) return "Already queued — I'll get to it as soon as the current one is done.";
  if (enq.full) return `Still working, and this ${place}'s queue is full at ${QUEUE_CAP}. Please resend once I've caught up.`;
  return "Still working on your previous message, and this one could not be queued. Please resend in a moment.";
}
