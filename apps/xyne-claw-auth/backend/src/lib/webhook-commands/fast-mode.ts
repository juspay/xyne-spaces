import { errMsg } from "../errors.js";
import { setFastModeOverride } from "../fast-mode.js";
import type { WebhookCommandCtx } from "./context.js";

export async function handleFastModeUsage(ctx: WebhookCommandCtx): Promise<void> {
  await ctx.reply(
    "Usage: `/fast` · `/fast off` · `/fast <task>` (turn on fast mode and run the task)",
    "Failed to post /fast reply",
  );
}

export async function handleFastModeToggle(ctx: WebhookCommandCtx, enabled: boolean): Promise<void> {
  const { agent, payload, log } = ctx;
  // This slash handler runs only for normal mention/DM webhooks; scheduled
  // automation runs can only be detected here by their one-shot conversation id.
  const isAutomationThread = payload.conversationId?.startsWith("scheduled_") === true;
  let markdownText = isAutomationThread
    ? "⚡ `/fast` does not persist for scheduled/automation firings because each firing uses a new conversation. Set `fastMode: true` on the agent instead."
    : enabled
      ? "⚡ fast mode on — tools load on demand, no subagent delegation."
      : "⚡ fast mode off — subagent delegation restored for the next run.";
  if (!isAutomationThread) {
    try {
      await setFastModeOverride(payload.conversationId, agent.slug, enabled);
    } catch (err) {
      log.warn("Failed to set /fast override", { error: errMsg(err) });
      markdownText = "⚠️ couldn't persist fast mode — try again";
    }
  }
  await ctx.reply(markdownText, "Failed to post /fast reply");
}

// `/fast <task>` — enable fast mode AND dispatch the remainder in one shot.
// Bare `/fast`, `/fast on|off`, and on/off
// typos were already handled (ack-only) by the parseSlashCommand branch
// above, so only the with-task shape reaches this regex. `/fast off <task>`
// disables fast mode and still runs the task.
const FAST_TASK_RE = /^\s*\/fast\s+([\s\S]+?)\s*$/i;

export async function applyFastTaskCommand(
  ctx: WebhookCommandCtx,
  taskWithoutMentions: string,
  task: string,
): Promise<string> {
  const { agent, payload, log } = ctx;
  const fastTaskMatch = FAST_TASK_RE.exec(taskWithoutMentions);
  if (!fastTaskMatch) return task;
  let rest = fastTaskMatch[1]!.trim();
  let fastEnable = true;
  if (/^off\b/i.test(rest)) {
    fastEnable = false;
    rest = rest.replace(/^off\b/i, "").trim();
  }
  if (payload.conversationId) {
    try {
      await setFastModeOverride(payload.conversationId, agent.slug, fastEnable);
    } catch (err) {
      // Run the task anyway — resolveFastMode falls back to agent config.
      log.warn("Failed to set /fast override for /fast <task>", { error: errMsg(err) });
    }
  }
  return rest;
}
