/**
 * Postgres persistence for Onyx eval runs + per-question results.
 *
 * Uses the shared retry-wrapped client from db.js — same as every other
 * service in claw-auth (digitalTwin, entityExtraction, dailyBrief...).
 *
 * Run rows carry the full posted input (question slice + options) in `config`
 * so runs are reproducible/resumable without any dataset tables; per-question
 * rows are upsert-write-once artifacts (resume re-attempts overwrite failed
 * rows in place).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

export interface OnyxAggregate {
  totalQuestions: number;
  correctnessPercent: number;
  completenessPercent: number;
  documentRecallPercent: number;
  invalidExtraDocsAvg: number;
  leaderboardScore: number;
}

/** Counters derived from persisted question rows — recomputed wholesale at
 *  run finish (so resumed runs aggregate old + new rows uniformly). */
export interface OnyxScoreRow {
  questionType: string;
  correctness: number | null;
  completeness: number | null;
  documentRecall: number | null;
  invalidExtra: number | null;
}

export function aggregateMetrics(rows: OnyxScoreRow[]): OnyxAggregate {
  const n = rows.length || 1;
  const mean = (xs: Array<number | null>): number => {
    const v = xs.filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  // Paper §5.1 leaderboard: completeness % if correct, else 0 — averaged over
  // ALL questions in the run.
  const leaderboard = rows.reduce((acc, r) => acc + (r.correctness === 1 ? (r.completeness ?? 0) : 0), 0) / n;
  return {
    totalQuestions: rows.length,
    correctnessPercent: Math.round(mean(rows.map((r) => r.correctness)) * 1000) / 10,
    completenessPercent: Math.round(mean(rows.map((r) => (r.completeness === null ? null : r.completeness * 100))) * 10) / 10,
    documentRecallPercent: Math.round(mean(rows.map((r) => (r.documentRecall === null ? null : r.documentRecall * 100))) * 10) / 10,
    invalidExtraDocsAvg: Math.round(mean(rows.map((r) => r.invalidExtra)) * 100) / 100,
    leaderboardScore: Math.round(leaderboard * 1000) / 10,
  };
}

export async function createRun(input: {
  config: Record<string, unknown>;
  totalQuestions: number;
  createdBy?: string | undefined;
  orgId: string;
}): Promise<string> {
  const run = await prisma.onyxEvalRun.create({
    data: {
      config: input.config,
      totalQuestions: input.totalQuestions,
      createdBy: input.createdBy ?? null,
      orgId: input.orgId,
    },
    select: { id: true },
  });
  return run.id;
}

export interface OnyxQuestionPersist {
  questionId: string;
  questionType: string;
  question: string;
  orgId: string;
  retrieved: unknown;
  rawAnswer: string | null;
  answerText: string | null;
  citedDocIds: string[];
  correctness: number | null;
  correctnessReasoning: string | null;
  completeness: number | null;
  factSupported: boolean[];
  goldVotes: unknown | null;
  validDocIds: string[];
  invalidExtra: number | null;
  documentRecall: number | null;
  corrected: boolean;
  goldDocIdsOriginal: string[];
  goldDocIdsCorrected: string[];
  goldAnswer: string | null;
  answerFacts: string[];
  dsidToSynthetic: unknown;
  error: string | null;
}

export async function upsertQuestion(runId: string, q: OnyxQuestionPersist): Promise<void> {
  await prisma.onyxEvalQuestion.upsert({
    where: { runId_questionId: { runId, questionId: q.questionId } },
    create: {
      runId,
      ...q,
      goldVotes: q.goldVotes != null ? (q.goldVotes as object) : Prisma.JsonNull,
      dsidToSynthetic: q.dsidToSynthetic as object,
      retrieved: q.retrieved as object,
    },
    update: {
      retrieved: q.retrieved as object,
      rawAnswer: q.rawAnswer,
      answerText: q.answerText,
      citedDocIds: q.citedDocIds,
      correctness: q.correctness,
      correctnessReasoning: q.correctnessReasoning,
      completeness: q.completeness,
      factSupported: q.factSupported,
      goldVotes: q.goldVotes != null ? (q.goldVotes as object) : Prisma.JsonNull,
      validDocIds: q.validDocIds,
      invalidExtra: q.invalidExtra,
      documentRecall: q.documentRecall,
      corrected: q.corrected,
      goldDocIdsOriginal: q.goldDocIdsOriginal,
      goldDocIdsCorrected: q.goldDocIdsCorrected,
      goldAnswer: q.goldAnswer,
      answerFacts: q.answerFacts,
      dsidToSynthetic: q.dsidToSynthetic as object,
      error: q.error,
    },
  });
}

export async function bumpProcessed(runId: string, processed: number): Promise<void> {
  await prisma.onyxEvalRun.update({ where: { id: runId }, data: { processed } });
}

/** /stop needs runId → the BullMQ job to cancel: recorded at enqueue time. */
export async function attachJobId(runId: string, jobId: string): Promise<void> {
  const run = await prisma.onyxEvalRun.findUnique({ where: { id: runId }, select: { config: true } });
  if (!run) return;
  await prisma.onyxEvalRun.update({
    where: { id: runId },
    data: { config: { ...(run.config as Record<string, unknown>), jobId } },
  });
}

/** Replicas-drop of the aggregate as of right now, recomputed over EVERY row
 *  persisted for the run so far — the endpoint response artifact. Drop-only,
 *  NOT a canonical metric the final finish computes. */
export async function refreshAggregate(runId: string): Promise<OnyxAggregate> {
  const aggregate = aggregateMetrics(await getScoreRows(runId));
  await prisma.onyxEvalRun.update({ where: { id: runId }, data: { aggregate: aggregate as object } });
  return aggregate;
}

export async function finishRun(runId: string, input: {
  status: "completed" | "failed" | "stopped";
  aggregate?: OnyxAggregate | undefined;
  corrections?: number | undefined;
  processed?: number | undefined;
  lastError?: string | undefined;
}): Promise<void> {
  await prisma.onyxEvalRun.update({
    where: { id: runId },
    data: {
      status: input.status,
      finishedAt: new Date(),
      ...(input.aggregate !== undefined ? { aggregate: input.aggregate as object } : {}),
      ...(input.corrections !== undefined ? { corrections: input.corrections } : {}),
      ...(input.processed !== undefined ? { processed: input.processed } : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
    },
  });
}

export async function reopenRun(runId: string): Promise<void> {
  await prisma.onyxEvalRun.update({
    where: { id: runId },
    data: { status: "running", finishedAt: null, lastError: null },
  });
}

export async function getRun(runId: string) {
  return prisma.onyxEvalRun.findUnique({ where: { id: runId } });
}

export interface OnyxRunConfigShape {
  questions: Array<Record<string, unknown>>;
  dsidMapping: Record<string, Array<{ sourceType: string; syntheticId: string }>>;
  topK: number;
  rankProfile: string;
  concurrency: number;
  threeJudgeCorrection: boolean;
  model?: string | undefined;
}

export function parseRunConfig(config: unknown): OnyxRunConfigShape | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  if (!Array.isArray(c["questions"]) || !c["dsidMapping"] || typeof c["dsidMapping"] !== "object") return null;
  return {
    questions: c["questions"] as Array<Record<string, unknown>>,
    dsidMapping: c["dsidMapping"] as OnyxRunConfigShape["dsidMapping"],
    topK: Math.min(Math.max(Number(c["topK"]) || 10, 1), 25),
    rankProfile: typeof c["rankProfile"] === "string" ? c["rankProfile"] : "default_native",
    concurrency: Math.min(Math.max(Number(c["concurrency"]) || 2, 1), 4),
    threeJudgeCorrection: c["threeJudgeCorrection"] !== false,
    model: typeof c["model"] === "string" ? c["model"] : undefined,
  };
}

export async function getDoneQuestionIds(runId: string): Promise<Set<string>> {
  const rows = await prisma.onyxEvalQuestion.findMany({ where: { runId }, select: { questionId: true } });
  return new Set(rows.map((r) => r.questionId));
}

/** Score rows for aggregate recomputation over EVERYTHING persisted for the run. */
export async function getScoreRows(runId: string): Promise<OnyxScoreRow[]> {
  return prisma.onyxEvalQuestion.findMany({
    where: { runId },
    select: { questionType: true, correctness: true, completeness: true, documentRecall: true, invalidExtra: true },
  });
}

export async function listRuns(limit: number) {
  return prisma.onyxEvalRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}

export async function getRunQuestions(runId: string, page: number, pageSize: number, questionType?: string) {
  const where = { runId, ...(questionType ? { questionType } : {}) };
  const [total, rows] = await Promise.all([
    prisma.onyxEvalQuestion.count({ where }),
    prisma.onyxEvalQuestion.findMany({
      where,
      orderBy: { questionId: "asc" },
      skip: page * pageSize,
      take: pageSize,
      select: {
        questionId: true, questionType: true, question: true,
        correctness: true, completeness: true, documentRecall: true,
        invalidExtra: true, corrected: true, error: true, createdAt: true,
      },
    }),
  ]);
  return { total, rows };
}

export async function getRunQuestionDetail(runId: string, questionId: string) {
  return prisma.onyxEvalQuestion.findUnique({ where: { runId_questionId: { runId, questionId } } });
}

/** Latest non-completed run (used by POST /runs/resume with no id). */
export async function findResumableRun() {
  return prisma.onyxEvalRun.findFirst({
    where: { status: { in: ["running", "stopped", "failed"] } },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, config: true },
  });
}
