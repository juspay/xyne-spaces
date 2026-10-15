import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MessageType,
  serializeInitialMessageMd,
  createForwardedMessageXml,
  type InitialMessageSummary,
} from '@xyne/shared';

import {
  buildLastMessagePreview,
  getVisibleInitialMessageSummary,
} from '@/src/utils/message-preview';

const CURRENT_USER = 'user-self';

function makeSummary(overrides: Partial<InitialMessageSummary> = {}): InitialMessageSummary {
  return {
    messageId: 'm1',
    conversationId: 'c1',
    workspaceId: 'w1',
    senderId: CURRENT_USER,
    content: 'Hello world',
    msgType: MessageType.USER,
    hasAttachment: false,
    edited: false,
    isDeleted: false,
    showInChannel: true,
    visibleTo: null,
    createdAt: 1_700_000_000_000,
    metadata: null,
    nudgeCount: null,
    isSent: true,
    reactions_md: null,
    link_preview_md: null,
    childConversationId: null,
    ...overrides,
  };
}

// buildLastMessagePreview only reads `initial_message_md` at runtime; cast the
// minimal fixture to its parameter type to stay typecheck-clean.
type Conversation = NonNullable<Parameters<typeof buildLastMessagePreview>[0]>;

function makeConversation(summary: InitialMessageSummary | null): Conversation {
  const md = summary ? serializeInitialMessageMd(summary) : null;
  return { initial_message_md: md } as unknown as Conversation;
}

// ─── getVisibleInitialMessageSummary ────────────────────────────────────────

test('getVisibleInitialMessageSummary: undefined conversation returns null', () => {
  assert.equal(getVisibleInitialMessageSummary(undefined), null);
});

test('getVisibleInitialMessageSummary: missing initial_message_md returns null', () => {
  assert.equal(getVisibleInitialMessageSummary({ initial_message_md: null }), null);
});

test('getVisibleInitialMessageSummary: returns the parsed summary when unrestricted', () => {
  const conv = makeConversation(makeSummary({ messageId: 'msg-42' }));
  const summary = getVisibleInitialMessageSummary(conv);
  assert.equal(summary?.messageId, 'msg-42');
});

test('getVisibleInitialMessageSummary: honors visibleTo when it matches the viewer', () => {
  const conv = makeConversation(makeSummary({ visibleTo: CURRENT_USER }));
  assert.notEqual(getVisibleInitialMessageSummary(conv, CURRENT_USER), null);
});

test('getVisibleInitialMessageSummary: hides a message scoped to a different viewer', () => {
  const conv = makeConversation(makeSummary({ visibleTo: 'someone-else' }));
  assert.equal(getVisibleInitialMessageSummary(conv, CURRENT_USER), null);
});

test('getVisibleInitialMessageSummary: without a viewer id, visibility scope is not enforced', () => {
  const conv = makeConversation(makeSummary({ visibleTo: 'someone-else' }));
  assert.notEqual(getVisibleInitialMessageSummary(conv), null);
});

// ─── buildLastMessagePreview ────────────────────────────────────────────────

test('buildLastMessagePreview: no conversation shows the empty placeholder', () => {
  assert.deepEqual(buildLastMessagePreview(undefined, CURRENT_USER), {
    variant: 'text',
    text: 'No messages yet',
  });
});

test('buildLastMessagePreview: unparseable conversation shows the empty placeholder', () => {
  assert.deepEqual(buildLastMessagePreview(makeConversation(null), CURRENT_USER), {
    variant: 'text',
    text: 'No messages yet',
  });
});

test('buildLastMessagePreview: a message hidden from the viewer shows the empty placeholder', () => {
  const conv = makeConversation(makeSummary({ visibleTo: 'someone-else' }));
  assert.deepEqual(buildLastMessagePreview(conv, CURRENT_USER), {
    variant: 'text',
    text: 'No messages yet',
  });
});

test('buildLastMessagePreview: deleted message shows the deleted placeholder', () => {
  const conv = makeConversation(makeSummary({ isDeleted: true }));
  assert.deepEqual(buildLastMessagePreview(conv, CURRENT_USER), {
    variant: 'text',
    text: 'Message deleted',
  });
});

test('buildLastMessagePreview: own message is prefixed with "You: "', () => {
  const conv = makeConversation(makeSummary({ senderId: CURRENT_USER, content: 'Hello there' }));
  assert.deepEqual(buildLastMessagePreview(conv, CURRENT_USER), {
    variant: 'text',
    text: 'You: Hello there',
  });
});

test('buildLastMessagePreview: another sender is prefixed with their first name', () => {
  const conv = makeConversation(makeSummary({ senderId: 'user-other', content: 'Hi' }));
  assert.deepEqual(buildLastMessagePreview(conv, CURRENT_USER, 'John Doe'), {
    variant: 'text',
    text: 'John: Hi',
  });
});

test('buildLastMessagePreview: another sender without a name has no prefix', () => {
  const conv = makeConversation(makeSummary({ senderId: 'user-other', content: 'Hi' }));
  assert.deepEqual(buildLastMessagePreview(conv, CURRENT_USER), {
    variant: 'text',
    text: 'Hi',
  });
});

test('buildLastMessagePreview: HTML content is stripped to plain text', () => {
  const conv = makeConversation(
    makeSummary({ senderId: CURRENT_USER, content: '<p>Hi <b>bold</b><br/>next</p>' }),
  );
  assert.deepEqual(buildLastMessagePreview(conv, CURRENT_USER), {
    variant: 'text',
    text: 'You: Hi bold next',
  });
});

test('buildLastMessagePreview: empty content falls back to "Message"', () => {
  const conv = makeConversation(makeSummary({ senderId: CURRENT_USER, content: '   ' }));
  assert.deepEqual(buildLastMessagePreview(conv, CURRENT_USER), {
    variant: 'text',
    text: 'You: Message',
  });
});

test('buildLastMessagePreview: forwarded message previews its optional text', () => {
  const xml = createForwardedMessageXml({
    originalMessageId: 'orig-1',
    originalSenderId: 'user-orig',
    originalSenderName: 'Origin User',
    originalCreatedAt: 1_700_000_000_000,
    originalChannelId: 'chan-1',
    originalConversationId: 'conv-1',
    optionalText: 'look <b>here</b>',
    content: 'the original body',
  });
  const conv = makeConversation(
    makeSummary({ senderId: CURRENT_USER, msgType: MessageType.FORWARDED, content: xml }),
  );
  assert.deepEqual(buildLastMessagePreview(conv, CURRENT_USER), {
    variant: 'text',
    text: 'look here',
  });
});

test('buildLastMessagePreview: forwarded message falls back to the forwarded body when no optional text', () => {
  const xml = createForwardedMessageXml({
    originalMessageId: 'orig-2',
    originalSenderId: 'user-orig',
    originalSenderName: 'Origin User',
    originalCreatedAt: 1_700_000_000_000,
    originalChannelId: 'chan-1',
    originalConversationId: 'conv-1',
    optionalText: null,
    content: 'the original body',
  });
  const conv = makeConversation(
    makeSummary({ senderId: CURRENT_USER, msgType: MessageType.FORWARDED, content: xml }),
  );
  assert.deepEqual(buildLastMessagePreview(conv, CURRENT_USER), {
    variant: 'text',
    text: 'the original body',
  });
});
