/**
 * The reflex check worker: one cheap COUNT per agent per interval, escalating
 * to a full collect only when enough has actually happened.
 *
 * Claimed with the same `FOR UPDATE SKIP LOCKED` pattern as the heartbeat tick
 * so it is safe on every pod, but against `reflexNextCheckAt` — reflex runs on
 * its own, much faster cadence.
 *
 * Watermark discipline mirrors the heartbeat worker, with one addition: on an
 * INJECT the reflex watermark still advances, because those events have been
 * handed to the live session and must not be counted toward the next trigger.
 * Handed to, not necessarily read by — a run can end with batches still queued,
 * so the result callback rolls the watermark back over anything undelivered
 * (rewindWatermarkForUndelivered in routes/awakening.ts).
 */

import { Worker, type Job } from "bullmq";
import { redisService } from "../redis.js";
import { prisma } from "../db.js";
import { resolveAwakeningConfig, participatesIn } from "../awakening/config.js";
import { resolveAwakeningChannels } from "../awakening/channel-resolver.js";
import { collectWindow } from "../awakening/collector.js";
import { computeSignals } from "../awakening/signals.js";
import { countEventsSince, decideReflex, renderInjection, logDecision } from "../awakening/reflex.js";
import { acquireAgentLock, readAgentLock, releaseAgentLock } from "../awakening/lock.js";
import { pushInjection, readInjectionStats } from "../awakening/inbox.js";
import { dispatchAwakening, resolveAgentIdentity, AwakeningIdentityError } from "../awakening/dispatch.js";
import { resolveWorkspaceId, WorkspaceResolutionError } from "../awakening/workspace.js";
import { peekRunRate, consumeRunRate } from "../awakening/rate-limit.js";
import { REFLEX_QUEUE_NAME, type AwakeningReflexJobData } from "./awakening-queue.js";
import type { AwakeningWindow } from "../awakening/types.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-reflex-worker");

let worker: Worker<AwakeningReflexJobData> | undefined;

function nextCheckAt(intervalMs: number): Date {
  return new Date(Date.now() + intervalMs);
}

/** One-line-per-thread outline for an injection batch. */
function outlineFor(window: AwakeningWindow): string[] {
  const byThread = new Map<string, { title: string; channel: string; n: number; last: string }>();
  for (const e of window.events) {
    const entry = byThread.get(e.cv) ?? { title: e.cvTitle, channel: e.chName, n: 0, last: "" };
    entry.n++;
    entry.last = e.text.length > 100 ? `${e.text.slice(0, 97)}…` : e.text;
    byThread.set(e.cv, entry);
  }
  return [...byThread.entries()].map(
    ([cv, t]) => `- ${t.channel} / \`${cv}\` — "${t.title}" (${t.n} new): ${t.last.replace(/\n/g, " ")}`,
  );
}

async function processReflex(job: Job<AwakeningReflexJobData>): Promise<void> {
  const { agentId, orgId } = job.data;

  const state = await prisma.agentAwakeningState.findUnique({ where: { agentId } });
  if (!state?.enabled) return;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true, slug: true, orgId: true, config: true,
      spacesAppId: true, spacesAppUserId: true, spacesAppToken: true,
    },
  });
  if (!agent) return;

  const config = resolveAwakeningConfig(agent.config);
  if (!config.enabled || !participatesIn(config, "reflex")) return;

  try {
    const workspaceId = await resolveWorkspaceId(orgId, agent.spacesAppUserId, config.workspaceId);
    const identity = resolveAgentIdentity(agent, workspaceId);

    const sinceMs = (state.reflexWatermarkAt ?? state.watermarkAt).getTime();
    const untilMs = Date.now() - config.cursor.replicaSafetyMs;
    if (untilMs <= sinceMs) return;

    const resolved = await resolveAwakeningChannels(agentId, config.channels, identity, config.reflex.checkIntervalMs);
    if (resolved.channels.length === 0) return;

    const count = await countEventsSince(resolved.channels, sinceMs, untilMs, identity);
    const holder = await readAgentLock(agentId);
    const stats = holder ? await readInjectionStats(holder.sessionId) : { used: 0, lastAtMs: 0 };

    const decision = decideReflex({
      count,
      config,
      busyWithSessionId: holder?.sessionId ?? null,
      sinceLastRunMs: state.reflexLastRunAt ? Date.now() - state.reflexLastRunAt.getTime() : Number.POSITIVE_INFINITY,
      injectionsUsed: stats.used,
      sinceLastInjectionMs: stats.lastAtMs ? Date.now() - stats.lastAtMs : Number.POSITIVE_INFINITY,
    });
    logDecision(agent.slug, decision, !!holder);

    if (decision.action === "wait" || decision.action === "hold") return;

    // Both remaining actions need the actual events, not just a count.
    const collected = await collectWindow(resolved.channels, sinceMs, untilMs, identity, config);
    if (collected.events.length === 0) return;

    const window: AwakeningWindow = {
      agentId,
      agentSlug: agent.slug,
      orgId,
      kind: "reflex",
      startMs: sinceMs,
      endMs: untilMs,
      channels: resolved.channels.filter((c) => collected.activeChannels.has(c.id)),
      silentChannels: resolved.channels.filter((c) => !collected.activeChannels.has(c.id)),
      events: collected.events,
      signals: computeSignals(collected.events),
      truncated: collected.truncated,
      gap: null,
      priorRuns: [],
      config,
    };

    if (decision.action === "inject") {
      const ordinal = stats.used + 1;
      const remaining = Math.max(0, config.reflex.maxInjectionsPerSession - ordinal);
      const pushed = await pushInjection(decision.sessionId, {
        ordinal,
        eventCount: window.events.length,
        windowStartMs: sinceMs,
        text: renderInjection(ordinal, window.events.length, remaining, outlineFor(window)),
        createdAtMs: Date.now(),
        isFinal: remaining <= 0,
      });
      // Only advance once the batch is safely queued. A dropped push must leave
      // the events to be re-counted, not silently vanish.
      if (pushed) {
        await prisma.agentAwakeningState.update({
          where: { agentId },
          data: { reflexWatermarkAt: new Date(untilMs), reflexNextCheckAt: nextCheckAt(config.reflex.checkIntervalMs) },
        });
        await prisma.agentAwakeningRun.updateMany({
          where: { sessionId: decision.sessionId },
          data: { injectionsUsed: ordinal },
        });
      }
      return;
    }

    // action === "fire"
    const rate = await peekRunRate(agentId, config.limits.maxRunsPerHour);
    if (!rate.allowed) return;

    const idempotencyKey = `awk_reflex_${agentId}_${sinceMs}`;
    // Placeholder holder: the lock must be taken BEFORE dispatch (otherwise a
    // second pod could dispatch in the gap), so it is keyed on the idempotency
    // key and re-keyed to the real sessionId once claw returns one.
    if (!(await acquireAgentLock(agentId, { sessionId: idempotencyKey, kind: "reflex", acquiredAtMs: Date.now() }))) {
      return;
    }

    try {
      const result = await dispatchAwakening(window, agent, identity, idempotencyKey);
      if (!result.dispatched) {
        await releaseAgentLock(agentId, idempotencyKey);
        throw new Error(`reflex dispatch failed: ${result.reason ?? "unknown"}`);
      }

      // Re-key the lock to the real session so the result callback and the
      // injection path can both find it.
      if (result.sessionId) {
        await releaseAgentLock(agentId, idempotencyKey);
        await acquireAgentLock(agentId, {
          sessionId: result.sessionId,
          kind: "reflex",
          acquiredAtMs: Date.now(),
        });
      }

      await consumeRunRate(agentId);
      await prisma.agentAwakeningRun.create({
        data: {
          agentId,
          orgId,
          kind: "reflex",
          windowStartMs: BigInt(sinceMs),
          windowEndMs: BigInt(untilMs),
          outcome: config.shadow ? "shadow" : "ran",
          eventCount: window.events.length,
          signals: window.signals as unknown as object,
          idempotencyKey,
          ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        },
      }).catch((err: { code?: string }) => {
        if (err?.code !== "P2002") throw err;
      });

      await prisma.agentAwakeningState.update({
        where: { agentId },
        data: {
          reflexWatermarkAt: new Date(untilMs),
          reflexLastRunAt: new Date(),
          reflexNextCheckAt: nextCheckAt(config.reflex.checkIntervalMs),
          // The heartbeat path clears this via markSuccess; a reflex-only agent
          // has no such path, so a resolved error would otherwise stick forever.
          lastError: null,
        },
      });
    } catch (err) {
      await releaseAgentLock(agentId, idempotencyKey).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    // Fail-closed on identity (see the window worker), retry on workspace.
    if (err instanceof AwakeningIdentityError) {
      await prisma.agentAwakeningState
        .update({ where: { agentId }, data: { enabled: false, lastError: String(err.message).slice(0, 500) } })
        .catch(() => undefined);
      return;
    }
    if (err instanceof WorkspaceResolutionError) {
      await prisma.agentAwakeningState
        .update({ where: { agentId }, data: { lastError: String(err.message).slice(0, 500) } })
        .catch(() => undefined);
      log.warn(`[awakening] reflex skipped agent=${agent.slug} (workspace unresolved): ${err.message}`);
      return;
    }
    log.error(`[awakening] reflex check failed agent=${agent.slug}: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

export function initAwakeningReflexWorker(): Worker<AwakeningReflexJobData> {
  if (worker) return worker;
  worker = new Worker<AwakeningReflexJobData>(REFLEX_QUEUE_NAME, processReflex, {
    connection: redisService.getConnection(),
    concurrency: Number(process.env["AWAKENING_REFLEX_CONCURRENCY"] ?? 10),
  });
  worker.on("failed", (job, err) =>
    log.error(`[awakening] reflex job ${job?.data.agentId ?? job?.id} failed: ${err.message}`),
  );
  worker.on("error", (err) => log.error(`[awakening] reflex worker error: ${err.message}`));
  log.info("[awakening] reflex worker started");
  return worker;
}

export async function closeAwakeningReflexWorker(): Promise<void> {
  await worker?.close().catch(() => {});
  worker = undefined;
}
