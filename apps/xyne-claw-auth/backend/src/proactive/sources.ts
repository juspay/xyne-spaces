import { prisma } from "../db.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import { enqueueInboxIngest } from "../queue/proactive-queue.js";
import { PROACTIVE, proactiveMode } from "./config.js";
import { gmailClientFor } from "./ingest.js";

const log = createLogger("proactive-sources");

export class ProactiveSetupError extends Error {
  constructor(
    readonly code: "disabled" | "not_configured" | "google_not_connected",
    message: string,
  ) {
    super(message);
    this.name = "ProactiveSetupError";
  }
}

function expiryFrom(expiration: string | undefined): Date | null {
  const ms = Number(expiration);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

export async function enableGmailSource(input: { userId: string; orgId: string; agentId?: string | null }) {
  if (proactiveMode() === "off") throw new ProactiveSetupError("disabled", "The proactive inbox is not enabled on this deployment");
  if (!PROACTIVE.gmailTopic) throw new ProactiveSetupError("not_configured", "GMAIL_PUSH_TOPIC is not configured");
  const gmail = await gmailClientFor(input.userId);
  if (!gmail) throw new ProactiveSetupError("google_not_connected", "Connect Google first");

  const profile = await gmail.profile();
  const watch = await gmail.watch(PROACTIVE.gmailTopic);
  const address = profile.emailAddress.toLowerCase();
  const source = await prisma.inboxSource.upsert({
    where: { userId_kind: { userId: input.userId, kind: "gmail" } },
    create: {
      userId: input.userId,
      orgId: input.orgId,
      kind: "gmail",
      address,
      enabled: true,
      status: "active",
      cursor: watch.historyId ?? profile.historyId,
      watchExpiresAt: expiryFrom(watch.expiration),
    },
    update: {
      orgId: input.orgId,
      address,
      enabled: true,
      status: "active",
      cursor: watch.historyId ?? profile.historyId,
      watchExpiresAt: expiryFrom(watch.expiration),
      consecutiveFailures: 0,
      lastError: null,
    },
  });
  await prisma.proactivePrefs.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, orgId: input.orgId, ...(input.agentId ? { agentId: input.agentId } : {}) },
    update: input.agentId ? { agentId: input.agentId } : {},
  });
  log.info(`[proactive] gmail enabled user=${input.userId}`);
  return source;
}

export async function disableGmailSource(userId: string): Promise<void> {
  const source = await prisma.inboxSource.findUnique({ where: { userId_kind: { userId, kind: "gmail" } } });
  if (!source) return;
  try {
    const gmail = await gmailClientFor(userId);
    await gmail?.stop();
  } catch (err) {
    log.warn(`[proactive] gmail stop failed user=${userId}: ${errMsg(err)}`);
  }
  await prisma.inboxSource.update({ where: { id: source.id }, data: { enabled: false, watchExpiresAt: null } });
  await prisma.openLoop.updateMany({
    where: { userId, status: { in: ["open", "nudged"] } },
    data: { status: "dismissed", resolution: "source_disabled", resolvedAt: new Date() },
  });
}

export async function deleteProactiveData(userId: string): Promise<void> {
  await disableGmailSource(userId);
  await prisma.$transaction([
    prisma.nudgeLog.deleteMany({ where: { userId } }),
    prisma.openLoop.deleteMany({ where: { userId } }),
    prisma.trackedThread.deleteMany({ where: { userId } }),
    prisma.inboxContact.deleteMany({ where: { userId } }),
    prisma.inboxSource.deleteMany({ where: { userId } }),
  ]);
}

export async function renewExpiringWatches(limit: number): Promise<number> {
  if (!PROACTIVE.gmailTopic) return 0;
  const due = await prisma.inboxSource.findMany({
    where: {
      kind: "gmail",
      enabled: true,
      OR: [{ watchExpiresAt: null }, { watchExpiresAt: { lte: new Date(Date.now() + PROACTIVE.watchRenewAheadMs) } }],
    },
    orderBy: { watchExpiresAt: "asc" },
    take: limit,
  });
  let renewed = 0;
  for (const source of due) {
    try {
      const gmail = await gmailClientFor(source.userId);
      if (!gmail) {
        await prisma.inboxSource.update({
          where: { id: source.id },
          data: { enabled: false, status: "revoked", lastError: "Google connection missing" },
        });
        continue;
      }
      const watch = await gmail.watch(PROACTIVE.gmailTopic);
      await prisma.inboxSource.update({ where: { id: source.id }, data: { watchExpiresAt: expiryFrom(watch.expiration) } });
      renewed++;
    } catch (err) {
      await prisma.inboxSource.update({
        where: { id: source.id },
        data: { consecutiveFailures: { increment: 1 }, lastError: errMsg(err).slice(0, 1_000) },
      });
    }
  }
  return renewed;
}

export async function enqueueStaleSources(limit: number): Promise<number> {
  const stale = await prisma.inboxSource.findMany({
    where: {
      enabled: true,
      kind: "gmail",
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: new Date(Date.now() - PROACTIVE.staleSyncMs) } }],
    },
    select: { id: true },
    take: limit,
  });
  for (const s of stale) await enqueueInboxIngest(s.id, 0).catch(() => undefined);
  return stale.length;
}

export interface GmailPushEnvelope {
  message?: { data?: string; messageId?: string };
}

export function parsePushEnvelope(body: unknown): { emailAddress: string; historyId: string } | null {
  const data = (body as GmailPushEnvelope | undefined)?.message?.data;
  if (typeof data !== "string" || !data) return null;
  try {
    const decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as { emailAddress?: unknown; historyId?: unknown };
    if (typeof decoded.emailAddress !== "string") return null;
    return { emailAddress: decoded.emailAddress.toLowerCase(), historyId: String(decoded.historyId ?? "") };
  } catch {
    return null;
  }
}

export async function handleGmailPush(body: unknown): Promise<number> {
  const push = parsePushEnvelope(body);
  if (!push || proactiveMode() === "off") return 0;
  const sources = await prisma.inboxSource.findMany({
    where: { kind: "gmail", address: push.emailAddress, enabled: true },
    select: { id: true },
  });
  for (const s of sources) {
    await prisma.inboxSource.update({ where: { id: s.id }, data: { lastPushAt: new Date() } });
    await enqueueInboxIngest(s.id);
  }
  log.info(`[proactive] push historyId=${push.historyId} sources=${sources.length}`);
  return sources.length;
}
