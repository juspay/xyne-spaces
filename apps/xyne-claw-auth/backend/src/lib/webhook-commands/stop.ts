import { activeGoalRepository } from "../../repositories/index.js";
import type { WebhookCommandCtx } from "./context.js";

// ── /stop (and /goal clear) ── halt EVERYTHING active in this thread: cancel
// the in-flight run, drop queued messages, and clear any active goal. Queued
// messages must go too — the cancel's failure result drains the queue
// immediately, so keeping them would restart work the instant it stopped.
// Any thread participant may stop (same permissive model as /goal clear).
export async function handleStop(ctx: WebhookCommandCtx): Promise<void> {
  const { agent, payload } = ctx;
  const convId = payload.conversationId;
  let goalWasActive = false;
  if (convId) {
    const g = await activeGoalRepository.findActiveByConversation(convId).catch(() => null);
    if (g) {
      goalWasActive = true;
      await activeGoalRepository.terminate(convId, "cancelled", "user_stopped").catch(() => {});
    }
  }
  const stopResult = convId
    ? await ctx.reconcileStoppedRuns(convId, agent.slug)
    : { stopped: 0, cleaned: 0, queued: 0, hadRunningRows: false };

  const parts: string[] = [];
  parts.push(`Stopped ${stopResult.stopped} running run${stopResult.stopped === 1 ? "" : "s"}`);
  parts.push(`cleaned ${stopResult.cleaned} stale run${stopResult.cleaned === 1 ? "" : "s"}`);
  parts.push(`dropped ${stopResult.queued} queued message${stopResult.queued === 1 ? "" : "s"}`);
  if (goalWasActive) parts.push("cleared the active /goal");
  const reply =
    stopResult.hadRunningRows || goalWasActive || stopResult.queued > 0
      ? `🛑 ${parts.join(" - ")}.`
      : "Nothing is currently running in this thread.";

  await ctx.reply(reply, "Failed to post /stop reply");
}
