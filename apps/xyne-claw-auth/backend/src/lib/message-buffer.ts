/**
 * Chat buffering for the mid-run message queue.
 *
 * Without buffering, a burst of follow-ups sent while an agent is replying is
 * drained ONE message per run: three quick messages → three sequential runs and
 * three replies. With buffering on, the drain takes every consecutive queued
 * message that can safely be merged and answers them in a single run.
 *
 * Safety rules for what may be merged (see `isCoalescible` / `canJoin`):
 *  - Only thin conversation-mode entries. Twin / messaging-channel entries carry
 *    a byte-identical replay blob (dispatchPayload + sessionContext) and approval
 *    semantics; they are always replayed one-by-one.
 *  - Never lock-contention retries (`alreadyPersisted`): their user row already
 *    exists, merging would orphan or duplicate it.
 *  - Never entries carrying run-scoped extras (experiment, recordingRefs) — those
 *    bind per-run state on /internal/run.
 *  - Never an explicit `/queue <msg>`: the user asked for strict ordering.
 *  - Only the SAME sender and SAME event type. The run executes with the
 *    sender's identity, tools and credentials; merging two people's messages
 *    would act on one user's text with another user's permissions.
 */

import type { QueuedMessage } from "./message-queue.js";

/** Feature flag. Off → drain behaviour is exactly the legacy one-by-one FIFO. */
export function isChatBufferingEnabled(): boolean {
  return process.env["CLAW_MSG_BUFFER_ENABLED"] === "1" || process.env["CLAW_MSG_BUFFER_ENABLED"] === "true";
}

export function isCoalescible(msg: QueuedMessage): boolean {
  if (msg.dispatchPayload || msg.sessionContext) return false;
  if (msg.alreadyPersisted) return false;
  if (msg.experiment) return false;
  if (msg.recordingRefs && msg.recordingRefs.length > 0) return false;
  if (msg.twinUserScopeId) return false;
  if (msg.queueReason === "explicit_queue") return false;
  if (msg.responseMode === "approval") return false;
  return typeof msg.task === "string" && msg.task.trim().length > 0;
}

function canJoin(head: QueuedMessage, next: QueuedMessage): boolean {
  return (
    isCoalescible(next) &&
    next.userId === head.userId &&
    next.eventType === head.eventType &&
    next.conversationId === head.conversationId &&
    next.agentSlug === head.agentSlug &&
    (next.resultForwardUrl ?? null) === (head.resultForwardUrl ?? null)
  );
}

/**
 * How many entries from the head of the queue form one buffered batch.
 * Always ≥ 1 for a non-empty list (a non-coalescible head drains alone).
 */
export function leadingBatchSize(queue: QueuedMessage[]): number {
  if (queue.length === 0) return 0;
  const head = queue[0]!;
  if (!isCoalescible(head)) return 1;
  let n = 1;
  while (n < queue.length && canJoin(head, queue[n]!)) n++;
  return n;
}

/**
 * Merge a batch into ONE queued message that the existing redispatch path can
 * send unchanged. Identity/routing fields come from the head (all entries share
 * sender + conversation by construction); the newest non-empty `context` wins
 * because it reflects the latest thread state.
 */
export function coalesceQueuedMessages(batch: QueuedMessage[]): QueuedMessage {
  if (batch.length === 0) throw new Error("coalesceQueuedMessages: empty batch");
  if (batch.length === 1) return batch[0]!;
  const head = batch[0]!;
  const latestContext = [...batch].reverse().find((m) => m.context)?.context;
  const parts = batch.map((m, i) => `[${i + 1}/${batch.length}] ${m.task.trim()}`);
  const task =
    `While you were replying, I sent ${batch.length} more messages. ` +
    `Read them together and answer them in a single reply (later messages may refine or correct earlier ones):\n\n` +
    parts.join("\n\n");
  return {
    ...head,
    eventId: `buffer:${batch.map((m) => m.eventId).join(",")}`.slice(0, 512),
    task,
    ...(latestContext ? { context: latestContext } : {}),
    ...(batch.some((m) => m.resolveMentions) ? { resolveMentions: true } : {}),
    // Keep the interrupt follow-up signal if ANY entry was one, so the
    // "Picked up your new message" working signal still fires on drain.
    ...(batch.some((m) => m.queueReason === "interrupt_followup")
      ? { queueReason: "interrupt_followup" as const }
      : head.queueReason
        ? { queueReason: head.queueReason }
        : {}),
    ts: batch[batch.length - 1]!.ts,
  };
}
