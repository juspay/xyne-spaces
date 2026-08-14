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

  // `visibleTo` is what separates a notice addressed to one person from one posted to the
  // channel. Anything the product posts channel-wide leaves it unset, so it is refused by
  // default — no subtype list to keep in step.
  it.each([
    ['a call summary', { messageSubtype: 'call_summary' }],
    ['a whiteboard', { messageSubtype: 'call_whiteboard' }],
    ['a channel email notice', { messageSubtype: 'channel_email' }],
    ['a subtype nobody has written yet', { messageSubtype: 'something_added_next_quarter' }],
    ['no metadata at all', undefined],
  ])('refuses to delete %s, which is addressed to the channel', async (_label, metadata) => {
    const tx = transactionReturning(
      nonParticipantBanner({ visibleTo: null, metadata }),
      { channel: { workspaceId: context.workspaceId } },
    );

    await expect(acl.canDelete({ messageId: 'message-1' }, tx)).rejects.toThrow(
      'system messages cannot be deleted',
    );
  });

  it('lets the recipient dismiss a personal notice of any subtype', async () => {
    const tx = transactionReturning(
      nonParticipantBanner({ metadata: { messageSubtype: 'some_future_personal_nudge' } }),
      { channel: { workspaceId: context.workspaceId } },
    );

    await expect(acl.canDelete({ messageId: 'message-1' }, tx)).resolves.toBeUndefined();
  });

  it("refuses a banner addressed to someone else", async () => {
    const tx = transactionReturning(
      nonParticipantBanner({ visibleTo: 'user-2' }),
      { channel: { workspaceId: context.workspaceId } },
    );

    await expect(acl.canDelete({ messageId: 'message-1' }, tx)).rejects.toThrow(
      'system messages cannot be deleted',
    );
  });

  it("refuses another user's ordinary message", async () => {
    const tx = transactionReturning(
      { messageId: 'message-1', conversationId: 'conversation-1', msgType: 'USER', senderId: 'user-2' },
      { channel: { workspaceId: context.workspaceId } },
    );

    await expect(acl.canDelete({ messageId: 'message-1' }, tx)).rejects.toThrow(
      'only the original sender can delete this message',
    );
  });
});

describe('MessagesACL.canUpdate', () => {
  const acl = new MessagesACL(context);

  function participantNotice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      messageId: 'message-1',
      conversationId: 'conversation-1',
      msgType: 'SYSTEM',
      metadata: { operationType: 'participants_removed', adminUserId: context.userID },
      ...overrides,
    };
  }

  // Removing several people in a row coalesces into one notice, so the admin who wrote it
  // edits it. Without this the second removal fails outright.
  it('lets the admin who posted a participant notice coalesce into it', async () => {
    const tx = transactionReturning(
      participantNotice(),
      { channel: { workspaceId: context.workspaceId } },
      { channel: { id: 'channel-1', visibility: 'PUBLIC' } },
    );

    await expect(acl.canUpdate({ messageId: 'message-1' }, tx)).resolves.toBeUndefined();
  });

  it('refuses a participant notice posted by a different admin', async () => {
    const tx = transactionReturning(
      participantNotice({ metadata: { operationType: 'participants_removed', adminUserId: 'user-2' } }),
      { channel: { workspaceId: context.workspaceId } },
    );

    await expect(acl.canUpdate({ messageId: 'message-1' }, tx)).rejects.toThrow(
      'system messages cannot be modified',
    );
  });

  it('refuses any other system message', async () => {
    const tx = transactionReturning(
      participantNotice({ metadata: { messageSubtype: 'call_summary' } }),
      { channel: { workspaceId: context.workspaceId } },
    );

    await expect(acl.canUpdate({ messageId: 'message-1' }, tx)).rejects.toThrow(
      'system messages cannot be modified',
    );
  });
});

describe('MessagesACL.canDelete — sender path', () => {
  const acl = new MessagesACL(context);

  it("refuses another user's ordinary message", async () => {
    const tx = transactionReturning(
      { messageId: 'message-1', conversationId: 'conversation-1', msgType: 'USER', senderId: 'user-2' },
      { channel: { workspaceId: context.workspaceId } },
    );

    await expect(acl.canDelete({ messageId: 'message-1' }, tx)).rejects.toThrow(
      'only the original sender can delete this message',
    );
  });
});
