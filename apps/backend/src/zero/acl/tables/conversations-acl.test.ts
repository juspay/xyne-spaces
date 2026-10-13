jest.mock('@xyne/shared', () => ({
  ChannelVisibility: { PUBLIC: 'PUBLIC' },
  schema: { tables: {} },
}));

jest.mock('../../queries', () => ({
  zql: {
    conversations: {
      where: jest.fn(() => ({
        related: jest.fn(() => ({ one: jest.fn() })),
      })),
    },
    messages: {
      where: jest.fn(),
    },
    channels: {
      where: jest.fn(() => ({ one: jest.fn() })),
    },
    channel_participants: {
      where: jest.fn(() => ({
        where: jest.fn(() => ({ one: jest.fn() })),
      })),
    },
  },
}));

import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import type { QueryContext } from '../core/types';
import { ConversationsACL } from './conversations-acl';

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

describe('ConversationsACL.canDelete', () => {
  const acl = new ConversationsACL(context);

  it('allows empty-thread cleanup after message deletion removes all messages', async () => {
    const tx = transactionReturning(
      {
        conversationId: 'conversation-1',
        createdBy: 'user-2',
        channel: { workspaceId: context.workspaceId, isArchived: false },
      },
      { channel: { workspaceId: context.workspaceId } },
      [],
    );

    await expect(acl.canDelete({ conversationId: 'conversation-1' }, tx)).resolves.toBeUndefined();
  });

  it("does not allow deleting another user's conversation while messages still exist", async () => {
    const tx = transactionReturning(
      {
        conversationId: 'conversation-1',
        createdBy: 'user-2',
        channel: { workspaceId: context.workspaceId, isArchived: false },
      },
      { channel: { workspaceId: context.workspaceId } },
      [{ messageId: 'message-1' }],
    );

    await expect(acl.canDelete({ conversationId: 'conversation-1' }, tx)).rejects.toThrow(
      'Conversation delete failed: only the conversation creator can delete it',
    );
  });
});
