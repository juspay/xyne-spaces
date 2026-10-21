import { activeGoalRepository } from "../../repositories/index.js";
import type { WebhookCommandCtx } from "./context.js";
import { notice, pluralize, sentenceList, systemNote } from "../notice-format.js";

// ── /stop (and /goal clear) ── halt THE ADDRESSED AGENT in this thread:
// cancel its in-flight runs, drop its queued messages, and clear any active
// goal. Other agents' runs in the same thread keep going — /stop is scoped to
// the app that received the command. Queued messages must go too — the
// cancel's failure result drains the queue immediately, so keeping them would
// restart work the instant it stopped.
// Any thread participant may stop (same permissive model as /goal clear).
export async function handleStop(ctx: WebhookCommandCtx): Promise<void> {
  const { agent, payload } = ctx;
  const convId = payload.conversationId;
  let goalWasActive = false;
  if (convId) {
    const g = await activeGoalRepository.findActiveByConversation(convId).catch(() => null);
    if (g && g.agentSlug === agent.slug) {
      goalWasActive = true;
      await activeGoalRepository.terminate(convId, "cancelled", "user_stopped").catch(() => {});
    }
  }
  const stopResult = convId
    ? await ctx.reconcileStoppedRuns(convId, agent.slug)
    : { stopped: 0, cleaned: 0, queued: 0, hadRunningRows: false };

  await ctx.reply(formatStopReply(agent.slug, stopResult, goalWasActive), "Failed to post /stop reply");
}

/**
 * Report only what actually happened. The old wording emitted all three counts
 * unconditionally ("Stopped 1 running run - cleaned 0 stale runs - dropped 0
 * queued messages"), so the reader had to filter two zeroes out of every reply
 * to find the one fact that mattered.
 *
 * "Cleaned up N stale runs" is deliberately phrased as housekeeping and only
 * appears when it happened: a stale run is one the user never knew was still
 * on the books, so leading with it would answer a question nobody asked.
 */
export function formatStopReply(
  agentSlug: string,
  result: { stopped: number; cleaned: number; queued: number; hadRunningRows: boolean },
  goalWasActive: boolean,
): string {
  const didSomething = result.hadRunningRows || goalWasActive || result.queued > 0;
  if (!didSomething) {
    return systemNote(`Nothing is running for ${agentSlug} in this thread right now.`);
  }

  const parts: string[] = [];
  if (result.stopped > 0) parts.push(`cancelled ${pluralize(result.stopped, "run")}`);
  if (result.queued > 0) parts.push(`dropped ${pluralize(result.queued, "queued message")}`);
  if (result.cleaned > 0) parts.push(`cleaned up ${pluralize(result.cleaned, "stale run")}`);
  if (goalWasActive) parts.push("cleared the active goal");

  // hadRunningRows with nothing cancellable: the rows were all mid-flight
  // elsewhere, so say plainly that the stop was recorded rather than claiming
  // work we did not do.
  if (parts.length === 0) return notice("Stopped.", `No active work remained for ${agentSlug}.`);

  const detail = `${sentenceList(parts)}.`;
  return notice("Stopped.", detail.charAt(0).toUpperCase() + detail.slice(1));
}
