/**
 * Routes for the awakening pipeline.
 *
 * The result callback is deliberately its OWN route rather than reusing
 * /webhook/result: that handler is a long shared hot path carrying every
 * user-facing delivery concern (thread replies, cards, follow-ups, twin
 * routing). An unattended run needs none of it — it needs to close its ledger
 * row. Keeping them separate means awakening can never regress human chat, and
 * a change to human chat delivery can never silently alter what an unattended
 * agent does.
 */

import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireNoAccessToken, requireStrictS2S } from "../middleware/require-auth.js";
import { requireClawAdmin } from "../middleware/agent-acl.js";
import { agentRunRepository, chatMessageRepository } from "../repositories/index.js";
import type { FinalizeRunInput } from "../repositories/agentRunRepository.js";
import { releaseAgentLock } from "../awakening/lock.js";
import { clearInbox, drainInbox } from "../awakening/inbox.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-routes");

export const awakeningRouter: Router = Router();

interface ResultBody {
  sessionId?: string;
  status?: string;
  result?: string;
  error?: string;
  // Run telemetry claw sends with every terminal callback. An unattended run
  // has no human watching it live, so the stored row is the ONLY record an
  // admin can review afterwards — dropping these left the activity view
  // showing a result with no tools, no token cost and no timings.
  reasoning?: string;
  provider?: string;
  model?: string;
  toolsUsed?: unknown;
  toolInvocations?: unknown;
  tokenUsage?: FinalizeRunInput["tokenUsage"];
  latency?: FinalizeRunInput["latency"];
}

/**
 * Give back the events a finished run never actually consumed.
 *
 * The reflex watermark advances the moment a batch is QUEUED, not when the run
 * drains it — deliberately, so a slow drain cannot re-trigger the same events.
 * But a run can end with batches still queued (it converged, failed, or simply
 * stopped calling tools), and clearing the inbox at that point would step the
 * watermark permanently over events nobody ever saw.
 *
 * So before clearing, take what is left and roll the watermark back to the
 * START of the earliest undelivered window. Those events are then re-counted on
 * the next check and land in the next run. Only ever moves the watermark
 * BACKWARDS, and only past events this session was given but did not read.
 */
async function rewindWatermarkForUndelivered(agentId: string, sessionId: string): Promise<void> {
  try {
    const undelivered = await drainInbox(sessionId);
    if (undelivered.length === 0) return;

    const starts = undelivered
      .map((batch) => batch.windowStartMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (starts.length === 0) return;

    const rewindTo = new Date(Math.min(...starts));
    const state = await prisma.agentAwakeningState.findUnique({
      where: { agentId },
      select: { reflexWatermarkAt: true },
    });
    // Never move it forward, and never rewind past a watermark that some other
    // run has already legitimately pushed further back.
    if (state?.reflexWatermarkAt && state.reflexWatermarkAt <= rewindTo) return;

    await prisma.agentAwakeningState.update({
      where: { agentId },
      data: { reflexWatermarkAt: rewindTo, reflexNextCheckAt: new Date() },
    });
    log.info(
      `[awakening] rewound reflex watermark agent=${agentId} to ${rewindTo.toISOString()} ` +
      `(${undelivered.length} undelivered batch(es) from session=${sessionId})`,
    );
  } catch (err) {
    log.warn(
      `[awakening] watermark rewind failed session=${sessionId}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/** claw sends tool names as a string[]; be defensive about anything else. */
function toolNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.filter((entry): entry is string => typeof entry === "string");
  return names.length > 0 ? names : undefined;
}

/**
 * POST /awakening/:idempotencyKey/result — terminal callback from xyne-claw.
 *
 * Idempotent by construction: it writes completedAt on a row keyed by the same
 * idempotencyKey the dispatch used, so a duplicate delivery (retry, recovery
 * refire) just rewrites the same values.
 */
awakeningRouter.post("/awakening/:idempotencyKey/result", requireStrictS2S, async (req: Request, res: Response) => {
  const { idempotencyKey } = req.params as { idempotencyKey?: string };
  if (!idempotencyKey) {
    res.status(400).json({ success: false, error: "idempotencyKey is required" });
    return;
  }

  const body = (req.body ?? {}) as ResultBody;
  const failed = body.status === "failed" || Boolean(body.error);

  // Ack first, reconcile after: xyne-claw must never block on our bookkeeping,
  // and every write below is best-effort and independently retryable.
  res.json({ success: true });

  await prisma.agentAwakeningRun
    .updateMany({
      where: { idempotencyKey },
      data: {
        completedAt: new Date(),
        ...(failed ? { outcome: "failed", skipReason: (body.error ?? "run failed").slice(0, 500) } : {}),
      },
    })
    .catch((err: unknown) =>
      log.warn(
        `[awakening] result bookkeeping failed key=${idempotencyKey}: ${err instanceof Error ? err.message : err}`,
      ),
    );

  if (body.sessionId) {
    // Persist the agent's answer as the assistant turn, so the awakened
    // conversation opens and reads like any other in the chat UI. Mirrors what
    // the scheduled-job result route does — the shared /webhook/result path
    // does it too, but awakening deliberately does not go through there.
    const run = await agentRunRepository.findBySessionId(body.sessionId).catch(() => null);
    if (run?.conversationId && (body.result?.trim() || body.error)) {
      await chatMessageRepository
        .create({
          conversationId: run.conversationId,
          agentSlug: run.agentSlug,
          userId: run.userId,
          role: "assistant",
          content: body.result?.trim() || `Run failed: ${body.error ?? "unknown error"}`,
          status: failed ? "failed" : "completed",
          orgId: run.orgId ?? "",
        })
        .catch((err: unknown) =>
          log.warn(
            `[awakening] assistant ChatMessage failed key=${idempotencyKey}: ${err instanceof Error ? err.message : err}`,
          ),
        );
    }

    await agentRunRepository
      .finalize(body.sessionId, {
        status: failed ? "failed" : "completed",
        ...(body.result ? { result: body.result } : {}),
        ...(body.error ? { error: body.error } : {}),
        ...(body.reasoning ? { reasoning: body.reasoning } : {}),
        ...(body.provider ? { provider: body.provider } : {}),
        ...(body.model ? { model: body.model } : {}),
        ...(toolNames(body.toolsUsed) ? { toolsUsed: toolNames(body.toolsUsed)! } : {}),
        ...(body.toolInvocations !== undefined ? { toolInvocations: body.toolInvocations } : {}),
        ...(body.tokenUsage ? { tokenUsage: body.tokenUsage } : {}),
        ...(body.latency ? { latency: body.latency } : {}),
      })
      .catch((err: unknown) =>
        log.warn(`[awakening] AgentRun.finalize failed: ${err instanceof Error ? err.message : err}`),
      );
  }

  // Free the agent so the next wake can proceed, and drop any injection batch
  // the finished run never drained. Both are keyed on the session, so a stale
  // callback from an older run cannot free a newer run's lock.
  const row = await prisma.agentAwakeningRun
    .findUnique({ where: { idempotencyKey }, select: { agentId: true, sessionId: true } })
    .catch(() => null);
  const sessionId = body.sessionId ?? row?.sessionId;
  if (row?.agentId && sessionId) {
    await releaseAgentLock(row.agentId, sessionId).catch(() => undefined);
    await rewindWatermarkForUndelivered(row.agentId, sessionId);
    await clearInbox(sessionId).catch(() => undefined);
  }

  log.info(`[awakening] result key=${idempotencyKey} status=${failed ? "failed" : "completed"}`);
});

/**
 * POST /awakening/inbox/:sessionId/drain — the live-injection pull.
 *
 * Called by the claw pod that OWNS the session, at its own turn boundaries.
 * That is the whole point of making this a pull: claw is horizontally scaled
 * and a session lives in one pod's memory, so nothing outside that pod can
 * address it. The pod asking for its own mail needs no routing at all.
 *
 * Returns and CLEARS whatever is queued. A batch handed out here is considered
 * delivered — the caller steers it into the session immediately, and a pod
 * that dies mid-turn loses at most one batch, which the next reflex re-counts.
 */
awakeningRouter.post("/awakening/inbox/:sessionId/drain", requireStrictS2S, async (req: Request, res: Response) => {
  const { sessionId } = req.params as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const batches = await drainInbox(sessionId);
  res.json({
    success: true,
    batches: batches.map((b) => ({
      ordinal: b.ordinal,
      eventCount: b.eventCount,
      text: b.text,
      isFinal: b.isFinal,
    })),
  });
});

/**
 * GET /awakening/:agentId/status — operator view of one agent's beat.
 * Answers "is it running, when is the next beat, why did it skip".
 */
awakeningRouter.get(
  "/awakening/:agentId/status",
  requireAuth,
  requireNoAccessToken,
  requireClawAdmin,
  async (req: Request, res: Response) => {
  const { agentId } = req.params as { agentId?: string };
  if (!agentId) {
    res.status(400).json({ success: false, error: "agentId is required" });
    return;
  }

  const [state, recent] = await Promise.all([
    prisma.agentAwakeningState.findUnique({ where: { agentId } }),
    prisma.agentAwakeningRun.findMany({
      where: { agentId },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
  ]);

  res.json({
    success: true,
    data: {
      state,
      // BigInt is not JSON-serializable; window bounds go out as numbers.
      recent: recent.map((r) => ({
        ...r,
        windowStartMs: Number(r.windowStartMs),
        windowEndMs: Number(r.windowEndMs),
      })),
    },
  });
  },
);
