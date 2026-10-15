import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MessageType,
  serializeInitialMessageMd,
  serializeParentMessageMd,
  createForwardedMessageXml,
  type InitialMessageSummary,
} from '@xyne/shared';

import type { Conversation } from '../data/normalizeConversationWindow';
import { toConversationInput } from '../data/toConversationInput';

const summary = (over: Partial<InitialMessageSummary> = {}): InitialMessageSummary => ({
  messageId: 'm-1',
  conversationId: 'c-1',
  senderId: 'u-2',
  content: '<p>hello</p>',
  msgType: MessageType.USER,
  hasAttachment: false,
  edited: false,
  isDeleted: false,
  showInChannel: false,
  createdAt: 1_700_000_000_000,
  isSent: true,
  ...over,
});

const row = (over: Record<string, unknown> = {}): Conversation =>
  ({
    conversationId: 'c-1',
    channelId: 'ch-1',
    createdAt: 1_700_000_000_000,
    createdBy: 'u-2',
    ['initial_message_md']: serializeInitialMessageMd(summary()),
    ['ticket_md']: null,
    ['replies_md']: null,
    ['parent_message_md']: null,
    replyCount: 3,
    pinned: false,
    initialMessageAttachments: [],
    ...over,
  }) as unknown as Conversation;

const ctx = {
  channelId: 'ch-1',
  currentUserId: 'me',
  isBookmarked: (id: string): boolean => id === 'm-1',
};

describe('toConversationInput', (): void => {
  it('maps a visible user message onto the row-model input', (): void => {
    const input = toConversationInput(row(), ctx);
    assert.ok(input);
    assert.equal(input.conversationId, 'c-1');
    assert.equal(input.messageId, 'm-1');
    assert.equal(input.senderId, 'u-2');
    assert.equal(input.html, '<p>hello</p>');
    assert.equal(input.messageType, 'USER');
    assert.equal(input.replyCount, 3);
    assert.equal(input.isBookmarked, true);
  });

  it('preserves stored external link-preview metadata for the V3 row model', (): void => {
    const input = toConversationInput(
      row({
        ['initial_message_md']: serializeInitialMessageMd(
          summary({
            ['link_preview_md']: [
              ':::link_preview',
              'url: https://example.com/docs',
              'title: Documentation',
              'siteName: Example',
              ':::',
            ].join('\n'),
          }),
        ),
      }),
      ctx,
    );

    assert.ok(input);
    assert.equal(input.linkUrl, 'https://example.com/docs');
    assert.equal(input.linkTitle, 'Documentation');
    assert.equal(input.linkSiteName, 'Example');
    assert.equal(input.linkNeedsMetadataFetch, false);
  });

  it('returns null when the message is hidden from this user', (): void => {
    assert.equal(
      toConversationInput(
        row({
          ['initial_message_md']: serializeInitialMessageMd(summary({ visibleTo: 'other' })),
        }),
        ctx,
      ),
      null,
    );
  });

  it('returns null when initial_message_md cannot be parsed', (): void => {
    assert.equal(toConversationInput(row({ ['initial_message_md']: null }), ctx), null);
  });

  it('maps a parent preview and suppresses reply count on thread children', (): void => {
    const input = toConversationInput(
      row({
        ['parent_message_md']: serializeParentMessageMd({
          messageId: 'p-1',
          senderId: 'u-9',
          content: 'parent',
          msgType: MessageType.USER,
          createdAt: 1,
          conversationId: 'parent-c',
        }),
        replyCount: 9,
      }),
      ctx,
    );
    assert.ok(input);
    assert.equal(input.parentConversationId, 'parent-c');
    assert.equal(input.replyCount, 0);
  });

  it('does not hide rows while currentUserId is still empty', (): void => {
    const input = toConversationInput(
      row({
        ['initial_message_md']: serializeInitialMessageMd(summary({ visibleTo: 'me' })),
      }),
      { ...ctx, currentUserId: '' },
    );
    assert.ok(input);
  });

  it('falls back to conversation_id and summary.conversationId', (): void => {
    const input = toConversationInput(
      row({ conversationId: undefined, ['conversation_id']: 'from-snake' }),
      ctx,
    );
    assert.ok(input);
    assert.equal(input.conversationId, 'from-snake');
  });

  it('paints thread MessageItems the way v2 toThreadPaintConversation does', (): void => {
    const input = toConversationInput(
      {
        messageId: 'reply-1',
        conversationId: 'thread-1',
        senderId: 'u-2',
        content: '<p>reply</p>',
        createdAt: 1_700_000_000_000,
        attachments: [],
      } as unknown as Conversation,
      { ...ctx, threadId: 'thread-1' },
    );
    assert.ok(input);
    assert.equal(input.conversationId, 'reply-1');
    assert.equal(input.messageId, 'reply-1');
    assert.equal(input.html, '<p>reply</p>');
    assert.equal(input.senderId, 'u-2');
  });

  it('maps a forwarded message onto optional comment + original source', (): void => {
    const xml = createForwardedMessageXml({
      originalMessageId: 'orig-1',
      originalSenderId: 'user-orig',
      originalSenderName: 'Origin User',
      originalCreatedAt: 1_700_000_000_000,
      originalChannelId: 'chan-1',
      originalConversationId: 'conv-1',
      optionalText: 'look here',
      content: '<p>the original body</p>',
    });
    const input = toConversationInput(
      row({
        ['initial_message_md']: serializeInitialMessageMd(
          summary({ msgType: MessageType.FORWARDED, content: xml }),
        ),
      }),
      ctx,
    );
    assert.ok(input);
    assert.equal(input.messageType, 'FORWARDED');
    assert.equal(input.html, 'look here');
    assert.equal(input.storedHtml, xml);
    assert.equal(input.forwardedFromName, 'Origin User');
    assert.equal(input.forwardedSource?.originalHtml, '<p>the original body</p>');
    assert.equal(input.forwardedSource?.originalChannelId, 'chan-1');
    assert.equal(input.forwardedSource?.originalConversationId, 'conv-1');
    assert.equal(input.forwardedSource?.originalMessageId, 'orig-1');
  });

  it('detects flow-json from html even without metadata.isFlowJson', (): void => {
    const html =
      '<div data-flow-json="{&quot;version&quot;:&quot;2.0&quot;,&quot;screenId&quot;:&quot;s1&quot;,&quot;title&quot;:&quot;Flow JSON&quot;,&quot;components&quot;:[{&quot;type&quot;:&quot;plan&quot;,&quot;props&quot;:{&quot;title&quot;:&quot;Acknowledge PR&quot;,&quot;status&quot;:&quot;in_progress&quot;}}]}"></div>';
    const input = toConversationInput(
      row({
        ['initial_message_md']: serializeInitialMessageMd(summary({ content: html })),
      }),
      ctx,
    );
    assert.ok(input);
    assert.equal(input.isFlowJson, true);
    assert.equal(input.html.includes('data-flow-json'), true);
  });

  it('preserves call metadata for dedicated thread navigation', (): void => {
    const input = toConversationInput(
      row({
        ['initial_message_md']: serializeInitialMessageMd(
          summary({
            metadata: JSON.stringify({ isCallMessage: true, callId: 'call-1' }),
          }),
        ),
      }),
      ctx,
    );
    assert.ok(input);
    assert.equal(input.metadata?.['isCallMessage'], true);
    assert.equal(input.metadata?.['callId'], 'call-1');
  });
});
