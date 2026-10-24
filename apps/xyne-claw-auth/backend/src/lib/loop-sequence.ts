import type { ExperimentRun, LoopCommandDefinition, LoopSequenceRun } from "@prisma/client";
import { LOOP_COMMANDS, fillStepArgs, getLoopTemplate, type LoopSequenceStep } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { experimentRepository } from "../repositories/index.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { dispatchExperimentEpoch, parseExperimentCommand, postThreadMarkdown, slashWord, type CustomCommandMatch } from "./experiment.js";
import { findRunnableLoopCommand, toLoopDef } from "./loop-command-defs.js";

const log = createLogger("loop-sequence");
const REPORT_LINE_CHARS = 240;

export type SequenceOutcome = "done" | "aborted";

export function sequenceSteps(seq: Pick<LoopSequenceRun, "steps">): LoopSequenceStep[] {
  return Array.isArray(seq.steps) ? (seq.steps as unknown as LoopSequenceStep[]) : [];
}

export function stepText(step: LoopSequenceStep, focus: string | null | undefined): string {
  return `${step.command} ${fillStepArgs(step.args, focus ?? undefined)}`.trim();
}

async function resolveStep(seq: LoopSequenceRun, text: string): Promise<{ custom: CustomCommandMatch | null } | { error: string }> {
  const word = slashWord(text);
  if (!word) return { error: `\`${text}\` is not a command` };
  if (LOOP_COMMANDS.some((d) => d.command === `/${word}`)) return { custom: null };
  const row = await findRunnableLoopCommand(seq.orgId, seq.userId, word);
  if (!row) return { error: `/${word} no longer exists or you cannot run it` };
  if (getLoopTemplate(row.template)?.composite) return { error: `/${word} is a sequence; sequences cannot nest` };
  return {
    custom: { def: toLoopDef(row), commandId: row.id, version: row.version, maxDurationMs: row.maxDurationMinutes * 60_000, provider: row.provider, modelId: row.modelId },
  };
}

async function abortSequence(seq: LoopSequenceRun, reason: string): Promise<void> {
  await prisma.loopSequenceRun.update({ where: { id: seq.id }, data: { status: "aborted", currentRunId: null, finishedAt: new Date() } });
  await postThreadMarkdown(seq, `**/${seq.commandName}** stopped at step ${seq.stepIndex + 1}/${sequenceSteps(seq).length}: ${reason}`).catch(() => undefined);
}

export async function startSequenceStep(seq: LoopSequenceRun, index: number): Promise<ExperimentRun | null> {
  const steps = sequenceSteps(seq);
  const step = steps[index];
  if (!step) {
    await abortSequence(seq, "the step list is empty");
    return null;
  }
  const text = stepText(step, seq.focus);
  const resolved = await resolveStep(seq, text).catch((err: unknown) => ({ error: errMsg(err) }));
  if ("error" in resolved) {
    await abortSequence({ ...seq, stepIndex: index }, resolved.error);
    return null;
  }
  const command = parseExperimentCommand(text, resolved.custom);
  if (!command || command.sub !== "start") {
    await abortSequence({ ...seq, stepIndex: index }, `\`${text}\` did not parse as a run (it may need arguments, e.g. /ui-test <route>)`);
    return null;
  }
  const run = await experimentRepository.createRun({
    conversationId: seq.conversationId,
    channelId: seq.channelId,
    agentSlug: seq.agentSlug,
    userId: seq.userId,
    orgId: seq.orgId,
    focus: command.focus ?? null,
    provider: command.provider ?? null,
    modelId: command.model ?? null,
    kind: command.kind ?? null,
    commandId: command.commandId ?? null,
    commandVersion: resolved.custom?.version ?? null,
    sequenceId: seq.id,
    sequenceStep: index,
    deadlineAt: new Date(Date.now() + command.durationMs),
  });
  await prisma.loopSequenceRun.update({ where: { id: seq.id }, data: { stepIndex: index, currentRunId: run.id } });
  await postThreadMarkdown(seq, `**/${seq.commandName}** · step ${index + 1}/${steps.length}: \`${text}\` started`).catch(() => undefined);
  try {
    await dispatchExperimentEpoch(run);
  } catch (err) {
    log.warn(`[loop-sequence] step dispatch failed seq=${seq.id} step=${index}: ${errMsg(err)}`);
    await experimentRepository.update(run.id, { status: "aborted", lastEpochEndedAt: new Date() }).catch(() => undefined);
    await abortSequence({ ...seq, stepIndex: index }, `step could not start: ${errMsg(err).slice(0, 200)}`);
    return null;
  }
  return run;
}

export async function startSequence(args: {
  row: LoopCommandDefinition;
  conversationId: string;
  channelId: string;
  agentSlug: string;
  userId: string;
  focus?: string | undefined;
}): Promise<{ ok: true; sequence: LoopSequenceRun } | { ok: false; error: string }> {
  const steps = Array.isArray(args.row.steps) ? (args.row.steps as unknown as LoopSequenceStep[]) : [];
  if (steps.length === 0) return { ok: false, error: `/${args.row.name} has no steps` };
  if (await experimentRepository.findActiveByConversation(args.conversationId)) {
    return { ok: false, error: "A loop is already running in this thread. Use `/experiment status` or `/experiment stop`." };
  }
  if (await prisma.loopSequenceRun.findFirst({ where: { conversationId: args.conversationId, status: "running" }, select: { id: true } })) {
    return { ok: false, error: "A sequence is already running in this thread. Use `/experiment stop` to stop it." };
  }
  const sequence = await prisma.loopSequenceRun.create({
    data: {
      orgId: args.row.orgId,
      commandId: args.row.id,
      commandName: args.row.name,
      commandVersion: args.row.version,
      conversationId: args.conversationId,
      channelId: args.channelId,
      agentSlug: args.agentSlug,
      userId: args.userId,
      focus: args.focus?.trim() || null,
      steps: steps as unknown as object,
    },
  });
  await startSequenceStep(sequence, 0);
  return { ok: true, sequence };
}

export function sequenceSummary(seq: Pick<LoopSequenceRun, "commandName" | "steps" | "focus">, runs: Array<Pick<ExperimentRun, "sequenceStep" | "status" | "epoch" | "finalReport">>, outcome: SequenceOutcome): string {
  const steps = sequenceSteps(seq);
  const lines = steps.map((step, i) => {
    const run = runs.find((r) => r.sequenceStep === i);
    const status = !run ? "not run" : run.status === "done" ? "done" : run.status;
    const first = run?.finalReport?.trim().split("\n").find((l) => l.trim()) ?? "";
    const report = first ? ` — ${first.length > REPORT_LINE_CHARS ? `${first.slice(0, REPORT_LINE_CHARS)}…` : first}` : "";
    return `${i + 1}. \`${stepText(step, seq.focus)}\` · ${status}${run ? ` · ${run.epoch} pass${run.epoch === 1 ? "" : "es"}` : ""}${report}`;
  });
  return [
    outcome === "done" ? `**/${seq.commandName} finished** — all ${steps.length} steps ran.` : `**/${seq.commandName} stopped** before all steps ran.`,
    "",
    ...lines,
    "",
    "Each step posted its own full report above; `/experiment findings <id>` pulls any one of them.",
  ].join("\n");
}

export async function onExperimentFinished(run: Pick<ExperimentRun, "id" | "sequenceId">, outcome: SequenceOutcome): Promise<void> {
  if (!run.sequenceId) return;
  const seq = await prisma.loopSequenceRun.findUnique({ where: { id: run.sequenceId } });
  if (!seq || seq.status !== "running" || seq.currentRunId !== run.id) return;
  const steps = sequenceSteps(seq);
  const next = seq.stepIndex + 1;
  const finished = outcome === "aborted" || next >= steps.length;
  const claimed = await prisma.loopSequenceRun.updateMany({
    where: { id: seq.id, status: "running", currentRunId: run.id },
    data: finished
      ? { status: outcome === "aborted" ? "aborted" : "done", currentRunId: null, finishedAt: new Date() }
      : { currentRunId: null, stepIndex: next },
  });
  if (claimed.count === 0) return;
  if (finished) {
    const runs = await prisma.experimentRun.findMany({ where: { sequenceId: seq.id }, select: { sequenceStep: true, status: true, epoch: true, finalReport: true } });
    await postThreadMarkdown(seq, sequenceSummary(seq, runs, outcome)).catch((err: unknown) => log.warn(`[loop-sequence] summary post failed seq=${seq.id}: ${errMsg(err)}`));
    log.info(`[loop-sequence] seq=${seq.id} /${seq.commandName} ${outcome} after step ${seq.stepIndex + 1}/${steps.length}`);
    return;
  }
  await startSequenceStep({ ...seq, stepIndex: next, currentRunId: null }, next);
}

export async function stopSequencesInThread(conversationId: string): Promise<number> {
  const running = await prisma.loopSequenceRun.findMany({ where: { conversationId, status: "running" }, select: { id: true } });
  if (running.length === 0) return 0;
  const { count } = await prisma.loopSequenceRun.updateMany({ where: { id: { in: running.map((r) => r.id) }, status: "running" }, data: { status: "aborted", currentRunId: null, finishedAt: new Date() } });
  return count;
}
