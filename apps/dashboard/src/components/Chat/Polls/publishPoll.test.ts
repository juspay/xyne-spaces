import { describe, expect, it, vi } from 'vitest';
import type { PollDraft, PollSchedule } from '@xyne/shared';
import { publishPollToChannel } from './publishPoll';

vi.mock('@xyne/shared', () => ({
  MessageType: { USER: 'USER' },
  buildPollMessageSummary: () => '<p>Poll: Where?</p>',
}));

const poll: PollDraft = {
  pollId: 'poll-1',
  allowAudienceChoices: false,
  isAnonymous: false,
  resultVisibility: 'EVERYONE',
  sortResultsByVotes: false,
  questions: [
    {
      id: 'question-1',
      question: 'Where?',
      responseType: 'SINGLE_CHOICE',
      options: [
        { id: 'option-1', text: 'Here' },
        { id: 'option-2', text: 'There' },
      ],
    },
  ],
};

describe('publishPollToChannel', () => {
  it('schedules a future poll in the active channel with its lifecycle schedule', async () => {
    const scheduleMutation = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn();
    const pollSchedule: PollSchedule = {
      publishAt: '2026-10-06T12:30:00.000Z',
      closeAt: '2026-10-06T13:30:00.000Z',
    };

    await publishPollToChannel(
      { poll, pollSchedule, channelId: 'channel-2', timestamp: 1000 },
      { createId: () => 'delayed-1', schedule: scheduleMutation, send },
    );

    expect(scheduleMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delayed-1',
        channelId: 'channel-2',
        poll,
        pollSchedule,
        scheduledFor: Date.parse(pollSchedule.publishAt!),
      }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('awaits immediate publication in the active channel', async () => {
    const scheduleMutation = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    const ids = ['message-1', 'conversation-1'];

    await publishPollToChannel(
      { poll, pollSchedule: {}, channelId: 'channel-2', timestamp: 1000 },
      { createId: () => ids.shift()!, schedule: scheduleMutation, send },
    );

    expect(send).toHaveBeenCalledWith(
      { kind: 'channel', channelId: 'channel-2' },
      expect.objectContaining({
        messageId: 'message-1',
        conversationId: 'conversation-1',
        poll,
        pollSchedule: {},
      }),
    );
    expect(scheduleMutation).not.toHaveBeenCalled();
  });
});
