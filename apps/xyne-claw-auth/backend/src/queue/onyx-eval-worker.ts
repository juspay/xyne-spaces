/**
 * BullMQ worker for background Onyx eval runs (EnterpriseRAG-Bench) —
 * agent-driven variant.
 *
 * Per question, paper-strict §5 flow:
 *
 *   1. dsid → synthetic-Vespa-id resolution via the posted mapping.
 *   2. Retrieval + answering = ONE ask-ai agent run of
 *      `config.onyxEvalAgentSlug` on the question — the agent's view IS its
 *      spaces-search tool, same chain a prod user gets. The run's claw callback
 *      is awaited via Redis by the client, then scraped: the final text =
 *      the answer, tool invocations of spaces-search = retrieval evidence.
 *      We post callback to /claw/api/v1/onyx-evals-callback.
 *   3. The agent's retrieval evidence becomes the measured RETRIEVED SET:
 *      for each spaces-search tool call in invocation order, its params's
 *      ranked result ids are lifted (dedup by first hit).
 *   4. §5.3 GOLD-SET CORRECTION first — 3 independent relevance votes/doc
 *      over gold ∪ retrieved (judges stay on claw), gold-biased majority;
 *      changed required set → /eval-onyx/regenerate-gold from CONTENT of
 *      those docs (via fetchOnyxDocsByIds for promoted-not-retrieved docs —
 *      the ONE infra-side direct fetch; it never guides the agent).
 *   5. Judges on effective (possibly regenerated) gold: binary correctness +
 *      per-fact completeness.
 *   6. Arithmetic: recall over top-10 of the retrieved set as surfaced in (3),
 *      invalid-extras excluding "valid" docs (paper §5.3), leaderboard =
 *      completeness-when-correct.
 *
 * No in harness YQL is ever written for retrieval — that changed vs the
 * originally-planned design after review.
 */
import { Worker, type Job } from "bullmq";
import { redisService } from "../redis.js";
import { CONFIG } from "../config.js";
import { fetchOnyxDocsByIds, type OnyxRetrievedDoc } from "../services/onyx/onyxVespa.js";
import {
  onyxCorrectness,
  onyxFacts,
  onyxRelevance,
  onyxRegenerateGold,
  type OnyxRelevanceLabel,
} from "../services/onyx/onyxClawClient.js";
import * as agent from "../services/onyx/onyxAgentClient.js";
import * as store from "../services/onyx/onyxEvalStore.js";
import { prisma } from "../db.js";
import { isOnyxCancelRequested } from "./onyx-eval-queue.js";
import type { OnyxEvalRunJobData, OnyxEvalRunProgress } from "./onyx-eval-queue.js";

import { createLogger } from "../logger.js";
const log = createLogger("onyx-eval-run-worker");

const QUEUE_NAME = "onyx-eval-run";
/** Paper §5.1: scoring over the first RECALL_K of the retrieved sequence. */
const RECALL_K = 10;
const RESULT_POLL_MS = 2_000;

/** Agent identity — THE ONLY slug the bench ever fires. The seed module owns
 *  the row (`onyx-ask-ai`, hugging the ask-ai persona + memory/citation wiring);
 *  no patching is done at dispatch time. */
const BENCH_AGENT_SLUG = "onyx-ask-ai";

/** Paper answerer contract (the SAME semantics as the original synthetic
 *  `ANSWERER_SYSTEM`, adapted to an agentic flow: there are no EX-[nn] labels
 *  here because retrieval + citation order are scraped from the literal
 *  ordered spaces-search tool-call sequence, NOT from in-answer markers).
 *  Injected at the head of each bench question — the agent keeps its full
 *  identity + tooling, but its ANSWERING CONTRACT is the paper's. */
const BENCH_QUESTION_PREAMBLE = `You are answering an enterprise knowledge question inside the fictional company "Redwood Inference".

ANSWERING CONTRACT (strict — more important than any prior instruction):
- Use the workspace retrieval tools to gather evidence FIRST, then answer with
  ONLY what those retrieved documents say. Do NOT use outside knowledge.
- If the retrieved documents do not contain the answer, say exactly that the
  information is not available — do not guess.
- When retrieved documents conflict, prefer the most recent / superseding
  information and note the discrepancy.
- Answer directly in prose. Do NOT append any citation markers, bracket lists,
  or a reference footer inside the prose body.
- Cover EVERY distinct fact in the retrieved documents relevant to the question.

Question:\n`;

/** Bench toolbox — final-authority dispatch-NARROWING (the row-level config
 *  is the same shape as the seed; re-asserted by the dispatch path so a bent
 *  database can't redirect the run's toolset): retrieval always
 *  `spaces-vespa-search` — the direct-to-benchmark-Vespa tool — nothing else. */
const BENCH_TOOL_CONFIG: Record<string, unknown> = {
  tools: {
    subagents: [], // no delegation — ask-ai's workspace-oriented flow
    direct: ["spaces-vespa-search"],
    custom: [],
  },
};

interface PostedQuestion {
  questionId: string;
  questionType: string;
  sourceTypes: string[];
  question: string;
  expectedDocIds: string[];
  goldAnswer: string;
  answerFacts: string[];
}

interface DsidEntry { sourceType: string; syntheticId: string }

function normalizeQuestion(raw: Record<string, unknown>): PostedQuestion | null {
  if (typeof raw["questionId"] !== "string" || typeof raw["question"] !== "string" || !raw["question"].trim()) return null;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    questionId: raw["questionId"],
    questionType: typeof raw["questionType"] === "string" ? raw["questionType"] : "unknown",
    sourceTypes: arr(raw["sourceTypes"]),
    question: raw["question"],
    expectedDocIds: arr(raw["expectedDocIds"]),
    goldAnswer: typeof raw["goldAnswer"] === "string" ? raw["goldAnswer"] : "",
    answerFacts: arr(raw["answerFacts"]),
  };
}

function resolveDsid(dsid: string, sourceTypes: string[], mapping: Record<string, DsidEntry[]>): DsidEntry | null {
  const entries = mapping[dsid];
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries.find((e) => sourceTypes.includes(e.sourceType)) ?? entries[0]!;
}

/** Strip the agent's citation markers (paper §5.1 says strip before judging);
 *  preserve audit markers in citedDocIds with their ordinal -> dsid map so we
 *  can retain per-doc reference for debugging. */
function stripCitations(answerText: string): { cleaned: string } {
  return {
    cleaned: answerText
      .replace(/\[\s*(?:doc|citation|source)?\s*\w{1,3}\s*\]/gi, "")
      .replace(/EX-\[\d+\]/g, "")
      .replace(/\[\s*\d+\s*\]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

/** Ranked doc ids the agent actually surfaced, from spaces-search invocations
 *  in invocation order (first-sighted dedup). Tool-call payloads vary in shape
 *  between chunk orders; we accept the broadest reasonable shape. */
function retrievalEvidence(toolInvocations: unknown[] | null): { retrievedIds: string[] } {
  if (!Array.isArray(toolInvocations) || toolInvocations.length === 0) return { retrievedIds: [] };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const inv of toolInvocations) {
    if (!inv || typeof inv !== "object") continue;
    const rec = inv as Record<string, unknown>;
    const toolName = String(rec["toolName"] ?? rec["tool"] ?? "");
    if (toolName !== "spaces-search" && toolName !== "xyne-spaces__spaces-search" && toolName !== "spaces-search-v2" && toolName !== "xyne-spaces__spaces-search-v2") continue;
    const result = rec["result"];
    const candidates: string[] = [];
    const collect = (items: unknown) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const id = String(row["id"] ?? row["docId"] ?? "");
        if (id) candidates.push(id);
      }
    };
    if (result && typeof result === "object") {
      const r = result as Record<string, unknown>;
      collect(r["documents"]);
      collect(r["results"]);
      collect(r["hits"]);
      collect(r["citations"]);
      if (Array.isArray(r["children"])) collect(r["children"]);
    }
    // Text-form fallback: markdown/numbered list of doc ids.
    if (candidates.length === 0 && typeof result === "string") {
      const ids = result.match(/ent[a-z0-9-]*-documents?-[a-f0-9]+/gi) ?? [];
      candidates.push(...ids);
    }
    for (const id of candidates) if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return { retrievedIds: out };
}

interface RelevanceVote { label: OnyxRelevanceLabel; note: string }

function majorityVote(votes: OnyxRelevanceLabel[], isGold: boolean): OnyxRelevanceLabel {
  const count = (l: OnyxRelevanceLabel) => votes.filter((v) => v === l).length;
  const req = count("required");
  const val = count("valid");
  const inv = count("invalid");
  if (isGold) {
    if (inv >= 2) return "invalid";
    return req >= val ? "required" : "valid";
  }
  if (req >= 2) return "required";
  if (val >= 2) return "valid";
  if (req + val >= 2) return "valid";
  return "invalid";
}

async function processQuestion(
  q: PostedQuestion,
  cfg: store.OnyxRunConfigShape,
  workspaceId: string,
  run: { id: string; orgId: string | null; createdBy: string | null },
): Promise<store.OnyxQuestionPersist> {
  const dsidToSynthetic: Record<string, { docId: string | null; sourceType: string | null }> = {};
  const goldSyntheticSet = new Set<string>();
  for (const dsid of q.expectedDocIds) {
    const entry = resolveDsid(dsid, q.sourceTypes, cfg.dsidMapping);
    dsidToSynthetic[dsid] = { docId: entry?.syntheticId ?? null, sourceType: entry?.sourceType ?? null };
    if (entry?.syntheticId) goldSyntheticSet.add(entry.syntheticId);
  }

  const orgId = (run.orgId ?? "").trim();
  if (!orgId) throw new Error("bench dispatch misconfigured: run has no orgId");
  // Row exists & supplies identity; narrowing is authority of THIS dispatch —
  // row itself is left exact-as-seeded.
  const agentRow = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId, slug: BENCH_AGENT_SLUG } },
    select: { spacesAppUserId: true },
  });
  if (!agentRow) throw new Error(`onyx-ask-ai agent row missing in org=${orgId} — run the db:seed first — no dispatch`);
  // The bench's direct-vespa tool never asks for a token — userId stops being
  // a real identity and is just a session-owner tag the resolver needs to be
  // able to pin to an existing users row. Registered agents (ask-ai-style)
  // have their own row; the unregistered bench agent inherits the run
  // creator's identity.
  const userId = agentRow.spacesAppUserId?.trim() || run.createdBy?.trim() || "";
  if (!userId) throw new Error("no resolvable userId — run.createdBy empty and agent row unregistered");
  const callbackUrl = `${CONFIG.internalUrl}/claw/api/v1/onyx-evals/callback`;

  // (1) Ask the bench agent: fire + await its callback.
  const ref = { runId: run.id, questionId: q.questionId, orgId };
  let epoch = 0;
  const fire = await agent.fireOnyxQuestionRun({
    orgId,
    agentSlug: BENCH_AGENT_SLUG,
    userId,
    callbackUrl,
    questionText: `${BENCH_QUESTION_PREAMBLE}${q.question}`,
    ref,
    epoch,
    config: BENCH_TOOL_CONFIG,
    ...(cfg.model ? { model: cfg.model } : {}),
  });
  if (!fire.ok) {
    return errored(q, dsidToSynthetic, goldSyntheticSet, `dispatch failed (${fire.failure.reason})`);
  }
  await store.upsertQuestion(run.id, placeholderRow(q, dsidToSynthetic, goldSyntheticSet)).catch(() => {});
  const outcome = await agent.awaitOnyxCompletion(ref, CONFIG.onyxEvalClawTimeoutMs, RESULT_POLL_MS);
  if (!outcome) {
    return errored(q, dsidToSynthetic, goldSyntheticSet, "agent run timed out");
  }
  if (outcome.status !== "completed" || !outcome.answerText) {
    return errored(q, dsidToSynthetic, goldSyntheticSet, outcome.error ?? "agent run returned no answer");
  }

  const answerText = outcome.answerText;
  const { retrievedIds } = retrievalEvidence(outcome.toolInvocations);
  const retrievedIdsTop10 = retrievedIds.slice(0, RECALL_K);

  // (2) Gold-set correction (optional).
  let effectiveGold = new Set(goldSyntheticSet);
  let validIds = new Set<string>();
  let corrected = false;
  let goldVotes: Map<string, { label: OnyxRelevanceLabel; votes: RelevanceVote[] }> | null = null;
  let goldAnswer = q.goldAnswer;
  let answerFacts = q.answerFacts;

  if (cfg.threeJudgeCorrection && q.expectedDocIds.length > 0) {
    const docsById = new Map<string, OnyxRetrievedDoc>();
    for (const id of retrievedIds) {
      docsById.set(id, { docId: id, title: "", content: "", rank: docsById.size + 1, score: 0 });
    }
    goldVotes = new Map();
    validIds = new Set();
    let judgeUnavailableCount = 0;
    const unionIds = new Set<string>([...goldSyntheticSet, ...docsById.keys()]);
    for (const uid of unionIds) {
      const isGold = goldSyntheticSet.has(uid);
      const docObj = docsById.get(uid);
      const votes: RelevanceVote[] = [];
      for (let j = 0; j < 3; j++) {
        const v = docObj
          ? await onyxRelevance({
              question: q.question,
              doc: { benchmarkDocId: uid, title: docObj.title, content: docObj.content },
              ...(cfg.model ? { model: cfg.model } : {}),
            })
          : null;
        if (docObj && v === null) judgeUnavailableCount += 1;
        votes.push({ label: v?.label ?? (isGold ? "required" : "invalid"), note: v?.note ?? (docObj ? "judge_unavailable" : "doc_not_retrieved") });
      }
      goldVotes.set(uid, { label: majorityVote(votes.map((x) => x.label), isGold), votes });
      if (majorityVote(votes.map((x) => x.label), isGold) === "valid") validIds.add(uid);
    }
    const correctedRequired = new Set([...goldVotes.entries()].filter(([, g]) => g.label === "required").map(([id]) => id));
    const changed = correctedRequired.size !== goldSyntheticSet.size || [...goldSyntheticSet].some((x) => !correctedRequired.has(x));
    if (changed) {
      const missing = [...correctedRequired].filter((id) => !docsById.has(id));
      if (missing.length > 0) {
        const fetched = await fetchOnyxDocsByIds(missing, workspaceId);
        for (const d of fetched) docsById.set(d.docId, d);
      }
      const requiredDocs = [...correctedRequired]
        .map((id) => docsById.get(id))
        .filter((d): d is OnyxRetrievedDoc => !!d);
      const regen = await onyxRegenerateGold({
        question: q.question,
        docs: requiredDocs.map((d) => ({ benchmarkDocId: d.docId, title: d.title, content: d.content })),
        originalFacts: q.answerFacts,
        ...(cfg.model ? { model: cfg.model } : {}),
      });
      if (regen && regen.goldAnswer.trim() && regen.answerFacts.length > 0) {
        corrected = true;
        effectiveGold = correctedRequired;
        goldAnswer = regen.goldAnswer;
        answerFacts = regen.answerFacts;
      } else {
        corrected = false;
        log.warn(`[onyx-eval-run] ${q.questionId}: correction discarded (regeneration unavailable)`);
      }
    }
  }

  const { cleaned } = stripCitations(answerText);
  // (3) Judges vs effective gold.
  const judgeRes = goldAnswer && cleaned
    ? await onyxCorrectness({ expected: goldAnswer, generated: cleaned, ...(cfg.model ? { model: cfg.model } : {}) })
    : null;
  const correctness = judgeRes?.correct === 1 ? 1 : 0;
  const correctnessReasoning = judgeRes?.reasoning ?? null;
  const factsRes = answerFacts.length > 0 && cleaned
    ? await onyxFacts({ answer: cleaned, answerFacts, ...(cfg.model ? { model: cfg.model } : {}) })
    : null;
  const completeness = factsRes?.completeness ?? 0;

  // (4) Arithmetic over the RETRIEVED sequence.
  const hasGold = effectiveGold.size > 0;
  const documentRecall = hasGold ? retrievedIdsTop10.filter((id) => effectiveGold.has(id)).length / effectiveGold.size : null;
  const invalidExtra = hasGold ? retrievedIdsTop10.filter((id) => !effectiveGold.has(id) && !validIds.has(id)).length : null;

  return {
    questionId: q.questionId,
    questionType: q.questionType,
    question: q.question,
    retrieved: retrievedIds.map((id, idx) => ({ docId: id, title: "", rank: idx + 1, score: 0 })),
    rawAnswer: answerText,
    answerText: cleaned,
    citedDocIds: [],
    correctness,
    correctnessReasoning,
    completeness,
    factSupported: factsRes?.supported ?? [],
    goldVotes: goldVotes ? Object.fromEntries(goldVotes) : null,
    validDocIds: [...validIds],
    invalidExtra,
    documentRecall,
    corrected,
    goldDocIdsOriginal: q.expectedDocIds,
    goldDocIdsCorrected: corrected ? [...effectiveGold] : [],
    goldAnswer: goldAnswer || null,
    answerFacts,
    dsidToSynthetic,
    error: null,
  };

  function errored(q2: PostedQuestion, map: Record<string, { docId: string | null; sourceType: string | null }>, goldSet: Set<string>, errorMsg: string): store.OnyxQuestionPersist {
    return {
      questionId: q2.questionId,
      questionType: q2.questionType,
      question: q2.question,
      retrieved: [],
      rawAnswer: null,
      answerText: null,
      citedDocIds: [],
      correctness: 0,
      correctnessReasoning: null,
      completeness: 0,
      factSupported: [],
      goldVotes: null,
      validDocIds: [],
      invalidExtra: null,
      documentRecall: null,
      corrected: false,
      goldDocIdsOriginal: q2.expectedDocIds,
      goldDocIdsCorrected: [],
      goldAnswer: q2.goldAnswer || null,
      answerFacts: q2.answerFacts,
      dsidToSynthetic: map,
      error: errorMsg,
    };
  }

  function placeholderRow(q2: PostedQuestion, map: Record<string, { docId: string | null; sourceType: string | null }>, goldSet: Set<string>) {
    return errored(q2, map, goldSet, "in_flight");
  }
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

async function processJob(job: Job<OnyxEvalRunJobData>): Promise<OnyxEvalRunProgress> {
  const { runId } = job.data;
  const run = await store.getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  const cfg = store.parseRunConfig(run.config);
  if (!cfg) throw new Error(`run ${runId}: unparseable config`);

  const workspaceId = CONFIG.onyxWorkspaceId.trim();
  if (!workspaceId) log.warn("[onyx-eval-run] ONYX_EVAL_WORKSPACE_ID unset");
  if (!CONFIG.internalUrl.trim()) throw new Error("AUTH_SERVICE_INTERNAL_URL is not set — the agent's dispatch URL is derive-less.");
  if (!CONFIG.onyxVespaEndpoint.trim()) log.warn("[onyx-eval-run] ONYX_EVAL_VESPA_ENDPOINT unset");

  const questions = cfg.questions.map(normalizeQuestion).filter((q): q is PostedQuestion => q !== null);
  const doneIds = await store.getDoneQuestionIds(runId);
  const queue = questions.filter((q) => !doneIds.has(q.questionId));

  const progress: OnyxEvalRunProgress = { phase: "running", questionsTotal: questions.length, questionsDone: doneIds.size, corrections: 0 };
  await job.updateProgress(progress);

  let cancelled = false;
  await pool(queue, cfg.concurrency, async (q) => {
    if (await isOnyxCancelRequested(job.id!)) {
      cancelled = true;
      return;
    }
    try {
      const row = await processQuestion(q, cfg, workspaceId, run);
      if (row.corrected) progress.corrections += 1;
      await store.upsertQuestion(runId, row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[onyx-eval-run] question ${q.questionId} failed:`, err);
      await store.upsertQuestion(runId, {
        questionId: q.questionId,
        questionType: q.questionType,
        question: q.question,
        retrieved: [],
        rawAnswer: null,
        answerText: null,
        citedDocIds: [],
        correctness: 0,
        correctnessReasoning: null,
        completeness: 0,
        factSupported: [],
        goldVotes: null,
        validDocIds: [],
        invalidExtra: null,
        documentRecall: null,
        corrected: false,
        goldDocIdsOriginal: q.expectedDocIds,
        goldDocIdsCorrected: [],
        goldAnswer: q.goldAnswer || null,
        answerFacts: q.answerFacts,
        dsidToSynthetic: {},
        error: msg,
      });
    } finally {
      progress.questionsDone += 1;
      await job.updateProgress(progress);
      await store.bumpProcessed(runId, progress.questionsDone).catch(() => { /* non-fatal */ });
      await store.refreshAggregate(runId).catch(err => log.warn(`[onyx-eval-run] mid-run aggregate refresh failed (non-fatal): ${err instanceof Error ? err.message : err}`));
    }
  });

  const scoreRows = await store.getScoreRows(runId);
  const aggregate = store.aggregateMetrics(scoreRows);

  if (cancelled || await isOnyxCancelRequested(job.id!)) {
    progress.phase = "stopped";
    await job.updateProgress(progress);
    await store.finishRun(runId, { status: "stopped", aggregate, corrections: progress.corrections, processed: progress.questionsDone });
    return progress;
  }

  progress.phase = "done";
  await job.updateProgress(progress);
  await store.finishRun(runId, { status: "completed", aggregate, corrections: progress.corrections, processed: progress.questionsDone });
  return progress;
}

let worker: Worker<OnyxEvalRunJobData> | undefined;

export function initOnyxEvalRunWorker(): Worker<OnyxEvalRunJobData> {
  if (worker) return worker;
  worker = new Worker<OnyxEvalRunJobData>(QUEUE_NAME, processJob, {
    connection: redisService.getConnection(),
    concurrency: 2,
  });
  worker.on("failed", (job, err) => {
    log.error(`[onyx-eval-run] job ${job?.id} failed:`, err instanceof Error ? err.message : err);
    if (job?.data?.runId) void store.finishRun(job.data.runId, { status: "failed", lastError: err instanceof Error ? err.message : String(err) }).catch(() => {});
  });
  log.info("[onyx-eval-run] Worker started (agent-driven)");
  return worker;
}

export async function closeOnyxEvalRunWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
