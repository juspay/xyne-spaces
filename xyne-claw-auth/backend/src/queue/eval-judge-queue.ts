/**
 * Background SCORING jobs — one or more judges grade a run's turns server-side
 * so the browser doesn't block on a long "Scoring…" modal. Thin typed wrapper
 * over the generic job-queue machine (see job-queue.ts).
 */
import { makeJobQueue } from "./job-queue.js";

export interface EvalJudgeJobData {
  runId: string;
  judges: Array<{ judgeId: string; model?: string }>;
  conversationIds?: string[];
  onlyUnscored?: boolean;
  userId?: string;
}

export interface EvalJudgeProgress {
  phase: "scoring" | "done" | "cancelled" | "failed";
  total: number;
  done: number;
  judged: number;
  failed: number;
  judgeCount: number;
}

const q = makeJobQueue<EvalJudgeJobData, EvalJudgeProgress>("eval-judge");

export const enqueueEvalJudge = q.enqueue;
export const getEvalJudgeStatus = q.getStatus;
export const cancelEvalJudge = q.cancel;
export const isEvalJudgeCancelRequested = q.isCancelRequested;
export const clearEvalJudgeCancel = q.clearCancel;
