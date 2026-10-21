import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MessageType,
  createForwardedMessageXml,
  serializeInitialMessageMd,
  serializeParentMessageMd,
  serializeReactionsMd,
  type InitialMessageSummary,
  type ParentMessageSummary,
} from '@xyne/shared';

import {
  getInitialMessageFromConversation,
  getParentMessageFromConversation,
  getParentMessagePreviewText,
  initialMessageSummaryToMessage,
  reactionsMdToRawReactions,
} from '@/src/utils/conversationMessageHelpers';

const baseSummary = (overrides: Partial<InitialMessageSummary> = {}): InitialMessageSummary => ({
  messageId: 'msg-1',
  conversationId: 'conv-1',
  senderId: 'user-1',
  content: 'hello world',
  msgType: MessageType.USER,
  hasAttachment: false,
  edited: false,
  isDeleted: false,
  showInChannel: true,
  createdAt: 1700000000000,
  isSent: true,
  ...overrides,
});

const parent = (overrides: Partial<ParentMessageSummary> = {}): ParentMessageSummary => ({
  messageId: 'p-1',
  senderId: 'user-2',
  content: 'parent content',
  msgType: MessageType.USER,
  createdAt: 1700000000000,
  ...overrides,
});

describe('reactionsMdToRawReactions', () => {
  it('returns [] for null or missing reactions', () => {
    assert.deepEqual(reactionsMdToRawReactions(null, 'msg-1'), []);
    assert.deepEqual(reactionsMdToRawReactions(undefined, 'msg-1'), []);
  });

  it('flattens each (emoji, user) pair into a deterministic RawReaction', () => {
    const md = serializeReactionsMd({ '👍': ['u1', 'u2'], '🔥': ['u3'] });
    const out = reactionsMdToRawReactions(md, 'msg-9');
    assert.equal(out.length, 3);
    assert.deepEqual(out[0], {
      reactionId: 'msg-9:👍:u1',
      messageId: 'msg-9',
      userId: 'u1',
      emojiName: '👍',
      createdAt: 0,
    });
    assert.deepEqual(
      out.map(r => r.reactionId),
      ['msg-9:👍:u1', 'msg-9:👍:u2', 'msg-9:🔥:u3'],
    );
  });
});

describe('initialMessageSummaryToMessage', () => {
  it('parses JSON metadata and preserves core fields', () => {
    const result = initialMessageSummaryToMessage(
      baseSummary({ metadata: JSON.stringify({ ticketId: 't1' }) }),
    );
    assert.deepEqual(result.metadata, { ticketId: 't1' });
    assert.equal(result.messageId, 'msg-1');
    assert.equal(result.content, 'hello world');
  });

  it('coalesces optional fields to null when absent', () => {
    const result = initialMessageSummaryToMessage(baseSummary());
    assert.equal(result.metadata, null);
    assert.equal(result.visibleTo, null);
    assert.equal(result.nudgeCount, null);
    assert.equal(result.childConversationId, null);
    assert.equal(result.reactions_md, null);
    assert.equal(result.link_preview_md, null);
  });
});

describe('getInitialMessageFromConversation', () => {
  it('returns null when there is no snapshot markdown', () => {
    assert.equal(getInitialMessageFromConversation({ initial_message_md: null }), null);
    assert.equal(getInitialMessageFromConversation({}), null);
  });

  it('round-trips a serialized snapshot into a UI message', () => {
    const md = serializeInitialMessageMd(baseSummary());
    const result = getInitialMessageFromConversation({ initial_message_md: md });
    assert.ok(result);
    assert.equal(result?.messageId, 'msg-1');
    assert.equal(result?.senderId, 'user-1');
  });

  it('hides a snapshot whose visibleTo does not match the current user', () => {
    const md = serializeInitialMessageMd(baseSummary({ visibleTo: 'user-A' }));
    assert.equal(getInitialMessageFromConversation({ initial_message_md: md }, 'user-B'), null);
  });

  it('shows a private snapshot to its intended recipient', () => {
    const md = serializeInitialMessageMd(baseSummary({ visibleTo: 'user-A' }));
    const result = getInitialMessageFromConversation({ initial_message_md: md }, 'user-A');
    assert.ok(result);
    assert.equal(result?.visibleTo, 'user-A');
  });
});

describe('getParentMessageFromConversation', () => {
  it('returns null when there is no parent snapshot', () => {
    assert.equal(getParentMessageFromConversation({ parent_message_md: null }), null);
  });

  it('parses a serialized parent snapshot', () => {
    const md = serializeParentMessageMd(parent({ content: 'the parent' }));
    const result = getParentMessageFromConversation({ parent_message_md: md });
    assert.equal(result?.messageId, 'p-1');
    assert.equal(result?.content, 'the parent');
  });
});

describe('getParentMessagePreviewText', () => {
  it('returns "Message" for a null parent', () => {
    assert.equal(getParentMessagePreviewText(null), 'Message');
  });

  it('returns "Message" for empty content', () => {
    assert.equal(getParentMessagePreviewText(parent({ content: '   ' })), 'Message');
  });

  it('passes plain text through', () => {
    assert.equal(getParentMessagePreviewText(parent({ content: 'just text' })), 'just text');
  });

  it('strips HTML and collapses whitespace', () => {
    assert.equal(
      getParentMessagePreviewText(parent({ content: '<b>Hi</b><br/>there&nbsp;now' })),
      'Hi there now',
    );
  });

  it('replaces a bare conversation UUID with "Message"', () => {
    assert.equal(
      getParentMessagePreviewText(parent({ content: '123e4567-e89b-12d3-a456-426614174000' })),
      'Message',
    );
  });

  it('prefers the forwarded optional text for a forwarded parent', () => {
    const xml = createForwardedMessageXml({
      originalMessageId: 'orig-1',
      originalSenderId: 'sender-1',
      originalSenderName: 'Sender One',
      originalCreatedAt: 1700000000000,
      originalChannelId: 'chan-1',
      originalConversationId: 'conv-orig',
      optionalText: 'look at this',
      content: 'the forwarded body',
    });
    assert.equal(
      getParentMessagePreviewText(parent({ content: xml, msgType: MessageType.FORWARDED })),
      'look at this',
    );
  });

  it('falls back to the forwarded body when there is no optional text', () => {
    const xml = createForwardedMessageXml({
      originalMessageId: 'orig-2',
      originalSenderId: 'sender-2',
      originalSenderName: 'Sender Two',
      originalCreatedAt: 1700000000000,
      originalChannelId: null,
      originalConversationId: 'conv-orig-2',
      optionalText: null,
      content: 'body only',
    });
    assert.equal(
      getParentMessagePreviewText(parent({ content: xml, msgType: MessageType.FORWARDED })),
      'body only',
    );
  });
});
