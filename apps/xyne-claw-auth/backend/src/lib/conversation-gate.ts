import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import {
  QUEUE_CAP,
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
  const interrupted = enq.enqueued && interruptSessionId ? await requestInterruptWithReply(interruptSessionId, userId) : false;
  log.info(
    `[msg-queue] conv ${conversationId} busy — queued eventId=${input.message.eventId} interrupted=${interrupted} (enqueued=${enq.enqueued} pos=${enq.position} deduped=${enq.deduped} full=${enq.full})`,
  );
  return {
    kind: "queued",
    accepted: enq.enqueued || enq.deduped,
    interrupted,
    notice: queuedNotice(enq, interrupted, input.explicitQueueOnly ?? false, input.place ?? "thread"),
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

export function queuedNotice(enq: EnqueueResult, interrupted: boolean, explicitQueueOnly: boolean, place: "thread" | "chat"): string {
  if (enq.enqueued && interrupted) return "⏸️ I’ll wrap up my current reply first, then continue with your new message.";
  if (enq.enqueued) {
    return explicitQueueOnly
      ? `🕒 Queued after the current run (position ${enq.position}).`
      : `🕒 I’m still working on your previous message — this one is queued (position ${enq.position}). I’ll get to it as soon as I’m done.`;
  }
  if (enq.deduped) return "🕒 Already queued — I’ll get to it as soon as I’m done with the current one.";
  if (enq.full) return `⚠️ I’m still working and this ${place}’s queue is full (${QUEUE_CAP}). Please resend once I’ve caught up.`;
  return "⚠️ I’m still working on your previous message and couldn’t queue this one. Please resend in a moment.";
}
