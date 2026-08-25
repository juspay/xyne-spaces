#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Seeds realistic tickets into the #xyne-spaces channel.
 *
 * Additive by design: it never deletes and it continues the project's existing
 * ticket numbering, so it can be run on a workspace that already has tickets.
 *
 * Like demo-seed.ts, a ticket becomes visible in a channel through its
 * conversation, not through the ticket row — MessageBubble draws the card off
 * `conversation.ticket_md`. Three things have to line up:
 *
 *   ticket.conversationId  → the conversation
 *   conversation.ticketId  → back to the ticket
 *   conversation.ticket_md → the denormalized card the UI actually draws
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-xyne-spaces-tickets.ts
 *   SEED_CHANNEL=xyne-spaces SEED_COUNT=120 …
 *
 * Not queued for Vespa: these rows reach the UI over Zero, but full-text search
 * needs a reindex.
 */

import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import {
  serializeInitialMessageMd,
  serializeTicketMd,
  MessageType,
  TicketStatusV2,
  TicketPriority,
} from '@xyne/shared';
import { TICKET_SPECS } from './seed-xyne-spaces-tickets-content';

const prisma = new PrismaClient();

const CHANNEL_NAME = process.env.SEED_CHANNEL ?? 'xyne-spaces';
const COUNT = Number(process.env.SEED_COUNT ?? 120);

const STATUS_TO_STAGE: Record<string, string> = {
  TODO: 'Triage',
  STARTED: 'In Progress',
  PAUSED: 'In Progress',
  CANCELLED: 'Triage',
  COMPLETED: 'Done',
};

/** Spread createdAt across the past ~6 months so the board does not look bulk-loaded. */
function stagger(index: number, total: number): Date {
  const oldestDays = 182;
  const spanMs = oldestDays * 24 * 60 * 60 * 1000;
  const frac = index / Math.max(total - 1, 1);
  // Skew recent: more tickets in the last few weeks than six months back.
  const eased = Math.pow(frac, 1.6);
  const jitterMs = ((index * 7919) % 41) * 37 * 60 * 1000;
  return new Date(Date.now() - (spanMs - eased * spanMs) - jitterMs);
}

async function main() {
  const channel = await prisma.channel.findFirst({
    where: { name: CHANNEL_NAME },
    select: { id: true, name: true, workspaceId: true },
  });
  if (!channel) throw new Error(`Channel "${CHANNEL_NAME}" not found`);

  const project = await prisma.project.findFirst({
    where: { code: 'PLAT', workspaceId: channel.workspaceId },
    select: { id: true, code: true },
  });
  if (!project) throw new Error('Project with code PLAT not found');

  const board = await prisma.board.findFirst({
    where: { projectId: project.id },
    select: { id: true, name: true },
  });
  if (!board) throw new Error(`No board on project ${project.id}`);

  // Only people actually in the channel get to report or be assigned work in it.
  const memberships = await prisma.channelUserStatus.findMany({
    where: { channelId: channel.id },
    select: { userId: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: memberships.map((m) => m.userId) } },
    select: { id: true, name: true },
  });
  if (users.length === 0) throw new Error(`Channel ${channel.name} has no members`);

  // Continue the existing sequence rather than colliding with it.
  const existing = await prisma.ticket.findMany({
    where: { projectId: project.id },
    select: { xyneId: true },
  });
  const maxNum = existing.reduce((max, t) => {
    const n = Number(t.xyneId?.split('-')[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  console.log(`\n  channel  #${channel.name} (${channel.id})`);
  console.log(`  project  ${project.code} · board ${board.name}`);
  console.log(`  people   ${users.length} channel members`);
  console.log(`  numbers  ${project.code}-${maxNum + 1} … ${project.code}-${maxNum + COUNT}\n`);

  const specs = Array.from({ length: COUNT }, (_, i) => TICKET_SPECS[i % TICKET_SPECS.length]);

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const reporter = users[(i * 13 + 5) % users.length];
    const assignee = users[(i * 29 + 11) % users.length];
    const createdAt = stagger(i, specs.length);
    const xyneId = `${project.code}-${maxNum + i + 1}`;
    const stageName = STATUS_TO_STAGE[spec.s] ?? 'Triage';

    const conversationId = createId();
    const messageId = createId();

    await prisma.message.create({
      data: {
        messageId,
        conversationId,
        senderId: reporter.id,
        workspaceId: channel.workspaceId,
        content: spec.t,
        msgType: MessageType.USER,
        showInChannel: false,
        createdAt,
      },
    });

    const thread = spec.th ?? [];
    for (let m = 0; m < thread.length; m++) {
      await prisma.message.create({
        data: {
          messageId: createId(),
          conversationId,
          senderId: users[(i * 7 + m * 17 + 3) % users.length].id,
          workspaceId: channel.workspaceId,
          content: thread[m],
          msgType: MessageType.USER,
          showInChannel: false,
          createdAt: new Date(createdAt.getTime() + (m + 1) * 17 * 60_000),
        },
      });
    }

    const ticket = await prisma.ticket.create({
      data: {
        title: spec.t,
        description: spec.d,
        statusV2: spec.s as TicketStatusV2,
        priority: spec.p as TicketPriority,
        createdBy: reporter.id,
        updatedBy: reporter.id,
        assignedTo: assignee.id,
        conversationId,
        channelId: channel.id,
        xyneId,
        projectId: project.id,
        workspaceId: channel.workspaceId,
        boardId: board.id,
        stageName,
        lastEmailAt: createdAt,
        createdAt,
        updatedAt: new Date(createdAt.getTime() + thread.length * 17 * 60_000),
        statusUpdatedAt: createdAt,
        ...(spec.s === 'COMPLETED'
          ? {
              closedAt: new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000),
              closedBy: assignee.id,
            }
          : {}),
      },
      select: { id: true, xyneId: true },
    });

    await prisma.conversation.create({
      data: {
        conversationId,
        channelId: channel.id,
        workspaceId: channel.workspaceId,
        createdBy: reporter.id,
        initialMessageId: messageId,
        ticketId: ticket.id,
        createdAt,
        lastActivityAt: new Date(createdAt.getTime() + thread.length * 17 * 60_000),
        replyCount: thread.length,
        initial_message_md: serializeInitialMessageMd({
          messageId,
          conversationId,
          senderId: reporter.id,
          content: spec.t,
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
          id: ticket.id,
          title: spec.t,
          description: spec.d,
          statusV2: TicketStatusV2[spec.s as keyof typeof TicketStatusV2],
          priority: TicketPriority[spec.p as keyof typeof TicketPriority],
          assignedTo: assignee.id,
          createdBy: reporter.id,
          createdAt: createdAt.getTime(),
          xyneId,
          stageName,
          channelId: channel.id,
          conversationId,
        }),
      },
    });

    console.log(`  🎫 ${ticket.xyneId}  ${spec.s.padEnd(9)} ${spec.p.padEnd(8)} ${spec.t}`);
  }

  // Keep the counter ahead of what we just wrote so the app does not reissue ids.
  await prisma.project.update({
    where: { id: project.id },
    data: { ticketSequence: maxNum + COUNT },
  });

  console.log(`\n  ✅ ${COUNT} tickets → #${channel.name}; ticketSequence = ${maxNum + COUNT}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
