/**
 * BullMQ worker for background eval runs. Replays each conversation against the
 * chosen agent server-side (via evalRunReplay → the agent-chat SSE path),
 * writing an EvalTurnResult per turn and ticking progress. Resilient to the
 * browser closing; cancellable via a Redis flag.
 */
import { Worker, type Job } from "bullmq";
import { redisService } from "../redis.js";
import { evalRepository } from "../repositories/index.js";
import { replayTurn } from "../services/evalGenerationReplay.js";
import {
  isEvalGenerationCancelRequested,
  clearEvalGenerationCancel,
  type EvalGenerationJobData,
  type EvalGenerationProgress,
} from "./eval-generation-queue.js";

import { createLogger } from "../logger.js";
const log = createLogger("eval-generation-worker");

const QUEUE_NAME = "eval-generation";
const CONV_CONCURRENCY = 2; // conversations in parallel (turns within one stay sequential)

interface ConvTurn {
  message: string;
  expectedResponse?: string | null;
}

/** Max simultaneous LLM streams per provider across ALL runs. Copilot cuts
 *  concurrent streams on one account ("terminated"), so it gets 1. */
function providerStreamCap(provider: string): number {
  if (provider === "copilot") return 1;
  return Math.max(1, Number(process.env["EVAL_RUN_PROVIDER_STREAMS"] ?? 2));
}

class TurnCancelledError extends Error {}

/** Acquire a slot in the provider's global stream budget, run fn, release.
 *
 *  Slots are individual Redis keys (eval-generation:stream:<provider>:<i>) with their
 *  own TTLs — NOT a shared counter. A crashed/restarted worker's slot simply
 *  expires (TTL 900s > the 600s replay timeout), so a leak can never wedge the
 *  budget. (The previous counter design leaked on hot-restart, and its TTL
 *  "guard" was refreshed by the very waiters stuck behind the leak.)
 *  Waiting respects run cancellation. */
async function withProviderSlot<T>(provider: string, jobId: string, fn: () => Promise<T>): Promise<T> {
  const cap = providerStreamCap(provider);
  const redis = redisService.getConnection();
  const token = `${jobId}:${process.pid}:${Date.now()}`;
  let heldKey: string | null = null;
  for (;;) {
    for (let i = 0; i < cap; i++) {
      const key = `eval-generation:stream:${provider}:${i}`;
      const ok = await redis.set(key, token, "EX", 900, "NX");
      if (ok) {
        heldKey = key;
        break;
      }
    }
    if (heldKey) break;
    await new Promise((r) => setTimeout(r, 3000));
    if (await isEvalGenerationCancelRequested(jobId)) throw new TurnCancelledError("cancelled while waiting for provider slot");
  }
  try {
    return await fn();
  } finally {
    // Release only our own slot (don't free a successor's after a TTL expiry).
    const v = await redis.get(heldKey).catch(() => null);
    if (v === token) await redis.del(heldKey).catch(() => {});
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

async function processJob(job: Job<EvalGenerationJobData>): Promise<EvalGenerationProgress> {
  const { runId, agentSlug, userId, conversationIds, genProvider, genModel } = job.data;
  const jobId = job.id!;
  // Pin the generation LLM for every replayed turn when the run requested one.
  const providerOverride = genProvider ? { provider: genProvider, ...(genModel ? { model: genModel } : {}) } : undefined;

  const conversations = await evalRepository.getConversationsByIds(conversationIds);
  const turnsTotal = conversations.reduce((n, c) => n + ((c.turns as unknown as ConvTurn[]) ?? []).length, 0);

  const progress: EvalGenerationProgress = (job.progress && typeof job.progress === "object"
    ? (job.progress as EvalGenerationProgress)
    : { phase: "running", conversationsTotal: conversations.length, conversationsDone: 0, turnsTotal, turnsDone: 0, turnsFailed: 0 });
  progress.conversationsTotal = conversations.length;
  progress.turnsTotal = turnsTotal;
  await job.updateProgress(progress);

  let cancelled = false;

  // Cancel watcher: polls the Redis cancel flag every 2s and aborts the
  // in-flight turn requests immediately — without this, "Cancel" only took
  // effect at the next turn boundary, which can be minutes away.
  const abortCtl = new AbortController();
  const cancelWatcher = setInterval(() => {
    void isEvalGenerationCancelRequested(jobId).then((flag) => {
      if (flag && !cancelled) {
        cancelled = true;
        abortCtl.abort();
      }
    });
  }, 2000);

  await pool(conversations, CONV_CONCURRENCY, async (conv) => {
    if (cancelled) return;
    const turns = (conv.turns as unknown as ConvTurn[]) ?? [];
    const clawConvId = `eval-${runId}-${conv.id}`;
    for (let ti = 0; ti < turns.length; ti++) {
      if (cancelled || (await isEvalGenerationCancelRequested(jobId))) {
        cancelled = true;
        return;
      }
      const turn = turns[ti]!;
      try {
        const providerKey = genProvider || "default";
        // The "running" marker goes INSIDE the provider slot — a turn waiting
        // for the provider budget isn't running yet, and marking it early made
        // the UI look like two parallel streams when only one was live.
        const reply = await withProviderSlot(providerKey, jobId, async () => {
          await evalRepository.upsertTurnResult({
            runId,
            conversationId: conv.id,
            turnIndex: ti,
            inputMessage: turn.message,
            expectedResponse: turn.expectedResponse ?? null,
            status: "running",
            clawConversationId: clawConvId,
          });
          return replayTurn(agentSlug, turn.message, clawConvId, userId, providerOverride, abortCtl.signal);
        });
        const status = reply.status === "completed" ? "completed" : "failed";
        await evalRepository.upsertTurnResult({
          runId,
          conversationId: conv.id,
          turnIndex: ti,
          inputMessage: turn.message,
          expectedResponse: turn.expectedResponse ?? null,
          clawAnswer: reply.content,
          reasoning: reply.reasoning,
          toolInvocations: reply.toolInvocations,
          status,
          clawConversationId: clawConvId,
          ...(reply.sessionId ? { sessionId: reply.sessionId } : {}),
        });
        if (status === "failed") progress.turnsFailed += 1;
      } catch (err) {
        // User-cancelled mid-turn: leave the turn unfinished, don't count it
        // as a model failure.
        if (cancelled) {
          await evalRepository.upsertTurnResult({
            runId,
            conversationId: conv.id,
            turnIndex: ti,
            inputMessage: turn.message,
            expectedResponse: turn.expectedResponse ?? null,
            clawAnswer: "(cancelled)",
            status: "failed",
            clawConversationId: clawConvId,
          });
          return;
        }
        await evalRepository.upsertTurnResult({
          runId,
          conversationId: conv.id,
          turnIndex: ti,
          inputMessage: turn.message,
          expectedResponse: turn.expectedResponse ?? null,
          clawAnswer: err instanceof Error ? err.message : "Run failed",
          status: "failed",
          clawConversationId: clawConvId,
        });
        progress.turnsFailed += 1;
      }
      progress.turnsDone += 1;
      await job.updateProgress(progress);
    }
    progress.conversationsDone += 1;
    await job.updateProgress(progress);
  });

  clearInterval(cancelWatcher);

  if (cancelled) {
    progress.phase = "cancelled";
    await evalRepository.updateRunStatus(runId, "cancelled").catch(() => {});
    await clearEvalGenerationCancel(jobId);
  } else {
    progress.phase = "done";
    await evalRepository.updateRunStatus(runId, "completed").catch(() => {});
  }
  await job.updateProgress(progress);
  return progress;
}

let worker: Worker<EvalGenerationJobData> | undefined;

export function initEvalGenerationWorker(): Worker<EvalGenerationJobData> {
  if (worker) return worker;
  worker = new Worker<EvalGenerationJobData>(QUEUE_NAME, processJob, {
    connection: redisService.getConnection(),
    // Parallel runs are fine — per-provider stream budgets below keep any one
    // provider account from being hit by too many concurrent streams.
    concurrency: 2,
  });
  worker.on("failed", (job, err) => {
    log.error(`[eval-run] job ${job?.id} failed:`, err instanceof Error ? err.message : err);
    if (job?.data?.runId) void evalRepository.updateRunStatus(job.data.runId, "failed").catch(() => {});
  });
  log.info("[eval-run] Worker started");
  return worker;
}

export async function closeEvalGenerationWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
