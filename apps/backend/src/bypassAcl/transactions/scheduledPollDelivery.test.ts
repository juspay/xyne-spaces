jest.mock('@xyne/shared', () => ({
  AttachmentEntityType: { DELAYED_MESSAGE: 'DELAYED_MESSAGE' },
  ConversationParticipation: { AUTHOR: 'AUTHOR' },
  MessageType: { USER: 'USER' },
  buildInitialMessageMd: jest.fn(() => '{"messageId":"message"}'),
  buildPollMessageSummary: jest.fn(() => 'Poll: Lunch?'),
  buildPollRows: jest.fn(),
  normalizePollDraft: jest.fn((value: unknown) => value),
  normalizePollSchedule: jest.fn((value: unknown) => value),
}));

const txMock = {
  delayedMessage: { findUnique: jest.fn(), update: jest.fn() },
  user: { findUnique: jest.fn() },
  message: { findUnique: jest.fn(), create: jest.fn() },
  conversation: { create: jest.fn() },
  conversationParticipant: { create: jest.fn() },
  poll: { create: jest.fn() },
  pollQuestion: { createMany: jest.fn() },
  pollQuestionResult: { createMany: jest.fn() },
  messageAttachment: { deleteMany: jest.fn() },
};

jest.mock('@/database/client', () => ({
  db: { $transaction: jest.fn((fn: (tx: typeof txMock) => unknown) => fn(txMock)) },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { buildPollRows, type PollDraft } from '@xyne/shared';
import { deliverScheduledPollTx, scheduledPollIds } from './scheduledPollDelivery';

const timestamp = Date.parse('2026-10-14T12:00:00.000Z');
const poll: PollDraft = {
  pollId: 'poll-1',
  allowAudienceChoices: false,
  isAnonymous: false,
  resultVisibility: 'EVERYONE',
  questions: [
    {
      id: 'question-1',
      question: 'Lunch?',
      responseType: 'SINGLE_CHOICE',
      options: [
        { id: 'option-1', text: 'Yes' },
        { id: 'option-2', text: 'No' },
      ],
    },
  ],
};

function delayedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delayed-1',
    workspaceId: 'workspace-1',
    channelId: 'channel-1',
    conversationId: null,
    senderId: 'user-1',
    pollDraft: {
      poll,
      schedule: { closeAt: '2026-10-14T13:00:00.000Z', remindAt: '2026-10-14T12:30:00.000Z' },
    },
    status: 'SENDING',
    ...overrides,
  };
}

const input = {
  delayedMessageId: 'delayed-1',
  expectedChannelId: 'channel-1',
  expectedSenderId: 'user-1',
  timestamp,
};

const closesAt = Date.parse('2026-10-14T13:00:00.000Z');
const remindAt = Date.parse('2026-10-14T12:30:00.000Z');
const pollRows = {
  poll: {
    id: 'poll-1',
    workspaceId: 'workspace-1',
    messageId: scheduledPollIds('delayed-1').messageId,
    createdBy: 'user-1',
    allowAudienceChoices: false,
    isAnonymous: false,
    resultVisibility: 'EVERYONE',
    closesAt,
    remindAt,
    closedAt: null,
    createdAt: timestamp,
  },
  questions: [
    {
      id: 'question-1',
      workspaceId: 'workspace-1',
      pollId: 'poll-1',
      question: 'Lunch?',
      position: 0,
      responseType: 'SINGLE_CHOICE',
      options: [
        { id: 'option-1', text: 'Yes', createdBy: 'user-1' },
        { id: 'option-2', text: 'No', createdBy: 'user-1' },
      ],
      createdAt: timestamp,
    },
  ],
  results: [
    {
      questionId: 'question-1',
      workspaceId: 'workspace-1',
      pollId: 'poll-1',
      voterCount: 0,
      optionCounts: {},
      rankTotals: {},
      ratingTotal: 0,
      updatedAt: timestamp,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(buildPollRows).mockReturnValue(pollRows as ReturnType<typeof buildPollRows>);
  txMock.delayedMessage.findUnique.mockResolvedValue(delayedRow());
  txMock.message.findUnique.mockResolvedValue(null);
  txMock.user.findUnique.mockResolvedValue({ id: 'user-1', workspaceId: 'workspace-1' });
});

describe('deliverScheduledPollTx', () => {
  it('publishes the poll rows from buildPollRows with a server-built summary', async () => {
    const ids = scheduledPollIds('delayed-1');
    const createdAt = new Date(timestamp);

    const result = await deliverScheduledPollTx(input);

    expect(buildPollRows).toHaveBeenCalledWith({
      draft: poll,
      messageId: ids.messageId,
      workspaceId: 'workspace-1',
      userId: 'user-1',
      timestamp,
      schedule: { closeAt: '2026-10-14T13:00:00.000Z', remindAt: '2026-10-14T12:30:00.000Z' },
    });
    expect(result).toEqual({
      ...ids,
      createdPoll: {
        id: 'poll-1',
        closesAt: new Date('2026-10-14T13:00:00.000Z'),
        remindAt: new Date('2026-10-14T12:30:00.000Z'),
      },
    });
    expect(txMock.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ messageId: ids.messageId, content: 'Poll: Lunch?' }),
    });
    expect(txMock.poll.create).toHaveBeenCalledWith({
      data: {
        ...pollRows.poll,
        closesAt: new Date(closesAt),
        remindAt: new Date(remindAt),
        createdAt,
      },
    });
    expect(txMock.pollQuestion.createMany).toHaveBeenCalledWith({
      data: [{ ...pollRows.questions[0], createdAt }],
    });
    expect(txMock.pollQuestionResult.createMany).toHaveBeenCalledWith({
      data: [{ ...pollRows.results[0], updatedAt: createdAt }],
    });
    expect(txMock.delayedMessage.update).toHaveBeenCalledWith({
      where: { id: 'delayed-1' },
      data: { status: 'SENT', sentAt: createdAt, failureReason: null },
    });
  });

  it('is a no-op replay once the deterministic message exists', async () => {
    txMock.delayedMessage.findUnique.mockResolvedValue(delayedRow({ status: 'SENT' }));
    txMock.message.findUnique.mockResolvedValue({ messageId: 'message' });

    const result = await deliverScheduledPollTx(input);

    expect(result.createdPoll).toBeNull();
    expect(txMock.poll.create).not.toHaveBeenCalled();
  });

  it('rejects a payload that is not a { poll, schedule } envelope', async () => {
    txMock.delayedMessage.findUnique.mockResolvedValue(delayedRow({ pollDraft: poll }));

    await expect(deliverScheduledPollTx(input)).rejects.toThrow('Scheduled poll payload is missing');
    expect(txMock.conversation.create).not.toHaveBeenCalled();
  });

  it('refuses a delayed message for another channel or sender', async () => {
    await expect(
      deliverScheduledPollTx({ ...input, expectedChannelId: 'channel-2' }),
    ).rejects.toThrow('Not authorized to deliver this scheduled poll');
    expect(txMock.conversation.create).not.toHaveBeenCalled();
  });
});
