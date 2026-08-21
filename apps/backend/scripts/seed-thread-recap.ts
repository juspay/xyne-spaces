#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Seeds a thread that trips the AI thread recap — the "Thread recap" tab in the
 * twin tray above the composer.
 *
 * FOUR THINGS HAVE TO BE TRUE, or the tab never appears. Two live in
 * `src/services/threadSummaryService.ts`, two in the dashboard's
 * `ThreadCatchupSummary/useThreadCatchupSummary.ts`:
 *
 *   1. THREAD_SUMMARY_ENABLED_CHANNELS covers the channel — "all", or the
 *      channel id in the comma-separated list. Empty means off everywhere.
 *   2. The thread holds MORE than THREAD_SUMMARY_MIN_MESSAGES (default 6)
 *      messages that are neither deleted nor SYSTEM.
 *   3. Either
 *        (a) the viewer has a pending first-visit flag in Redis
 *            (`thread-pending-users:<conversationId>`), which the backend writes
 *            when somebody ELSE adds them to a thread — GET /recommendation
 *            consumes it, so it fires exactly once; or
 *        (b) they are a thread participant and at least 10 messages from other
 *            people are newer than their lastReadAt (MIN_UNREAD_FOR_RECAP,
 *            client-side, measured from a baseline captured on thread open).
 *   4. The newest message in the thread is not their own.
 *
 * This script arranges all four, so the recap shows on either path: the flag
 * makes the first visit recommended, and the unread count keeps it available on
 * every visit after that.
 *
 * The summary text itself is generated lazily by the dashboard (GET
 * /conversations/:id/summary → LiteLLM), so LITELLM_API_KEY must be set for the
 * pane to fill in. This script writes no summary of its own.
 *
 * Usage:
 *   pnpm exec dotenv -e .env -- pnpm exec tsx scripts/seed-thread-recap.ts --email you@company.com
 *
 *   --email <address>    Who should see the recap. Default: the first human in
 *                        the workspace (printed, so you can check).
 *   --channel <name|id>  Host the thread in an existing channel. Default:
 *                        reuse-or-create a public channel named `recap-lab`.
 *   --messages <n>       How many messages to write. Default 14 — comfortably
 *                        over both the server's 6 and the client's 10.
 *   --no-flag            Skip the Redis first-visit flag, leaving only the
 *                        unread-count path (3b). Useful for testing that one.
 *   --cleanup            Delete every thread this script has seeded (plus their
 *                        Redis keys) and exit. Channels and users are left.
 */

import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import Redis from 'ioredis';
import {
  serializeInitialMessageMd,
  MessageType,
  ChannelType,
  ChannelScopeType,
  ChannelVisibility,
  ChannelRole,
  ConversationParticipation,
  AuthProvider,
  UserStatus,
  OrgRole,
  WorkspaceRole,
} from '@xyne/shared';
import { hashPassword } from '../src/utils/passwordUtils';

const prisma = new PrismaClient();

/** Stamped on `conversations.metadata` so --cleanup can find its own work. */
const SEED_MARKER = 'seed-thread-recap';
const DEFAULT_CHANNEL_NAME = 'recap-lab';
const DEFAULT_MESSAGE_COUNT = 14;
/** Matches PENDING_USERS_TTL_SECONDS in threadSummaryService.ts. */
const PENDING_USERS_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Only used when the workspace has nobody to talk to but the target user. */
const FILLER_EMAIL_DOMAIN = '@xyne.team';
const FILLER_PASSWORD = 'Demo@12345';

interface Options {
  email?: string;
  channel?: string;
  messages: number;
  flag: boolean;
  cleanup: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = { messages: DEFAULT_MESSAGE_COUNT, flag: true, cleanup: false };

  const value = (arg: string, index: number, name: string): string => {
    const inline = `${name}=`;
    const raw = arg.startsWith(inline) ? arg.slice(inline.length) : args[index + 1];
    if (!raw) throw new Error(`${name} requires a value`);
    return raw;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--') continue;
    if (arg === '--email' || arg.startsWith('--email=')) {
      options.email = value(arg, index, '--email');
      if (!arg.includes('=')) index += 1;
    } else if (arg === '--channel' || arg.startsWith('--channel=')) {
      options.channel = value(arg, index, '--channel');
      if (!arg.includes('=')) index += 1;
    } else if (arg === '--messages' || arg.startsWith('--messages=')) {
      const raw = value(arg, index, '--messages');
      if (!arg.includes('=')) index += 1;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 2) {
        throw new Error('--messages must be an integer >= 2');
      }
      options.messages = parsed;
    } else if (arg === '--no-flag') {
      options.flag = false;
    } else if (arg === '--cleanup') {
      options.cleanup = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

/**
 * A thread with decisions in it. The summary prompt asks for outcomes, so
 * chit-chat produces an empty-feeling recap — these lines each land something.
 * `from` indexes the peer list; the target user never speaks (gate 4).
 */
const SCRIPTED_THREAD: Array<{ from: number; text: string }> = [
  { from: 0, text: 'Checkout is throwing 502s for about 4% of card payments since the 10:20 deploy. Anyone else seeing it?' },
  { from: 1, text: 'Confirmed on my side. All of them are on the new payments-gateway pods, none on the old ones.' },
  { from: 2, text: 'Support has 23 tickets in the last half hour, all "payment failed, card not charged".' },
  { from: 0, text: 'Rolling the deploy back now. Give it five minutes to drain.' },
  { from: 1, text: 'Rollback is out. Error rate is down to 0.2%, which is where it normally sits.' },
  { from: 2, text: 'Ticket volume stopped climbing. I will reply to the 23 and tell them to retry.' },
  { from: 0, text: 'Root cause is the connection pool size — the new config caps it at 10 per pod, we need 50.' },
  { from: 1, text: 'That explains why staging was fine. Staging runs one pod and never hits the cap.' },
  { from: 2, text: 'Do we tell the merchants? A few of the tickets are from the same two accounts.' },
  { from: 0, text: 'Yes. I will send a note to the affected merchants this evening once we have the final numbers.' },
  { from: 1, text: 'Pool size is now an env var instead of a constant, PR is up for review.' },
  { from: 0, text: 'Approved. Ship it behind the flag and we will re-deploy tomorrow morning, not tonight.' },
  { from: 2, text: 'I added a support macro for this failure so nobody has to write the apology by hand again.' },
  { from: 1, text: 'Also adding an alert on pool saturation so we catch it before customers do.' },
  { from: 0, text: 'Last thing: staging gets a second pod this week so the cap is reachable there.' },
  { from: 2, text: 'Merchant note drafted, waiting on the final failure count before it goes out.' },
];

function buildLines(count: number): Array<{ from: number; text: string }> {
  const lines: Array<{ from: number; text: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const source = SCRIPTED_THREAD[index % SCRIPTED_THREAD.length]!;
    // Past one pass the script repeats; number the repeats so the transcript
    // does not read as duplicated messages to the summariser.
    const round = Math.floor(index / SCRIPTED_THREAD.length);
    lines.push(round === 0 ? source : { ...source, text: `${source.text} (follow-up ${round})` });
  }
  return lines;
}

function createRedis(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
    ...(process.env.REDIS_TLS === 'true' ? { tls: { rejectUnauthorized: false } } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
}

interface Person {
  id: string;
  name: string;
  email: string;
}

async function resolveTargetUser(email: string | undefined): Promise<Person & { workspaceId: string; orgMemberId: string }> {
  const user = email
    ? await prisma.user.findFirst({
        where: { email, leftAt: null },
        select: { id: true, name: true, email: true, workspaceId: true, orgMemberId: true },
      })
    : await prisma.user.findFirst({
        where: { userType: 'USER', status: UserStatus.ACTIVE, leftAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, email: true, workspaceId: true, orgMemberId: true },
      });

  if (!user) {
    throw new Error(
      email
        ? `No user found with email ${email}`
        : 'No users in this database — run scripts/seed-acl.ts and scripts/demo-seed.ts first',
    );
  }
  return user;
}

/** Two other humans to hold the conversation; created if the workspace is bare. */
async function resolvePeers(target: Person & { workspaceId: string; orgMemberId: string }): Promise<Person[]> {
  const existing = await prisma.user.findMany({
    where: {
      workspaceId: target.workspaceId,
      userType: 'USER',
      status: UserStatus.ACTIVE,
      leftAt: null,
      id: { not: target.id },
    },
    orderBy: { createdAt: 'asc' },
    take: 3,
    select: { id: true, name: true, email: true },
  });
  if (existing.length >= 2) return existing.slice(0, 3);

  const orgMember = await prisma.orgMember.findUnique({
    where: { memberId: target.orgMemberId },
    select: { orgId: true },
  });
  if (!orgMember) throw new Error(`No org membership for ${target.email}; cannot create filler users`);

  const created: Person[] = [...existing];
  const filler = [
    { first: 'Arjun', last: 'Rao' },
    { first: 'Sara', last: 'Iyer' },
    { first: 'Daniel', last: 'Okafor' },
  ];
  for (const person of filler) {
    if (created.length >= 3) break;
    const name = `${person.first} ${person.last}`;
    const email = `${person.first.toLowerCase()}.${person.last.toLowerCase()}${FILLER_EMAIL_DOMAIN}`;
    if (created.some((c) => c.email === email)) continue;

    // Password accounts, matching demo-seed.ts: passwordHash on the org member,
    // AuthProvider.EMAIL, and the `email-<address>` providerUserId convention.
    // Any other combination produces a user who cannot sign in.
    const memberId = createId();
    await prisma.orgMember.create({
      data: {
        memberId,
        orgId: orgMember.orgId,
        email,
        role: OrgRole.MEMBER,
        passwordHash: await hashPassword(FILLER_PASSWORD),
      },
    });
    const user = await prisma.user.create({
      data: {
        name,
        email,
        picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`,
        authProvider: AuthProvider.EMAIL,
        providerUserId: `email-${email}`,
        status: UserStatus.ACTIVE,
        workspaceId: target.workspaceId,
        orgMemberId: memberId,
        role: WorkspaceRole.MEMBER,
      },
      select: { id: true, name: true, email: true },
    });
    console.log(`  created filler user ${email} (password ${FILLER_PASSWORD})`);
    created.push(user);
  }

  if (created.length < 2) throw new Error('Could not assemble two other participants for the thread');
  return created;
}

async function resolveChannel(
  selector: string | undefined,
  workspaceId: string,
  members: Person[],
): Promise<{ id: string; name: string }> {
  const found = selector
    ? await prisma.channel.findFirst({
        where: { workspaceId, isArchived: false, OR: [{ id: selector }, { name: selector }] },
        select: { id: true, name: true },
      })
    : await prisma.channel.findFirst({
        where: { workspaceId, name: DEFAULT_CHANNEL_NAME, isArchived: false },
        select: { id: true, name: true },
      });

  if (found) {
    await ensureChannelMembership(found.id, workspaceId, members);
    return found;
  }
  if (selector) throw new Error(`No channel matching "${selector}" in workspace ${workspaceId}`);

  const project =
    (await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } })) ??
    (await prisma.project.create({
      data: {
        name: 'Recap Lab',
        code: 'RECAP',
        description: 'Scratch project for thread-recap seeding.',
        workspaceId,
        createdBy: members[0]!.id,
      },
      select: { id: true },
    }));

  const channelId = createId();
  await prisma.channel.create({
    data: {
      id: channelId,
      name: DEFAULT_CHANNEL_NAME,
      description: 'Seeded threads for exercising the AI thread recap.',
      type: ChannelType.DEFAULT,
      scopeType: ChannelScopeType.DEFAULT,
      visibility: ChannelVisibility.PUBLIC,
      createdBy: members[0]!.id,
      projectId: project.id,
      workspaceId,
      participantCount: members.length,
      metadata: { seededBy: SEED_MARKER },
    },
  });
  // The sidebar lists channels from channel_stats, not channels — a channel
  // without this row exists but never shows up.
  await prisma.channelStats.create({
    data: { channelId, lastActivityAt: new Date(), participantCount: members.length, workspaceId },
  });
  await ensureChannelMembership(channelId, workspaceId, members);
  console.log(`  created channel #${DEFAULT_CHANNEL_NAME}`);
  return { id: channelId, name: DEFAULT_CHANNEL_NAME };
}

async function ensureChannelMembership(channelId: string, workspaceId: string, members: Person[]): Promise<void> {
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index]!;
    const existing = await prisma.channelParticipant.findFirst({
      where: { channelId, userId: member.id },
      select: { id: true },
    });
    if (!existing) {
      await prisma.channelParticipant.create({
        data: {
          channelId,
          userId: member.id,
          role: index === 0 ? ChannelRole.ADMIN : ChannelRole.MEMBER,
          workspaceId,
        },
      });
    }
    const status = await prisma.channelUserStatus.findFirst({
      where: { channelId, userId: member.id },
      select: { id: true },
    });
    if (!status) {
      await prisma.channelUserStatus.create({
        data: { channelId, userId: member.id, unreadCount: 0, workspaceId },
      });
    }
  }
  await prisma.channel.update({ where: { id: channelId }, data: { lastActivityAt: new Date() } });
  await prisma.channelStats
    .update({ where: { channelId }, data: { lastActivityAt: new Date() } })
    .catch(() => {
      /* channel predates channel_stats; the feed still works */
    });
}

async function seed(options: Options): Promise<void> {
  const target = await resolveTargetUser(options.email);
  console.log(`Target viewer : ${target.name} <${target.email}>`);

  const peers = await resolvePeers(target);
  console.log(`Other people  : ${peers.map((p) => p.name).join(', ')}`);

  const channel = await resolveChannel(options.channel, target.workspaceId, [target, ...peers]);
  console.log(`Channel       : #${channel.name} (${channel.id})`);

  const lines = buildLines(options.messages);
  const conversationId = createId();
  const workspaceId = target.workspaceId;

  // One message every three minutes, the newest two minutes old. The whole
  // thread has to sit after the target's lastReadAt for the unread path to
  // count it, so lastReadAt is pinned before the first message below.
  const now = Date.now();
  const stepMs = 3 * 60 * 1000;
  const at = (index: number): Date => new Date(now - 2 * 60 * 1000 - (lines.length - 1 - index) * stepMs);

  let initialMd: string | null = null;
  const messageIds: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const sender = peers[line.from % peers.length]!;
    const messageId = createId();
    const createdAt = at(index);
    messageIds.push(messageId);

    await prisma.message.create({
      data: {
        messageId,
        conversationId,
        senderId: sender.id,
        // Denormalized for ACL filtering — rows without it fall outside the
        // workspace-scoped queries the client runs, i.e. invisible messages.
        workspaceId,
        content: line.text,
        msgType: MessageType.USER,
        showInChannel: false,
        createdAt,
      },
    });

    if (index === 0) {
      initialMd = serializeInitialMessageMd({
        messageId,
        conversationId,
        workspaceId,
        senderId: sender.id,
        content: line.text,
        msgType: MessageType.USER,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        showInChannel: false,
        visibleTo: null,
        createdAt: createdAt.getTime(),
        isSent: true,
      });
    }
  }

  const firstAt = at(0);
  const lastAt = at(lines.length - 1);

  await prisma.conversation.create({
    data: {
      conversationId,
      channelId: channel.id,
      workspaceId,
      createdBy: peers[0]!.id,
      initialMessageId: messageIds[0]!,
      createdAt: firstAt,
      lastActivityAt: lastAt,
      replyCount: lines.length - 1,
      initial_message_md: initialMd,
      metadata: { seededBy: SEED_MARKER },
    },
  });

  // Everyone who spoke is an AUTHOR; the target is subscribed but has read
  // nothing, which is what makes every message above count as unread for them.
  const readBefore = new Date(firstAt.getTime() - 5 * 60 * 1000);
  for (const sender of peers) {
    await prisma.conversationParticipant.create({
      data: {
        conversationId,
        userId: sender.id,
        channelId: channel.id,
        workspaceId,
        participationType: ConversationParticipation.AUTHOR,
        isSubscribed: true,
        joinedAt: firstAt,
        lastReadAt: lastAt,
        lastReplyAt: lastAt,
      },
    });
  }
  await prisma.conversationParticipant.create({
    data: {
      conversationId,
      userId: target.id,
      channelId: channel.id,
      workspaceId,
      participationType: ConversationParticipation.MENTIONED,
      isSubscribed: true,
      joinedAt: firstAt,
      lastReadAt: readBefore,
      lastReplyAt: lastAt,
    },
  });

  let flagged = false;
  if (options.flag) {
    const redis = createRedis();
    try {
      await redis.connect();
      // Mirrors flagThreadRecommendation() — the set GET /recommendation reads
      // and empties, which is what makes the very first visit "recommended".
      await redis.sadd(`thread-pending-users:${conversationId}`, target.id);
      await redis.expire(`thread-pending-users:${conversationId}`, PENDING_USERS_TTL_SECONDS);
      flagged = true;
    } catch (error) {
      console.warn(`  ! Redis flag not written (${(error as Error).message}); the unread path still works`);
    } finally {
      await redis.quit().catch(() => redis.disconnect());
    }
  }

  const enabledChannels = (process.env.THREAD_SUMMARY_ENABLED_CHANNELS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const channelEnabled =
    enabledChannels.some((entry) => entry.toLowerCase() === 'all') || enabledChannels.includes(channel.id);

  console.log('');
  console.log(`Thread        : ${conversationId}`);
  console.log(`Messages      : ${lines.length} (all from other people, newest ${Math.round((now - lastAt.getTime()) / 60000)}m ago)`);
  console.log(`Open at       : /${workspaceId}/chat/dir/${channel.id}/${conversationId}`);
  console.log('');
  console.log('Gates:');
  console.log(`  channel enabled          : ${channelEnabled ? 'yes' : `NO — set THREAD_SUMMARY_ENABLED_CHANNELS=all (currently "${process.env.THREAD_SUMMARY_ENABLED_CHANNELS ?? ''}")`}`);
  console.log(`  message count            : ${lines.length} > THREAD_SUMMARY_MIN_MESSAGES (${process.env.THREAD_SUMMARY_MIN_MESSAGES ?? 6})`);
  console.log(`  first-visit flag         : ${flagged ? 'set (one-shot — consumed on first open)' : 'skipped'}`);
  console.log(`  unread from others       : ${lines.length} >= 10 required by the client`);
  console.log(`  newest message is theirs : no`);
  console.log(`  LITELLM_API_KEY          : ${process.env.LITELLM_API_KEY ? 'set' : 'MISSING — the recap pane will stay empty'}`);
  console.log('');
  console.log('Open the thread, then expand the tray above the composer and pick "Thread recap".');
}

async function cleanup(): Promise<void> {
  const conversations = await prisma.conversation.findMany({
    where: { metadata: { path: ['seededBy'], equals: SEED_MARKER } },
    select: { conversationId: true },
  });
  if (conversations.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }
  const ids = conversations.map((c) => c.conversationId);

  await prisma.message.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { conversationId: { in: ids } } });

  const redis = createRedis();
  try {
    await redis.connect();
    await redis.del(
      ...ids.map((id) => `thread-pending-users:${id}`),
      ...ids.map((id) => `thread-summary:${id}`),
    );
  } catch (error) {
    console.warn(`  ! Redis keys not removed (${(error as Error).message})`);
  } finally {
    await redis.quit().catch(() => redis.disconnect());
  }

  console.log(`Removed ${ids.length} seeded thread(s). Channels and users were left alone.`);
  console.log('The dashboard also caches summaries in localStorage under xyne:thread-summary:*.');
}

async function main(): Promise<void> {
  const options = parseArgs();
  if (options.cleanup) {
    await cleanup();
    return;
  }
  await seed(options);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
