jest.mock('@xyne/shared', () => ({
  ActivityClassification: { PENDING: 'PENDING' },
}));

jest.mock('@/services/activity/activityService', () => ({
  activityService: { createActivities: jest.fn() },
}));

jest.mock('@/services/notificationService', () => ({
  notificationService: { createMentionNotifications: jest.fn() },
}));

jest.mock('@/utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import {
  resolveMentionReplayRecipients,
  replayMentionForAddedUsers,
  type MentionReplaySource,
} from './mentionReplayUtils';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';

const source = (overrides: Partial<MentionReplaySource> = {}): MentionReplaySource => ({
  messageId: 'msg-1',
  conversationId: 'conv-1',
  channelId: 'chan-1',
  senderId: 'sender-1',
  isDeleted: false,
  isThreadMessage: false,
  ...overrides,
});

describe('resolveMentionReplayRecipients', () => {
  it('notifies an added user who was actually mentioned', () => {
    expect(
      resolveMentionReplayRecipients({
        channelId: 'chan-1',
        source: source(),
        addedUserIds: ['user-a'],
        mentionedUserIds: ['user-a'],
      }),
    ).toEqual(['user-a']);
  });

  it('drops added users the message never mentioned', () => {
    expect(
      resolveMentionReplayRecipients({
        channelId: 'chan-1',
        source: source(),
        addedUserIds: ['user-a', 'user-b'],
        mentionedUserIds: ['user-a'],
      }),
    ).toEqual(['user-a']);
  });

  it('refuses to replay a message that belongs to another channel', () => {
    expect(
      resolveMentionReplayRecipients({
        channelId: 'chan-1',
        source: source({ channelId: 'chan-2' }),
        addedUserIds: ['user-a'],
        mentionedUserIds: ['user-a'],
      }),
    ).toEqual([]);
  });

  it('never replays a deleted source message', () => {
    expect(
      resolveMentionReplayRecipients({
        channelId: 'chan-1',
        source: source({ isDeleted: true }),
        addedUserIds: ['user-a'],
        mentionedUserIds: ['user-a'],
      }),
    ).toEqual([]);
  });

  it('excludes the sender and de-duplicates', () => {
    expect(
      resolveMentionReplayRecipients({
        channelId: 'chan-1',
        source: source(),
        addedUserIds: ['sender-1', 'user-a', 'user-a'],
        mentionedUserIds: ['sender-1', 'user-a'],
      }),
    ).toEqual(['user-a']);
  });
});

describe('replayMentionForAddedUsers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing when there are no recipients', async () => {
    await replayMentionForAddedUsers({
      recipientUserIds: [],
      channelId: 'chan-1',
      channelName: 'general',
      workspaceId: 'ws-1',
      source: source(),
      actorName: 'Sender',
      actorPicture: '',
      preview: 'hello',
    });

    expect(activityService.createActivities).not.toHaveBeenCalled();
    expect(notificationService.createMentionNotifications).not.toHaveBeenCalled();
  });

  it('writes the activity record and sends the mention notification', async () => {
    await replayMentionForAddedUsers({
      recipientUserIds: ['user-a'],
      channelId: 'chan-1',
      channelName: 'general',
      workspaceId: 'ws-1',
      source: source({ isThreadMessage: true }),
      actorName: 'Sender',
      actorPicture: 'pic',
      preview: 'hello',
    });

    expect(activityService.createActivities).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'user-a',
        actorId: 'sender-1',
        actorAction: 'mentioned_user',
        messageId: 'msg-1',
        channelId: 'chan-1',
        isThreadActivity: true,
      }),
    ]);
    expect(notificationService.createMentionNotifications).toHaveBeenCalledWith(
      ['user-a'],
      'msg-1',
      'conv-1',
      'chan-1',
      'general',
      'sender-1',
      'Sender',
      'hello',
      'ws-1',
      undefined,
      false,
      true,
      'pic',
    );
  });

  it('swallows delivery failures so the add still succeeds', async () => {
    (activityService.createActivities as jest.Mock).mockRejectedValueOnce(new Error('db down'));

    await expect(
      replayMentionForAddedUsers({
        recipientUserIds: ['user-a'],
        channelId: 'chan-1',
        channelName: 'general',
        workspaceId: 'ws-1',
        source: source(),
        actorName: 'Sender',
        actorPicture: '',
        preview: 'hello',
      }),
    ).resolves.toBeUndefined();
  });
});
