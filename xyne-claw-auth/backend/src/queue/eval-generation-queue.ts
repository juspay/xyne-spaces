/**
 * Background GENERATION jobs — replaying conversations against an agent
 * server-side, so a generation survives the browser tab closing. Thin typed
 * wrapper over the generic job-queue machine (see job-queue.ts).
 */
import { makeJobQueue } from "./job-queue.js";

export interface EvalGenerationJobData {
  runId: string;
  agentSlug: string;
  userId: string;
  conversationIds: string[];
  genProvider?: string;
  genModel?: string;
}

export interface EvalGenerationProgress {
  phase: "running" | "done" | "cancelled" | "failed";
  conversationsTotal: number;
  conversationsDone: number;
  turnsTotal: number;
  turnsDone: number;
  turnsFailed: number;
}

const q = makeJobQueue<EvalGenerationJobData, EvalGenerationProgress>("eval-generation");

export const enqueueEvalGeneration = q.enqueue;
export const getEvalGenerationStatus = q.getStatus;
export const cancelEvalGeneration = q.cancel;
export const isEvalGenerationCancelRequested = q.isCancelRequested;
export const clearEvalGenerationCancel = q.clearCancel;
