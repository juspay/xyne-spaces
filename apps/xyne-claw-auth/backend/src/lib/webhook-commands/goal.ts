import { handleSlashCommandBeforeRun, type SlashIntercept } from "../../services/goalRelooper.js";
import { postGoalPhase } from "../goal-phase.js";
import type { SlashCommand } from "../parseSlashCommand.js";
import type { WebhookCommandCtx } from "./context.js";

// Only goal commands reach the goal relooper; stop/clear/compact are handled
// here (goalClear was short-circuited above into the full /stop path).
export async function runGoalIntercept(
  ctx: WebhookCommandCtx,
  slash: SlashCommand | null,
): Promise<SlashIntercept> {
  const goalCommand =
    slash && (slash.kind === "goalStart" || slash.kind === "goalStatus")
      ? slash
      : null;
  return handleSlashCommandBeforeRun({ command: goalCommand, conversationId: ctx.payload.conversationId });
}

export async function replyGoalControl(ctx: WebhookCommandCtx, replyToUser: string): Promise<void> {
  await ctx.reply(replyToUser, "Failed to post /goal control reply");
}

export async function announceGoalStart(ctx: WebhookCommandCtx, replyToUser: string): Promise<void> {
  const { agent, payload } = ctx;
  // Show "Starting /goal…" on the ephemeral progress spinner (same surface as
  // tool calls), not as a permanent chat message — the goal loop's meta lines
  // shouldn't clutter the thread. The terminal outcome stays a real message.
  await postGoalPhase(
    { conversationId: payload.conversationId, channelId: payload.channelId, agentSlug: agent.slug, spacesAppUserId: agent.spacesAppUserId, appToken: agent.appToken },
    replyToUser,
  );
}
