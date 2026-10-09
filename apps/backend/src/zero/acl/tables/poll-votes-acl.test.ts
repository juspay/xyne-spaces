jest.mock('@xyne/shared', () => ({
  ChannelVisibility: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' },
  GuestEntity: { CHANNEL: 'CHANNEL' },
  isPollClosedAt: (poll: { closedAt?: number | null }) => poll.closedAt != null,
  schema: { tables: {} },
}));

const query = {
  where: jest.fn(),
  related: jest.fn(),
  one: jest.fn(),
};
query.where.mockReturnValue(query);
query.related.mockReturnValue(query);
query.one.mockReturnValue(query);

jest.mock('../../queries', () => ({
  zql: {
    polls: query,
    poll_questions: query,
    poll_votes: query,
    channels: query,
    guest_access: query,
    channel_participants: query,
  },
}));

import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import type { QueryContext } from '../core/types';
import { PollVotesACL } from './poll-votes-acl';

const context: QueryContext = {
  userID: 'user-1',
  workspaceId: 'workspace-1',
  role: 'MEMBER',
  orgRole: 'MEMBER',
  memberId: 'member-1',
};

const ballot = (overrides: Record<string, unknown> = {}) => ({
  id: 'vote-1',
  workspaceId: context.workspaceId,
  pollId: 'poll-1',
  questionId: 'question-1',
  userId: context.userID,
  optionIds: ['option-1'],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const pollScope = (overrides: Record<string, unknown> = {}) => ({
  id: 'poll-1',
  workspaceId: context.workspaceId,
  message: { isDeleted: false, conversation: { channelId: 'channel-1' } },
  ...overrides,
});

function transactionReturning(...rows: unknown[]): Transaction<Schema> {
  return {
    run: jest.fn().mockImplementation(() => Promise.resolve(rows.shift())),
  } as unknown as Transaction<Schema>;
}

describe('PollVotesACL', () => {
  it('allows a member to create their own ballot in an accessible public channel', async () => {
    const tx = transactionReturning(
      pollScope(),
      { id: 'channel-1', workspaceId: context.workspaceId, visibility: 'PUBLIC' },
      { id: 'question-1', pollId: 'poll-1', workspaceId: context.workspaceId },
    );

    await expect(new PollVotesACL(context).canInsert(ballot(), tx)).resolves.toBeUndefined();
  });

  it('rejects a ballot attributed to another user', async () => {
    const tx = transactionReturning();

    await expect(
      new PollVotesACL(context).canInsert(ballot({ userId: 'user-2' }), tx),
    ).rejects.toThrow('your own ballot');
  });

  it('rejects client-supplied workspace IDs from another tenant', async () => {
    const tx = transactionReturning();

    await expect(
      new PollVotesACL(context).canInsert(ballot({ workspaceId: 'workspace-2' }), tx),
    ).rejects.toThrow('this workspace');
  });

  it('rejects a nonparticipant ballot in a private channel', async () => {
    const tx = transactionReturning(
      pollScope(),
      { id: 'channel-1', workspaceId: context.workspaceId, visibility: 'PRIVATE' },
      null,
    );

    await expect(new PollVotesACL(context).canInsert(ballot(), tx)).rejects.toThrow(
      'channel access',
    );
  });

  it('allows a guest ballot only when the guest has explicit channel access', async () => {
    const guestContext = { ...context, role: 'GUEST' };
    const tx = transactionReturning(
      pollScope(),
      { id: 'channel-1', workspaceId: context.workspaceId, visibility: 'PRIVATE' },
      { id: 'channel-1', workspaceId: context.workspaceId, visibility: 'PRIVATE' },
      { id: 'guest-access-1' },
      { id: 'question-1', pollId: 'poll-1', workspaceId: context.workspaceId },
    );

    await expect(
      new PollVotesACL(guestContext).canInsert(ballot(), tx),
    ).resolves.toBeUndefined();
  });

  it('rejects a ballot when the owning poll message is deleted', async () => {
    const tx = transactionReturning(
      pollScope({
        message: { isDeleted: true, conversation: { channelId: 'channel-1' } },
      }),
    );

    await expect(new PollVotesACL(context).canInsert(ballot(), tx)).rejects.toThrow('deleted');
  });

  it('rejects a vote after the lifecycle worker closes the poll', async () => {
    const tx = transactionReturning(pollScope({ closedAt: 900 }), {
      id: 'channel-1',
      workspaceId: context.workspaceId,
      visibility: 'PUBLIC',
    });

    await expect(new PollVotesACL(context).canInsert(ballot(), tx)).rejects.toThrow('closed');
  });
});
