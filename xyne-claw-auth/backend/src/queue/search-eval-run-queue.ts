/**
 * Background SEARCH EVAL RUN jobs — searching Vespa for every query in a
 * sheet under a fixed config (entity types, permission mode, as-of
 * timestamp) and scoring hit/rank against each row's gold id. Thin typed
 * wrapper over the generic job-queue machine (see job-queue.ts).
 */
import { makeJobQueue } from "./job-queue.js";

export interface SearchEvalRunJobData {
  runId: string;
  sheetId: string;
  permissionMode: "with" | "without";
  queryType: string[];
  rankProfile: string | null;
  rankProfileInputs: Record<string, number> | null;
  asOfTimestamp: string | null; // ISO string (Date isn't JSON-safe across the Redis boundary)
  userId: string;
}

export interface SearchEvalRunProgress {
  phase: "running" | "done" | "failed";
  queriesTotal: number;
  queriesDone: number;
}

const q = makeJobQueue<SearchEvalRunJobData, SearchEvalRunProgress>("search-eval-run");

export const enqueueSearchEvalRun = q.enqueue;
export const getSearchEvalRunStatus = q.getStatus;
