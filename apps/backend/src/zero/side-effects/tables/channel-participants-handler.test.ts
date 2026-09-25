/**
 * `added_to_channel` bell activity: created when someone else adds a user to a channel.
 * Not created for self-joins or DM/GROUP_DM (the DM shelf already counts those), and
 * idempotent under side-effect redelivery.
 */

jest.mock('@xyne/shared', () => ({
  ActivityClassification: { FYI: 'FYI' },
  ChannelScopeType: { DM: 'DM', GROUP_DM: 'GROUP_DM' },
  isDmShelfScopeType: (scopeType: string) => scopeType === 'DM' || scopeType === 'GROUP_DM',
}));

jest.mock('@/database/client', () => ({
  db: {
    channelParticipant: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    channel: { findUnique: jest.fn() },
    activity: { findUnique: jest.fn() },
  },
}));

jest.mock('@/services/notificationService', () => ({
  notificationService: { createParticipantAddedNotifications: jest.fn() },
}));

jest.mock('@/services/activity/activityService', () => ({
  activityService: { createActivities: jest.fn() },
}));

jest.mock('@/services/canvasPermissionSync', () => ({
  refreshCanvasPermissionsForChannel: jest.fn().mockResolvedValue(undefined),
}));

import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { ChannelParticipantsSideEffectHandler } from './channel-participants-handler';

const mockedDb = db as unknown as {
  channelParticipant: { findUnique: jest.Mock };
  user: { findUnique: jest.Mock };
  channel: { findUnique: jest.Mock };
  activity: { findUnique: jest.Mock };
};
const createActivities = activityService.createActivities as jest.Mock;

const PARTICIPANT_ID = 'participant-1';

const runOnInsert = (actorId: string): Promise<void> => {
  const handler = new ChannelParticipantsSideEffectHandler({
    userID: actorId,
    workspaceId: 'ws-1',
  } as never);
  return handler.onInsert({ entityId: PARTICIPANT_ID } as never);
};

describe('ChannelParticipantsSideEffectHandler.onInsert — added_to_channel activity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.channelParticipant.findUnique.mockResolvedValue({
      channelId: 'channel-1',
      userId: 'added-user',
    });
    mockedDb.user.findUnique.mockResolvedValue({ id: 'adder', name: 'Adder', displayName: null });
    mockedDb.channel.findUnique.mockResolvedValue({ name: 'general', scopeType: 'DEFAULT' });
    mockedDb.activity.findUnique.mockResolvedValue(null);
  });

  it('creates one FYI activity for the added user', async () => {
    await runOnInsert('adder');

    expect(createActivities).toHaveBeenCalledTimes(1);
    expect(createActivities).toHaveBeenCalledWith([
      expect.objectContaining({
        id: `added_to_channel_${PARTICIPANT_ID}`,
        userId: 'added-user',
        actorId: 'adder',
        actorAction: 'added_to_channel',
        actionSource: 'channel',
        actionSourceId: 'channel-1',
        channelId: 'channel-1',
        classification: 'FYI',
      }),
    ]);
  });

  it('creates nothing when the user joined themselves', async () => {
    await runOnInsert('added-user');
    expect(createActivities).not.toHaveBeenCalled();
  });

  it.each(['DM', 'GROUP_DM'])('creates nothing for %s channels', async scopeType => {
    mockedDb.channel.findUnique.mockResolvedValue({ name: null, scopeType });
    await runOnInsert('adder');
    expect(createActivities).not.toHaveBeenCalled();
  });

  it('is a no-op when the activity already exists (redelivery)', async () => {
    mockedDb.activity.findUnique.mockResolvedValue({ id: `added_to_channel_${PARTICIPANT_ID}` });
    await runOnInsert('adder');
    expect(createActivities).not.toHaveBeenCalled();
  });
});
