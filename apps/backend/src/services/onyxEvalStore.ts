/**
 * Persistence for the EnterpriseRAG-Bench /api/onyx-eval orchestrator.
 *
 * These are intra-run bookkeeping tables (onyx_eval_run / onyx_eval_question)
 * in the backend's own Postgres `public` schema — deliberately separate from
 * the benchmark corpus, which lives only in the separate Vespa. Rows are
 * written incrementally so a backend restart mid-run doesn't lose completed
 * questions, and a big `/results` read doesn't serialize megabytes of rows
 * back to the client.
 */
import { randomUUID } from 'crypto';
import { DatabaseClient } from '@/database/client';

export interface OnyxEvalConfig {
  workspaceId: string;
  topK: number;
  rankProfile: string;
  concurrency: number;
  threeJudgeCorrection: boolean;
  model?: string | undefined;
  maxQuestions?: number | undefined;
}

/** Shape of one benchmark question parsed from questions.jsonl. */
export interface BenchQuestion {
  question_id: string;
  question_type: string;
  source_types: string[];
  question: string;
  expected_doc_ids: string[];
  gold_answer: string;
  answer_facts: string[];
}

export interface OnyxEvalQuestionRow {
  questionId: string;
  questionType: string;
  retrieved: unknown;                 // [{ docId, benchmarkDocId, title, rank, score }]
  rawAnswer: string | null;
  answerText: string | null;
  citedDocIds: string[];
  correctness: number | null;         // 0|1
  correctnessReasoning: string | null;
  completeness: number | null;        // 0..1
  factSupported: boolean[];
  goldVotes: unknown | null;          // { docId: {label, votes[3]} }
  validDocIds: string[];
  invalidExtra: number | null;
  documentRecall: number | null;
  corrected: boolean;
  goldDocIdsOriginal: string[];       // dsids
  goldDocIdsCorrected: string[];      // corrected required syntheticIds (empty if unchanged)
  dsidToSynthetic: unknown;           // { dsid: {docId, schema} }
  error: string | null;
}

const db = () => DatabaseClient.getInstance();

export async function createRun(config: OnyxEvalConfig, totalQuestions: number): Promise<string> {
  const id = randomUUID();
  await db().onyxEvalRun.create({
    data: {
      id,
      config: config as object,
      totalQuestions,
      status: 'running',
    },
  });
  return id;
}

export async function upsertQuestion(runId: string, q: OnyxEvalQuestionRow): Promise<void> {
  const data = {
    questionType: q.questionType,
    retrieved: q.retrieved as object,
    rawAnswer: q.rawAnswer,
    answerText: q.answerText,
    citedDocIds: q.citedDocIds,
    correctness: q.correctness,
    correctnessReasoning: q.correctnessReasoning,
    completeness: q.completeness,
    factSupported: q.factSupported,
    goldVotes: q.goldVotes === null ? undefined : (q.goldVotes as object),
    validDocIds: q.validDocIds,
    invalidExtra: q.invalidExtra,
    documentRecall: q.documentRecall,
    corrected: q.corrected,
    goldDocIdsOriginal: q.goldDocIdsOriginal,
    goldDocIdsCorrected: q.goldDocIdsCorrected,
    dsidToSynthetic: q.dsidToSynthetic as object,
    error: q.error,
  };
  await db().onyxEvalQuestion.upsert({
    where: { runId_questionId: { runId, questionId: q.questionId } },
    create: { runId, questionId: q.questionId, ...data },
    update: data,
  });
}

export async function finishRun(runId: string, patch: {
  status: 'completed' | 'stopped' | 'failed';
  aggregate?: unknown;
  corrections?: number;
  lastError?: string | null;
  processed?: number;
}): Promise<void> {
  await db().onyxEvalRun.update({
    where: { id: runId },
    data: {
      status: patch.status,
      finishedAt: new Date(),
      ...(patch.aggregate !== undefined ? { aggregate: patch.aggregate as object } : {}),
      ...(patch.corrections !== undefined ? { corrections: patch.corrections } : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      ...(patch.processed !== undefined ? { processed: patch.processed } : {}),
    },
  });
}

export async function bumpProcessed(runId: string, processed: number): Promise<void> {
  await db().onyxEvalRun.update({ where: { id: runId }, data: { processed } });
}

/** Summary rows (no blobs) for listing runs — kept small so the CLI/dashboard stays fast. */
export async function listRuns(limit = 20) {
  const rows = await db().onyxEvalRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true, startedAt: true, finishedAt: true, status: true,
      totalQuestions: true, processed: true, corrections: true, lastError: true,
      aggregate: true, config: true,
    },
  });
  return rows;
}

export async function getRunWithQuestions(runId: string) {
  return db().onyxEvalRun.findUnique({
    where: { id: runId },
    include: { questions: { orderBy: { questionId: 'asc' } } },
  });
}

/** Latest run that is not yet 'completed', most recently started first. */
export async function findResumableRun() {
  return db().onyxEvalRun.findFirst({
    where: { status: { in: ['stopped', 'failed', 'running'] } },
    orderBy: { startedAt: 'desc' },
  });
}

/** question_ids already persisted for a run — used to skip on resume. */
export async function getDoneQuestionIds(runId: string): Promise<Set<string>> {
  const rows = await db().onyxEvalQuestion.findMany({
    where: { runId },
    select: { questionId: true },
  });
  return new Set(rows.map((r) => r.questionId));
}

/** Flip a previously stopped/failed run back to 'running' ahead of a resume (same runId kept). */
export async function reopenRun(runId: string): Promise<void> {
  await db().onyxEvalRun.update({
    where: { id: runId },
    data: { status: 'running', finishedAt: null, lastError: null },
  });
}

/** Map the in-memory orchestrator row to the persisted OnyxEvalQuestionRow shape. */
export function rowToStoreRow(row: Record<string, unknown>): OnyxEvalQuestionRow {
  return {
    questionId: String(row['question_id'] ?? ''),
    questionType: String(row['question_type'] ?? 'unknown'),
    retrieved: row['retrieved'] ?? [],
    rawAnswer: (row['rawAnswer'] as string | undefined) ?? null,
    answerText: (row['answer'] as string | undefined) ?? null,
    citedDocIds: (row['documentIds'] as string[] | undefined) ?? [],
    correctness: typeof row['correctness'] === 'number' ? (row['correctness'] as number) : (row['correctness'] ? 1 : 0),
    correctnessReasoning: (row['correctnessReasoning'] as string | null | undefined) ?? null,
    completeness: typeof row['completeness'] === 'number' ? (row['completeness'] as number) : null,
    factSupported: (row['factSupported'] as boolean[] | undefined) ?? [],
    goldVotes: (row['goldVotes'] as object | undefined) ?? null,
    validDocIds: (row['validDocIds'] as string[] | undefined) ?? [],
    invalidExtra: typeof row['invalidExtraDocs'] === 'number' ? (row['invalidExtraDocs'] as number) : null,
    documentRecall: typeof row['documentRecall'] === 'number' ? (row['documentRecall'] as number) : null,
    corrected: row['corrected'] === true,
    goldDocIdsOriginal: (row['goldDocIdsOriginal'] as string[] | undefined) ?? [],
    goldDocIdsCorrected: (row['goldDocIdsCorrected'] as string[] | undefined) ?? [],
    dsidToSynthetic: (row['dsidToSynthetic'] as object) ?? {},
    error: (row['error'] as string | null | undefined) ?? null,
  };
}

/** Persisted row for a question that threw before producing any artifacts. */
export function errorStoreRow(q: BenchQuestion, message: string): OnyxEvalQuestionRow {
  return {
    questionId: q.question_id, questionType: q.question_type, retrieved: [],
    rawAnswer: null, answerText: null, citedDocIds: [],
    correctness: null, correctnessReasoning: null, completeness: null, factSupported: [],
    goldVotes: null, validDocIds: [], invalidExtra: null, documentRecall: null,
    corrected: false, goldDocIdsOriginal: q.expected_doc_ids, goldDocIdsCorrected: [],
    dsidToSynthetic: {}, error: message,
  };
}
