import { prisma } from "../db.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import { interruptViaClaw } from "./claw-client.js";
import { PROACTIVE, proactiveMode, type ProactiveMode } from "./config.js";
import { deliverNudge } from "./deliver.js";
import { mapPool } from "./pool.js";
import { buildInterruptState, fallbackDecision, finalDecision, nudgeTask, type Decision, type LoopFacts } from "./policy.js";
import { loadPrefs } from "./prefs.js";
import { adjustWeight, nextAllowedAt } from "./schedule.js";
import { enqueueStaleSources, renewExpiringWatches } from "./sources.js";

const log = createLogger("proactive-sweep");

const OPEN_STATUSES = ["open", "nudged"];
const HOUR = 60 * 60_000;
const CAP_RETRY_MS = 3 * HOUR;
const CLAIM_LEASE_MS = 15 * 60_000;

export async function claimDueLoops(limit: number): Promise<Array<{ id: string }>> {
  const lease = new Date(Date.now() + CLAIM_LEASE_MS);
  return prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "open_loops" AS l
       SET "dueAt" = ${lease}
     WHERE l."id" IN (
       SELECT "id" FROM "open_loops"
        WHERE "status" IN ('open', 'nudged')
          AND "dueAt" <= NOW()
        ORDER BY "dueAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
 RETURNING l."id"
  `;
}

export async function expireLoops(now: Date): Promise<number> {
  const res = await prisma.openLoop.updateMany({
    where: { status: { in: OPEN_STATUSES }, expiresAt: { lte: now } },
    data: { status: "expired", resolution: "expired", resolvedAt: now },
  });
  return res.count;
}

async function closeLoop(id: string, status: string, resolution: string, now: Date): Promise<void> {
  await prisma.openLoop.update({ where: { id }, data: { status, resolution, resolvedAt: now } });
}

export async function evaluateLoop(id: string, mode: ProactiveMode, now: Date = new Date()): Promise<Decision | null> {
  const loop = await prisma.openLoop.findUnique({ where: { id }, include: { thread: true } });
  if (!loop || !OPEN_STATUSES.includes(loop.status)) return null;
  const thread = loop.thread;

  if (
    thread &&
    loop.kind !== "awaiting_them" &&
    thread.lastUserReplyAt &&
    (!thread.lastInboundAt || thread.lastUserReplyAt >= thread.lastInboundAt)
  ) {
    await closeLoop(loop.id, "resolved", "user_replied", now);
    return null;
  }
  if (loop.nudgeCount >= PROACTIVE.maxNudgesPerLoop) {
    await closeLoop(loop.id, "expired", "nudge_limit", now);
    return null;
  }

  const prefs = await loadPrefs(loop.userId);
  const counterpartKey = thread?.lastInboundFrom ?? null;
  if (counterpartKey && prefs.mutedContacts.includes(counterpartKey)) {
    await closeLoop(loop.id, "dismissed", "muted_contact", now);
    return null;
  }

  const allowedAt = nextAllowedAt(now, prefs);
  if (allowedAt.getTime() > now.getTime()) {
    await prisma.openLoop.update({ where: { id: loop.id }, data: { dueAt: allowedAt } });
    return null;
  }

  const textsLast24h = await prisma.nudgeLog.count({
    where: { userId: loop.userId, decision: "text", shadow: mode === "shadow", createdAt: { gte: new Date(now.getTime() - 24 * HOUR) } },
  });
  if (textsLast24h >= prefs.maxNudgesPerDay) {
    await prisma.openLoop.update({ where: { id: loop.id }, data: { dueAt: new Date(now.getTime() + CAP_RETRY_MS) } });
    return null;
  }

  const contact = counterpartKey
    ? await prisma.inboxContact.findUnique({ where: { userId_key: { userId: loop.userId, key: counterpartKey } } })
    : null;
  const facts: LoopFacts = {
    kind: loop.kind,
    title: loop.title,
    ask: loop.ask,
    counterpart: loop.counterpart,
    deadlineAt: loop.deadlineAt,
    confidence: loop.confidence,
    nudgeCount: loop.nudgeCount,
  };
  const threadFacts = thread
    ? { subject: thread.subject, summary: thread.summary, importance: thread.importance, lastInboundAt: thread.lastInboundAt }
    : null;
  const state = buildInterruptState({
    loop: facts,
    thread: threadFacts,
    contact,
    textsLast24h,
    maxPerDay: prefs.maxNudgesPerDay,
    timezone: prefs.timezone,
    now,
  });
  const judged = await interruptViaClaw(state);
  const proposed = judged?.decision ?? fallbackDecision({ loop: facts, importance: thread?.importance ?? null, now });
  const laterCount = await prisma.nudgeLog.count({ where: { loopId: loop.id, decision: "later" } });
  const decision = finalDecision({ proposed, loop: facts, laterCount, maxLater: PROACTIVE.maxLaterPerLoop });
  const reason = judged ? `jev ${judged.decision} (${judged.confidence.toFixed(2)})` : `fallback ${proposed}`;

  if (decision === "ignore") {
    await prisma.nudgeLog.create({ data: { userId: loop.userId, loopId: loop.id, agentId: prefs.agentId, decision, reason, shadow: mode === "shadow" } });
    await closeLoop(loop.id, "dismissed", "policy_ignore", now);
    return decision;
  }
  if (decision === "later") {
    await prisma.nudgeLog.create({ data: { userId: loop.userId, loopId: loop.id, agentId: prefs.agentId, decision, reason, shadow: mode === "shadow" } });
    await prisma.openLoop.update({ where: { id: loop.id }, data: { dueAt: new Date(now.getTime() + PROACTIVE.laterDelayMs) } });
    return decision;
  }

  const nextDue = new Date(now.getTime() + Math.max(prefs.replySlaHours, 4) * HOUR);
  if (mode === "live") {
    const delivery = await deliverNudge({
      userId: loop.userId,
      agentId: prefs.agentId,
      task: nudgeTask({ loop: facts, thread: threadFacts, threadExternalId: thread?.externalId ?? null, now }),
      idempotencyKey: `proactive-${loop.id}-${loop.nudgeCount + 1}`,
      now,
    });
    await prisma.nudgeLog.create({
      data: {
        userId: loop.userId,
        loopId: loop.id,
        agentId: prefs.agentId,
        decision,
        reason: delivery.ok ? reason : `${reason}; not sent: ${delivery.reason}`,
        shadow: !delivery.ok,
        ...(delivery.ok ? { channel: delivery.channel, runId: delivery.sessionId, sentAt: now } : {}),
      },
    });
  } else {
    await prisma.nudgeLog.create({ data: { userId: loop.userId, loopId: loop.id, agentId: prefs.agentId, decision, reason, shadow: true } });
  }
  await prisma.openLoop.update({
    where: { id: loop.id },
    data: { status: "nudged", nudgeCount: { increment: 1 }, lastNudgedAt: now, dueAt: nextDue },
  });
  return decision;
}

export async function dismissLoop(userId: string, loopId: string): Promise<boolean> {
  const loop = await prisma.openLoop.findFirst({ where: { id: loopId, userId }, include: { thread: true } });
  if (!loop) return false;
  const now = new Date();
  await closeLoop(loop.id, "dismissed", "user_dismissed", now);
  await prisma.nudgeLog.updateMany({
    where: { loopId: loop.id, decision: "text", reaction: null },
    data: { reaction: "dismissed", reactedAt: now },
  });
  const key = loop.thread?.lastInboundFrom;
  if (key) {
    const contact = await prisma.inboxContact.findUnique({ where: { userId_key: { userId, key } } });
    if (contact) {
      await prisma.inboxContact.update({ where: { id: contact.id }, data: { weight: adjustWeight(contact.weight, "dismissed") } });
    }
  }
  return true;
}

export async function runProactiveTick(): Promise<void> {
  const mode = proactiveMode();
  if (mode === "off") return;
  const now = new Date();
  const [renewed, stale, expired] = await Promise.all([
    renewExpiringWatches(50).catch((err) => {
      log.warn(`[proactive] watch renewal failed: ${errMsg(err)}`);
      return 0;
    }),
    enqueueStaleSources(100).catch(() => 0),
    expireLoops(now).catch(() => 0),
  ]);
  const claimed = await claimDueLoops(PROACTIVE.sweepBatch);
  const decisions = await mapPool(claimed, 4, async ({ id }) => {
    try {
      return await evaluateLoop(id, mode, now);
    } catch (err) {
      log.warn(`[proactive] evaluate loop=${id} failed: ${errMsg(err)}`);
      return null;
    }
  });
  const texts = decisions.filter((d) => d === "text").length;
  if (claimed.length || renewed || expired) {
    log.info(`[proactive] tick mode=${mode} claimed=${claimed.length} texts=${texts} renewed=${renewed} stale=${stale} expired=${expired}`);
  }
}
