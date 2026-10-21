import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyRowPresentation } from '../model/applyRowPresentation';
import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import {
  CALL_ROW_HEIGHT,
  NON_PARTICIPANT_ROW_HEIGHT,
  measureRowHeight,
  estimateCharsPerLine,
} from '../model/measureRowHeight';
import { hasStatusChrome, statusChromeFor } from '../model/statusChrome';
import { isJumboEmojiModel } from '../model/jumboEmoji';
import type { ChatRow } from '../model/chatRow.types';

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'c1',
  channelId: 'ch',
  createdAt: DAY,
  messageId: 'm1',
  senderId: 'u2',
  senderDisplayName: 'Ada',
  senderAvatarUri: null,
  messageType: 'USER',
  html: '',
  markdown: 'hello',
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
  forwardedFromName: null,
  forwardedSource: null,
  isPinned: false,
  isBookmarked: false,
  isEdited: false,
  isFlowJson: false,
  ...over,
});

const ctx = { channelId: 'ch', channelKind: 'channel' as const, currentUserId: 'me' };

const shapes: ConversationInput[] = [
  input({ markdown: 'short' }),
  input({ markdown: Array.from({ length: 24 }, (_, i) => `${i}. line`).join('\n') }),
  input({ markdown: 'xemoji:e1:wave:emojix' }),
  input({ attachments: [{ id: 'a', mimetype: 'image/png', width: 4, height: 3 }] }),
  input({ attachments: [{ id: 'a', mimetype: 'video/mp4' }] }),
  input({ attachments: [{ id: 'a', mimetype: 'application/pdf' }] }),
  input({
    attachments: [
      { id: 'a', mimetype: 'image/png' },
      { id: 'b', mimetype: 'application/zip' },
    ],
  }),
  input({
    messageType: 'SYSTEM',
    metadata: { ticketId: 't' },
    ticketPreview: {
      ticketId: 't',
      title: 'T',
      description: null,
      statusLabel: 'open',
      priority: null,
    },
  }),
  input({ messageType: 'SYSTEM', metadata: { isTicketActivity: true } }),
  input({ isFlowJson: true }),
  input({ forwardedFromName: 'Lin', messageType: 'FORWARDED' }),
  input({ messageType: 'SYSTEM', markdown: 'joined' }),
  input({ reactionsMd: 'wave' }),
  input({ replyCount: 2, latestReplierIds: ['a'] }),
  input({ parentConversationId: 'p', parentMarkdown: 'orig' }),
  input({ isPinned: true, isBookmarked: true, isEdited: true }),
  input({ isDeleted: true }),
  input({ linkUrl: 'https://example.com', linkTitle: 'Ex' }),
];

describe('measureRowHeight', (): void => {
  it('is deterministic: same model in → same height out, ×1000 fuzzed models', (): void => {
    const rows: ChatRow[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const shape = shapes[i % shapes.length];
      if (!shape) continue;
      const built = buildRows(
        [{ ...shape, conversationId: `c-${i}`, messageId: `m-${i}`, createdAt: DAY + i }],
        ctx,
      );
      rows.push(...built);
    }
    for (const row of rows) {
      const a = measureRowHeight(row);
      const b = measureRowHeight(row);
      assert.equal(a, b);
      assert.equal(typeof a, 'number');
      assert.ok(a > 0);
    }
  });

  it('grows when a collapsible row is expanded', (): void => {
    const markdown = Array.from(
      { length: 24 },
      (_, i) => `${i}. line with enough words to wrap on a phone`,
    ).join('\n');
    const row = buildRows([input({ markdown })], ctx).find(item => item.type === 'message');
    assert.ok(row && row.type === 'message');
    assert.equal(row.model.body.collapse.isCollapsible, true);
    const collapsed = measureRowHeight(row);
    const painted = applyRowPresentation([row], {
      expandedIds: new Set(['c1']),
      highlightedConversationId: null,
    });
    const expanded = painted[0];
    assert.ok(expanded && expanded.type === 'message');
    assert.ok(measureRowHeight(expanded) > collapsed);
  });

  it('reserves jumbo height for emoji-only bodies', (): void => {
    const jumbo = buildRows([input({ markdown: 'xemoji:e1:wave:emojix' })], ctx).find(
      item => item.type === 'message',
    );
    const inline = buildRows([input({ markdown: 'hi xemoji:e1:wave:emojix' })], ctx).find(
      item => item.type === 'message',
    );
    assert.ok(jumbo && jumbo.type === 'message');
    assert.ok(inline && inline.type === 'message');
    assert.equal(isJumboEmojiModel(jumbo.model), true);
    assert.equal(isJumboEmojiModel(inline.model), false);
    assert.ok(measureRowHeight(jumbo) >= measureRowHeight(inline));
  });

  it('uses the V2 special-system estimate for call cards', (): void => {
    const call = buildRows(
      [
        input({
          messageType: 'SYSTEM',
          metadata: { isCallMessage: true, callId: 'call-1' },
        }),
      ],
      ctx,
    ).find(item => item.type === 'message');
    assert.ok(call && call.type === 'message');
    assert.equal(measureRowHeight(call), CALL_ROW_HEIGHT);
  });

  it('reserves the V2 special-system estimate for non-participant cards', (): void => {
    const row = buildRows(
      [
        input({
          messageType: 'SYSTEM',
          metadata: {
            messageSubtype: 'user_not_in_channel',
            mentionedUsers: [{ userId: 'u1' }],
          },
        }),
      ],
      ctx,
    ).find(item => item.type === 'message');
    assert.ok(row && row.type === 'message');
    assert.equal(measureRowHeight(row), NON_PARTICIPANT_ROW_HEIGHT);
  });

  it('keeps deleted messages on normal geometry with timestamp-only metadata', (): void => {
    const plain = buildRows([input({ markdown: 'hello' })], ctx).find(
      item => item.type === 'message',
    );
    const deleted = buildRows([input({ isDeleted: true, markdown: 'gone' })], ctx).find(
      item => item.type === 'message',
    );
    assert.ok(plain && plain.type === 'message');
    assert.ok(deleted && deleted.type === 'message');
    assert.equal(hasStatusChrome(deleted.model), false);
    assert.equal(measureRowHeight(deleted), measureRowHeight(plain));
  });

  it('estimateCharsPerLine floors at 16 and ignores non-finite widths', (): void => {
    assert.equal(estimateCharsPerLine(300), 34);
    assert.equal(estimateCharsPerLine(0), 34);
  });
});

describe('statusChromeFor', (): void => {
  it('maps V2 footer states to renderable chrome', (): void => {
    const row = buildRows([input({ isEdited: true, isPinned: true })], ctx).find(
      item => item.type === 'message',
    );
    assert.ok(row && row.type === 'message');
    assert.deepEqual(statusChromeFor(row.model), {
      showEdited: true,
      showBookmark: false,
      reminderLabel: null,
      showPinned: true,
    });
    assert.equal(hasStatusChrome(row.model), true);
  });

  it('does not paint footer status on deleted rows', (): void => {
    const row = buildRows(
      [input({ isDeleted: true, isEdited: true, isPinned: true, isBookmarked: true })],
      ctx,
    ).find(item => item.type === 'message');
    assert.ok(row && row.type === 'message');
    assert.deepEqual(statusChromeFor(row.model), {
      showEdited: false,
      showBookmark: false,
      reminderLabel: null,
      showPinned: false,
    });
    assert.equal(hasStatusChrome(row.model), false);
  });

  it('ticket creation shows time only — no ticket-created caption', (): void => {
    const row = buildRows(
      [
        input({
          messageType: 'SYSTEM',
          metadata: { ticketId: 't' },
          ticketPreview: {
            ticketId: 't',
            title: 'Release',
            description: null,
            statusLabel: 'Created',
            priority: null,
          },
        }),
      ],
      ctx,
    ).find(item => item.type === 'message');
    assert.ok(row && row.type === 'message');
    assert.equal(row.model.isTicketCreation, true);
    assert.equal(hasStatusChrome(row.model), false);
  });
});
