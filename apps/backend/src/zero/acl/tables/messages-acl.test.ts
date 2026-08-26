jest.mock('@xyne/shared', () => ({
  ChannelVisibility: { PUBLIC: 'PUBLIC' },
  MessageType: { SYSTEM: 'SYSTEM' },
  schema: { tables: {} },
}));

jest.mock('../../queries', () => ({
  zql: {
    messages: {
      where: jest.fn(() => ({ one: jest.fn() })),
    },
    conversations: {
      where: jest.fn(() => ({
        one: jest.fn(),
        related: jest.fn(() => ({ one: jest.fn() })),
      })),
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
import { MessagesACL } from './messages-acl';

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

function nonParticipantBanner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageId: 'message-1',
    conversationId: 'conversation-1',
    msgType: 'SYSTEM',
    visibleTo: context.userID,
    metadata: { messageSubtype: 'user_not_in_channel' },
    ...overrides,
  };
}

describe('MessagesACL.canDelete', () => {
  const acl = new MessagesACL(context);

  it('allows a user to delete their own non-participant banner', async () => {
    const tx = transactionReturning(
      nonParticipantBanner(),
      { channel: { workspaceId: context.workspaceId } },
    );

    await expect(acl.canDelete({ messageId: 'message-1' }, tx)).resolves.toBeUndefined();
  });

  it('rejects a non-participant banner from another workspace', async () => {
    const tx = transactionReturning(
      nonParticipantBanner(),
      { channel: { workspaceId: 'workspace-2' } },
    );

    await expect(acl.canDelete({ messageId: 'message-1' }, tx)).rejects.toThrow(
      'Message not found in this workspace',
    );
  });

  it('allows cleanup of a deleted initial-message tombstone after the last reply is removed', async () => {
    const tx = transactionReturning(
      {
        messageId: 'root-message',
        conversationId: 'conversation-1',
        senderId: 'user-2',
        msgType: 'USER',
        isDeleted: true,
      },
      { channel: { workspaceId: context.workspaceId } },
      { initialMessageId: 'root-message' },
      [{ messageId: 'root-message' }],
    );

    await expect(acl.canDelete({ messageId: 'root-message' }, tx)).resolves.toBeUndefined();
  });

  it("does not allow deleting another user's tombstoned initial message while replies still exist", async () => {
    const tx = transactionReturning(
      {
        messageId: 'root-message',
        conversationId: 'conversation-1',
        senderId: 'user-2',
        msgType: 'USER',
        isDeleted: true,
      },
      { channel: { workspaceId: context.workspaceId } },
      { initialMessageId: 'root-message' },
      [{ messageId: 'root-message' }, { messageId: 'reply-message' }],
    );

    await expect(acl.canDelete({ messageId: 'root-message' }, tx)).rejects.toThrow(
      'Message delete failed: only the original sender can delete this message',
    );
  });
});
