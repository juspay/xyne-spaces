#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Seeds direct-message conversations between people already created by
 * org-seed.ts (the @juspay.team roster) plus the local dev/admin account
 * harsh.sharma.001@juspay.in. Never invents people — every email in
 * dm-seed-content.ts must already exist as a user, or the script fails fast.
 *
 * A DM channel is a `channels` row with scopeType 'DM', visibility PRIVATE,
 * and `name` set to the two participant user IDs sorted and comma-joined —
 * exactly the shape ChannelRepository.findOrCreateDMChannel produces, so
 * these threads are indistinguishable from ones a real user started.
 *
 * Each line in a thread becomes its OWN conversation (a single-message
 * thread with replyCount 0), not a reply chained onto one giant parent —
 * that's what makes the channel feed render as a normal flowing DM instead
 * of one collapsed "47 replies" row. See dm-seed-content.ts's header for the
 * timing model (recency bucket + per-line `gap`/`hour`).
 *
 * Denormalized copies matter here same as everywhere else in this schema:
 *   conversations.initial_message_md  → what the feed actually renders
 *   messages.reactions_md             → what ReactionView actually renders
 * Both are written alongside the real rows (messages/reactions/reaction_counts),
 * matching what the live mutators do.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/dm-seed.ts
 *   DM_WIPE=1 …            # remove previously seeded DM threads, then reseed
 *   DM_SKIP_VESPA=1 …      # seed Postgres only, queue nothing
 *
 * Idempotent: every channel this script creates is stamped with
 * metadata.seedTag = 'dm-seed-v1'. A second run without DM_WIPE=1 detects
 * those and exits without creating duplicates. It never touches the
 * pre-existing self-DM / bot-DM channels — only channels it stamped itself.
 */

import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import {
  serializeInitialMessageMd,
  serializeReactionsMd,
  MessageType,
  ChannelScopeType,
  ChannelVisibility,
  ChannelRole,
} from '@xyne/shared';
import {
  DM_THREADS,
  HARSH_EMAIL,
  type DmThreadSpec,
  type RecencyBucket,
  type Side,
} from './dm-seed-content';

const prisma = new PrismaClient();

const WIPE = process.env.DM_WIPE === '1';
const SKIP_VESPA = process.env.DM_SKIP_VESPA === '1';
const SEED_TAG = 'dm-seed-v1';

/** Collected as we go, then queued for Vespa in one pass at the end. */
const vespaJobs: Array<{ schema: string; docId: string }> = [];

const NOW = Date.now();
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// ---------------------------------------------------------------------------
// Deterministic PRNG — same tag, same timestamps/unread-state, every run.
// ---------------------------------------------------------------------------

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed;
  return function rng() {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Timing — recency bucket anchors the LAST line; `gap`/`hour` walk from there.
// ---------------------------------------------------------------------------

function bucketWindowDays(bucket: RecencyBucket): [number, number] {
  switch (bucket) {
    case 'today':
      return [0, 0.3];
    case 'yesterday':
      return [1, 1.4];
    case 'this_week':
      return [1.6, 6];
    case 'last_week':
      return [8, 13];
    case 'last_weekend':
      return [2, 9]; // resolved against the most recent Saturday below
    case 'two_weeks':
      return [14, 20];
    case 'this_month':
      return [21, 29];
    case 'last_month':
      return [31, 55];
    case 'two_months':
      return [58, 82];
    case 'dormant':
      return [90, 150];
    default:
      return [21, 29];
  }
}

function setHour(ms: number, hour: number, minute: number): number {
  const d = new Date(ms);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function mostRecentSaturday(fromMs: number): number {
  const d = new Date(fromMs);
  const day = d.getDay(); // 0 sun .. 6 sat
  const diff = (day - 6 + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

/** One timestamp per line, strictly increasing, never in the future. */
function computeTimestamps(spec: DmThreadSpec): number[] {
  const rng = mulberry32(hashSeed(spec.tag));

  let endMs: number;
  if (spec.recency === 'last_weekend') {
    const satMs = mostRecentSaturday(NOW);
    const hour = 11 + Math.floor(rng() * 9);
    endMs = setHour(satMs, hour, Math.floor(rng() * 60));
  } else {
    const [minD, maxD] = bucketWindowDays(spec.recency);
    const endDaysAgo = minD + rng() * (maxD - minD);
    let base = NOW - endDaysAgo * DAY_MS;
    const hourRoll = rng();
    const hour =
      hourRoll < 0.1
        ? 22 + Math.floor(rng() * 2) // late night 22-23
        : hourRoll < 0.16
          ? Math.floor(rng() * 5) // early morning 0-4
          : 9 + Math.floor(rng() * 10); // work hours 9-18
    base = setHour(base, hour, Math.floor(rng() * 60));
    endMs = base;
  }

  const lines = spec.lines;
  const gaps = lines.map((l, i) => (i === 0 ? 0 : (l.gap ?? 2 + Math.floor(rng() * 6))));
  const totalMin = gaps.reduce((a, b) => a + b, 0);

  let t = endMs - totalMin * MINUTE_MS;
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    t += gaps[i] * MINUTE_MS;
    let ts = t;
    const hourOverride = lines[i].hour;
    if (hourOverride !== undefined) {
      ts = setHour(ts, hourOverride, new Date(ts).getMinutes());
    }
    out.push(ts);
  }

  // Guard: hour overrides can rewind ordering — force strictly increasing.
  for (let i = 1; i < out.length; i++) {
    if (out[i] <= out[i - 1]) out[i] = out[i - 1] + MINUTE_MS;
  }
  // Guard: never land in the future.
  const overshoot = out[out.length - 1] - (NOW - MINUTE_MS);
  if (overshoot > 0) {
    for (let i = 0; i < out.length; i++) out[i] -= overshoot;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Read state — unread badges concentrate on recent threads, like a real inbox.
// ---------------------------------------------------------------------------

interface ReadState {
  unreadA: number;
  unreadB: number;
  lastViewedA: number;
  lastViewedB: number;
}

const AUTO_UNREAD_CHANCE: Record<RecencyBucket, number> = {
  today: 0.55,
  yesterday: 0.5,
  this_week: 0.35,
  last_weekend: 0.4,
  last_week: 0.12,
  two_weeks: 0.06,
  this_month: 0.04,
  last_month: 0,
  two_months: 0,
  dormant: 0,
};

function computeReadState(spec: DmThreadSpec, timestamps: number[]): ReadState {
  const lines = spec.lines;
  const n = lines.length;
  const lastTs = timestamps[n - 1];
  const fullyRead: ReadState = { unreadA: 0, unreadB: 0, lastViewedA: lastTs + 1000, lastViewedB: lastTs + 1000 };

  const applyUnread = (recipient: Side, count: number): ReadState => {
    const cutoffIndex = Math.max(0, n - count);
    const cutoffTs = cutoffIndex > 0 ? timestamps[cutoffIndex - 1] + 1000 : timestamps[0] - MINUTE_MS;
    const unreadCount = lines.slice(cutoffIndex).filter(l => l.who !== recipient).length;
    if (unreadCount === 0) return fullyRead;
    return recipient === 'a'
      ? { unreadA: unreadCount, lastViewedA: cutoffTs, unreadB: 0, lastViewedB: lastTs + 1000 }
      : { unreadB: unreadCount, lastViewedB: cutoffTs, unreadA: 0, lastViewedA: lastTs + 1000 };
  };

  if (spec.unread) {
    return applyUnread(spec.unread.side, spec.unread.count);
  }

  const lastSender = lines[n - 1].who;
  let runLen = 0;
  for (let i = n - 1; i >= 0 && lines[i].who === lastSender; i--) runLen++;
  if (runLen === 0) return fullyRead;

  const rng = mulberry32(hashSeed(spec.tag + ':unread'));
  const chance = AUTO_UNREAD_CHANCE[spec.recency] ?? 0;
  if (rng() >= chance) return fullyRead;

  const recipient: Side = lastSender === 'a' ? 'b' : 'a';
  const count = Math.max(1, Math.min(runLen, 1 + Math.floor(rng() * runLen)));
  return applyUnread(recipient, count);
}

// ---------------------------------------------------------------------------
// Per-thread seeding
// ---------------------------------------------------------------------------

async function seedThread(
  spec: DmThreadSpec,
  idA: string,
  idB: string,
  workspaceId: string,
  projectId: string,
): Promise<number> {
  const channelId = createId();
  const channelName = [idA, idB].sort().join(',');
  const timestamps = computeTimestamps(spec);
  const lastTs = timestamps[timestamps.length - 1];

  await prisma.channel.create({
    data: {
      id: channelId,
      name: channelName,
      type: 'DEFAULT',
      scopeType: ChannelScopeType.DM,
      visibility: ChannelVisibility.PRIVATE,
      createdBy: idA,
      projectId,
      workspaceId,
      participantCount: 2,
      metadata: { seedTag: SEED_TAG, tag: spec.tag },
      createdAt: new Date(timestamps[0]),
      lastActivityAt: new Date(lastTs),
    },
  });
  vespaJobs.push({ schema: 'chat_container', docId: channelId });

  // The DM list reads channel_stats, not channels — without a row the
  // channel never appears in the sidebar.
  await prisma.channelStats.create({
    data: { channelId, workspaceId, lastActivityAt: new Date(lastTs), participantCount: 2 },
  });

  await prisma.channelParticipant.create({
    data: { channelId, workspaceId, userId: idA, role: ChannelRole.ADMIN },
  });
  await prisma.channelParticipant.create({
    data: { channelId, workspaceId, userId: idB, role: ChannelRole.MEMBER },
  });

  const read = computeReadState(spec, timestamps);
  const starred = spec.starred ?? [];

  await prisma.channelUserStatus.create({
    data: {
      channelId,
      workspaceId,
      userId: idA,
      unreadCount: read.unreadA,
      lastViewedAt: new Date(read.lastViewedA),
      isStarred: starred.includes('a'),
    },
  });
  await prisma.channelUserStatus.create({
    data: {
      channelId,
      workspaceId,
      userId: idB,
      unreadCount: read.unreadB,
      lastViewedAt: new Date(read.lastViewedB),
      isStarred: starred.includes('b'),
    },
  });

  for (let i = 0; i < spec.lines.length; i++) {
    const line = spec.lines[i];
    const senderId = line.who === 'a' ? idA : idB;
    const otherId = line.who === 'a' ? idB : idA;
    const createdAt = new Date(timestamps[i]);
    const messageId = createId();
    const conversationId = createId();

    const reactionsMd = line.react ? serializeReactionsMd({ [line.react]: [otherId] }) : null;

    await prisma.message.create({
      data: {
        messageId,
        conversationId,
        senderId,
        workspaceId,
        content: line.text,
        msgType: MessageType.USER,
        showInChannel: false,
        createdAt,
        reactions_md: reactionsMd,
      },
    });
    vespaJobs.push({ schema: 'chat_message', docId: messageId });

    if (line.react) {
      await prisma.reaction.create({
        data: {
          reactionId: createId(),
          messageId,
          userId: otherId,
          emojiName: line.react,
          workspaceId,
          createdAt: new Date(timestamps[i] + 30_000),
        },
      });
      await prisma.reactionCount.create({
        data: { countId: createId(), messageId, emojiName: line.react, count: 1, workspaceId },
      });
    }

    const initialMd = serializeInitialMessageMd({
      messageId,
      conversationId,
      workspaceId,
      senderId,
      content: line.text,
      msgType: MessageType.USER,
      hasAttachment: false,
      edited: false,
      isDeleted: false,
      showInChannel: false,
      visibleTo: null,
      createdAt: createdAt.getTime(),
      isSent: true,
      reactions_md: reactionsMd,
    });

    await prisma.conversation.create({
      data: {
        conversationId,
        channelId,
        workspaceId,
        createdBy: senderId,
        initialMessageId: messageId,
        createdAt,
        lastActivityAt: createdAt,
        replyCount: 0,
        initial_message_md: initialMd,
      },
    });
  }

  return spec.lines.length;
}

// ---------------------------------------------------------------------------
// Wipe — only ever touches channels this script stamped itself.
// ---------------------------------------------------------------------------

async function wipe(channelIds: string[]) {
  const convs = await prisma.conversation.findMany({
    where: { channelId: { in: channelIds } },
    select: { conversationId: true },
  });
  const convIds = convs.map(c => c.conversationId);

  const msgs = await prisma.message.findMany({
    where: { conversationId: { in: convIds } },
    select: { messageId: true },
  });
  const msgIds = msgs.map(m => m.messageId);

  await prisma.reactionCount.deleteMany({ where: { messageId: { in: msgIds } } });
  await prisma.reaction.deleteMany({ where: { messageId: { in: msgIds } } });
  await prisma.message.deleteMany({ where: { messageId: { in: msgIds } } });
  await prisma.conversation.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.channelUserStatus.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channelParticipant.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channelStats.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
}

// ---------------------------------------------------------------------------
// Vespa queueing — Redis-backed (Bull); if it's down, jobs are just skipped
// with a warning, same as demo-seed.ts. Data is fully usable either way.
// ---------------------------------------------------------------------------

async function queueForVespa(workspaceId: string, orgId: string, userId: string) {
  if (SKIP_VESPA) {
    console.log(`\n  ⏭  DM_SKIP_VESPA=1 — skipped queueing ${vespaJobs.length} documents`);
    return;
  }

  const { vespaQueue } = await import('../src/queues/vespaQueue');

  try {
    await vespaQueue.initialize();
  } catch (error) {
    console.warn(
      `\n  ⚠️  Could not reach Redis to queue ${vespaJobs.length} documents for search: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    console.warn('     The data is seeded and usable; search will not find it until you re-run with Redis up.');
    return;
  }

  let queued = 0;
  for (const job of vespaJobs) {
    try {
      await vespaQueue.addJob({
        schema: job.schema as never,
        jobType: 'feed' as never,
        docId: job.docId,
        workspaceId,
        orgId,
        userId,
      } as never);
      queued++;
    } catch (error) {
      console.warn(`     failed to queue ${job.schema}/${job.docId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  await vespaQueue.close();
  console.log(`\n  🔍 Queued ${queued}/${vespaJobs.length} documents for Vespa indexing`);
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n🌱 Seeding DM conversations\n');

  const workspace = await prisma.workspace.findFirst({ where: { name: 'Default Workspace' } });
  if (!workspace) {
    throw new Error(
      'No "Default Workspace" found. Run the ACL seed first:\n' +
        '  pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts',
    );
  }

  const orgMember = await prisma.orgMember.findFirst({ select: { orgId: true } });
  if (!orgMember) throw new Error('No organization found. Run scripts/seed-acl.ts first.');

  const dmProject = await prisma.project.findFirst({ where: { workspaceId: workspace.id, code: 'DM' } });
  if (!dmProject) throw new Error('DM project not found — expected org-seed / seed-acl to have created it.');

  console.log(`  workspace: ${workspace.name}`);
  console.log(`  threads in content: ${DM_THREADS.length}`);

  // Resolve every referenced email up front — fail fast rather than invent people.
  const emails = Array.from(new Set(DM_THREADS.flatMap(t => [t.a, t.b])));
  const users = await prisma.user.findMany({
    where: { email: { in: emails }, workspaceId: workspace.id },
    select: { id: true, email: true },
  });
  const byEmail = new Map(users.map(u => [u.email, u]));
  const missing = emails.filter(e => !byEmail.has(e));
  if (missing.length > 0) {
    throw new Error(
      `Missing users for ${missing.length} email(s), refusing to invent people:\n  ${missing.join('\n  ')}\n` +
        'Run org-seed.ts first, or fix the email in dm-seed-content.ts.',
    );
  }
  console.log(`  👥 ${users.length} people resolved`);

  if (!byEmail.has(HARSH_EMAIL)) {
    throw new Error(`${HARSH_EMAIL} not found — expected the local dev/admin account to already exist.`);
  }

  const existingSeeded = await prisma.channel.findMany({
    where: {
      workspaceId: workspace.id,
      scopeType: { in: [ChannelScopeType.DM, ChannelScopeType.GROUP_DM] },
    },
    select: { id: true, metadata: true },
  });
  const priorRun = existingSeeded.filter(c => {
    const meta = c.metadata as { seedTag?: string } | null;
    return meta?.seedTag === SEED_TAG;
  });

  if (priorRun.length > 0 && !WIPE) {
    console.log(`\n  ✅ ${priorRun.length} DM threads already seeded (tag "${SEED_TAG}") — nothing to do.`);
    console.log('     Re-run with DM_WIPE=1 to replace them.\n');
    return;
  }

  if (priorRun.length > 0 && WIPE) {
    console.log(`  🧹 wiping ${priorRun.length} previously seeded DM channel(s)...`);
    await wipe(priorRun.map(c => c.id));
  }

  let threadCount = 0;
  let messageCount = 0;
  const seenPairs = new Set<string>();

  for (const spec of DM_THREADS) {
    const userA = byEmail.get(spec.a)!;
    const userB = byEmail.get(spec.b)!;
    const pairKey = [userA.id, userB.id].sort().join('|');
    if (seenPairs.has(pairKey)) {
      console.warn(`  ⚠️  duplicate pair for tag "${spec.tag}" (${spec.a} / ${spec.b}) — skipping`);
      continue;
    }
    seenPairs.add(pairKey);

    const n = await seedThread(spec, userA.id, userB.id, workspace.id, dmProject.id);
    threadCount++;
    messageCount += n;
  }

  console.log(`  💬 ${threadCount} DM threads · ${messageCount} messages`);

  await queueForVespa(workspace.id, orgMember.orgId, byEmail.get(HARSH_EMAIL)!.id);

  console.log('\n✅ DM seed complete\n');
}

main()
  .catch(error => {
    console.error('\n❌ DM seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
