import { createLogger } from "../logger.js";
import { isClawAdmin } from "../middleware/agent-acl.js";
import { agentRepository, experimentRepository } from "../repositories/index.js";
import { postAgentMessage } from "../surfaces/spaces/post-message.js";
import { errMsg } from "./errors.js";
import { toResolvedAgent } from "./resolved-agent.js";
import { postGeneratedMarkdownFile } from "./spaces-generated-file.js";
import type { WebhookCommandCtx } from "./webhook-commands/context.js";
import { handleExperimentCommand } from "./webhook-commands/experiment.js";

const log = createLogger("experiment-card-actions");

export const EXPERIMENT_CARD_ACTIONS = new Set(["experiment-findings", "experiment-stop"]);

export type ExperimentCardActionResult =
  | { type: "ack"; message: string }
  | { type: "error"; message: string };

export async function handleExperimentCardAction(args: {
  actionId: string;
  experimentId: string | undefined;
  callerUserId: string | undefined;
}): Promise<ExperimentCardActionResult> {
  const { actionId, experimentId, callerUserId } = args;
  if (!EXPERIMENT_CARD_ACTIONS.has(actionId)) return { type: "error", message: `Unknown experiment action: ${actionId}` };
  if (!experimentId || !callerUserId) return { type: "error", message: "Missing experiment or caller" };
  const run = await experimentRepository.findById(experimentId);
  if (!run?.orgId) return { type: "error", message: "Experiment not found" };
  const agentRow = await agentRepository.findBySlug(run.agentSlug, run.orgId);
  const agent = agentRow ? toResolvedAgent(agentRow) : null;
  if (!agent) return { type: "error", message: "The agent for this experiment is not connected to Spaces" };

  const isOwner = run.userId === callerUserId || await isClawAdmin(callerUserId);
  if (actionId === "experiment-stop") {
    if (!isOwner) return { type: "error", message: "Only the person who started this run or a claw admin can stop it." };
    const active = await experimentRepository.findActiveByConversation(run.conversationId);
    if (active?.id !== run.id) return { type: "ack", message: "This run has already ended." };
  }

  const ctx: WebhookCommandCtx = {
    agent,
    payload: { conversationId: run.conversationId, channelId: run.channelId, userId: callerUserId },
    log,
    userText: "",
    taskCommandText: "",
    immediateTaskCommand: false,
    autoGoalEnabled: false,
    isTwin: false,
    reply: async (markdownText, failureLabel) => {
      await postAgentMessage(
        { spacesAppUserId: agent.spacesAppUserId, appToken: agent.appToken },
        { channelId: run.channelId, conversationId: run.conversationId, markdownText, metadata: { contentFormat: "markdown" } },
      ).catch((err) => log.warn(failureLabel, { error: errMsg(err) }));
    },
    attach: async (file) => {
      await postGeneratedMarkdownFile({
        channelId: run.channelId,
        conversationId: run.conversationId,
        userId: agent.spacesAppUserId,
        appToken: agent.appToken,
        filename: file.fileName,
        markdown: file.content,
        mimeType: file.mimeType,
        summary: file.summary,
      });
    },
    reconcileStoppedRuns: async () => ({ stopped: 0, cleaned: 0, queued: 0, hadRunningRows: false }),
  };

  if (actionId === "experiment-stop") {
    void handleExperimentCommand(ctx, { sub: "stop" }).catch((err) =>
      log.warn(`[experiment-card] stop failed run=${run.id}: ${errMsg(err)}`));
    return { type: "ack", message: "Stopping the run…" };
  }
  void handleExperimentCommand(ctx, isOwner ? { sub: "findings", id: run.id } : { sub: "findings" }).catch((err) =>
    log.warn(`[experiment-card] findings failed run=${run.id}: ${errMsg(err)}`));
  return { type: "ack", message: "Posting the findings report to the thread…" };
}
