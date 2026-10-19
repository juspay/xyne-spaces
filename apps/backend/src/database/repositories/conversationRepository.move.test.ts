jest.mock('@/queues/vespaQueue', () => ({
  vespaQueue: { addJob: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/database/client', () => ({
  DatabaseClient: { getInstance: () => mockPrisma },
}));

import { PrismaClient } from '@prisma/client';
import { ConversationRepository } from './conversationRepository';

const mockPrisma = new PrismaClient();
const prisma = mockPrisma;
const repo = new ConversationRepository();
const DAY = 24 * 60 * 60 * 1000;
const RUN = `mv${Date.now().toString(36)}`;

let workspaceId: string;
let userId: string;
let projectId: string;
let boardId: string;
const createdChannelIds: string[] = [];

async function makeChannel(): Promise<string> {
  const channel = await prisma.channel.create({
    data: {
      name: `${RUN}-${createdChannelIds.length}`,
      scopeType: 'GROUP_DM',
      visibility: 'PRIVATE',
      createdBy: userId,
      projectId,
      workspaceId,
    },
  });
  createdChannelIds.push(channel.id);
  return channel.id;
}

async function makeThread(
  channelId: string,
  createdAt: Date,
  lastActivityAt: Date,
  extra: { doNotPostToChannel?: boolean } = {},
): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: {
      channelId,
      createdBy: userId,
      initialMessageId: 'pending',
      workspaceId,
      createdAt,
      lastActivityAt,
      ...extra,
    },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.conversationId,
      senderId: userId,
      content: 'hello',
      showInChannel: true,
      workspaceId,
      createdAt,
    },
  });
  await prisma.conversation.update({
    where: { conversationId: conversation.conversationId },
    data: { initialMessageId: message.messageId },
  });
  return conversation.conversationId;
}

beforeAll(async () => {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!user) {
    throw new Error('No user with a workspace in the test database');
  }
  userId = user.id;
  workspaceId = user.workspaceId;
  const project = await prisma.project.create({
    data: {
      name: `${RUN} project`,
      code: RUN.slice(-6).toUpperCase(),
      workspaceId,
      type: 'DEFAULT',
      createdBy: userId,
      updatedBy: userId,
    },
  });
  projectId = project.id;
  const board = await prisma.board.create({
    data: { name: `${RUN} board`, projectId, workspaceId, createdBy: userId },
  });
  boardId = board.id;
});

afterAll(async () => {
  const conversations = await prisma.conversation.findMany({
    where: { channelId: { in: createdChannelIds } },
    select: { conversationId: true },
  });
  const ids = conversations.map(c => c.conversationId);
  await prisma.message.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.channel.deleteMany({ where: { id: { in: createdChannelIds } } });
  await prisma.board.deleteMany({ where: { id: boardId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.$disconnect();
});

describe('moveConversationsToChannel by last activity', () => {
  it('moves a thread started days ago with a reply today, and leaves a quiet old thread', async () => {
    const source = await makeChannel();
    const target = await makeChannel();
    const now = Date.now();
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));

    const activeOld = await makeThread(source, new Date(now - 3 * DAY), new Date(now - 60_000));
    const quietOld = await makeThread(source, new Date(now - 3 * DAY), new Date(now - 3 * DAY));

    const preview = await repo.getHistoryPreview(source, startOfToday, 20);
    const count = await repo.countHistoryPreview(source, startOfToday);
    expect(preview.map(p => p.conversationId)).toEqual([activeOld]);
    expect(count).toBe(1);

    const result = await repo.moveConversationsToChannel(source, target, startOfToday);

    expect(result).toEqual({ moved: 1, remaining: 1 });
    const after = await prisma.conversation.findMany({
      where: { conversationId: { in: [activeOld, quietOld] } },
      select: { conversationId: true, channelId: true },
    });
    const channelOf = new Map(after.map(c => [c.conversationId, c.channelId]));
    expect(channelOf.get(activeOld)).toBe(target);
    expect(channelOf.get(quietOld)).toBe(source);
  });

  it('moves the ticket on a moved thread to the destination channel', async () => {
    const source = await makeChannel();
    const target = await makeChannel();
    const now = new Date();
    const thread = await makeThread(source, now, now);

    const ticket = await prisma.ticket.create({
      data: {
        title: `${RUN} ticket`,
        description: 'd',
        createdBy: userId,
        updatedBy: userId,
        conversationId: thread,
        channelId: source,
        xyneId: `${RUN}-1`,
        projectId,
        workspaceId,
        boardId,
        stageName: 'Backlog',
        lastEmailAt: now,
      },
    });
    await prisma.ticketDescription.create({
      data: {
        ticketId: ticket.id,
        channelId: source,
        workspaceId,
        description: 'd',
        createdAt: now,
        updatedAt: now,
      },
    });

    await repo.moveConversationsToChannel(source, target, null);

    const movedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const movedDescription = await prisma.ticketDescription.findUniqueOrThrow({
      where: { ticketId: ticket.id },
    });
    expect(movedTicket.channelId).toBe(target);
    expect(movedDescription.channelId).toBe(target);

    await prisma.ticketDescription.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.ticket.deleteMany({ where: { id: ticket.id } });
  });

  it('reports remaining 0 when only doNotPostToChannel threads are left behind', async () => {
    const source = await makeChannel();
    const target = await makeChannel();
    const now = new Date();
    await makeThread(source, now, now);
    await makeThread(source, now, now, { doNotPostToChannel: true });

    const result = await repo.moveConversationsToChannel(source, target, null);

    expect(result).toEqual({ moved: 1, remaining: 0 });
  });
});
