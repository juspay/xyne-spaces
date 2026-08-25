#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Repoints the #xyne-spaces tickets onto a board in that channel's own project.
 *
 * The tickets tab resolves its scope from the channel, not from the ticket rows:
 * KanbanBoardScreen computes `effectiveProjectId = projectIdParam || channel.projectId`
 * and queries tickets by that project. #xyne-spaces belongs to "Payments Platform"
 * (JSP), which had no board at all — so tickets written against the Platform (PLAT)
 * project were invisible there no matter how they were linked.
 *
 * This creates the missing board + stages on the channel's project and moves the
 * tickets across, reissuing xyneId under the correct project code and rewriting
 * the denormalized conversation.ticket_md that the channel feed renders from.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/fix-xyne-spaces-ticket-board.ts
 */

import { PrismaClient } from '@prisma/client';
import { serializeTicketMd, TicketStatusV2, TicketPriority } from '@xyne/shared';

const prisma = new PrismaClient();

const CHANNEL_NAME = process.env.SEED_CHANNEL ?? 'xyne-spaces';
const BOARD_NAME = 'Delivery';
const STAGES = ['Triage', 'In Progress', 'In Review', 'Done'];

async function main() {
  const channel = await prisma.channel.findFirst({
    where: { name: CHANNEL_NAME },
    select: { id: true, name: true, projectId: true, workspaceId: true },
  });
  if (!channel) throw new Error(`Channel "${CHANNEL_NAME}" not found`);
  if (!channel.projectId) throw new Error(`Channel #${channel.name} has no projectId`);

  const project = await prisma.project.findUnique({
    where: { id: channel.projectId },
    select: { id: true, name: true, code: true, createdBy: true },
  });
  if (!project) throw new Error(`Project ${channel.projectId} not found`);

  console.log(`\n  channel  #${channel.name}`);
  console.log(`  project  ${project.name} (${project.code}) — the tab scopes to this\n`);

  // The board the tab needs. Idempotent: reuse it if a previous run made it.
  let board = await prisma.board.findFirst({
    where: { projectId: project.id, name: BOARD_NAME },
    select: { id: true, name: true },
  });
  if (board) {
    console.log(`  ↻ board "${board.name}" already exists`);
  } else {
    board = await prisma.board.create({
      data: {
        name: BOARD_NAME,
        projectId: project.id,
        workspaceId: channel.workspaceId,
        createdBy: project.createdBy,
        description: 'What the team is working on, by stage.',
      },
      select: { id: true, name: true },
    });
    console.log(`  ✚ board "${board.name}" (${board.id})`);
  }

  for (let i = 0; i < STAGES.length; i++) {
    const existing = await prisma.stage.findFirst({
      where: { boardId: board.id, name: STAGES[i] },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.stage.create({
      data: {
        name: STAGES[i],
        boardId: board.id,
        workspaceId: channel.workspaceId,
        sequenceNumber: i + 1,
        createdBy: project.createdBy,
      },
    });
    console.log(`  ✚ stage "${STAGES[i]}"`);
  }

  // Everything in this channel that is not already on the right project.
  const tickets = await prisma.ticket.findMany({
    where: { channelId: channel.id, NOT: { projectId: project.id } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, title: true, description: true, statusV2: true, priority: true,
      assignedTo: true, createdBy: true, createdAt: true, stageName: true,
      conversationId: true, xyneId: true, projectId: true,
    },
  });
  if (tickets.length === 0) {
    console.log('\n  nothing to move — tickets are already on the channel project\n');
    return;
  }

  const sourceProjectIds = [...new Set(tickets.map((t) => t.projectId))];

  // Continue this project's own numbering rather than carrying PLAT-* across.
  const existingHere = await prisma.ticket.findMany({
    where: { projectId: project.id },
    select: { xyneId: true },
  });
  let next = existingHere.reduce((max, t) => {
    const n = Number(t.xyneId?.split('-')[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  console.log(`\n  moving ${tickets.length} tickets → ${project.code}-${next + 1} …\n`);

  for (const t of tickets) {
    next += 1;
    const xyneId = `${project.code}-${next}`;

    await prisma.ticket.update({
      where: { id: t.id },
      data: { projectId: project.id, boardId: board.id, xyneId },
    });

    // ticket_md embeds xyneId, so the card would keep showing the old number.
    await prisma.conversation.update({
      where: { conversationId: t.conversationId },
      data: {
        ticket_md: serializeTicketMd({
          id: t.id,
          title: t.title,
          description: t.description,
          statusV2: t.statusV2 as TicketStatusV2,
          priority: t.priority as TicketPriority,
          assignedTo: t.assignedTo,
          createdBy: t.createdBy,
          createdAt: t.createdAt.getTime(),
          xyneId,
          stageName: t.stageName,
          channelId: channel.id,
          conversationId: t.conversationId,
        }),
      },
    });
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { ticketSequence: next },
  });

  // Leave the projects we moved off with a counter matching what they still hold.
  for (const pid of sourceProjectIds) {
    const remaining = await prisma.ticket.findMany({
      where: { projectId: pid },
      select: { xyneId: true },
    });
    const max = remaining.reduce((m, t) => {
      const n = Number(t.xyneId?.split('-')[1]);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    await prisma.project.update({ where: { id: pid }, data: { ticketSequence: max } });
    console.log(`  ↩ source project ${pid} ticketSequence → ${max}`);
  }

  console.log(`\n  ✅ ${tickets.length} tickets on ${project.code} / ${board.name}; ticketSequence = ${next}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
