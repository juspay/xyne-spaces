import { parseSlashCommand } from "../parseSlashCommand.js";
import { parseExperimentCommand, slashWord, type CustomCommandMatch } from "../experiment.js";
import { findRunnableLoopCommand, toLoopDef } from "../loop-command-defs.js";
import { getLoopTemplate } from "xyne-claw-shared";
import type { LoopCommandDefinition } from "@prisma/client";
import { handleExperimentCommand } from "./experiment.js";
import { handleQueueClear, handleQueueShow } from "./queue.js";
import { handleHelp } from "./help.js";
import { handleStatus } from "./status.js";
import { handleEval } from "./eval.js";
import { handleDebug } from "./debug.js";
import { handleChainDebug } from "./chain-debug.js";
import { applyFastTaskCommand, handleFastModeToggle, handleFastModeUsage } from "./fast-mode.js";
import { handleClear } from "./clear.js";
import { handleStop } from "./stop.js";
import { announceGoalStart, replyGoalControl, runGoalIntercept } from "./goal.js";
import { buildCompactTask } from "./compact.js";
import { stripLeadingAgentMention } from "../strip-agent-mention.js";
import { preDispatchSessionKey } from "../../surfaces/spaces/agent-progress.js";
import type { CommandOutcome, PendingGoalStart, WebhookCommandCtx } from "./context.js";

export type {
  CommandOutcome,
  PendingGoalStart,
  StopReconcileResult,
  WebhookCommandCtx,
  WebhookCommandPayload,
} from "./context.js";

async function startSequenceFromThread(ctx: WebhookCommandCtx, row: LoopCommandDefinition): Promise<void> {
  const label = `Failed to start /${row.name}`;
  const text = (ctx.userText ?? "").trim();
  const rest = text.slice(text.toLowerCase().indexOf(`/${row.name}`) + row.name.length + 1).trim();
  if (/^(status|stop|findings)\b/i.test(rest)) {
    await ctx.reply(`Use \`/experiment ${rest.split(/\s+/)[0]!.toLowerCase()}\` for the step that is running.`, label);
    return;
  }
  const { startSequence, sequenceSteps, stepText } = await import("../loop-sequence.js");
  const result = await startSequence({
    row,
    conversationId: ctx.payload.conversationId,
    channelId: ctx.payload.channelId,
    agentSlug: ctx.agent.slug,
    userId: ctx.payload.userId,
    ...(rest ? { focus: rest } : {}),
  });
  if (!result.ok) {
    await ctx.reply(result.error, label);
    return;
  }
  const steps = sequenceSteps(result.sequence);
  await ctx.reply(
    [`**/${row.name} started** — ${steps.length} steps, one after another:`, ...steps.map((s, i) => `${i + 1}. \`${stepText(s, result.sequence.focus)}\``), "", "`/experiment status` shows the running step; `/experiment stop` stops the whole sequence."].join("\n"),
    label,
  );
}

async function resolveCustomLoopCommand(ctx: WebhookCommandCtx): Promise<CustomCommandMatch | { sequence: LoopCommandDefinition } | null> {
  const word = slashWord(ctx.userText);
  if (!word || !ctx.agent.orgId) return null;
  const row = await findRunnableLoopCommand(ctx.agent.orgId, ctx.payload.userId, word).catch((err: unknown) => {
    ctx.log.warn("[loop-commands] lookup failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  });
  if (!row) return null;
  if (getLoopTemplate(row.template)?.composite) return { sequence: row };
  return {
    def: toLoopDef(row),
    commandId: row.id,
    version: row.version,
    maxDurationMs: row.maxDurationMinutes * 60_000,
    provider: row.provider,
    modelId: row.modelId,
  };
}

export async function handleWebhookCommands(ctx: WebhookCommandCtx): Promise<CommandOutcome> {
  // ── /goal slash command interception ─────────────────────────────────────
  // Parse the RAW message first: an explicit command in the raw text (e.g.
  // "@Agent /stop") must win over autoGoal, otherwise autoGoal turns "/stop"
  // into "/goal … /stop" and the thread becomes impossible to stop.
  const rawSlash = parseSlashCommand(ctx.userText);
  const slash =
    rawSlash ??
    (ctx.autoGoalEnabled && !ctx.immediateTaskCommand ? parseSlashCommand(`/goal ${ctx.userText}`) : null);
  const resolved = await resolveCustomLoopCommand(ctx);
  if (resolved && "sequence" in resolved) {
    await startSequenceFromThread(ctx, resolved.sequence);
    return { kind: "handled" };
  }
  const custom = resolved;
  const experimentCommand = parseExperimentCommand(ctx.userText, custom);

  if (experimentCommand) {
    await handleExperimentCommand(ctx, experimentCommand, custom);
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

  if (slash?.kind === "debug") {
    if (slash.scope === "chain") {
      await handleChainDebug(ctx);
    } else {
      await handleDebug(ctx, slash.scope ?? "latest");
    }
    return { kind: "handled" };
  }

  if (slash?.kind === "eval") {
    if (ctx.isTwin) {
      ctx.log.info("/eval ignored on digital-twin run — eval runs only on the agent itself");
      return { kind: "handled" };
    }
    await handleEval(ctx, slash.question, slash.providers, slash.opts);
    return { kind: "handled" };
  }

  if (slash?.kind === "help") {
    await handleHelp(ctx, slash.command);
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
    // Pre-dispatch: the run has no sessionId yet, so the pill is keyed on the
    // conversation. The dispatch below re-lights it with the real one.
    await announceGoalStart(ctx, intercept.replyToUser, preDispatchSessionKey(ctx.payload.conversationId));
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
