/**
 * BullMQ worker for background search-eval runs. For every query row in the
 * run's sheet, searches Vespa (scoped per `permissionMode`) and checks
 * whether the row's goldId — the gold doc's own Vespa docId, whatever entity
 * type it is — shows up in the top-10 results, recording hit + rank + the
 * top-20 (fetched past the scoring cutoff purely for debugging — e.g. seeing
 * that a "miss" actually landed at rank 14) for manual review.
 *
 * Both permission modes go through search-eval-vespa.ts (xyne-claw-auth's own
 * yqlbuilder) — the main xyne-spaces backend is never called here. No Spaces
 * session/token is needed for "with" mode either, since the ACL check just
 * needs a userId value, and xyne-claw-auth's internal userId is JIT-mirrored
 * to equal the Spaces one.
 */
import { Worker, type Job } from "bullmq";
import { redisService } from "../redis.js";
import { CONFIG } from "../config.js";
import { searchEvalRepository, computeSearchEvalSummary, type SearchEvalTopResult } from "../repositories/index.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { searchEvalVespa } from "../mcp/servers/search-eval-vespa.js";
import type { SearchEvalRunJobData, SearchEvalRunProgress } from "./search-eval-run-queue.js";

import { createLogger } from "../logger.js";
const log = createLogger("search-eval-run-worker");

const QUEUE_NAME = "search-eval-run";
/** Hit/rank scoring cutoff — matches what a real search UI shows on one page. */
const TOP_K = 10;
/** How many results to actually fetch + store for debug review — deliberately
 *  past TOP_K so a "miss" row can show where the gold doc really landed
 *  (e.g. rank 14) instead of just "not in the top 10". */
const DEBUG_FETCH_LIMIT = 20;
const QUERY_CONCURRENCY = 4;

interface RawSearchResult {
  id?: string;
  type?: string;
  context?: string;
  relevanceScore?: number;
  searchContext?: { messageId?: string; conversationId?: string; xyneId?: string } | null;
  // transformHit()/resultTransform.ts also return type/title/subtitle/metadata/
  // and a much richer searchContext (senderName, tags, ownerId, threadId, etc.)
  // — not enumerated here since `raw` below stores the whole object untouched.
  [key: string]: unknown;
}

// file/attachment/mail `context` (transformHit's description+chunks join —
// see vespa-direct.ts) can run to several KB, dwarfing every other type's.
// Each type's own `title` (fileName / email subject) already identifies it
// well enough for eval debugging, so it's dropped from what gets persisted —
// this only trims what Search Evals stores/shows, not transformHit() itself
// (still used by the real search-facing MCP tools, which do need the real
// content).
const TYPES_WITHOUT_STORED_CONTEXT = new Set(["file", "attachment", "mail"]);

function stripBigContext(r: RawSearchResult): RawSearchResult {
  if (!r.type || !TYPES_WITHOUT_STORED_CONTEXT.has(r.type)) return r;
  const { context: _context, ...rest } = r;
  return rest;
}

/**
 * A hit if goldId matches the result's own Vespa docId (`id` — the field
 * transformHit()/resultTransform.ts populate identically for every entity
 * type: messageId for a message, the file's own id, channelId, callId, the
 * email's own id, or a ticket's internal id) OR, for tickets specifically,
 * the human-facing xyneId (e.g. "XYNE-13292") — what someone curating a gold
 * sheet by hand would actually have on hand, not the ticket's raw internal id.
 */
function matchesGoldId(result: RawSearchResult, goldId: string): boolean {
  const docId = result.id ?? result.searchContext?.messageId;
  if (docId && docId === goldId) return true;
  return Boolean(result.searchContext?.xyneId && result.searchContext.xyneId === goldId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

interface SearchDebugPayload { stage: string; yql: string; vespaParams: Record<string, unknown> }

/** Extract the flat results array from searchEvalVespa()'s response
 *  ({success, data: {grouped: false, results, debug}}). */
function extractResults(resp: unknown): RawSearchResult[] {
  const data = (resp as { data?: { results?: unknown } } | undefined)?.data;
  return Array.isArray(data?.results) ? (data.results as RawSearchResult[]) : [];
}

/** Extract the captured YQL debug payloads. */
function extractDebugPayloads(resp: unknown): SearchDebugPayload[] {
  const debug = (resp as { data?: { debug?: { payloads?: unknown } } } | undefined)?.data?.debug;
  return Array.isArray(debug?.payloads) ? (debug.payloads as SearchDebugPayload[]) : [];
}

async function processJob(job: Job<SearchEvalRunJobData>): Promise<SearchEvalRunProgress> {
  const { runId, sheetId, permissionMode, queryType, rankProfile, rankProfileInputs, asOfTimestamp, userId } = job.data;

  const sheet = await searchEvalRepository.getSheet(sheetId);
  const queries = sheet?.queries ?? [];

  const progress: SearchEvalRunProgress = { phase: "running", queriesTotal: queries.length, queriesDone: 0 };
  await job.updateProgress(progress);

  // Resolve once per run, not per query.
  const workspaceId = await getWorkspaceIdForUser(userId, "unknown");
  if (!workspaceId) {
    throw new Error(`Could not resolve a workspaceId for user ${userId}.`);
  }

  const typeParam = queryType.length > 0 ? queryType.join(",") : undefined;
  const beforeParam = asOfTimestamp ?? undefined;
  const rankProfileParam = rankProfile ?? undefined;

  const outcomes: Array<{ hit: boolean; rank: number | null }> = [];

  await pool(queries, QUERY_CONCURRENCY, async (row) => {
    try {
      const resp = await searchEvalVespa({
        q: row.query,
        workspaceId,
        limit: DEBUG_FETCH_LIMIT,
        permissionMode,
        ...(permissionMode === "with" ? { userId } : {}),
        ...(typeParam ? { type: typeParam } : {}),
        ...(beforeParam ? { before: beforeParam } : {}),
        ...(rankProfileParam ? { rankProfile: rankProfileParam } : {}),
        ...(rankProfileInputs ? { rankProfileInputs } : {}),
      });

      // Human-readable dump of the exact request + generated YQL for this query,
      // so every case (permission mode × type × date filter) can be eyeballed
      // and confirmed directly from the log rather than inferred from hit/miss.
      const debugPayloads = extractDebugPayloads(resp);
      const yqlBlock = debugPayloads.length > 0
        ? debugPayloads.map((p) => `  [${p.stage}]\n${p.yql.split("\n").map((l) => `    ${l}`).join("\n")}`).join("\n")
        : "  (no YQL captured)";
      log.info(
        [
          "",
          "═══════════════════════════════════════════════════════════",
          `[search-eval-run] query: "${row.query}"`,
          `  queryId:        ${row.id}`,
          `  permissionMode: ${permissionMode}`,
          `  type:           ${typeParam ?? "(all types)"}`,
          `  before:         ${beforeParam ?? "(none)"}`,
          "  YQL:",
          yqlBlock,
          "═══════════════════════════════════════════════════════════",
        ].join("\n"),
      );

      const results = extractResults(resp).slice(0, DEBUG_FETCH_LIMIT);

      // Hit/rank is scored against the first TOP_K only — matches what a real
      // search UI would show; results past that are kept for debug display only.
      let hitRank: number | null = null;
      results.slice(0, TOP_K).forEach((r, idx) => {
        if (hitRank !== null) return;
        if (matchesGoldId(r, row.goldId)) hitRank = idx + 1;
      });

      const topResults: SearchEvalTopResult[] = results.map((r) => ({
        id: r.id ?? null,
        xyneId: r.searchContext?.xyneId ?? null,
        messageId: r.searchContext?.messageId ?? r.id ?? null,
        conversationId: r.searchContext?.conversationId ?? null,
        relevanceScore: typeof r.relevanceScore === "number" ? r.relevanceScore : null,
        snippet: TYPES_WITHOUT_STORED_CONTEXT.has(r.type ?? "") ? null : (r.context ?? null),
        // Full untouched result object (title, type, subtitle, metadata, the
        // complete searchContext — everything transformHit()/resultTransform.ts
        // return), minus `context` for file/attachment results (see
        // stripBigContext) — the projected fields above are just quick-access
        // convenience, this is what the debug UI's detail view renders in full.
        raw: stripBigContext(r) as Record<string, unknown>,
      }));

      await searchEvalRepository.upsertResult({
        runId,
        queryId: row.id,
        hit: hitRank !== null,
        rank: hitRank,
        topResults,
        debug: debugPayloads,
      });
      outcomes.push({ hit: hitRank !== null, rank: hitRank });
    } catch (err) {
      log.error(`[search-eval-run] query ${row.id} failed:`, err instanceof Error ? err.message : err);
      await searchEvalRepository.upsertResult({ runId, queryId: row.id, hit: false, rank: null, topResults: [] });
      outcomes.push({ hit: false, rank: null });
    }
    progress.queriesDone += 1;
    await job.updateProgress(progress);
    // Throttle Vespa load — applies in both permission modes, both hit Vespa directly.
    if (CONFIG.searchEvalQueryDelayMs > 0) await sleep(CONFIG.searchEvalQueryDelayMs);
  });

  progress.phase = "done";
  await job.updateProgress(progress);
  const summary = computeSearchEvalSummary(outcomes);
  await searchEvalRepository.updateRunStatus(runId, "completed", summary);
  return progress;
}

let worker: Worker<SearchEvalRunJobData> | undefined;

export function initSearchEvalRunWorker(): Worker<SearchEvalRunJobData> {
  if (worker) return worker;
  worker = new Worker<SearchEvalRunJobData>(QUEUE_NAME, processJob, {
    connection: redisService.getConnection(),
    concurrency: 2,
  });
  worker.on("failed", (job, err) => {
    log.error(`[search-eval-run] job ${job?.id} failed:`, err instanceof Error ? err.message : err);
    if (job?.data?.runId) void searchEvalRepository.updateRunStatus(job.data.runId, "failed").catch(() => {});
  });
  log.info("[search-eval-run] Worker started");
  return worker;
}

export async function closeSearchEvalRunWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
