jest.mock('@xyne/shared', () => ({
  ChannelVisibility: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' },
  GuestEntity: { CHANNEL: 'CHANNEL' },
  schema: { tables: {} },
}));

const query = { where: jest.fn(), related: jest.fn(), one: jest.fn() };
query.where.mockReturnValue(query);
query.related.mockReturnValue(query);
query.one.mockReturnValue(query);

jest.mock('../../queries', () => ({
  zql: {
    polls: query,
    poll_questions: query,
    poll_question_results: query,
    channels: query,
    guest_access: query,
    channel_participants: query,
  },
}));

import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import type { QueryContext } from '../core/types';
import { PollQuestionResultsMutationACL } from './poll-question-results-acl';

const context: QueryContext = {
  userID: 'user-1',
  workspaceId: 'workspace-1',
  role: 'MEMBER',
  orgRole: 'MEMBER',
  memberId: 'member-1',
};

function transactionReturning(...rows: unknown[]): Transaction<Schema> {
  return {
    run: jest.fn().mockImplementation(() => Promise.resolve(rows.shift())),
  } as unknown as Transaction<Schema>;
}

const poll = {
  id: 'poll-1',
  workspaceId: 'workspace-1',
  createdBy: 'user-1',
  message: { isDeleted: false, conversation: { channelId: 'channel-1' } },
};
const publicChannel = { id: 'channel-1', workspaceId: 'workspace-1', visibility: 'PUBLIC' };

const resultRow = (overrides: Record<string, unknown> = {}) => ({
  questionId: 'question-1',
  workspaceId: 'workspace-1',
  pollId: 'poll-1',
  voterCount: 0,
  optionCounts: {},
  rankTotals: {},
  ratingTotal: 0,
  updatedAt: 1,
  ...overrides,
});

describe('PollQuestionResultsMutationACL', () => {
  it('allows the poll author to initialize an empty aggregate row', async () => {
    const tx = transactionReturning(poll, publicChannel, {
      id: 'question-1',
      pollId: 'poll-1',
      workspaceId: 'workspace-1',
    });
    await expect(
      new PollQuestionResultsMutationACL(context).canInsert(resultRow(), tx)
    ).resolves.toBeUndefined();
  });

  it('rejects client-authored aggregate counts', async () => {
    const tx = transactionReturning(poll, publicChannel, {
      id: 'question-1',
      pollId: 'poll-1',
      workspaceId: 'workspace-1',
    });
    await expect(
      new PollQuestionResultsMutationACL(context).canInsert(resultRow({ voterCount: 10 }), tx)
    ).rejects.toThrow('start empty');
  });

  it('lets a voter with channel access recompute the aggregate row', async () => {
    const tx = transactionReturning(resultRow(), { ...poll, createdBy: 'someone-else' }, publicChannel);
    await expect(
      new PollQuestionResultsMutationACL(context).canUpdate(
        { questionId: 'question-1', voterCount: 1 },
        tx
      )
    ).resolves.toBeUndefined();
  });

  it('only lets the poll creator delete the aggregate row', async () => {
    const tx = transactionReturning(resultRow(), { ...poll, createdBy: 'someone-else' }, publicChannel);
    await expect(
      new PollQuestionResultsMutationACL(context).canDelete({ questionId: 'question-1' }, tx)
    ).rejects.toThrow('Only the poll creator');
  });
});
