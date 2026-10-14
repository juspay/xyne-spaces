import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildForwarded } from '../model/buildPreviews';
import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import { measureRowHeight } from '../model/measureRowHeight';

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'c1',
  channelId: 'ch',
  createdAt: DAY,
  messageId: 'm1',
  senderId: 'u2',
  senderDisplayName: 'Ada',
  senderAvatarUri: null,
  messageType: 'FORWARDED',
  html: 'look here',
  markdown: 'look here',
  isDeleted: false,
  showInChannel: false,
  isVisibleToCurrentUser: true,
  metadata: null,
  attachments: [],
  ticketPreview: null,
  parentConversationId: null,
  parentMessageId: null,
  parentMarkdown: null,
  replyCount: 0,
  latestReplierIds: [],
  reactionsMd: null,
  linkUrl: null,
  linkTitle: null,
  linkDescription: null,
  forwardedFromName: 'Lin',
  forwardedSource: {
    originalSenderId: 'user-orig',
    originalCreatedAt: DAY,
    originalChannelId: 'chan-1',
    originalConversationId: 'conv-1',
    originalMessageId: 'orig-1',
    originalHtml: '<p>the original body</p>',
  },
  isPinned: false,
  isBookmarked: false,
  isEdited: false,
  isFlowJson: false,
  ...over,
});

const ctx = { channelId: 'ch', channelKind: 'channel' as const, currentUserId: 'me' };
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('v3 forwarded / thread chrome (v2 parity)', (): void => {
  it('builds a quote preview from forwardedSource, not the wrapper XML', (): void => {
    const preview = buildForwarded(input());
    assert.ok(preview);
    assert.equal(preview.fromName, 'Lin');
    assert.equal(preview.originalHtml, '<p>the original body</p>');
    assert.equal(preview.originalMarkdown, 'the original body');
    assert.equal(preview.originalChannelId, 'chan-1');
    assert.ok(preview.reservedHeightPx >= 96);
  });

  it('reserves forwarded quote height on the message row', (): void => {
    const rows = buildRows([input()], ctx);
    const message = rows.find(row => row.type === 'message');
    assert.ok(message && message.type === 'message');
    assert.equal(message.model.forwarded?.fromName, 'Lin');
    assert.ok((message.model.forwarded?.reservedHeightPx ?? 0) > 0);
    const height = measureRowHeight(message);
    assert.ok(Number.isFinite(height) && height > 72);
  });

  it('paints the v2 forwarded quote card instead of a one-line banner', (): void => {
    const banner = read('../rows/parts/ForwardedBanner.tsx');
    assert.equal(/Posted in/.test(banner), true);
    assert.equal(/borderLeftWidth/.test(banner), true);
    assert.equal(/forwardedBgUser/.test(banner), true);
    assert.equal(/useForwardedMessageNavigation/.test(banner), true);
    assert.equal(/ForwardedMessageBody/.test(banner), true);
    assert.equal(/Forwarded from /.test(banner), false);
    assert.match(banner, /min-w-0 shrink/);
    assert.match(banner, /flexShrink: 0/);
    assert.match(banner, /ellipsizeMode='tail'/);
    assert.match(banner, /tokens\.rootMetaUser/);
  });

  it('keeps Flow and rich forwarded content on the V3 renderer path', (): void => {
    const body = read('../rows/parts/ForwardedMessageBody.tsx');
    assert.equal(/parseFlowJsonParts/.test(body), true);
    assert.equal(/FlowJsonRenderer/.test(body), true);
    assert.equal(/variant='quoted'/.test(body), true);
    assert.equal(/parseCustomEmojiMarkdownSegments/.test(body), true);
    assert.equal(/InlineRichText/.test(body), true);
    assert.equal(/features\/chat\/v2/.test(body), false);
  });

  it('paints the v2 replied-to-thread preview and jump-to-latest control', (): void => {
    const parent = read('../rows/parts/ParentPreviewCard.tsx');
    const list = read('../list/ConversationList.tsx');
    const dock = read('../list/ConversationListChrome.tsx');
    assert.equal(/Replied to thread:/.test(parent), true);
    assert.equal(/channel_thread/.test(parent), true);
    assert.equal(/ScrollToBottomButton/.test(list + dock), true);
    assert.equal(/showJumpToLatest/.test(list), true);
  });
});
