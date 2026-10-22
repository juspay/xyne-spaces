import type { ExperimentRun } from "@prisma/client";
import { agentRunRepository, experimentRepository } from "../../repositories/index.js";
import { dispatchExperimentChecker, dispatchExperimentEpoch, postExperimentNotice } from "../../lib/experiment.js";
import { errMsg } from "../../lib/errors.js";
import { createLogger } from "../../logger.js";
import { LOOP_COMMANDS, loopCommandFor, type LoopCommandDef, type LoopKey } from "xyne-claw-shared";
import { advanceLoop, passesExhausted, pastDeadline, pastHardStop, type LoopEdge, type LoopNode, type LoopSpec } from "../engine.js";
import { decided, xorDecideNode, type Decision } from "../decide.js";

const log = createLogger("experiment");

const MIN_EPOCH_MS = 30_000;
const STALE_MS = 10 * 60_000;
const FORCE_DONE_AFTER_MS = 15 * 60_000;
const MAX_REPO_HISTORY_EPOCHS = 1000;
const NO_FINAL_REPORT = "(experiment ended without final report)";

export interface ExperimentLedger {
  run: ExperimentRun;
  decision?: Decision;
}

export interface ExperimentCtx {
  now: number;
  sessionId?: string;
  lastResult?: string;
}

type ExperimentSpec = LoopSpec<ExperimentLedger, ExperimentCtx, boolean>;

async function epochLivedMs(sessionId: string | undefined, now: number): Promise<number> {
  if (!sessionId) return Number.POSITIVE_INFINITY;
  const epochRun = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
  return epochRun?.startedAt ? now - epochRun.startedAt.getTime() : Number.POSITIVE_INFINITY;
}

async function sessionIsActive(sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false;
  const row = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
  return row?.status === "running";
}

async function nextEpoch(ledger: ExperimentLedger) {
  const next = await experimentRepository.update(ledger.run.id, {
    epoch: { increment: 1 },
    lastEpochEndedAt: new Date(),
  });
  await dispatchExperimentEpoch(next);
  return { ledger: { run: next }, output: true };
}

async function finalEpoch(ledger: ExperimentLedger) {
  const finishing = await experimentRepository.update(ledger.run.id, {
    status: "finishing",
    epoch: { increment: 1 },
    lastEpochEndedAt: new Date(),
  });
  await dispatchExperimentEpoch(finishing);
  return { ledger: { run: finishing }, output: true };
}

type ExperimentNode = LoopNode<ExperimentLedger, ExperimentCtx, boolean>;
type ExperimentEdge = LoopEdge<ExperimentLedger, ExperimentCtx>;

function checkerStage(spec: ExperimentSpec, progressGated: boolean): { nodes: Record<string, ExperimentNode>; edges: ExperimentEdge[] } {
  return {
    nodes: {
      checker: {
        kind: "checker",
        run: async (ledger) => {
          await dispatchExperimentChecker(ledger.run, ledger.run.epoch).catch((err) => {
            log.warn(`[experiment] checker dispatch threw id=${ledger.run.id} epoch=${ledger.run.epoch}: ${errMsg(err)}`);
          });
        },
      },
    },
    edges: [
      { from: "pass", on: "result", to: "checker", label: "epoch finished" },
      {
        from: "checker",
        on: "done",
        to: "pass",
        label: "keep going",
        when: (ledger, ctx) =>
          progressGated
            ? !passesExhausted(spec.policy, ledger)
            : !pastDeadline(spec.policy, ledger, ctx.now),
      },
      { from: "checker", on: "done", to: "report", label: "deadline or backstop reached" },
    ],
  };
}

function judgeStage(spec: ExperimentSpec, def: LoopCommandDef): { nodes: Record<string, ExperimentNode>; edges: ExperimentEdge[] } {
  const judge = def.judge;
  if (!judge) throw new Error(`[loop] ${def.command} uses the fix-retry graph but has no judge`);
  return {
    nodes: {
      judge: xorDecideNode<ExperimentLedger, ExperimentCtx>({
        questions: judge.questions,
        state: (_ledger, ctx) => ctx.lastResult ?? "",
        context: `The last pass of a ${def.command} run just finished. Judge its own report below.`,
      }) as ExperimentNode,
    },
    edges: [
      { from: "pass", on: "result", to: "judge", label: "pass finished" },
      {
        from: "judge",
        on: "done",
        to: "pass",
        label: "judge found something to fix",
        when: (ledger, ctx) =>
          decided(ledger.decision, judge.retryWhen.question, judge.retryWhen.value) &&
          ledger.run.epoch <= judge.maxRetries &&
          !pastDeadline(spec.policy, ledger, ctx.now),
      },
      { from: "judge", on: "done", to: "report", label: "clean, unsure, or out of retries" },
    ],
  };
}

function buildEpochLoop(def: LoopCommandDef): ExperimentSpec {
  const progressGated = def.graph === "progress";
  const spec: ExperimentSpec = {
    id: def.key,
    policy: {
      deadline: (ledger) => ledger.run.deadlineAt,
      graceAfterDeadlineMs: FORCE_DONE_AFTER_MS,
      maxPasses: () => (progressGated ? MAX_REPO_HISTORY_EPOCHS : null),
      passes: (ledger) => ledger.run.epoch,
      minPassMs: MIN_EPOCH_MS,
      staleAfterMs: STALE_MS,
      onTimeout: "report",
    },
    nodes: {
      pass: { kind: "pass", run: nextEpoch },
      report: {
        kind: "report",
        run: async (ledger) => {
          if (progressGated) {
            log.warn(`[experiment] ${def.command.slice(1)} ${ledger.run.id} hit the ${MAX_REPO_HISTORY_EPOCHS}-epoch backstop without reaching HEAD — finishing; the walk likely stalled (cursor not advancing)`);
          }
          return finalEpoch(ledger);
        },
      },
      rescuePass: { kind: "pass", run: nextEpoch },
      rescueReport: { kind: "report", run: finalEpoch },
      brake: {
        kind: "wait",
        run: async (ledger) => {
          log.warn(`[experiment] epoch for ${ledger.run.id} ended within ${MIN_EPOCH_MS / 1000}s of starting — deferring next epoch to supervisor (rapid-fail brake)`);
          await experimentRepository.update(ledger.run.id, { lastEpochEndedAt: new Date() }).catch(() => undefined);
          return { output: true };
        },
      },
      done: {
        kind: "end",
        run: async (ledger) => {
          await experimentRepository.update(ledger.run.id, { status: "done", lastEpochEndedAt: new Date() });
          return { output: false };
        },
      },
      forceDone: {
        kind: "end",
        run: async (ledger) => {
          const finalReport = ledger.run.finalReport ?? NO_FINAL_REPORT;
          await experimentRepository.update(ledger.run.id, { status: "done", finalReport });
          await postExperimentNotice({ ...ledger.run, finalReport }).catch((err) => {
            log.warn(`[experiment] force-done notice failed id=${ledger.run.id}: ${errMsg(err)}`);
          });
        },
      },
      idle: { kind: "wait" },
    },
    edges: [],
  };
  const stage = def.graph === "fix-retry" ? judgeStage(spec, def) : checkerStage(spec, progressGated);
  Object.assign(spec.nodes, stage.nodes);
  spec.edges = [
    { from: "report", on: "result", to: "done", label: "final report delivered" },
    {
      from: "pass",
      on: "result",
      to: "brake",
      label: "epoch died too fast",
      when: async (_ledger, ctx) => (await epochLivedMs(ctx.sessionId, ctx.now)) < (spec.policy.minPassMs ?? 0),
    },
    ...stage.edges,
    {
      from: "*",
      on: "tick",
      to: "forceDone",
      label: "past deadline grace",
      when: (ledger, ctx) => pastHardStop(spec.policy, ledger, ctx.now),
    },
    {
      from: "*",
      on: "tick",
      to: "idle",
      label: "epoch session still running",
      when: (ledger) => sessionIsActive(ledger.run.currentSessionId),
    },
    {
      from: "*",
      on: "tick",
      to: "idle",
      label: "recently touched",
      when: (ledger, ctx) => ctx.now - ledger.run.updatedAt.getTime() <= (spec.policy.staleAfterMs ?? 0),
    },
    {
      from: "*",
      on: "tick",
      to: "rescuePass",
      label: "stalled before deadline",
      when: (ledger, ctx) => ledger.run.status === "running" && !pastDeadline(spec.policy, ledger, ctx.now),
    },
    {
      from: "*",
      on: "tick",
      to: "rescueReport",
      label: "stalled after deadline",
      when: (ledger) => ledger.run.status === "running",
    },
  ];
  return spec;
}

export const EPOCH_LOOPS = Object.fromEntries(LOOP_COMMANDS.map((def) => [def.key, buildEpochLoop(def)])) as Record<LoopKey, ExperimentSpec>;

export const experimentLoop = EPOCH_LOOPS.experiment;

export function epochLoopFor(kind: unknown): ExperimentSpec {
  return EPOCH_LOOPS[loopCommandFor(kind).key];
}

function currentNode(run: ExperimentRun): string {
  return run.status === "finishing" ? "report" : "pass";
}

export async function continueExperimentAfterResult(conversationId: string, sessionId: string, lastResult?: string): Promise<boolean> {
  const active = await experimentRepository.findActiveByConversation(conversationId);
  if (!active) return false;
  if (active.currentSessionId && active.currentSessionId !== sessionId) return false;
  const step = await advanceLoop(epochLoopFor(active.kind), {
    from: currentNode(active),
    on: "result",
    ledger: { run: active },
    ctx: { now: Date.now(), sessionId, ...(lastResult ? { lastResult } : {}) },
  });
  return step.output ?? false;
}

export async function superviseExperiment(run: ExperimentRun, now = Date.now()): Promise<void> {
  await advanceLoop(epochLoopFor(run.kind), { from: currentNode(run), on: "tick", ledger: { run }, ctx: { now } });
}
