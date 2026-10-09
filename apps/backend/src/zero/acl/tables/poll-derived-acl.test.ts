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
    channels: query,
    guest_access: query,
    channel_participants: query,
  },
}));

import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import type { QueryContext } from '../core/types';
import { PollJobsMutationACL, PollQuestionResultsMutationACL } from './poll-derived-acl';

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
  responseCount: 0,
  rankTotals: {},
  rankResponseCount: 0,
  ratingCounts: {},
  ratingTotal: 0,
  updatedAt: 1,
  ...overrides,
});

const job = (overrides: Record<string, unknown> = {}) => ({
  id: 'poll-1:CLOSE',
  workspaceId: 'workspace-1',
  pollId: 'poll-1',
  kind: 'CLOSE',
  runAt: 2,
  status: 'PENDING',
  attempts: 0,
  maxAttempts: 5,
  leaseOwner: null,
  leaseExpiresAt: null,
  completedAt: null,
  failedAt: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('poll derived-table mutation ACLs', () => {
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

  it('allows the poll author to initialize a lifecycle job', async () => {
    const tx = transactionReturning(poll, publicChannel);
    await expect(new PollJobsMutationACL(context).canInsert(job(), tx)).resolves.toBeUndefined();
  });

  it('rejects a lifecycle job that is already completed', async () => {
    const tx = transactionReturning(poll, publicChannel);
    await expect(
      new PollJobsMutationACL(context).canInsert(job({ status: 'COMPLETED' }), tx)
    ).rejects.toThrow('initial lifecycle state');
  });
});
