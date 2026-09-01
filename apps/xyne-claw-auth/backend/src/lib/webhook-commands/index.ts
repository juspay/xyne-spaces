import { parseSlashCommand } from "../parseSlashCommand.js";
import { parseExperimentCommand } from "../experiment.js";
import { handleExperimentCommand } from "./experiment.js";
import { handleQueueClear, handleQueueShow } from "./queue.js";
import { handleHelp } from "./help.js";
import { handleStatus } from "./status.js";
import { applyFastTaskCommand, handleFastModeToggle, handleFastModeUsage } from "./fast-mode.js";
import { handleClear } from "./clear.js";
import { handleStop } from "./stop.js";
import { announceGoalStart, replyGoalControl, runGoalIntercept } from "./goal.js";
import { buildCompactTask } from "./compact.js";
import { stripLeadingAgentMention } from "../strip-agent-mention.js";
import type { CommandOutcome, PendingGoalStart, WebhookCommandCtx } from "./context.js";

export type {
  CommandOutcome,
  PendingGoalStart,
  StopReconcileResult,
  WebhookCommandCtx,
  WebhookCommandPayload,
} from "./context.js";

export async function handleWebhookCommands(ctx: WebhookCommandCtx): Promise<CommandOutcome> {
  // ── /goal slash command interception ─────────────────────────────────────
  // Parse the RAW message first: an explicit command in the raw text (e.g.
  // "@Agent /stop") must win over autoGoal, otherwise autoGoal turns "/stop"
  // into "/goal … /stop" and the thread becomes impossible to stop.
  const rawSlash = parseSlashCommand(ctx.userText);
  const slash =
    rawSlash ??
    (ctx.autoGoalEnabled && !ctx.immediateTaskCommand ? parseSlashCommand(`/goal ${ctx.userText}`) : null);
  const experimentCommand = parseExperimentCommand(ctx.userText);

  if (experimentCommand) {
    await handleExperimentCommand(ctx, experimentCommand);
    return { kind: "handled" };
  }

  if (slash?.kind === "queueShow") {
    await handleQueueShow(ctx);
    return { kind: "handled" };
  }

  if (slash?.kind === "status") {
    await handleStatus(ctx);
    return { kind: "handled" };
  }

  if (slash?.kind === "help") {
    await handleHelp(ctx);
    return { kind: "handled" };
  }

  if (slash?.kind === "fastModeUsage") {
    await handleFastModeUsage(ctx);
    return { kind: "handled" };
  }

  if (slash?.kind === "fastMode") {
    await handleFastModeToggle(ctx, slash.enabled);
    return { kind: "handled" };
  }

  if (slash?.kind === "clear") {
    await handleClear(ctx);
    return { kind: "handled" };
  }

  if (slash?.kind === "queueClear") {
    await handleQueueClear(ctx);
    return { kind: "handled" };
  }

  if (slash?.kind === "goalClear") {
    await handleStop(ctx);
    return { kind: "handled" };
  }

  // ── /compact ── compact (summarize) this thread's context before the run.
  // Not a short-circuit: it dispatches a normal turn with compactBeforeRun set,
  // so the agent compacts the resumed session and replies with a summary.
  const compactBeforeRun = slash?.kind === "compact";
  const explicitQueueOnly = slash?.kind === "queueAdd";

  const intercept = await runGoalIntercept(ctx, slash);
  let pendingGoalStart: PendingGoalStart | null = null;
  let task: string;
  if (intercept.kind === "goalStatusReply" || intercept.kind === "goalCleared") {
    await replyGoalControl(ctx, intercept.replyToUser);
    return { kind: "handled" };
  } else if (slash?.kind === "queueAdd") {
    // `/queue <message>` is an explicit opt-out from same-user interrupt-with-reply.
    // If a run is active the slot gate below will enqueue it without touching the
    // active run; if nothing is active we just run the message now.
    task = slash.message;
  } else if (compactBeforeRun) {
    task = buildCompactTask(slash);
  } else if (intercept.kind === "goalStarted") {
    pendingGoalStart = {
      condition: intercept.condition,
      ...(intercept.providerOverride ? { providerOverride: intercept.providerOverride } : {}),
    };
    task = intercept.firstTurnTask;
    await announceGoalStart(ctx, intercept.replyToUser);
  } else {
    task = ctx.immediateTaskCommand ? ctx.taskCommandText : ctx.userText;
  }

  const taskWithoutMentions = stripLeadingAgentMention(task, [ctx.agent.name, ctx.agent.slug]);
  task = await applyFastTaskCommand(ctx, taskWithoutMentions, task);

  return {
    kind: "dispatch",
    task,
    compactBeforeRun,
    explicitQueueOnly,
    pendingGoalStart,
  };
}
