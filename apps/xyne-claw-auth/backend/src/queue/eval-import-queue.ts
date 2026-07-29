/**
 * Background "import from Spaces" jobs — page a channel's conversations,
 * extract (query, response) pairs, persist EvalConversations. Thin typed
 * wrapper over the generic job-queue machine (see job-queue.ts).
 */
import { makeJobQueue } from "./job-queue.js";

export interface EvalImportJobData {
  folderId: string;
  userId: string;
  kind: "thread" | "channel" | "email-channel";
  channelId?: string;
  conversationId?: string;
  from?: string;
  to?: string;
  model?: string;
}

export interface EvalImportProgress {
  phase: "scanning" | "done" | "cancelled";
  conversationsScanned: number;
  pairsFound: number;
  conversationsCreated: number;
  duplicatesSkipped: number;
  conversationsUpdated: number;
  capped: boolean;
  cursor?: string;
}

const q = makeJobQueue<EvalImportJobData, EvalImportProgress>("eval-import", { attempts: 3 });

export const enqueueEvalImport = q.enqueue;
export const getEvalImportStatus = q.getStatus;
export const cancelEvalImport = q.cancel;
export const isCancelRequested = q.isCancelRequested;
export const clearCancel = q.clearCancel;
