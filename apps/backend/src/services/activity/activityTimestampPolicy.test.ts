import type { PrismaClient } from '@prisma/client';

jest.mock('@xyne/shared', () => ({
  ActivityClassification: { FYI: 'FYI' },
  ActivityClassificationJobType: {},
  UserStatus: { ACTIVE: 'ACTIVE' },
}));

jest.mock('@/database/client', () => ({ db: {} }));
jest.mock('@/database/repositories', () => ({
  repositories: { channels: { getWorkspaceId: jest.fn() } },
}));
jest.mock('@/database/tenant/context', () => ({
  currentWorkspaceId: jest.fn(),
  withWorkspaceScope: (callback: () => unknown) => callback(),
  runAsSystem: (callback: () => unknown) => callback(),
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { ActivityService } from './activityService';

const activity = {
  findFirst: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};
const message = { findUnique: jest.fn() };
const conversation = { findUnique: jest.fn(), findMany: jest.fn() };
const prisma = { activity, message, conversation } as unknown as PrismaClient;

describe('Activity event timestamp policy', () => {
  const service = new ActivityService(prisma);
  const eventAt = new Date('2026-08-30T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(eventAt);
    activity.update.mockResolvedValue({});
    activity.updateMany.mockResolvedValue({ count: 1 });
    message.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('refreshes updatedAt when a new reaction changes a batched activity', async () => {
    activity.findFirst.mockResolvedValue({
      id: 'activity-1',
      conversationSeenCutoffAt: eventAt,
    });

    await service.upsertReactionActivityV2({
      messageId: 'message-1',
      channelId: 'channel-1',
      actorId: 'actor-2',
      messageAuthorId: 'user-1',
    });

    expect(activity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ updatedAt: eventAt }),
      })
    );
  });

  it('refreshes updatedAt when a new reply changes a batched activity', async () => {
    activity.findFirst.mockResolvedValue({
      id: 'activity-1',
      conversationSeenCutoffAt: eventAt,
    });

    await service.upsertReplyActivityV2({
      conversationId: 'conversation-1',
      parentMessageId: 'message-1',
      channelId: 'channel-1',
      actorId: 'actor-2',
      recipientUserId: 'user-1',
      latestReplyMessageId: 'message-2',
    });

    expect(activity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ updatedAt: eventAt }),
      })
    );
  });

  it('refreshes updatedAt when reply activity metadata moves to another message', async () => {
    await service.updateReplyActivitiesMetadataV2({
      conversationId: 'conversation-1',
      recipientUserIds: ['user-1'],
      actorId: 'actor-2',
      latestReplyMessageId: 'message-2',
    });

    expect(activity.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ updatedAt: eventAt }),
      })
    );
  });
});
