/**
 * Background ONYX EVAL RUN jobs — one job per /onyx-evals/run: the worker
 * walks the run's posted question slice, retrieves from the eval Vespa, calls
 * claw's /eval-onyx/* judges per question, and scores the paper §5.1 metrics.
 *
 * Thin typed wrapper over the generic job-queue machine (see job-queue.ts) —
 * one queue per workload is this service's convention (search-eval-run,
 * eval-judge, eval-generation, ...): it gives the run its own worker
 * concurrency + retry/backoff policy, its namespaced cancel key
 * (`onyx-eval-run:cancel:<jobId>` is how /stop works), and clean queue-level
 * visibility without type unions across unrelated workers.
 */
import { makeJobQueue } from "./job-queue.js";

export interface OnyxEvalRunJobData {
  runId: string;
  /** Requester's userId (audit only — retrieval is env-scoped, not user-scoped). */
  userId: string;
}

export interface OnyxEvalRunProgress {
  phase: "running" | "done" | "failed" | "stopped";
  questionsTotal: number;
  questionsDone: number;
  corrections: number;
}

const q = makeJobQueue<OnyxEvalRunJobData, OnyxEvalRunProgress>("onyx-eval-run");

export const enqueueOnyxEvalRun = q.enqueue;
export const getOnyxEvalRunStatus = q.getStatus;
/** /stop: sets the namespaced cancel flag; the worker polls it per question. */
export const cancelOnyxEvalRun = q.cancel;
export const isOnyxCancelRequested = q.isCancelRequested;
