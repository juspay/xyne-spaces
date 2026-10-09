jest.mock('@xyne/shared', () => ({
  AttachmentEntityType: { DELAYED_MESSAGE: 'DELAYED_MESSAGE' },
  ConversationParticipation: { AUTHOR: 'AUTHOR' },
  MessageType: { USER: 'USER' },
  buildInitialMessageMd: jest.fn(() => '{"messageId":"message"}'),
  normalizePollChoice: jest.fn((value: string) => value.trim().toLocaleLowerCase()),
  normalizePollDraft: jest.fn((value: unknown) => value),
  normalizePollSchedule: jest.fn((value: unknown) => value),
}));

import type { PollDraft } from '@xyne/shared';
import {
  deliverScheduledPollTx,
  scheduledPollIds,
  type ScheduledPollDeliveryClient,
} from './scheduledPollDelivery';

const poll: PollDraft = {
  pollId: 'poll-1',
  allowAudienceChoices: false,
  isAnonymous: false,
  resultVisibility: 'EVERYONE',
  sortResultsByVotes: false,
  questions: [
    {
      id: 'question-1',
      question: 'Lunch?',
      responseType: 'SINGLE_CHOICE',
      options: [{ id: 'option-1', text: 'Yes' }],
    },
  ],
};

function clientFor(existingMessage: { messageId: string } | null = null) {
  const tx = {
    delayedMessage: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'delayed-1',
        workspaceId: 'workspace-1',
        channelId: 'channel-1',
        conversationId: null,
        senderId: 'user-1',
        content: '<p>Lunch?</p>',
        pollDraft: {
          poll,
          schedule: {
            closeAt: '2026-10-06T13:00:00.000Z',
            remindAt: '2026-10-06T12:30:00.000Z',
          },
        },
        status: 'SENDING',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    channel: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'channel-1',
        workspaceId: 'workspace-1',
        archivedAt: null,
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user-1', workspaceId: 'workspace-1' }),
    },
    message: {
      findUnique: jest.fn().mockResolvedValue(existingMessage),
      create: jest.fn().mockResolvedValue(undefined),
    },
    conversation: { create: jest.fn().mockResolvedValue(undefined) },
    conversationParticipant: { create: jest.fn().mockResolvedValue(undefined) },
    poll: { create: jest.fn().mockResolvedValue(undefined) },
    messageAttachment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const client = {
    $transaction: jest.fn(async (callback: (transactionClient: typeof tx) => Promise<unknown>) =>
      callback(tx)),
  } as unknown as ScheduledPollDeliveryClient;
  return { client, tx };
}

describe('scheduled poll delivery transaction', () => {
  it('derives stable, distinct conversation and message ids', () => {
    expect(scheduledPollIds('delayed-1')).toEqual(scheduledPollIds('delayed-1'));
    expect(scheduledPollIds('delayed-1').conversationId)
      .not.toBe(scheduledPollIds('delayed-1').messageId);
  });

  it('writes the poll graph before marking the delayed message sent', async () => {
    const { client, tx } = clientFor();

    const result = await deliverScheduledPollTx({
      delayedMessageId: 'delayed-1',
      expectedChannelId: 'channel-1',
      expectedSenderId: 'user-1',
      timestamp: Date.parse('2026-10-06T12:00:00.000Z'),
      client,
    });

    const ids = scheduledPollIds('delayed-1');
    expect(result).toEqual({ ...ids, created: true });
    expect(tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageId: ids.messageId,
          metadata: expect.objectContaining({ messageSubtype: 'poll' }),
        }),
      })
    );
    expect(tx.poll.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'poll-1',
          messageId: ids.messageId,
          jobs: {
            create: expect.arrayContaining([
              expect.objectContaining({ kind: 'CLOSE', maxAttempts: 5 }),
              expect.objectContaining({ kind: 'REMINDER', maxAttempts: 5 }),
            ]),
          },
        }),
      })
    );
    expect(tx.delayedMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      })
    );
    expect(tx.poll.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.delayedMessage.update.mock.invocationCallOrder[0]
    );
  });

  it('returns the committed deterministic delivery without creating rows on retry', async () => {
    const ids = scheduledPollIds('delayed-1');
    const { client, tx } = clientFor({ messageId: ids.messageId });
    tx.delayedMessage.findUnique.mockResolvedValue({
      id: 'delayed-1',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      conversationId: null,
      senderId: 'user-1',
      content: '<p>Lunch?</p>',
      pollDraft: { poll, schedule: {} },
      status: 'SENT',
    });

    await expect(deliverScheduledPollTx({
      delayedMessageId: 'delayed-1',
      expectedChannelId: 'channel-1',
      expectedSenderId: 'user-1',
      timestamp: Date.parse('2026-10-06T12:00:00.000Z'),
      client,
    })).resolves.toEqual({ ...ids, created: false });

    expect(tx.conversation.create).not.toHaveBeenCalled();
    expect(tx.poll.create).not.toHaveBeenCalled();
  });
});
