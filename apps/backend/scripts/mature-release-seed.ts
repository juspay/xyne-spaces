#!/usr/bin/env npx tsx
/// <reference types="node" />

/**
 * Mature Release Manager demo seed — release board, tickets, timeline events.
 *
 * PREREQUISITE: base seed + release-manager-localdev/seed-release.ts
 *
 * Usage (from apps/backend):
 *   NODE_ENV=development SEED_USER_EMAIL=you@example.com pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/mature-release-seed.ts
 *   MATURE_RELEASE_WIPE=1 ...  # remove prior mature-release data
 */

import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import {
  serializeInitialMessageMd,
  serializeTicketMd,
  ChannelScopeType,
  MessageType,
  ProjectType,
  TicketStatus,
  TicketStatusV2,
  TicketPriority,
  BoardType,
  BaseTicketType,
  ReleaseEventType,
  ReleaseTrackingMode,
} from '@xyne/shared';

const prisma = new PrismaClient();

const SEED_META = { seed: 'mature-release' } as const;
const RELEASE_TICKET_COUNT = 10;
const PLATFORM_PROJECT_CODE = process.env.PLATFORM_PROJECT_CODE ?? 'PLAT';
const DEFAULT_PLATFORM_PROJECT_ID = process.env.PLATFORM_PROJECT_ID ?? 'cmsq33yxd000b75atdjq8ute7';
const USER_EMAIL_PREFIX = 'mature-user-';
const BOARD_NAME = 'Releases';
const XYNE_ID_PREFIX = `${PLATFORM_PROJECT_CODE}-RL`;

const RELEASE_STAGES: Array<{ name: string; statusV2: TicketStatusV2; legacy: TicketStatus }> = [
  { name: 'Planning', statusV2: TicketStatusV2.TODO, legacy: TicketStatus.NEW },
  { name: 'Ready', statusV2: TicketStatusV2.STARTED, legacy: TicketStatus.IN_PROGRESS },
  { name: 'Deploying', statusV2: TicketStatusV2.STARTED, legacy: TicketStatus.IN_PROGRESS },
  { name: 'Done', statusV2: TicketStatusV2.COMPLETED, legacy: TicketStatus.RESOLVED },
];

const RELEASE_TITLES = [
  'Spaces 2.14 — channel pagination',
  'Digital Twin persona rollout',
  'Release Manager v2 timeline polish',
  'Ask AI over call transcripts',
  'Zero mutator hardening batch',
  'Customer Ops desk Gmail archive',
  'Claw agent SLO auto-ticket',
  'Canvas export PDF images fix',
  'Mobile web canvas pinch-zoom',
  'Platform search index canvases',
];

const CHANNEL_PREFERENCE = ['releases', 'engineering'];

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60_000);
const hoursAgo = (h: number) => new Date(now - h * 60 * 60_000);

const pick = <T,>(arr: T[], i: number): T => arr[i % arr.length];

type Me = { id: string; email: string; name: string | null };

async function resolveUser(): Promise<Me | null> {
  const targetEmail = process.env.SEED_USER_EMAIL;
  if (targetEmail) {
    const hit = await prisma.user.findFirst({
      where: { email: targetEmail },
      select: { id: true, email: true, name: true },
    });
    if (hit) return hit;
    console.log(`  ⚠️  SEED_USER_EMAIL "${targetEmail}" not found — falling back to the last logged-in user.`);
  }
  const session = await prisma.userSession.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { lastActivity: 'desc' },
    select: { user: { select: { id: true, email: true, name: true } } },
  });
  if (session?.user) return session.user;
  return prisma.user.findFirst({
    where: {
      NOT: [
        { email: { contains: '@app.xyne.ai' } },
        { email: { contains: '@bot.xyne.ai' } },
        { email: { startsWith: USER_EMAIL_PREFIX } },
        { email: { startsWith: 'bulk-user-' } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true },
  });
}

async function deleteConversations(convIds: string[]) {
  if (!convIds.length) return;
  const msgs = await prisma.message.findMany({
    where: { conversationId: { in: convIds } },
    select: { messageId: true },
  });
  const msgIds = msgs.map(m => m.messageId);
  if (msgIds.length) {
    await prisma.reaction.deleteMany({ where: { messageId: { in: msgIds } } });
    await prisma.reactionCount.deleteMany({ where: { messageId: { in: msgIds } } });
    await prisma.message.deleteMany({ where: { messageId: { in: msgIds } } });
  }
  await prisma.activity.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.conversation.deleteMany({ where: { conversationId: { in: convIds } } });
}

async function wipeMatureRelease() {
  console.log('  collecting mature-release data to remove...');
  const matureTickets = await prisma.ticket.findMany({
    where: { metadata: { path: ['seed'], equals: 'mature-release' } },
    select: { id: true, conversationId: true },
  });
  if (!matureTickets.length) {
    console.log('  nothing to wipe');
    return;
  }
  const ticketIds = matureTickets.map(t => t.id);
  const convIds = [...new Set(matureTickets.map(t => t.conversationId))];

  await prisma.releaseEvent.deleteMany({ where: { releaseId: { in: ticketIds } } });
  console.log(`  wiped release events for ${ticketIds.length} tickets`);

  await deleteConversations(convIds);
  console.log(`  wiped ${convIds.length} conversations`);

  await prisma.ticketActivity.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await prisma.ticketTag.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await prisma.ticketAssignment.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  console.log(`  wiped ${ticketIds.length} release tickets`);
}

async function alreadySeeded(): Promise<boolean> {
  const hit = await prisma.ticket.findFirst({
    where: { metadata: { path: ['seed'], equals: 'mature-release' } },
    select: { id: true },
  });
  return !!hit;
}

async function ensureReleaseBoard(projectId: string, workspaceId: string, createdBy: string) {
  let board = await prisma.board.findFirst({
    where: { name: BOARD_NAME, projectId },
  });

  if (!board) {
    board = await prisma.board.create({
      data: {
        name: BOARD_NAME,
        projectId,
        workspaceId,
        createdBy,
        boardType: BoardType.RELEASE,
        releaseTrackingMode: ReleaseTrackingMode.COMMIT_RANGE,
        description: 'Mature demo release board (local seed)',
      },
    });
    console.log(`  created board "${BOARD_NAME}" (${board.id})`);
  } else {
    const needsUpdate =
      board.boardType !== BoardType.RELEASE || !board.releaseTrackingMode;
    if (needsUpdate) {
      board = await prisma.board.update({
        where: { id: board.id },
        data: {
          boardType: BoardType.RELEASE,
          releaseTrackingMode: board.releaseTrackingMode ?? ReleaseTrackingMode.COMMIT_RANGE,
        },
      });
    }
    console.log(`  reusing board "${BOARD_NAME}" (${board.id})`);
  }

  const existingStages = await prisma.stage.findMany({
    where: { boardId: board.id },
    select: { id: true, name: true },
  });
  const stageIdByName = new Map(existingStages.map(s => [s.name, s.id]));

  for (let i = 0; i < RELEASE_STAGES.length; i++) {
    const spec = RELEASE_STAGES[i];
    const existingId = stageIdByName.get(spec.name);
    if (existingId) {
      await prisma.stage.update({
        where: { id: existingId },
        data: {
          sequenceNumber: i + 1,
          defaultTicketStatusV2: spec.statusV2,
          updatedBy: createdBy,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.stage.create({
        data: {
          name: spec.name,
          boardId: board.id,
          workspaceId,
          sequenceNumber: i + 1,
          createdBy,
          defaultTicketStatusV2: spec.statusV2,
        },
      });
    }
  }

  return board;
}

async function resolveChannel(projectId: string) {
  for (const name of CHANNEL_PREFERENCE) {
    const ch = await prisma.channel.findFirst({
      where: { projectId, name, scopeType: ChannelScopeType.DEFAULT },
      select: { id: true, name: true },
    });
    if (ch) return ch;
  }
  const fallback = await prisma.channel.findFirst({
    where: { projectId, scopeType: ChannelScopeType.DEFAULT },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!fallback) throw new Error('No default channel on Platform project.');
  return fallback;
}

function nextRlNumber(existing: string[]): number {
  let max = 0;
  for (const xyneId of existing) {
    if (!xyneId.startsWith(`${XYNE_ID_PREFIX}`)) continue;
    const suffix = xyneId.slice(XYNE_ID_PREFIX.length);
    const n = Number.parseInt(suffix, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

type ReleaseEventSpec = {
  eventType: ReleaseEventType;
  eventName: string;
  message: string;
  hoursBack: number;
};

function eventsForRelease(index: number, title: string, stageName: string, userName: string): ReleaseEventSpec[] {
  const base = 12 + index * 18;
  return [
    {
      eventType: ReleaseEventType.RELEASE,
      eventName: 'RELEASE_CREATED',
      message: `Release ticket opened: ${title}`,
      hoursBack: base,
    },
    {
      eventType: ReleaseEventType.RELEASE,
      eventName: 'COMMIT_ANALYSIS_STARTED',
      message: `Commit analysis started for platform/spaces (${String(8 + index).padStart(7, '0')} → ${String(9 + index).padStart(7, '0')})`,
      hoursBack: base - 2,
    },
    {
      eventType: ReleaseEventType.RELEASE,
      eventName: 'COMMIT_ANALYSIS_COMPLETED',
      message: `Commit analysis completed — ${3 + (index % 4)} applications matched`,
      hoursBack: base - 4,
    },
    {
      eventType: ReleaseEventType.TESTING,
      eventName: 'STAGE_CHANGED',
      message: `${title} → ${stageName}`,
      hoursBack: base - 6,
    },
    {
      eventType: ReleaseEventType.SYSTEM,
      eventName: 'DEPLOYMENT_SCHEDULED',
      message: `Production deploy window scheduled; owner ${userName}`,
      hoursBack: base - 8,
    },
  ].slice(0, 3 + (index % 3));
}

async function seedReleaseTickets(input: {
  me: Me;
  projectId: string;
  workspaceId: string;
  boardId: string;
  channelId: string;
  channelName: string;
}) {
  const { me, projectId, workspaceId, boardId, channelId, channelName } = input;
  const meName = me.name ?? me.email.split('@')[0];

  const existingXyne = await prisma.ticket.findMany({
    where: { workspaceId, xyneId: { startsWith: XYNE_ID_PREFIX } },
    select: { xyneId: true },
  });
  let rlNum = nextRlNumber(existingXyne.map(r => r.xyneId));

  let ticketsCreated = 0;
  let messagesCreated = 0;
  let eventsCreated = 0;

  for (let i = 0; i < RELEASE_TICKET_COUNT; i++) {
    const stageSpec = pick(RELEASE_STAGES, i + 1);
    const titleBase = pick(RELEASE_TITLES, i);
    const title = `Release: ${titleBase}`;
    const description = `${titleBase} — tracked on #${channelName} for Release Manager demo.`;
    const createdAt = daysAgo(14 + i * 9);
    const updatedAt = hoursAgo(6 + i * 5);
    const xyneId = `${XYNE_ID_PREFIX}${String(rlNum++).padStart(3, '0')}`;

    const ticketId = createId();
    const conversationId = createId();
    const initialMessageId = createId();

    const threadLines = [
      `Kicking off ${titleBase}. Branch cut is today.`,
      'QA sign-off needed before prod — ping #releases when green.',
      'Changelog draft is on the release canvas.',
    ];

    await prisma.message.create({
      data: {
        workspaceId,
        messageId: initialMessageId,
        conversationId,
        senderId: me.id,
        content: threadLines[0],
        msgType: MessageType.USER,
        showInChannel: false,
        createdAt,
      },
    });
    messagesCreated++;

    const replyCount = 1 + (i % 2);
    for (let r = 0; r < replyCount; r++) {
      const replyAt = new Date(createdAt.getTime() + (r + 1) * 3600_000);
      await prisma.message.create({
        data: {
          workspaceId,
          messageId: createId(),
          conversationId,
          senderId: me.id,
          content: threadLines[(r + 1) % threadLines.length],
          msgType: MessageType.USER,
          showInChannel: false,
          createdAt: replyAt,
        },
      });
      messagesCreated++;
    }

    await prisma.conversation.create({
      data: {
        workspaceId,
        conversationId,
        channelId,
        createdBy: me.id,
        initialMessageId,
        ticketId,
        createdAt,
        lastActivityAt: updatedAt,
        replyCount,
        metadata: SEED_META,
        initial_message_md: serializeInitialMessageMd({
          messageId: initialMessageId,
          conversationId,
          senderId: me.id,
          content: threadLines[0],
          msgType: MessageType.USER,
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          showInChannel: false,
          visibleTo: null,
          createdAt: createdAt.getTime(),
          isSent: true,
        }),
        ticket_md: serializeTicketMd({
          id: ticketId,
          title,
          description,
          statusV2: stageSpec.statusV2,
          priority: i % 5 === 0 ? TicketPriority.HIGH : TicketPriority.MEDIUM,
          assignedTo: me.id,
          createdBy: me.id,
          createdAt: createdAt.getTime(),
          xyneId,
          stageName: stageSpec.name,
          channelId,
          conversationId,
        }),
      },
    });

    await prisma.ticket.create({
      data: {
        id: ticketId,
        title,
        description,
        status: stageSpec.legacy,
        statusV2: stageSpec.statusV2,
        createdBy: me.id,
        updatedBy: me.id,
        assignedTo: me.id,
        conversationId,
        channelId,
        xyneId,
        projectId,
        workspaceId,
        boardId,
        stageName: stageSpec.name,
        priority: i % 5 === 0 ? TicketPriority.HIGH : TicketPriority.MEDIUM,
        ticketType: BaseTicketType.Release,
        metadata: SEED_META,
        lastEmailAt: updatedAt,
        createdAt,
        updatedAt,
        statusUpdatedAt: updatedAt,
        ...(stageSpec.statusV2 === TicketStatusV2.COMPLETED
          ? { closedAt: updatedAt, closedBy: me.id }
          : {}),
      },
    });
    ticketsCreated++;

    const eventSpecs = eventsForRelease(i, title, stageSpec.name, meName);
    for (const ev of eventSpecs) {
      await prisma.releaseEvent.create({
        data: {
          workspaceId,
          releaseId: ticketId,
          eventType: ev.eventType,
          eventName: ev.eventName,
          message: ev.message,
          userId: me.id,
          userName: meName,
          channelId,
          conversationId,
          createdAt: hoursAgo(ev.hoursBack),
        },
      });
      eventsCreated++;
    }
  }

  return { ticketsCreated, messagesCreated, eventsCreated };
}

async function main() {
  console.log('🚀 Mature release manager demo seed...\n');

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development') {
    console.error(`❌ Refusing to run: NODE_ENV is "${nodeEnv}", expected "development".`);
    process.exit(1);
  }

  if (process.env.MATURE_RELEASE_WIPE === '1') {
    console.log('🧹 Wiping previous mature-release data...');
    await wipeMatureRelease();
  } else if (await alreadySeeded()) {
    console.log('  ⏭️  Mature release seed already present. Set MATURE_RELEASE_WIPE=1 to reseed.');
    const counts = await reportCounts();
    printCounts(counts);
    return;
  }

  const me = await resolveUser();
  if (!me) throw new Error('No users in DB. Run base seed first.');

  const project =
    (await prisma.project.findFirst({
      where: { OR: [{ id: DEFAULT_PLATFORM_PROJECT_ID }, { code: PLATFORM_PROJECT_CODE }] },
      select: { id: true, workspaceId: true, code: true },
    })) ??
    (await prisma.project.findFirst({
      where: { type: ProjectType.DEFAULT },
      select: { id: true, workspaceId: true, code: true },
    }));
  if (!project) throw new Error('No Platform project found.');

  const channel = await resolveChannel(project.id);
  const board = await ensureReleaseBoard(project.id, project.workspaceId, me.id);

  console.log(`  user=${me.email} project=${project.code} channel=#${channel.name} board=${board.id}\n`);

  const seeded = await seedReleaseTickets({
    me,
    projectId: project.id,
    workspaceId: project.workspaceId,
    boardId: board.id,
    channelId: channel.id,
    channelName: channel.name,
  });

  console.log('\n✅ Mature release seed complete.');
  console.log(`   Tickets created this run: ${seeded.ticketsCreated}`);
  console.log(`   Messages created this run: ${seeded.messagesCreated}`);
  console.log(`   Release events created this run: ${seeded.eventsCreated}`);

  const counts = await reportCounts();
  printCounts(counts);
}

async function reportCounts() {
  const matureTickets = await prisma.ticket.findMany({
    where: { metadata: { path: ['seed'], equals: 'mature-release' } },
    select: { id: true },
  });
  const ticketIds = matureTickets.map(t => t.id);
  const releaseTickets = ticketIds.length;
  const releaseEvents = ticketIds.length
    ? await prisma.releaseEvent.count({ where: { releaseId: { in: ticketIds } } })
    : 0;
  const releaseBoards = await prisma.board.count({
    where: { name: BOARD_NAME, boardType: BoardType.RELEASE },
  });
  return { releaseTickets, releaseEvents, releaseBoards };
}

function printCounts(counts: { releaseTickets: number; releaseEvents: number; releaseBoards: number }) {
  console.log(`   Total mature-release tickets: ${counts.releaseTickets}`);
  console.log(`   Total release events (linked): ${counts.releaseEvents}`);
  console.log(`   "${BOARD_NAME}" RELEASE boards: ${counts.releaseBoards}`);
}

main()
  .catch(e => {
    console.error('❌ Mature release seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
