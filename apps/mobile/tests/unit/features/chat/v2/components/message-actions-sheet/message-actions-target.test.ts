import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MessageType,
  serializeInitialMessageMd,
  serializeReactionsMd,
  type InitialMessageSummary,
} from '@xyne/shared';

import {
  conversationItemToActionsTarget,
  messageItemToActionsTarget,
  toForwardSheetTarget,
} from '@/src/features/chat/v2/components/message-actions-sheet/message-actions-target';
import type { MessageItem } from '@/src/components/message-composer';
import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer.types';
import type { ParsedInitialMessageForUi } from '@/src/components/chat/message/message.types';

const messageItem = (overrides: Record<string, unknown> = {}): MessageItem =>
  ({
    messageId: 'm-1',
    conversationId: 'conv-1',
    childConversationId: null,
    senderId: 'user-1',
    content: 'hi',
    msgType: MessageType.USER,
    hasAttachment: false,
    edited: false,
    isDeleted: false,
    showInChannel: true,
    visibleTo: null,
    createdAt: 1700000000000,
    metadata: null,
    nudgeCount: null,
    isSent: true,
    reactions_md: null,
    link_preview_md: null,
    attachments: [],
    nudgeCounts: [],
    ...overrides,
  }) as unknown as MessageItem;

const summary = (overrides: Partial<InitialMessageSummary> = {}): InitialMessageSummary => ({
  messageId: 'm-1',
  conversationId: 'conv-1',
  senderId: 'user-1',
  content: 'hi',
  msgType: MessageType.USER,
  hasAttachment: false,
  edited: false,
  isDeleted: false,
  showInChannel: true,
  createdAt: 1700000000000,
  isSent: true,
  ...overrides,
});

const conversationItem = (overrides: Record<string, unknown> = {}): ConversationItem =>
  ({
    channelId: 'chan-1',
    conversationId: 'conv-1',
    pinned: false,
    ticketId: null,
    initialMessageAttachments: [],
    initialMessageNudgeCounts: [],
    initial_message_md: serializeInitialMessageMd(summary()),
    ...overrides,
  }) as unknown as ConversationItem;

describe('messageItemToActionsTarget', () => {
  it('returns null for a null message', () => {
    assert.equal(messageItemToActionsTarget(null, { channelId: 'chan-1' }), null);
  });

  it('maps a thread message into a normalized target', () => {
    const target = messageItemToActionsTarget(
      messageItem({ reactions_md: 'rmd', conversationId: 'conv-9' }),
      {
        channelId: 'chan-1',
        threadId: 'thread-1',
        isFirstInThread: true,
        channelScopeType: undefined,
      },
    );
    assert.ok(target);
    assert.equal(target?.channelId, 'chan-1');
    assert.equal(target?.threadId, 'thread-1');
    assert.equal(target?.conversationId, 'conv-9');
    assert.equal(target?.isPinned, false);
    assert.equal(target?.reactionsMd, 'rmd');
    assert.equal(target?.isFirstInThread, true);
    assert.equal(target?.hasTicket, false);
  });

  it('omits channelName when it is not provided', () => {
    const target = messageItemToActionsTarget(messageItem(), { channelId: 'chan-1' });
    assert.ok(target);
    assert.equal('channelName' in (target as object), false);
  });

  it('detects a ticket from message metadata', () => {
    const target = messageItemToActionsTarget(messageItem({ metadata: { ticketId: 't-1' } }), {
      channelId: 'chan-1',
    });
    assert.equal(target?.hasTicket, true);
  });
});

describe('toForwardSheetTarget', () => {
  it('builds a forward target and defaults a missing user id to empty string', () => {
    const message = { conversationId: 'conv-5' } as unknown as ParsedInitialMessageForUi;
    const target = toForwardSheetTarget(message, 'chan-2', undefined);
    assert.equal(target.conversationId, 'conv-5');
    assert.equal(target.channelId, 'chan-2');
    assert.equal(target.currentUserId, '');
    assert.equal(target.initialMessage, message);
  });

  it('preserves an explicit current user id', () => {
    const message = { conversationId: 'conv-5' } as unknown as ParsedInitialMessageForUi;
    const target = toForwardSheetTarget(message, 'chan-2', 'user-7');
    assert.equal(target.currentUserId, 'user-7');
  });
});

describe('conversationItemToActionsTarget', () => {
  it('returns null when the initial message snapshot is missing', () => {
    assert.equal(
      conversationItemToActionsTarget(conversationItem({ initial_message_md: null })),
      null,
    );
  });

  it('maps a channel conversation row into a target', () => {
    const target = conversationItemToActionsTarget(
      conversationItem({ pinned: true, ticketId: 'tick-1' }),
      'user-1',
      { channelName: 'general' },
    );
    assert.ok(target);
    assert.equal(target?.channelId, 'chan-1');
    assert.equal(target?.conversationId, 'conv-1');
    assert.equal(target?.isPinned, true);
    assert.equal(target?.channelName, 'general');
    assert.equal(target?.hasTicket, true);
  });

  it('reads reactions from the snapshot markdown', () => {
    const reactionsMd = serializeReactionsMd({ '👍': ['user-1'] });
    const row = conversationItem({
      initial_message_md: serializeInitialMessageMd(summary({ reactions_md: reactionsMd })),
    });
    const target = conversationItemToActionsTarget(row, 'user-1');
    assert.equal(target?.reactionsMd, reactionsMd);
  });

  it('hides a snapshot the current user is not allowed to see', () => {
    const row = conversationItem({
      initial_message_md: serializeInitialMessageMd(summary({ visibleTo: 'user-A' })),
    });
    assert.equal(conversationItemToActionsTarget(row, 'user-B'), null);
  });

  it('detects a ticket from snapshot metadata when ticketId is absent', () => {
    const row = conversationItem({
      ticketId: null,
      initial_message_md: serializeInitialMessageMd(
        summary({ metadata: JSON.stringify({ ticketId: 't-9' }) }),
      ),
    });
    const target = conversationItemToActionsTarget(row, 'user-1');
    assert.equal(target?.hasTicket, true);
  });
});
