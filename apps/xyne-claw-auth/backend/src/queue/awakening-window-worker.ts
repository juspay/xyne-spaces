/**
 * The per-agent window pipeline: resolve channels → collect → score → gate →
 * render → dispatch.
 *
 * The load-bearing rule is the WATERMARK DISPOSITION at each stage, because it
 * decides what happens to the events in a window that did not produce a run:
 *
 *   skipped (gate said no)  → ADVANCE. The window was read and judged boring;
 *                             re-reading it would produce the same verdict.
 *   dispatched              → ADVANCE. The agent has the events now.
 *   failed (anything threw) → DO NOT ADVANCE. The next beat retries the same
 *                             range, so no event is ever silently dropped.
 *
 * Every stage that can fail is wrapped so a single bad agent can never take
 * the fleet's worker down; the failure is recorded on the agent's own state
 * row and the beat backs off exponentially from there.
 */

import { Worker, type Job } from "bullmq";
import { redisService } from "../redis.js";
import { prisma } from "../db.js";
import { resolveAwakeningConfig } from "../awakening/config.js";
import { resolveAwakeningChannels } from "../awakening/channel-resolver.js";
import { collectWindow } from "../awakening/collector.js";
import { computeSignals } from "../awakening/signals.js";
import { evaluateGate } from "../awakening/gate.js";
import { sealWindow, advanceWatermark } from "../awakening/cursor.js";
import { loadOverlappingRuns, markCoverage } from "../awakening/prior-runs.js";
import { dispatchAwakening, resolveAgentIdentity, AwakeningIdentityError } from "../awakening/dispatch.js";
import { resolveWorkspaceId, WorkspaceResolutionError } from "../awakening/workspace.js";
import { peekRunRate, consumeRunRate } from "../awakening/rate-limit.js";
import { acquireAgentLock, releaseAgentLock } from "../awakening/lock.js";
import { WINDOW_QUEUE_NAME, type AwakeningWindowJobData } from "./awakening-queue.js";
import type { AwakeningWindow } from "../awakening/types.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-window");

let worker: Worker<AwakeningWindowJobData> | undefined;

/** Records the wake attempt. Unique on idempotencyKey, so a retry is a no-op. */
async function recordRun(
  window: AwakeningWindow,
  idempotencyKey: string,
  outcome: "ran" | "skipped" | "failed" | "shadow",
  extra: { skipReason?: string; sessionId?: string | null } = {},
): Promise<void> {
  await prisma.agentAwakeningRun
    .create({
      data: {
        agentId: window.agentId,
        orgId: window.orgId,
        kind: window.kind,
        windowStartMs: BigInt(window.startMs),
        windowEndMs: BigInt(window.endMs),
        outcome,
        eventCount: window.events.length,
        signals: window.signals as unknown as object,
        idempotencyKey,
        ...(extra.skipReason ? { skipReason: extra.skipReason } : {}),
        ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
        ...(outcome !== "ran" ? { completedAt: new Date() } : {}),
      },
    })
    .catch((err) => {
      // P2002 = another pod already recorded this exact wake. That is the
      // idempotency guard doing its job, not an error.
      if ((err as { code?: string })?.code !== "P2002") {
        log.warn(`[awakening] recordRun failed agent=${window.agentId}: ${err?.message ?? err}`);
      }
    });
}

async function markFailure(agentId: string, message: string): Promise<void> {
  await prisma.agentAwakeningState
    .update({
      where: { agentId },
      data: { consecutiveFailures: { increment: 1 }, lastError: message.slice(0, 500) },
    })
    .catch(() => undefined);
}

async function markSuccess(agentId: string, skipped: boolean): Promise<void> {
  await prisma.agentAwakeningState
    .update({
      where: { agentId },
      data: {
        consecutiveFailures: 0,
        lastError: null,
        consecutiveSkips: skipped ? { increment: 1 } : { set: 0 },
      },
    })
    .catch(() => undefined);
}

async function processWindow(job: Job<AwakeningWindowJobData>): Promise<void> {
  const { agentId, orgId, kind } = job.data;

  const state = await prisma.agentAwakeningState.findUnique({ where: { agentId } });
  if (!state || !state.enabled) return;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      slug: true,
      orgId: true,
      config: true,
      spacesAppId: true,
      spacesAppUserId: true,
      spacesAppToken: true,
    },
  });
  if (!agent) return;

  const config = resolveAwakeningConfig(agent.config);
  if (!config.enabled) return;

  const bounds = sealWindow(state.watermarkAt, config);
  if (!bounds) return;

  const idempotencyKey = `awk_${kind}_${agentId}_${bounds.startMs}`;

  // Empty shell used for the failure/skip records before collection succeeds.
  const emptyWindow: AwakeningWindow = {
    agentId,
    agentSlug: agent.slug,
    orgId,
    kind,
    startMs: bounds.startMs,
    endMs: bounds.endMs,
    channels: [],
    silentChannels: [],
    events: [],
    signals: computeSignals([]),
    truncated: false,
    gap: bounds.gap,
    priorRuns: [],
    config,
  };

  try {
    const workspaceId = await resolveWorkspaceId(orgId, agent.spacesAppUserId, config.workspaceId);
    const identity = resolveAgentIdentity(agent, workspaceId);

    const rate = await peekRunRate(agentId, config.limits.maxRunsPerHour);
    if (!rate.allowed) {
      await recordRun(emptyWindow, idempotencyKey, "skipped", { skipReason: "rate_limited" });
      await advanceWatermark(agentId, bounds.endMs, null);
      await markSuccess(agentId, true);
      return;
    }

    const resolved = await resolveAwakeningChannels(agentId, config.channels, identity, config.periodMs);
    if (resolved.channels.length === 0) {
      await recordRun(emptyWindow, idempotencyKey, "skipped", { skipReason: "no_channels" });
      await advanceWatermark(agentId, bounds.endMs, null);
      await markSuccess(agentId, true);
      return;
    }

    const collected = await collectWindow(resolved.channels, bounds.startMs, bounds.endMs, identity, config);

    // Requirement 7: what did the reflexes already handle in this window?
    // Loaded BEFORE the signals are computed so coverage is on the events the
    // gate then scores — an event a reflex already answered should not be what
    // wakes the heartbeat.
    const priorRuns = await loadOverlappingRuns(agentId, bounds.startMs, bounds.endMs, idempotencyKey).catch(
      () => [],
    );
    markCoverage(collected.events, priorRuns);
    const signals = computeSignals(collected.events);

    const window: AwakeningWindow = {
      ...emptyWindow,
      priorRuns,
      channels: resolved.channels.filter((c) => collected.activeChannels.has(c.id)),
      silentChannels: resolved.channels.filter((c) => !collected.activeChannels.has(c.id)),
      events: collected.events,
      signals,
      truncated: collected.truncated,
    };

    const gate = evaluateGate({ signals, config, consecutiveSkips: state.consecutiveSkips });
    if (gate.decision === "skip") {
      await recordRun(window, idempotencyKey, "skipped", { skipReason: gate.rule });
      await advanceWatermark(agentId, bounds.endMs, null);
      await markSuccess(agentId, true);
      log.info(`[awakening] skip agent=${agent.slug} rule=${gate.rule} events=${signals.eventCount}`);
      return;
    }

    // One lock per agent across BOTH wake kinds. If a reflex is already awake
    // for this agent, the heartbeat stands down rather than running beside it —
    // two awakened runs on one agent read overlapping windows and both post.
    if (!(await acquireAgentLock(agentId, { sessionId: idempotencyKey, kind, acquiredAtMs: Date.now() }))) {
      await recordRun(window, idempotencyKey, "skipped", { skipReason: "agent_busy" });
      await markSuccess(agentId, true);
      log.info(`[awakening] skip agent=${agent.slug} rule=agent_busy (another awakened run is in flight)`);
      return;
    }

    const result = await dispatchAwakening(window, agent, identity, idempotencyKey);
    if (!result.dispatched) {
      await releaseAgentLock(agentId, idempotencyKey);
      // Dispatch failure is a real failure: the events were never delivered,
      // so the watermark must not move.
      await recordRun(window, idempotencyKey, "failed", { skipReason: result.reason ?? "dispatch_failed" });
      await markFailure(agentId, result.reason ?? "dispatch failed");
      throw new Error(`dispatch failed: ${result.reason ?? "unknown"}`);
    }

    // Re-key the lock from the idempotency key to the real session id, so the
    // result callback and the injection path can both find it.
    if (result.sessionId) {
      await releaseAgentLock(agentId, idempotencyKey);
      await acquireAgentLock(agentId, { sessionId: result.sessionId, kind, acquiredAtMs: Date.now() });
    }

    // Budget is consumed only once a run is genuinely in flight.
    await consumeRunRate(agentId);
    await recordRun(window, idempotencyKey, config.shadow ? "shadow" : "ran", { sessionId: result.sessionId });
    await advanceWatermark(agentId, bounds.endMs, collected.events.at(-1)?.id ?? null);
    await markSuccess(agentId, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // A broken identity is a CONFIG problem AND unfixable by waiting: an agent
    // with no bot identity must never fall back to a user token, so it stops.
    if (err instanceof AwakeningIdentityError) {
      await prisma.agentAwakeningState
        .update({ where: { agentId }, data: { enabled: false, lastError: message.slice(0, 500) } })
        .catch(() => undefined);
      log.error(`[awakening] disabled agent=${agent.slug}: ${message}`);
      return;
    }

    // A workspace that will not resolve is an operator-fixable gap — a bot user
    // not yet mirrored into Spaces, a Spaces DB blip, a tenant link nobody
    // seeded. Record it so the admin can SEE it, but stay enabled and try again
    // on the normal cadence: disabling here meant a five-minute fix needed a
    // human to notice and re-save the agent (prod, 2026-08-26).
    if (err instanceof WorkspaceResolutionError) {
      await prisma.agentAwakeningState
        .update({ where: { agentId }, data: { lastError: message.slice(0, 500) } })
        .catch(() => undefined);
      log.warn(`[awakening] window skipped agent=${agent.slug} (workspace unresolved): ${message}`);
      return;
    }

    await releaseAgentLock(agentId, idempotencyKey).catch(() => undefined);
    await markFailure(agentId, message);
    log.error(`[awakening] window failed agent=${agent.slug}: ${message}`);
    throw err;
  }
}

export function initAwakeningWindowWorker(): Worker<AwakeningWindowJobData> {
  if (worker) return worker;

  worker = new Worker<AwakeningWindowJobData>(WINDOW_QUEUE_NAME, processWindow, {
    connection: redisService.getConnection(),
    concurrency: Number(process.env["AWAKENING_WINDOW_CONCURRENCY"] ?? 5),
  });

  worker.on("failed", (job, err) =>
    log.error(`[awakening] window job ${job?.data.agentId ?? job?.id} failed: ${err.message}`),
  );
  worker.on("error", (err) => log.error(`[awakening] window worker error: ${err.message}`));
  log.info("[awakening] window worker started");
  return worker;
}

export async function closeAwakeningWindowWorker(): Promise<void> {
  await worker?.close().catch(() => {});
  worker = undefined;
}
