import { clearQueue, peekQueue, queueDepth } from "../message-queue.js";
import type { WebhookCommandCtx } from "./context.js";

// ── /queue ── show messages waiting behind the active run, then stop.
export async function handleQueueShow(ctx: WebhookCommandCtx): Promise<void> {
  const { agent, payload } = ctx;
  const convId = payload.conversationId;
  const depth = convId ? await queueDepth(convId, agent.slug) : 0;
  const waiting = convId ? await peekQueue(convId, agent.slug) : [];
  const lines =
    depth === 0
      ? ["🕒 **Message queue** — empty. Nothing is waiting behind the current run."]
      : [
          `🕒 **Message queue** — ${depth} message${depth === 1 ? "" : "s"} waiting behind the active run:`,
          ...waiting.map((m, i) => {
            const preview = m.task.replace(/\s+/g, " ").slice(0, 80);
            return `${i + 1}. ${preview}${m.task.length > 80 ? "…" : ""}`;
          }),
        ];
  await ctx.reply(lines.join("\n"), "Failed to post /queue reply");
}

// ── /queue clear ── drop the messages waiting behind the active run. Does
// NOT stop the current run (that's /stop) — the active run keeps going and
// will simply have nothing to drain when it finishes.
export async function handleQueueClear(ctx: WebhookCommandCtx): Promise<void> {
  const { agent, payload } = ctx;
  const convId = payload.conversationId;
  const discarded = convId ? await clearQueue(convId, agent.slug) : 0;
  const reply =
    discarded > 0
      ? `🧹 Cleared the queue — dropped ${discarded} waiting message${discarded === 1 ? "" : "s"}. The current run continues.`
      : "The queue is already empty.";
  await ctx.reply(reply, "Failed to post /queue clear reply");
}
