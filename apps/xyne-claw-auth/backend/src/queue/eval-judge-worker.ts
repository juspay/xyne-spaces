/**
 * BullMQ worker for background scoring. Scores every (turn × selected-judge)
 * pair via claw's LLM judge, writes per-judge scores (and mirrors the first
 * judge into the legacy single-score fields), and streams progress so the UI
 * shows a strip instead of a blocking modal. Cancellable between pairs.
 */
import { Worker, type Job } from "bullmq";
import { redisService } from "../redis.js";
import { judgeEvalTurn, listEvalModels } from "../services/evalJudgeClient.js";
import { getUserCopilotConfig, COPILOT_MODEL_SENTINEL } from "../services/providerCredentials.js";
import { evalRepository } from "../repositories/index.js";
import {
  isEvalJudgeCancelRequested,
  clearEvalJudgeCancel,
  type EvalJudgeJobData,
  type EvalJudgeProgress,
} from "./eval-judge-queue.js";

import { createLogger } from "../logger.js";
const log = createLogger("eval-judge-worker");

const QUEUE_NAME = "eval-judge";
const CONCURRENCY = 2;

interface GradableTurn {
  id: string;
  conversationId: string;
  inputMessage: string;
  expectedResponse: string | null;
  clawAnswer: string | null;
  matchScore: number | null;
}

async function processJob(job: Job<EvalJudgeJobData>): Promise<EvalJudgeProgress> {
  const data = job.data;
  const jobId = job.id!;

  const run = await evalRepository.getRun(data.runId);
  if (!run) throw new Error("Run not found");

  // Resolve judges in the requested order, each paired with its model for this
  // pass. The same judge may appear several times with different models — each
  // (judge, model) entry scores independently.
  const specs = data.judges ?? [];
  const loaded = await evalRepository.getJudgesByIds(specs.map((s) => s.judgeId));
  const judges = specs
    .map((s) => {
      const j = loaded.find((x) => x.id === s.judgeId);
      return j ? { ...j, passModel: s.model?.trim() || "" } : null;
    })
    .filter((j): j is NonNullable<typeof j> => !!j)
    .map((j, idx) => ({ ...j, isPrimary: idx === 0 }));
  if (judges.length === 0) throw new Error("No judges selected");

  // Resolve what "default" means right now so scores are stored under the REAL
  // model name — otherwise "default" and the same model picked explicitly would
  // show up as two different graders in the UI.
  const resolvedDefault = await listEvalModels()
    .then((r) => r.defaultModel)
    .catch(() => "");

  // "prov:copilot" = run this judge on the user's Copilot connection (their
  // configured model). Resolved once per job.
  const needsCopilot = judges.some((j) => j.passModel === COPILOT_MODEL_SENTINEL);
  const copilotCfg = needsCopilot && data.userId ? await getUserCopilotConfig(data.userId) : null;
  if (needsCopilot && !copilotCfg) {
    throw new Error("Copilot is selected for judging but no Copilot connection was found for this user");
  }

  const scope = data.conversationIds?.length ? new Set(data.conversationIds) : null;
  const turns = (run.turnResults as unknown as GradableTurn[]).filter(
    (t) =>
      (!scope || scope.has(t.conversationId)) &&
      typeof t.expectedResponse === "string" &&
      t.expectedResponse.trim().length > 0 &&
      typeof t.clawAnswer === "string" &&
      (!data.onlyUnscored || t.matchScore === null),
  );

  const pairs = turns.flatMap((t) => judges.map((j) => ({ t, j })));
  const progress: EvalJudgeProgress = {
    phase: "scoring",
    total: pairs.length,
    done: 0,
    judged: 0,
    failed: 0,
    judgeCount: judges.length,
  };
  await job.updateProgress(progress);

  let i = 0;
  let cancelled = false;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, async () => {
      while (i < pairs.length) {
        if (cancelled) return;
        if (await isEvalJudgeCancelRequested(jobId)) {
          cancelled = true;
          return;
        }
        const { t, j } = pairs[i++]!;
        // Model precedence: this judge's pick for this pass > the judge's stored default > platform default.
        const viaCopilot = j.passModel === COPILOT_MODEL_SENTINEL && !!copilotCfg;
        // Stored under the REAL model name ("copilot/gpt-4o") so the grader
        // dropdown shows what actually graded, not the sentinel.
        const judgeModel = viaCopilot ? `copilot/${copilotCfg!.model}` : j.passModel || j.model || resolvedDefault;
        const verdict = await judgeEvalTurn({
          expected: t.expectedResponse ?? "",
          generated: t.clawAnswer ?? "",
          message: t.inputMessage,
          prompt: j.prompt,
          ...(viaCopilot ? { copilot: copilotCfg! } : judgeModel ? { model: judgeModel } : {}),
        });
        await evalRepository.setTurnJudgeScore(t.id, {
          judgeId: j.id,
          judgeName: j.name,
          score: verdict.score,
          reasoning: verdict.reasoning,
          model: judgeModel || "default",
          passId: jobId,
        });
        // Mirror the first judge into the legacy single-score fields.
        if (j.isPrimary) {
          await evalRepository.setTurnJudgeResult(t.id, {
            matchScore: verdict.score,
            judgeReasoning: verdict.reasoning,
            judgeModel: judgeModel || "default",
          });
          if (verdict.score === null) progress.failed += 1;
          else progress.judged += 1;
        }
        progress.done += 1;
        await job.updateProgress(progress);
      }
    }),
  );

  if (cancelled) {
    progress.phase = "cancelled";
    await job.updateProgress(progress);
    await clearEvalJudgeCancel(jobId);
    return progress;
  }
  progress.phase = "done";
  await job.updateProgress(progress);
  return progress;
}

let worker: Worker<EvalJudgeJobData> | undefined;

export function initEvalJudgeWorker(): Worker<EvalJudgeJobData> {
  if (worker) return worker;
  worker = new Worker<EvalJudgeJobData>(QUEUE_NAME, processJob, {
    connection: redisService.getConnection(),
    concurrency: 1, // one scoring job at a time → at most CONCURRENCY in-flight LLM calls
  });
  worker.on("failed", (job, err) => {
    log.error(`[eval-judge] job ${job?.id} failed:`, err instanceof Error ? err.message : err);
  });
  log.info("[eval-judge] Worker started");
  return worker;
}

export async function closeEvalJudgeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
