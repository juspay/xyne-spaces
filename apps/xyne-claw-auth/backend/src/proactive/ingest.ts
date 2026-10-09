import type { InboxSource, Prisma, TrackedThread } from "@prisma/client";
import { prisma } from "../db.js";
import { errMsg } from "../lib/errors.js";
import { resolveFreshOAuthCreds } from "../lib/oauth-token-endpoint.js";
import { getOAuthProvider } from "../routes/oauth-token.js";
import { createLogger } from "../logger.js";
import { enqueueInboxIngest } from "../queue/proactive-queue.js";
import { extractViaClaw, triageViaClaw, type TriageScores } from "./claw-client.js";
import { PROACTIVE, proactiveMode } from "./config.js";
import { GmailApiError, GmailClient } from "./gmail-api.js";
import { messageBodyText, parseGmailMessage, type ParsedMessage } from "./gmail-message.js";
import { mapPool } from "./pool.js";
import { loadPrefs, type EffectivePrefs } from "./prefs.js";
import { planLoop, updateReplyAverage } from "./schedule.js";
import { buildTriageState, isHit, isUrgent } from "./triage.js";

const log = createLogger("proactive-ingest");

const MAX_HISTORY_PAGES = 5;
const RESYNC_QUERY = "newer_than:1d -in:chats";
const RESYNC_MAX = 50;
const THREAD_CONTEXT_MESSAGES = 8;
const OPEN_STATUSES = ["open", "nudged"];

export async function gmailClientFor(userId: string): Promise<GmailClient | null> {
  const provider = getOAuthProvider("google");
  if (!provider) return null;
  const creds = await resolveFreshOAuthCreds(provider, userId);
  return creds?.accessToken ? new GmailClient(creds.accessToken) : null;
}

interface CollectedIds {
  ids: string[];
  cursor: string;
  resynced: boolean;
}

async function collectNewMessageIds(gmail: GmailClient, cursor: string | null): Promise<CollectedIds> {
  if (!cursor) {
    const profile = await gmail.profile();
    return { ids: [], cursor: profile.historyId, resynced: false };
  }
  try {
    const ids: string[] = [];
    let next = cursor;
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const res = await gmail.history(cursor, pageToken);
      for (const entry of res.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          if (added.message?.id) ids.push(added.message.id);
        }
      }
      if (res.historyId) next = res.historyId;
      if (!res.nextPageToken) break;
      pageToken = res.nextPageToken;
    }
    const unique = [...new Set(ids)];
    return { ids: unique.slice(-PROACTIVE.maxMessagesPerIngest), cursor: next, resynced: false };
  } catch (err) {
    if (!(err instanceof GmailApiError) || err.status !== 404) throw err;
    const [profile, recent] = await Promise.all([gmail.profile(), gmail.recentMessageIds(RESYNC_QUERY, RESYNC_MAX)]);
    return { ids: (recent.messages ?? []).map((m) => m.id).reverse(), cursor: profile.historyId, resynced: true };
  }
}

async function fetchParsed(gmail: GmailClient, ids: string[], address: string): Promise<ParsedMessage[]> {
  const fetched = await mapPool(ids, 5, async (id) => {
    try {
      return await gmail.messageMetadata(id);
    } catch (err) {
      if (err instanceof GmailApiError && err.status === 404) return null;
      throw err;
    }
  });
  return fetched
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .map((m) => parseGmailMessage(m, address))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function participantsOf(message: ParsedMessage): Prisma.InputJsonValue {
  const rows = [
    ...(message.from ? [{ key: message.from.key, name: message.from.name, role: "from" }] : []),
    ...message.to.map((a) => ({ key: a.key, name: a.name, role: "to" })),
    ...message.cc.map((a) => ({ key: a.key, name: a.name, role: "cc" })),
  ];
  return rows.slice(0, 20);
}

async function resolveThreadLoops(threadId: string, kinds: string[], resolution: string, at: Date): Promise<void> {
  const loops = await prisma.openLoop.findMany({
    where: { threadId, kind: { in: kinds }, status: { in: OPEN_STATUSES } },
    select: { id: true, status: true },
  });
  if (loops.length === 0) return;
  const ids = loops.map((l) => l.id);
  await prisma.openLoop.updateMany({ where: { id: { in: ids } }, data: { status: "resolved", resolvedAt: at, resolution } });
  if (resolution === "user_replied") {
    await prisma.nudgeLog.updateMany({
      where: { loopId: { in: ids }, decision: "text", reaction: null },
      data: { reaction: "acted", reactedAt: at },
    });
  }
}

async function applyUserReply(source: InboxSource, message: ParsedMessage): Promise<void> {
  const thread = await prisma.trackedThread.findUnique({
    where: { userId_source_externalId: { userId: source.userId, source: "gmail", externalId: message.threadId } },
  });
  if (!thread) return;
  const repliedAfterInbound = !thread.lastInboundAt || thread.lastInboundAt.getTime() <= message.at.getTime();
  await prisma.trackedThread.update({
    where: { id: thread.id },
    data: {
      lastUserReplyAt: thread.lastUserReplyAt && thread.lastUserReplyAt > message.at ? thread.lastUserReplyAt : message.at,
      ...(repliedAfterInbound ? { state: "replied" } : {}),
    },
  });
  if (!repliedAfterInbound) return;
  await resolveThreadLoops(thread.id, ["awaiting_user", "deadline"], "user_replied", message.at);
  const counterpart = thread.lastInboundFrom;
  if (!counterpart || ![...message.to, ...message.cc].some((a) => a.key === counterpart)) return;
  const contact = await prisma.inboxContact.findUnique({ where: { userId_key: { userId: source.userId, key: counterpart } } });
  if (!contact) return;
  const minutes = thread.lastInboundAt ? (message.at.getTime() - thread.lastInboundAt.getTime()) / 60_000 : null;
  await prisma.inboxContact.update({
    where: { id: contact.id },
    data: {
      userReplyCount: { increment: 1 },
      lastUserReplyAt: message.at,
      ...(minutes !== null ? { avgReplyMins: updateReplyAverage(contact.avgReplyMins, minutes) } : {}),
    },
  });
}

async function applyInbound(source: InboxSource, message: ParsedMessage): Promise<TrackedThread | null> {
  if (message.noise) return null;
  const key = { userId: source.userId, source: "gmail", externalId: message.threadId };
  const existing = await prisma.trackedThread.findUnique({ where: { userId_source_externalId: key } });
  if (existing?.lastInboundAt && existing.lastInboundAt > message.at) return null;
  const data = {
    subject: message.subject ?? existing?.subject ?? null,
    participants: participantsOf(message),
    lastMessageId: message.id,
    lastInboundAt: message.at,
    lastInboundFrom: message.from?.key ?? null,
    state: "open",
  };
  const thread = existing
    ? await prisma.trackedThread.update({ where: { id: existing.id }, data })
    : await prisma.trackedThread.create({ data: { ...key, sourceId: source.id, ...data } });
  if (existing) await resolveThreadLoops(thread.id, ["awaiting_them"], "counterpart_replied", message.at);
  if (message.from) {
    await prisma.inboxContact.upsert({
      where: { userId_key: { userId: source.userId, key: message.from.key } },
      create: { userId: source.userId, key: message.from.key, name: message.from.name, inboundCount: 1, lastInboundAt: message.at },
      update: { inboundCount: { increment: 1 }, lastInboundAt: message.at, ...(message.from.name ? { name: message.from.name } : {}) },
    });
  }
  return thread;
}

interface Candidate {
  thread: TrackedThread;
  message: ParsedMessage;
}

async function threadContext(gmail: GmailClient, threadId: string, address: string) {
  const full = await gmail.thread(threadId);
  return (full.messages ?? []).slice(-THREAD_CONTEXT_MESSAGES).map((m) => {
    const parsed = parseGmailMessage(m, address);
    return {
      from: parsed.from ? (parsed.from.name ? `${parsed.from.name} <${parsed.from.key}>` : parsed.from.key) : "unknown",
      at: parsed.at.toISOString(),
      fromUser: parsed.fromUser,
      text: messageBodyText(m).slice(0, 3_000),
    };
  });
}

async function writeLoops(
  candidate: Candidate,
  loops: Array<Parameters<typeof planLoop>[0]>,
  prefs: EffectivePrefs,
  now: Date,
  urgent: boolean,
): Promise<number> {
  const { thread } = candidate;
  await prisma.openLoop.deleteMany({ where: { threadId: thread.id, status: "open", createdBy: "triage" } });
  const planned = loops.map((l) =>
    planLoop(l, {
      now,
      lastInboundAt: thread.lastInboundAt,
      lastUserReplyAt: thread.lastUserReplyAt,
      replySlaHours: prefs.replySlaHours,
      urgent,
    }),
  );
  if (planned.length === 0) return 0;
  await prisma.openLoop.createMany({
    data: planned.map((p) => ({
      userId: thread.userId,
      threadId: thread.id,
      kind: p.kind,
      title: p.title,
      ask: p.ask,
      counterpart: p.counterpart,
      deadlineAt: p.deadlineAt,
      dueAt: p.dueAt,
      expiresAt: p.expiresAt,
      confidence: p.confidence,
      createdBy: "triage",
    })),
  });
  return planned.length;
}

async function triageAndExtract(
  gmail: GmailClient,
  source: InboxSource,
  candidates: Candidate[],
  prefs: EffectivePrefs,
): Promise<{ triaged: number; hits: number; urgent: number; loops: number }> {
  if (candidates.length === 0) return { triaged: 0, hits: 0, urgent: 0, loops: 0 };
  const contacts = await prisma.inboxContact.findMany({
    where: { userId: source.userId, key: { in: candidates.map((c) => c.message.from?.key ?? "").filter(Boolean) } },
  });
  const byKey = new Map(contacts.map((c) => [c.key, c]));
  const items = candidates.map((c) => ({
    key: c.thread.id,
    state: buildTriageState(c.message, c.message.from ? (byKey.get(c.message.from.key) ?? null) : null),
  }));
  const results = await triageViaClaw(items);
  const now = new Date();
  const hits: Candidate[] = [];
  const urgent = new Set<string>();
  for (const c of candidates) {
    const scores: TriageScores | null = results?.[c.thread.id] ?? null;
    if (scores) {
      await prisma.trackedThread.update({
        where: { id: c.thread.id },
        data: {
          importance: scores.importance,
          needsReply: scores.needsReply,
          hasDeadline: scores.hasDeadline,
          kind: scores.kind,
          triagedAt: now,
          ...(scores.kind === "noise" ? { state: "ignored" } : {}),
        },
      });
    }
    const muted = c.message.from ? prefs.mutedContacts.includes(c.message.from.key) : false;
    if (!muted && isHit(scores, c.message, PROACTIVE)) {
      hits.push(c);
      if (isUrgent(scores, PROACTIVE)) urgent.add(c.thread.id);
    }
  }

  const user = await prisma.user.findUnique({ where: { id: source.userId }, select: { name: true } });
  let loops = 0;
  for (const c of hits.slice(0, PROACTIVE.maxExtractsPerIngest)) {
    try {
      const messages = await threadContext(gmail, c.message.threadId, source.address ?? "");
      const extracted = messages.length
        ? await extractViaClaw({
            now: now.toISOString(),
            timezone: prefs.timezone,
            ...(user?.name ? { userName: user.name } : {}),
            ...(source.address ? { userAddress: source.address } : {}),
            ...(c.message.subject ? { subject: c.message.subject } : {}),
            messages,
          })
        : null;
      if (extracted) {
        await prisma.trackedThread.update({
          where: { id: c.thread.id },
          data: { summary: extracted.summary || null, extractedAt: now },
        });
        loops += await writeLoops(c, extracted.loops, prefs, now, urgent.has(c.thread.id));
      } else {
        loops += await writeLoops(
          c,
          [
            {
              kind: "awaiting_user",
              title: (c.message.subject ?? "Unanswered email").slice(0, 120),
              ask: c.message.snippet.slice(0, 300) || null,
              counterpart: c.message.from?.name ?? c.message.from?.key ?? null,
              deadlineAt: null,
              confidence: 0.4,
            },
          ],
          prefs,
          now,
          urgent.has(c.thread.id),
        );
      }
    } catch (err) {
      log.warn(`[proactive] extract failed thread=${c.thread.id}: ${errMsg(err)}`);
    }
  }
  return { triaged: results ? candidates.length : 0, hits: hits.length, urgent: urgent.size, loops };
}

export async function ingestGmailSource(sourceId: string): Promise<void> {
  if (proactiveMode() === "off") return;
  const startedAt = new Date();
  const source = await prisma.inboxSource.findUnique({ where: { id: sourceId } });
  if (!source || !source.enabled || source.kind !== "gmail") return;

  const gmail = await gmailClientFor(source.userId).catch((err) => {
    log.warn(`[proactive] token refresh failed user=${source.userId}: ${errMsg(err)}`);
    return null;
  });
  if (!gmail) {
    await prisma.inboxSource.update({
      where: { id: source.id },
      data: { status: "revoked", enabled: false, lastError: "Google connection missing or refresh failed" },
    });
    return;
  }

  try {
    const collected = await collectNewMessageIds(gmail, source.cursor);
    const parsed = await fetchParsed(gmail, collected.ids, source.address ?? "");
    const latestByThread = new Map<string, Candidate>();
    for (const message of parsed) {
      if (message.fromUser) {
        await applyUserReply(source, message);
        latestByThread.delete(message.threadId);
        continue;
      }
      const thread = await applyInbound(source, message);
      if (thread) latestByThread.set(message.threadId, { thread, message });
    }
    const prefs = await loadPrefs(source.userId);
    const stats = await triageAndExtract(gmail, source, [...latestByThread.values()], prefs);
    await prisma.inboxSource.update({
      where: { id: source.id },
      data: {
        cursor: collected.cursor,
        lastSyncedAt: new Date(),
        status: "active",
        consecutiveFailures: 0,
        lastError: null,
      },
    });
    log.info(
      `[proactive] ingest user=${source.userId} messages=${parsed.length} candidates=${latestByThread.size} triaged=${stats.triaged} hits=${stats.hits} urgent=${stats.urgent} loops=${stats.loops}${collected.resynced ? " resynced" : ""}`,
    );
  } catch (err) {
    const unauthorized = err instanceof GmailApiError && (err.status === 401 || err.status === 403);
    await prisma.inboxSource.update({
      where: { id: source.id },
      data: {
        consecutiveFailures: { increment: 1 },
        lastError: errMsg(err).slice(0, 1_000),
        ...(unauthorized ? { status: "error" } : {}),
      },
    });
    throw err;
  }

  const latest = await prisma.inboxSource.findUnique({ where: { id: source.id }, select: { lastPushAt: true } });
  if (latest?.lastPushAt && latest.lastPushAt > startedAt) {
    await enqueueInboxIngest(source.id, PROACTIVE.ingestDebounceMs, `followup-${startedAt.getTime()}`).catch(() => undefined);
  }
}
