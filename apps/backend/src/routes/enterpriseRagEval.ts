import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import { authenticateAdmin as enterpriseRagAuthenticateAdmin, resolveContext as enterpriseRagResolveContext } from '@/routes/enterpriseRagBenchmark';
import { logger } from '@/utils/logger';
import { vespaService } from '@/services/vespaSearch';
import type { VespaSearchHit } from '@/vespa/src/types';
import { evalAnswer, evalCorrectness, evalFacts, evalRelevance } from '@/services/clawEvalBenchClient';
import * as onyxStore from '@/services/onyxEvalStore';
import type { BenchQuestion } from '@/services/onyxEvalStore';

const router = Router();

// ---------------------------------------------------------------------------
// Shared auth + identity context (identical to the ingest router).
// On the onyx deployment the run is invoked from an internal caller (loopback /
// x-route-env: onyx); otherwise full admin auth applies. resolveContext gives
// back the SAME benchmark workspace/user/org that /api/admin/enterprise-rag
// ingest wrote to Vespa — so retrieval here always reads the right corpus.
// ---------------------------------------------------------------------------
const authenticateAdmin = enterpriseRagAuthenticateAdmin;
const resolveContext = enterpriseRagResolveContext;

// ---------------------------------------------------------------------------
// Dataset: load questions + dsid -> {sourceType -> syntheticId} mapping once at
// module init. dsid_mapping.json is required here — every gold expected_doc_id
// is a dsid that MUST resolve through it (recomputing breaks multi-source ids).
// ---------------------------------------------------------------------------

const QUESTIONS_PATH = new URL('../../dataset/questions.jsonl', import.meta.url).pathname;
const DSID_MAPPING_PATH = new URL('../../dataset/dsid_mapping.json', import.meta.url).pathname;

let cachedQuestions: BenchQuestion[] | null = null;
/** dsid -> inner map of { sourceType: syntheticId }. */
let dsidMapping: Record<string, Record<string, string>> | null = null;
let syntheticToDsid: Record<string, string> | null = null;

/** Load dsid_mapping.json once; the inverse is derived in the same pass. */
async function loadDsidMapping(): Promise<Record<string, Record<string, string>>> {
  if (dsidMapping) return dsidMapping;
  const raw = await fs.promises.readFile(DSID_MAPPING_PATH, 'utf8');
  dsidMapping = JSON.parse(raw) as Record<string, Record<string, string>>;
  const inv: Record<string, string> = {};
  for (const [dsid, inner] of Object.entries(dsidMapping)) {
    for (const synth of Object.values(inner)) if (typeof synth === 'string') inv[synth] ??= dsid;
  }
  syntheticToDsid = inv;
  logger.info(`[EnterpriseRAG Eval] loaded dsid mapping (${Object.keys(dsidMapping).length} dsids, ${Object.keys(inv).length} synthetic ids)`);
  return dsidMapping;
}

/**
 * syntheticId → dsid if known, else the input (fallback for non-benchmark docs).
 * The inverse is guaranteed hot by processQuestion's earlier loadDsidMapping()
 * (via goldVespaRef on expected_doc_ids), so this never triggers a file read.
 */
function toDsid(synth: string): string {
  return syntheticToDsid?.[synth] ?? synth;
}

async function loadQuestions(): Promise<BenchQuestion[]> {
  if (cachedQuestions) return cachedQuestions;
  const out: BenchQuestion[] = [];
  const { createReadStream } = fs;
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: createReadStream(QUESTIONS_PATH, { encoding: 'utf-8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      const d = JSON.parse(t) as Partial<BenchQuestion>;
      if (typeof d.question_id === 'string' && typeof d.question === 'string') {
        out.push({
          question_id: d.question_id,
          question_type: typeof d.question_type === 'string' ? d.question_type : 'unknown',
          source_types: Array.isArray(d.source_types) ? d.source_types.filter((s): s is string => typeof s === 'string') : [],
          question: d.question,
          expected_doc_ids: Array.isArray(d.expected_doc_ids) ? d.expected_doc_ids.filter((s): s is string => typeof s === 'string') : [],
          gold_answer: typeof d.gold_answer === 'string' ? d.gold_answer : '',
          answer_facts: Array.isArray(d.answer_facts) ? d.answer_facts.filter((s): s is string => typeof s === 'string') : [],
        });
      }
    } catch {
      logger.warn('[EnterpriseRAG Eval] skipping malformed question line');
    }
  }
  cachedQuestions = out;
  return out;
}

/**
 * Map a gold dsid to its benchmark-source syntheticId + a Vespa schema to look
 * it up in. Uses the committed dsid_mapping.json; falls back to "no resolve"
 * (empty ref) when an unexpected missing mapping shows up rather than guessing
 * a source type (which was the bug in the positional zip).
 */
async function goldVespaRef(dsid: string): Promise<{ sourceType: string | null; syntheticId: string | null }> {
  const map = await loadDsidMapping();
  const inner = map[dsid];
  if (!inner) return { sourceType: null, syntheticId: null };
  // Exactly one sourceType per dsid in the benchmark (3 multi-source dsids
  // exist but the question's expected_doc_ids are unambiguous single ids).
  const entries = Object.entries(inner);
  const [sourceType, syntheticId] = entries[0]!;
  return { sourceType, syntheticId };
}

function sourceTypeToSchema(sourceType: string | null): string {
  switch (sourceType) {
    case 'slack': return 'chat_message';
    case 'gmail': return 'mail';
    case 'jira': case 'linear': return 'ticket';
    default: return 'file';
  }
}

// ---------------------------------------------------------------------------
// Retrieval (backend -> separate Vespa). Reads only the benchmark workspace
// (resolveContext) so it can never leak another tenant's docs.
// ---------------------------------------------------------------------------

const RETRIEVAL_SCHEMAS = 'chat_message, file, mail, ticket';

interface EvalDoc {
  docId: string;                    // syntheticId (Vespa doc id)
  benchmarkDocId: string | null;    // canonical dsid when in the corpus, else the synthetic id (resolved via dsid_mapping, not ingestion metadata)
  title: string;
  content: string;
  rank: number;
  score: number;
}

function extractTitle(hit: VespaSearchHit): string {
  const f = (hit.fields as any) ?? {};
  return String(f.fileName || f.subject || f.title || f.name || f.messageChannelName || f.username || f.docId || 'Untitled');
}

function extractContent(hit: VespaSearchHit): string {
  const f = (hit.fields as any) ?? {};
  const chunks: string[] = Array.isArray(f.chunks) ? f.chunks : [];
  return (chunks.join('\n') || f.text || f.description || f.initialMessage || f.subject || f.fileName || '').toString();
}

async function retrieveTopK(workspaceId: string, question: string, hits: number, rankProfile: string): Promise<EvalDoc[]> {
  // dsid_mapping is the source of truth for benchmark identity — no reliance on
  // how the docs were stamped at ingestion. mem-only after first call.
  await loadDsidMapping();
  const response = await vespaService.vespaClient.search<{ root: { children?: VespaSearchHit[] } }>({
    yql: `select * from ${RETRIEVAL_SCHEMAS} where ({grammar:"tokenize"} userInput(@query)) and (workspaceId contains "${workspaceId}");`,
    query: question,
    input: { query: question },
    ranking: { profile: rankProfile },
    hits,
  });
  return (response.root?.children ?? []).map((hit, i) => ({
    docId: String((hit.fields as any)?.docId ?? ''),
    benchmarkDocId: toDsid(String((hit.fields as any)?.docId ?? '')),
    title: extractTitle(hit),
    content: extractContent(hit),
    rank: i + 1,
    score: Number(hit.relevance ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// 3-judge relevance voting (paper §5.3) — keep notes with labels for audit.
// ---------------------------------------------------------------------------

type RelevanceLabel = 'required' | 'valid' | 'invalid';

interface RelevanceVote {
  label: RelevanceLabel;
  note: string;
}

function majorityVote(votes: RelevanceLabel[], isGold: boolean): RelevanceLabel {
  const count = (l: RelevanceLabel) => votes.filter((v) => v === l).length;
  const req = count('required');
  const val = count('valid');
  const inv = count('invalid');
  if (isGold) {
    if (inv >= 2) return 'invalid';       // gold stays unless a majority votes invalid
    return req >= val ? 'required' : 'valid';
  }
  if (req >= 2) return 'required';
  if (val >= 2) return 'valid';
  if (req + val >= 2) return 'valid';
  return 'invalid';
}

// ---------------------------------------------------------------------------
// Paper §5.1 metrics
// ---------------------------------------------------------------------------

interface QuestionScore {
  correctness: 0 | 1;
  correctnessReasoning: string | null;
  completeness: number;
  documentRecall: number | null;
  invalidExtraDocs: number | null;
}

function aggregateMetrics(rows: Array<QuestionScore>) {
  const n = rows.length || 1;
  const mean = (xs: Array<number | null>): number => {
    const v = xs.filter((x): x is number => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  const leaderboard = rows.reduce((acc, r) => acc + (r.correctness === 1 ? r.completeness : 0), 0) / n;
  return {
    totalQuestions: rows.length,
    correctnessPercent: Math.round(mean(rows.map((r) => r.correctness)) * 1000) / 10,
    completenessPercent: Math.round(mean(rows.map((r) => r.completeness * 100)) * 10) / 10,
    documentRecallPercent: Math.round(mean(rows.map((r) => (r.documentRecall === null ? null : r.documentRecall * 100))) * 10) / 10,
    invalidExtraDocsAvg: Math.round(mean(rows.map((r) => (r.invalidExtraDocs === null ? null : r.invalidExtraDocs))) * 100) / 100,
    leaderboardScore: Math.round(leaderboard * 1000) / 10,
  };
}

// ---------------------------------------------------------------------------
// Citations: the answerer ends with EX-[nn] markers; parse them into
// document_ids (model-cited subset) and strip the answer text for judges.
// ---------------------------------------------------------------------------

function splitCitations(docs: EvalDoc[], raw: string): { citedDocIds: string[]; answerText: string } {
  const cited: string[] = [];
  const seen = new Set<number>();
  for (const m of raw.matchAll(/EX-\[(\d+)\]/g)) {
    const idx = Number(m[1]);
    if (idx >= 1 && idx <= docs.length && !seen.has(idx)) {
      seen.add(idx);
      cited.push(docs[idx - 1]!.docId);
    }
  }
  return { citedDocIds: cited, answerText: raw.replace(/EX-\[\d+\]/g, '').replace(/\n{3,}/g, '\n\n').trim() };
}

// ---------------------------------------------------------------------------
// Run state machine (in-memory for live progress; durable rows go to Postgres)
// ---------------------------------------------------------------------------

interface RunState {
  running: boolean;
  stopped: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  processed: number;
  total: number;
  lastError: string | null;
  config: Record<string, unknown>;
  corrections: number;
}

const runState: RunState = {
  running: false, stopped: false, startedAt: null, finishedAt: null,
  processed: 0, total: 0, lastError: null, config: {}, corrections: 0,
};
let lastResults: {
  aggregate: ReturnType<typeof aggregateMetrics> | null;
  rows: Array<Record<string, unknown>>;
} = { aggregate: null, rows: [] };

// ---------------------------------------------------------------------------
// Per-question benchmark pass
// ---------------------------------------------------------------------------

async function processQuestion(
  q: BenchQuestion,
  opts: z.infer<typeof runSchema>,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  // (1) Resolve gold dsids -> {sourceType, syntheticId} via the committed mapping.
  const goldRefs = await Promise.all(q.expected_doc_ids.map((d) => goldVespaRef(d)));
  const dsidToSynthetic: Record<string, { docId: string; schema: string; sourceType: string | null }> = {};
  const goldSyntheticSet = new Set<string>();
  for (let i = 0; i < q.expected_doc_ids.length; i++) {
    const ref = goldRefs[i]!;
    dsidToSynthetic[q.expected_doc_ids[i]!] = {
      docId: ref.syntheticId ?? '',
      schema: sourceTypeToSchema(ref.sourceType),
      sourceType: ref.sourceType,
    };
    if (ref.syntheticId) goldSyntheticSet.add(ref.syntheticId);
  }

  // (2) Retrieve top-K from the separate Vespa (workspace = ingest's benchmark ws).
  const docs = await retrieveTopK(workspaceId, q.question, opts.topK, opts.rankProfile);

  // (3) Answerer agent (claw): question + retrieved full-content docs -> answer.
  const answerRes = await evalAnswer({
    question: q.question,
    docs: docs.map((d) => ({ benchmarkDocId: d.benchmarkDocId ?? null, title: d.title, content: d.content })),
    ...(opts.model ? { model: opts.model } : {}),
  });
  const rawAnswer = (answerRes?.answer ?? '').trim();

  // (4) Citations -> document_ids + judge-ready answer text.
  const { citedDocIds, answerText } = splitCitations(docs, rawAnswer);

  // (5) Correctness judge (paper §5.1 binary; independent of facts).
  const judgeRes = q.gold_answer && answerText
    ? await evalCorrectness({ expected: q.gold_answer, generated: answerText, ...(opts.model ? { model: opts.model } : {}) })
    : null;
  const correctnessBinary = judgeRes?.correct === 1;
  const correctnessReasoning = judgeRes?.reasoning ?? null;

  // (6) Completeness judge: atomic answer_facts -> per-fact supported.
  const factsRes = q.answer_facts.length > 0 && answerText
    ? await evalFacts({ answer: answerText, answerFacts: q.answer_facts, ...(opts.model ? { model: opts.model } : {}) })
    : null;
  const completeness = factsRes?.completeness ?? 0;

  // (7) 3-judge gold-set correction (paper §5.3) — optional per run.
  const goldVotes = new Map<string, { label: RelevanceLabel; votes: RelevanceVote[] }>();
  const validIds = new Set<string>();
  let corrected = false;
  if (opts.threeJudgeCorrection) {
    const unionIds = new Set<string>([...goldSyntheticSet, ...citedDocIds]);
    const docsById = new Map(docs.map((d) => [d.docId, d]));
    for (const id of unionIds) {
      const isGold = goldSyntheticSet.has(id);
      const docObj = docsById.get(id);
      const votes: RelevanceVote[] = [];
      for (let j = 0; j < 3; j++) {
        const v = docObj
          ? await evalRelevance({ question: q.question, doc: { benchmarkDocId: docObj.benchmarkDocId ?? null, title: docObj.title, content: docObj.content }, ...(opts.model ? { model: opts.model } : {}) })
          : null;
        votes.push({ label: v?.label ?? (isGold ? 'required' : 'invalid'), note: v?.note ?? (docObj ? 'judge_unavailable' : 'doc_not_retrieved') });
      }
      goldVotes.set(id, { label: majorityVote(votes.map((x) => x.label), isGold), votes });
    }
    for (const [id, { label }] of goldVotes) if (label === 'valid') validIds.add(id);
    const newRequired = new Set([...goldVotes.entries()].filter(([, g]) => g.label === 'required').map(([id]) => id));
    const same = newRequired.size === goldSyntheticSet.size && [...goldSyntheticSet].every((x) => newRequired.has(x));
    corrected = !same;
    if (corrected) {
      goldSyntheticSet.clear();
      newRequired.forEach((x) => goldSyntheticSet.add(x));
    }
  }

  // (8) Paper metrics on the candidate's cited set.
  const hasGold = goldSyntheticSet.size > 0 || q.expected_doc_ids.length > 0;
  const documentRecall = hasGold && goldSyntheticSet.size > 0
    ? citedDocIds.filter((id) => goldSyntheticSet.has(id)).length / goldSyntheticSet.size
    : null;
  const invalidExtraDocs = hasGold
    ? citedDocIds.filter((id) => !goldSyntheticSet.has(id) && !validIds.has(id)).length
    : null;

  // Relabel every persisted doc-id surface as canonical dsids (metrics above stay
  // on synthetics — same ids, so scoring is identical). cite/votes/valid are
  // Vespa addresses; the DB carries the dataset's own ids.
  const dsidCited = citedDocIds.map(toDsid);
  const dsidValid = [...validIds].map(toDsid);
  const dsidGoldVotes = new Map([...goldVotes.entries()].map(([k, v]) => [toDsid(k), v] as const));
  const dsidGoldCorrected = [...goldSyntheticSet].map(toDsid);

  const row: QuestionScore & Record<string, unknown> = {
    question_id: q.question_id,
    question_type: q.question_type,
    correctness: correctnessBinary ? 1 : 0,
    correctnessReasoning,
    completeness,
    factSupported: factsRes?.supported ?? [],
    documentRecall,
    invalidExtraDocs,
    answer: answerText,
    rawAnswer,
    documentIds: dsidCited,
    retrieved: docs.map((d) => ({ docId: d.docId, benchmarkDocId: d.benchmarkDocId ?? null, title: d.title, rank: d.rank, score: d.score })),
    dsidToSynthetic,
    corrected,
    goldVotes: opts.threeJudgeCorrection ? Object.fromEntries(dsidGoldVotes) : undefined,
    validDocIds: dsidValid,
    goldDocIdsOriginal: q.expected_doc_ids,
    goldDocIdsCorrected: corrected ? dsidGoldCorrected : [],
  };
  return row;
}

/** Resume context — present only on /resume; keeps run-claw's behavior byte-identical. */
interface ResumeCtx {
  doneIds: Set<string>;        // question_ids already persisted under this runId
  firstIncompleteIndex: number; // dataset index to slice from (startIndex override)
}

async function runBench(
  runId: string,
  opts: z.infer<typeof runSchema>,
  workspaceId: string,
  resume?: ResumeCtx,
): Promise<void> {
  await loadDsidMapping();   // warm the forward + inverse maps once per run — per-question relabeling is then pure memory
  const questionsAll = await loadQuestions();

  // On resume: skip every question we've already persisted for this runId and
  // reopen the same run row (post-completion rows are upserts keyed on
  // (runId, questionId), so re-attempting a previously-failed question
  // overwrites its error row cleanly).
  const startIndex = resume ? resume.firstIncompleteIndex : opts.startIndex;
  const slice = questionsAll.slice(startIndex, opts.maxQuestions ? startIndex + opts.maxQuestions : undefined);
  const queue = resume ? slice.filter((q) => !resume.doneIds.has(q.question_id)) : [...slice];

  const scoreRows: Array<Record<string, unknown>> = [];
  let corrections = 0;
  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, async () => {
    while (queue.length > 0 && !runState.stopped) {
      const q = queue.shift();
      if (!q) break;
      try {
        const row = await processQuestion(q, opts, workspaceId);
        scoreRows.push(row);
        if (opts.threeJudgeCorrection && row['corrected']) corrections += 1;
        try {
          await onyxStore.upsertQuestion(runId, onyxStore.rowToStoreRow(row));
        } catch (perr) {
          logger.error(`[EnterpriseRAG Eval] persist failed for ${q.question_id}`, { error: perr });
        }
      } catch (err) {
        logger.error(`[EnterpriseRAG Eval] question ${q.question_id} failed`, { error: err });
        const errMsg = err instanceof Error ? err.message : String(err);
        scoreRows.push({
          question_id: q.question_id,
          question_type: q.question_type,
          correctness: 0,
          correctnessReasoning: null,
          completeness: 0,
          documentRecall: null,
          invalidExtraDocs: null,
          answer: null,
          rawAnswer: null,
          documentIds: [] as string[],
          retrieved: [],
          dsidToSynthetic: {},
          goldVotes: undefined,
          validDocIds: [],
          goldDocIdsOriginal: q.expected_doc_ids,
          goldDocIdsCorrected: [],
          error: errMsg,
        } satisfies QuestionScore & Record<string, unknown>);
        try {
          await onyxStore.upsertQuestion(runId, onyxStore.errorStoreRow(q, errMsg));
        } catch (perr) {
          logger.error(`[EnterpriseRAG Eval] persist error failed for ${q.question_id}`, { error: perr });
        }
      } finally {
        runState.processed += 1;
        const cumulativeProcessed = (resume?.doneIds.size ?? 0) + runState.processed;
        void onyxStore.bumpProcessed(runId, cumulativeProcessed).catch(() => { /* non-fatal */ });
      }
    }
  });
  await Promise.all(workers);

  runState.corrections = corrections;
  const aggregate = aggregateMetrics(scoreRows as Array<QuestionScore & Record<string, unknown>>);
  lastResults = { aggregate, rows: scoreRows };
  await onyxStore.finishRun(runId, {
    status: runState.stopped ? 'stopped' : 'completed',
    aggregate,
    corrections,
    processed: (resume?.doneIds.size ?? 0) + runState.processed,
  });
}

// ---------------------------------------------------------------------------
// run-claw schema + routes (all admin/bypass-shared, mounted under /eval)
// ---------------------------------------------------------------------------

const runSchema = z.object({
  maxQuestions: z.number().int().min(1).max(500).optional(),
  startIndex: z.number().int().min(0).default(0),
  topK: z.number().int().min(1).max(25).default(20),
  rankProfile: z.string().default('default_native'),
  concurrency: z.number().int().min(1).max(4).default(1),
  threeJudgeCorrection: z.boolean().default(true),
  model: z.string().optional(),
  resumeFromRunId: z.string().min(1).optional(),
}).strict();

const resumeSchema = z.object({
  runId: z.string().min(1).optional(),
  concurrency: z.number().int().min(1).max(4).optional(),
  threeJudgeCorrection: z.boolean().optional(),
  model: z.string().optional(),
}).strict();

router.get('/questions', authenticateAdmin, async (_req: Request, res: Response): Promise<void> => {
  const qs = await loadQuestions();
  if (qs.length === 0) {
    res.status(503).json({ success: false, error: `questions.jsonl not found at ${QUESTIONS_PATH}` });
    return;
  }
  res.json({ success: true, count: qs.length, questionsPath: QUESTIONS_PATH });
});

router.post('/run-claw', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  // One run at a time: after /stop the caller must wait for runState.running
  // to flip false before starting a new invocation (else workers from the old
  // run share state with the new one).
  if (runState.running) {
    res.status(409).json({ success: false, error: 'A run is already in progress — /stop it and poll /status until running:false first', processed: runState.processed, total: runState.total });
    return;
  }
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid run-claw request', details: parsed.error.flatten() });
    return;
  }
  const qs = await loadQuestions();
  if (qs.length === 0) {
    res.status(503).json({ success: false, error: `questions.jsonl not found at ${QUESTIONS_PATH}` });
    return;
  }
  const context = await resolveContext(req);
  const total = Math.min(parsed.data.maxQuestions ?? qs.length - parsed.data.startIndex, qs.length - parsed.data.startIndex);
  Object.assign(runState, {
    running: true, stopped: false, startedAt: Date.now(), finishedAt: null,
    processed: 0, total, lastError: null, config: parsed.data, corrections: 0,
  });

  let runId = '';
  try {
    runId = await onyxStore.createRun({
      workspaceId: context.workspaceId,
      topK: parsed.data.topK,
      rankProfile: parsed.data.rankProfile,
      concurrency: parsed.data.concurrency,
      threeJudgeCorrection: parsed.data.threeJudgeCorrection,
      model: parsed.data.model,
      maxQuestions: parsed.data.maxQuestions,
    }, total);
  } catch (perr) {
    logger.error('[EnterpriseRAG Eval] failed to create run row — running unpersisted', { error: perr });
  }

  void runBench(runId, parsed.data, context.workspaceId)
    .catch(async (err) => {
      runState.lastError = err instanceof Error ? err.message : String(err);
      if (runId) await onyxStore.finishRun(runId, { status: 'failed', lastError: runState.lastError, processed: runState.processed }).catch(() => { /* ignore */ });
    })
    .finally(() => { runState.running = false; runState.finishedAt = Date.now(); });
  res.status(202).json({ success: true, status: 'running', total, runId, workspaceId: context.workspaceId });
});

/**
 * POST /resume[ /:runId ]
 *   - No runId: pick the latest non-'completed' run (stopped, failed, or stale 'running').
 *   - Reuse the same runId: questions already persisted (upserted) are skipped;
 *     previously-failed questions are re-attempted (their error rows are
 *     overwritten by the per-question upsert).
 *   - Slice extends from the first dataset index with no row, not the last
 *     completed index — workers complete out of order, so done-set (not
 *     position) is authoritative. Defaults reuse the original run's config;
 *     pass concurrency / threeJudgeCorrection / model to override.
 */
async function startResume(req: Request, res: Response): Promise<void> {
  if (runState.running) {
    res.status(409).json({ success: false, error: 'A run is already in progress — /stop it and poll /status until running:false first', processed: runState.processed, total: runState.total });
    return;
  }
  const body = resumeSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ success: false, error: 'Invalid resume request', details: body.error.flatten() });
    return;
  }
  const runIdBody = (req.params['runId'] as string | undefined) ?? body.data.runId;

  const run = runIdBody
    ? await onyxStore.getRunWithQuestions(runIdBody).then((r) => r ? { id: r.id, status: r.status, config: r.config } : null)
    : await onyxStore.findResumableRun();
  if (!run) {
    res.status(404).json({ success: false, error: runIdBody ? `run ${runIdBody} not found` : 'no resumable run (latest is already completed)' });
    return;
  }
  if (run.status === 'completed') {
    res.status(409).json({ success: false, error: `run ${run.id} is already completed` });
    return;
  }

  const qs = await loadQuestions();
  if (qs.length === 0) {
    res.status(503).json({ success: false, error: `questions.jsonl not found at ${QUESTIONS_PATH}` });
    return;
  }
  const doneIds = await onyxStore.getDoneQuestionIds(run.id);

  // Dataset order is fixed → first incomplete dataset index is the slice start.
  let firstIncomplete = 0;
  for (let i = 0; i < qs.length; i++) {
    if (!doneIds.has(qs[i]!.question_id)) { firstIncomplete = i; break; }
    firstIncomplete = i + 1;
  }
  const remaining = qs.length - doneIds.size;
  if (remaining <= 0) {
    await onyxStore.finishRun(run.id, { status: 'completed', processed: doneIds.size });
    res.json({ success: true, status: 'already completed', runId: run.id, completed: doneIds.size });
    return;
  }

  const context = await resolveContext(req);
  await onyxStore.reopenRun(run.id);

  const orig = (run.config as Record<string, unknown> | null) ?? {};
  const opts = runSchema.parse({
    maxQuestions: remaining,      // upper bound; if a later failed question lands beyond it we still run (it's part of the resume tail)
    startIndex: firstIncomplete,
    topK: Number(orig['topK']) || 20,
    rankProfile: String(orig['rankProfile'] ?? 'default_native'),
    concurrency: body.data.concurrency ?? (Number(orig['concurrency']) || 1),
    threeJudgeCorrection: body.data.threeJudgeCorrection ?? (orig['threeJudgeCorrection'] !== false),
    model: body.data.model ?? (orig['model'] as string | undefined),
  });

  Object.assign(runState, {
    running: true, stopped: false, startedAt: Date.now(), finishedAt: null,
    processed: 0, total: remaining, lastError: null, config: opts, corrections: 0,
  });
  void runBench(run.id, opts, context.workspaceId, { doneIds, firstIncompleteIndex: firstIncomplete })
    .catch(async (err) => {
      runState.lastError = err instanceof Error ? err.message : String(err);
      await onyxStore.finishRun(run.id, { status: 'failed', lastError: runState.lastError, processed: doneIds.size + runState.processed }).catch(() => { /* ignore */ });
    })
    .finally(() => { runState.running = false; runState.finishedAt = Date.now(); });

  res.status(202).json({
    success: true, status: 'running', runId: run.id,
    resumedFromIndex: firstIncomplete, alreadyDone: doneIds.size, remaining, workspaceId: context.workspaceId,
  });
}
router.post('/resume', authenticateAdmin, startResume);
router.post('/resume/:runId', authenticateAdmin, startResume);

router.get('/status', authenticateAdmin, (_req: Request, res: Response): void => {
  res.json({ success: true, ...runState, elapsedSeconds: runState.startedAt ? Math.round(((runState.finishedAt ?? Date.now()) - runState.startedAt) / 1000) : 0 });
});

router.post('/stop', authenticateAdmin, (_req: Request, res: Response): void => {
  if (!runState.running) { res.status(409).json({ success: false, error: 'No eval run in progress' }); return; }
  runState.stopped = true;
  res.json({ success: true, status: 'stopping', processed: runState.processed });
});

router.get('/results', authenticateAdmin, (_req: Request, res: Response): void => {
  res.json({ success: true, ...lastResults });
});

router.get('/runs', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  const take = Math.min(Number((req.query['limit'] as string) ?? 20) || 20, 100);
  const runs = await onyxStore.listRuns(take);
  res.json({ success: true, runs });
});

router.get('/runs/:runId', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  const run = await onyxStore.getRunWithQuestions(String(req.params['runId']));
  if (!run) { res.status(404).json({ success: false, error: 'run not found' }); return; }
  res.json({ success: true, run });
});

export default router;
