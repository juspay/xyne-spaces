/**
 * The fleet tick: claims every agent whose next beat is due and fans them out.
 *
 * The claim is a single atomic UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
 * LOCKED) that ALSO pushes nextDueAt forward. That combination is what makes
 * the tick safe to run on every pod concurrently: two pods scanning at the
 * same instant cannot claim the same agent, because the first one's row lock
 * makes the second skip it, and by the time the lock is released nextDueAt is
 * already in the future so the row no longer matches.
 *
 * Claiming BEFORE the work happens (rather than after) means a crashed pod
 * costs one skipped beat rather than a hot loop of re-claims. The watermark is
 * what guarantees no events are lost in that case — the next beat's window
 * simply starts where the crashed one would have.
 */

import { Worker, type Job } from "bullmq";
import { redisService } from "../redis.js";
import { prisma } from "../db.js";
import { resolveAwakeningConfig, participatesIn } from "../awakening/config.js";
import { computeNextDueAt } from "../awakening/cursor.js";
import { enqueueWindow, enqueueReflexCheck, TICK_QUEUE_NAME } from "./awakening-queue.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-tick");

/**
 * How far out a cadence is parked when the agent does not participate in that
 * wake kind. Long enough that the scan stops paying for it every tick, short
 * enough that flipping `kind` in the UI takes effect within the hour.
 */
const IDLE_REPARK_MS = 60 * 60_000;

/** Global kill switch. Set to "1" to stop every awakened agent everywhere. */
function killed(): boolean {
  return process.env["AWAKENING_DISABLED"] === "1";
}

/** Most agents claimed per tick, so one tick cannot enqueue unbounded work. */
const FANOUT_BATCH = Number(process.env["AWAKENING_FANOUT_BATCH"] ?? 100);

let worker: Worker | undefined;

/**
 * Claim agents whose reflex check is due. Same SKIP LOCKED shape as the
 * heartbeat claim, against the reflex cadence column.
 *
 * A NULL reflexNextCheckAt means "never checked" and is treated as due, so an
 * agent that has reflex switched on starts checking immediately rather than
 * waiting for a first write to the column.
 */
export async function claimDueReflexChecks(limit: number): Promise<ClaimedRow[]> {
  const provisionalNext = new Date(Date.now() + 60_000);
  return prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "agent_awakening_state" AS s
       SET "reflexNextCheckAt" = ${provisionalNext}
     WHERE s."id" IN (
       SELECT "id" FROM "agent_awakening_state"
        WHERE "enabled" = TRUE
          AND ("reflexNextCheckAt" IS NULL OR "reflexNextCheckAt" <= NOW())
        ORDER BY "reflexNextCheckAt" ASC NULLS FIRST
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
 RETURNING s."id", s."agentId", s."orgId", s."consecutiveFailures"
  `;
}

export interface ClaimedRow {
  id: string;
  agentId: string;
  orgId: string;
  consecutiveFailures: number;
}

/**
 * Atomically claim due agents and push their next beat out.
 *
 * nextDueAt is advanced by a provisional period here and corrected by the
 * window worker once it has read the agent's real config — the tick would
 * otherwise have to read and parse every agent's JSON config just to compute a
 * timestamp, on every tick, for the whole fleet.
 */
export async function claimDueAgents(limit: number): Promise<ClaimedRow[]> {
  const provisionalNext = new Date(Date.now() + 60_000);
  return prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "agent_awakening_state" AS s
       SET "nextDueAt"  = ${provisionalNext},
           "lastTickAt" = NOW()
     WHERE s."id" IN (
       SELECT "id" FROM "agent_awakening_state"
        WHERE "enabled" = TRUE
          AND "nextDueAt" <= NOW()
        ORDER BY "nextDueAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
 RETURNING s."id", s."agentId", s."orgId", s."consecutiveFailures"
  `;
}

async function processTick(_job: Job): Promise<void> {
  if (killed()) return;

  const claimedAtMs = Date.now();

  // Reflex checks run on their own, much faster cadence and are claimed
  // independently. They MUST be fanned out before any early return below —
  // gating them on a heartbeat being due would mean reflex only ever fires in
  // the same minute as a heartbeat, which is exactly the responsiveness the
  // reflex exists to provide.
  await fanOutReflexChecks(claimedAtMs).catch((err) =>
    log.error(`[awakening] reflex fan-out failed: ${err instanceof Error ? err.message : err}`),
  );

  const claimed = await claimDueAgents(FANOUT_BATCH);
  if (claimed.length === 0) return;

  let enqueued = 0;

  for (const row of claimed) {
    const agent = await prisma.agent
      .findUnique({ where: { id: row.agentId }, select: { config: true, enabled: true } })
      .catch(() => null);

    // The agent was deleted or disabled out from under the state row. Park it
    // rather than retrying every tick forever.
    if (!agent || !agent.enabled) {
      await prisma.agentAwakeningState
        .update({ where: { id: row.id }, data: { enabled: false, lastError: "agent missing or disabled" } })
        .catch(() => undefined);
      continue;
    }

    const config = resolveAwakeningConfig(agent.config);
    if (!config.enabled) {
      await prisma.agentAwakeningState
        .update({ where: { id: row.id }, data: { enabled: false, lastError: null } })
        .catch(() => undefined);
      continue;
    }

    // Not a heartbeat agent — park the HEARTBEAT cadence only.
    //
    // `state.enabled` means "awakening is on for this agent", and the reflex
    // claim scan requires it. Clearing it here (which this used to do) let the
    // first heartbeat tick permanently kill a reflex-only agent: the row was
    // disabled, and no reflex check ever ran again. Push nextDueAt out instead,
    // so the row stops being claimed by this scan and stays live for reflex.
    if (!participatesIn(config, "heartbeat")) {
      await prisma.agentAwakeningState
        .update({ where: { id: row.id }, data: { nextDueAt: new Date(Date.now() + IDLE_REPARK_MS) } })
        .catch(() => undefined);
      continue;
    }

    // Correct the provisional nextDueAt now that the real period is known.
    await prisma.agentAwakeningState
      .update({
        where: { id: row.id },
        data: { nextDueAt: computeNextDueAt(row.agentId, config, row.consecutiveFailures) },
      })
      .catch(() => undefined);

    await enqueueWindow({ agentId: row.agentId, orgId: row.orgId, kind: "heartbeat", claimedAtMs })
      .then(() => {
        enqueued++;
      })
      .catch((err) => log.warn(`[awakening] enqueue failed agent=${row.agentId}: ${err?.message ?? err}`));
  }

  log.info(`[awakening] tick claimed=${claimed.length} enqueued=${enqueued}`);
}

/**
 * Reflex checks ride the same tick. They are claimed separately (own cadence
 * column, own queue) but scanning both in one tick avoids a second scheduler
 * and keeps the whole feature behind a single repeatable job.
 */
async function fanOutReflexChecks(claimedAtMs: number): Promise<void> {
  const claimed = await claimDueReflexChecks(FANOUT_BATCH);
  if (claimed.length === 0) return;

  let enqueued = 0;
  for (const row of claimed) {
    const agent = await prisma.agent
      .findUnique({ where: { id: row.agentId }, select: { config: true, enabled: true } })
      .catch(() => null);
    if (!agent?.enabled) continue;

    const config = resolveAwakeningConfig(agent.config);
    // Same shape as the heartbeat gate, and the same reason to re-park rather
    // than fall through: the claim already wrote a provisional +60s, so simply
    // skipping would leave a heartbeat-only agent due again on the very next
    // tick, forever, for every tick of its life.
    if (!config.enabled || !participatesIn(config, "reflex")) {
      await prisma.agentAwakeningState
        .update({ where: { id: row.id }, data: { reflexNextCheckAt: new Date(Date.now() + IDLE_REPARK_MS) } })
        .catch(() => undefined);
      continue;
    }

    await prisma.agentAwakeningState
      .update({
        where: { id: row.id },
        data: { reflexNextCheckAt: new Date(Date.now() + config.reflex.checkIntervalMs) },
      })
      .catch(() => undefined);

    await enqueueReflexCheck({ agentId: row.agentId, orgId: row.orgId, claimedAtMs })
      .then(() => { enqueued++; })
      .catch((err) => log.warn(`[awakening] reflex enqueue failed agent=${row.agentId}: ${err?.message ?? err}`));
  }

  if (enqueued > 0) log.info(`[awakening] reflex checks enqueued=${enqueued}`);
}

export function initAwakeningTickWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(TICK_QUEUE_NAME, processTick, {
    connection: redisService.getConnection(),
    // Strictly 1: the claim is safe under concurrency, but there is no reason
    // to run two scans of the same table at the same instant.
    concurrency: 1,
  });

  worker.on("failed", (_job, err) => log.error(`[awakening] tick failed: ${err.message}`));
  worker.on("error", (err) => log.error(`[awakening] tick worker error: ${err.message}`));
  log.info(`[awakening] tick worker started (interval=${process.env["AWAKENING_TICK_MS"] ?? 60_000}ms)`);
  return worker;
}

export async function closeAwakeningTickWorker(): Promise<void> {
  await worker?.close().catch(() => {});
  worker = undefined;
}
