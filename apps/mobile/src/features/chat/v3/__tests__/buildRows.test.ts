import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FORBIDDEN_ALIAS_FIELDS, type ChatRow } from '../model/chatRow.types';
import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import {
  FILE_ATTACHMENT_HEIGHT_PX,
  FILE_ATTACHMENT_LIST_GAP_PX,
  MEDIA_FILE_SECTION_GAP_PX,
  MEDIA_GRID_HEIGHT_PX,
} from '../model/buildMedia';
import { FILE_ATTACHMENT_CARD_HEIGHT } from '@/src/components/conversation-composer/attachment-layout';
import { keyExtractor, getRowType } from '../model/rowType';

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const base = (over: Partial<ConversationInput> = {}): ConversationInput => ({
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

const message = (rows: ChatRow[]) => {
  const row = rows.find(item => item.type === 'message');
  assert.ok(row && row.type === 'message');
  return row.model;
};

const snap = (over: Partial<ConversationInput>) => {
  const model = message(buildRows([base(over)], ctx));
  return {
    rowType: model.rowType,
    rowKind: model.rowKind,
    messageType: model.messageType,
    isDeleted: model.isDeleted,
    isCall: model.isCall,
    isTicketCreation: model.isTicketCreation,
    isShowInChannel: model.isShowInChannel,
    isTicketActivity: model.isTicketActivity,
    isPinned: model.isPinned,
    isBookmarked: model.isBookmarked,
    isEdited: model.isEdited,
    isFlowJson: model.isFlowJson,
    body: model.body.plainText || model.body.markdown,
    collapse: model.body.collapse.isCollapsible,
    mediaKind: model.mediaPreview?.kind ?? null,
    reservedHeightPx: model.mediaPreview?.reservedHeightPx ?? null,
    hasTicket: !!model.ticketPreview,
    hasLink: !!model.linkPreview,
    hasParent: !!model.parentPreview,
    forwarded: model.forwarded?.fromName ?? null,
    reactions: model.reactionPreview?.totalCount ?? 0,
    replies: model.replyPreview?.count ?? 0,
  };
};

describe('buildRows snapshots', (): void => {
  it('plain text', (): void => {
    assert.deepEqual(snap({ markdown: 'hello **world**' }).body.includes('hello'), true);
  });

  it('uses v2 sender fallbacks while identity data is unavailable', (): void => {
    const unknown = message(buildRows([base({ senderId: 'missing', senderDisplayName: '' })], ctx));
    const own = message(buildRows([base({ senderId: 'me', senderDisplayName: ' ' })], ctx));
    const system = message(
      buildRows(
        [base({ senderId: '', senderDisplayName: '', messageType: 'SYSTEM', markdown: 'joined' })],
        ctx,
      ),
    );

    assert.equal(unknown.sender.displayName, 'Unknown User');
    assert.equal(own.sender.displayName, 'You');
    assert.equal(system.sender.displayName, 'System');
  });

  it('builds an extracted link preview with stable geometry inputs', (): void => {
    const model = message(buildRows([base({ markdown: 'Read https://example.com/docs.' })], ctx));

    assert.equal(model.linkPreview?.url, 'https://example.com/docs');
    assert.equal(model.linkPreview?.title, 'example.com');
    assert.equal(model.linkPreview?.needsMetadataFetch, true);
    assert.equal(model.linkPreview?.reservedHeightPx, 86);
  });

  it('long-collapsed', (): void => {
    const markdown = Array.from(
      { length: 20 },
      (_, i) => `${i + 1}. item with enough words to wrap on a phone`,
    ).join('\n');
    assert.equal(snap({ markdown }).collapse, true);
  });

  it('emoji-only', (): void => {
    const model = message(buildRows([base({ markdown: 'xemoji:e1:wave:emojix' })], ctx));
    assert.ok(model.emojiSlots.length >= 1);
  });

  it('media image', (): void => {
    const s = snap({
      attachments: [{ id: 'a1', mimetype: 'image/png', width: 800, height: 600 }],
    });
    assert.equal(s.rowType, 'media');
    assert.equal(s.mediaKind, 'image');
    assert.ok((s.reservedHeightPx ?? 0) > 0);
  });

  it('infers image media from a generic MIME and the filename extension', (): void => {
    const model = message(
      buildRows(
        [
          base({
            attachments: [
              { id: 'a1', mimetype: 'application/octet-stream', originalFilename: 'photo.jpg' },
            ],
          }),
        ],
        ctx,
      ),
    );
    assert.equal(model.mediaPreview?.kind, 'image');
    assert.equal(model.mediaPreview?.previewAttachmentKind, 'image');
  });

  it('media video', (): void => {
    assert.equal(
      snap({ attachments: [{ id: 'a1', mimetype: 'video/mp4', durationSeconds: 12 }] }).mediaKind,
      'video',
    );
  });

  it('media file', (): void => {
    const model = message(
      buildRows(
        [
          base({
            attachments: [{ id: 'a1', mimetype: 'application/pdf', originalFilename: 'doc.pdf' }],
          }),
        ],
        ctx,
      ),
    );
    assert.equal(model.mediaPreview?.kind, 'file');
    assert.equal(model.mediaPreview?.reservedHeightPx, FILE_ATTACHMENT_HEIGHT_PX);
  });

  it('reserves file-list gaps without clipping file-only or mixed attachments', (): void => {
    const twoFiles = message(
      buildRows(
        [
          base({
            attachments: [
              { id: 'a1', mimetype: 'application/pdf', originalFilename: 'one.pdf' },
              { id: 'a2', mimetype: 'text/plain', originalFilename: 'two.txt' },
            ],
          }),
        ],
        ctx,
      ),
    );
    const mixed = message(
      buildRows(
        [
          base({
            attachments: [
              { id: 'a1', mimetype: 'image/png' },
              { id: 'a2', mimetype: 'application/pdf', originalFilename: 'one.pdf' },
            ],
          }),
        ],
        ctx,
      ),
    );
    assert.equal(
      twoFiles.mediaPreview?.reservedHeightPx,
      FILE_ATTACHMENT_HEIGHT_PX + FILE_ATTACHMENT_CARD_HEIGHT + FILE_ATTACHMENT_LIST_GAP_PX,
    );
    assert.equal(
      mixed.mediaPreview?.reservedHeightPx,
      MEDIA_GRID_HEIGHT_PX + MEDIA_FILE_SECTION_GAP_PX + FILE_ATTACHMENT_CARD_HEIGHT,
    );
  });

  it('media mixed', (): void => {
    const rows = buildRows(
      [
        base({
          attachments: [
            { id: 'a1', mimetype: 'image/png' },
            { id: 'a2', mimetype: 'application/pdf' },
          ],
        }),
      ],
      ctx,
    );
    const model = message(rows);
    assert.equal(model.mediaPreview?.kind, 'mixed');
    assert.deepEqual(
      model.mediaPreview?.items.map(item => item.id),
      ['a1', 'a2'],
    );
  });

  it('ticket', (): void => {
    const s = snap({
      messageType: 'SYSTEM',
      metadata: { ticketId: 'tk' },
      ticketPreview: {
        ticketId: 'tk',
        title: 'Bug',
        description: null,
        statusLabel: 'open',
        priority: 'P1',
      },
    });
    assert.equal(s.rowType, 'ticket');
    assert.equal(s.hasTicket, true);
  });

  it('ticket-activity', (): void => {
    const s = snap({
      messageType: 'SYSTEM',
      metadata: { isTicketActivity: true },
      markdown: 'status changed',
    });
    assert.equal(s.isTicketActivity, true);
    assert.equal(s.rowKind, 'SYSTEM');
  });

  it('flow-json', (): void => {
    const html =
      '<div data-flow-json="{&quot;version&quot;:&quot;2.0&quot;,&quot;screenId&quot;:&quot;s1&quot;,&quot;title&quot;:&quot;Approve?&quot;,&quot;components&quot;:[{&quot;type&quot;:&quot;text&quot;,&quot;props&quot;:{&quot;text&quot;:&quot;Please approve&quot;}},{&quot;type&quot;:&quot;button&quot;,&quot;props&quot;:{&quot;label&quot;:&quot;Approve&quot;,&quot;action&quot;:{&quot;type&quot;:&quot;submit&quot;,&quot;actionId&quot;:&quot;approve&quot;}}}]}"></div>';
    const model = message(buildRows([base({ isFlowJson: true, html, markdown: '' })], ctx));
    assert.equal(model.isFlowJson, true);
    assert.equal(model.body.flowParts.length, 1);
    assert.equal(model.body.flowParts[0]?.type, 'flow');
    assert.equal(model.body.markdown.includes('Approve?'), true);
    assert.equal(model.body.markdown.includes('Please approve'), true);
    assert.equal(model.body.markdown.includes('actionId'), false);
  });

  it('forwarded', (): void => {
    assert.equal(snap({ forwardedFromName: 'Lin', messageType: 'FORWARDED' }).forwarded, 'Lin');
  });

  it('system', (): void => {
    const s = snap({ messageType: 'SYSTEM', markdown: 'Ada joined' });
    assert.equal(s.rowType, 'system');
    assert.equal(s.rowKind, 'SYSTEM');
  });

  it('builds non-participant actions as a system preview', (): void => {
    const model = message(
      buildRows(
        [
          base({
            messageType: 'SYSTEM',
            metadata: {
              messageSubtype: 'user_not_in_channel',
              mentionedUsers: [{ userId: 'u1' }],
            },
          }),
        ],
        ctx,
      ),
    );
    assert.deepEqual(model.nonParticipantPreview, {
      channelId: 'ch',
      userIds: ['u1'],
      canAddMembers: true,
    });
  });

  it('keeps custom emoji reaction keys for image rendering', (): void => {
    const model = message(buildRows([base({ reactionsMd: 'custom:e1:wave' })], ctx));
    assert.equal(model.reactionPreview?.groups[0]?.emojiName, 'custom:e1:wave');
    assert.equal(model.reactionPreview?.totalCount, 1);
  });

  it('with reactions', (): void => {
    assert.equal(snap({ reactionsMd: 'wave,heart' }).reactions, 2);
  });

  it('does not paint reaction previews for deleted messages', (): void => {
    assert.equal(snap({ isDeleted: true, reactionsMd: 'wave,heart' }).reactions, 0);
  });

  it('with replies', (): void => {
    assert.equal(snap({ replyCount: 3, latestReplierIds: ['u1'] }).replies, 3);
  });

  it('parent preview normalizes stored html before render', (): void => {
    const model = message(
      buildRows(
        [
          base({
            parentConversationId: 'p1',
            parentMessageId: 'm0',
            parentMarkdown:
              '<p>Hello <strong>Vinit</strong> <img data-emoji-id="e1" alt=":wave:"></p>',
          }),
        ],
        ctx,
      ),
    );
    assert.equal(model.parentPreview?.text.includes('<strong>'), false);
    assert.equal(model.parentPreview?.text.includes('Hello Vinit'), true);
    assert.deepEqual(model.parentPreview?.customEmojiIds, ['e1']);
  });

  it('parent preview', (): void => {
    assert.equal(
      snap({ parentConversationId: 'p1', parentMessageId: 'm0', parentMarkdown: 'original' })
        .hasParent,
      true,
    );
  });

  it('pinned bookmarked edited', (): void => {
    const s = snap({ isPinned: true, isBookmarked: true, isEdited: true });
    assert.equal(s.isPinned && s.isBookmarked && s.isEdited, true);
  });

  it('deleted tombstone', (): void => {
    assert.equal(snap({ isDeleted: true, markdown: 'gone' }).isDeleted, true);
  });

  it('call message', (): void => {
    const model = message(
      buildRows(
        [
          base({
            messageType: 'SYSTEM',
            metadata: {
              isCallMessage: true,
              callId: 'call-1',
              callTitle: 'Design review',
              operation: 'call_ended',
              durationMs: 90_000,
            },
          }),
        ],
        ctx,
      ),
    );
    assert.equal(model.isCall, true);
    assert.deepEqual(model.callPreview, {
      callId: 'call-1',
      title: 'Design review',
      operation: 'call_ended',
      durationMs: 90_000,
    });
  });

  it('ticket-creation', (): void => {
    const s = snap({
      messageType: 'SYSTEM',
      metadata: { ticketId: 'tk' },
      ticketPreview: {
        ticketId: 'tk',
        title: 'New',
        description: null,
        statusLabel: 'open',
        priority: null,
      },
    });
    assert.equal(s.isTicketCreation, true);
  });

  it('showInChannel reply', (): void => {
    assert.equal(snap({ showInChannel: true }).isShowInChannel, true);
  });
});

describe('row identity', (): void => {
  it('keyExtractor returns the server conversation id for every message row', (): void => {
    const rows = buildRows(
      [
        base({ conversationId: 'conv-99' }),
        base({ conversationId: 'conv-100', createdAt: DAY + 1 }),
      ],
      ctx,
    );
    for (const row of rows) {
      if (row.type === 'message') {
        assert.equal(keyExtractor(row), row.model.conversationId);
      }
    }
  });

  it('getRowType distinguishes chrome from message shapes', (): void => {
    const rows = buildRows([base()], ctx);
    assert.ok(rows.some(row => getRowType(row) === 'date'));
    assert.ok(rows.some(row => getRowType(row) === 'message'));
  });

  it('does not reuse a call row when its metadata changes', (): void => {
    const first = buildRows(
      [
        base({
          messageType: 'SYSTEM',
          metadata: { isCallMessage: true, callId: 'call-1', callTitle: 'First' },
        }),
      ],
      ctx,
    );
    const second = buildRows(
      [
        base({
          messageType: 'SYSTEM',
          metadata: { isCallMessage: true, callId: 'call-1', callTitle: 'Updated' },
        }),
      ],
      { ...ctx, previousRows: first },
    );
    const firstMessage = first.find(row => row.type === 'message');
    const secondMessage = second.find(row => row.type === 'message');
    assert.ok(firstMessage && secondMessage);
    assert.notEqual(firstMessage, secondMessage);
  });

  it('does not reuse a forwarded row when the original body changes', (): void => {
    const source = {
      originalSenderId: 'u-3',
      originalCreatedAt: DAY,
      originalChannelId: 'ch-2',
      originalConversationId: 'conv-2',
      originalMessageId: 'm-2',
      originalHtml: '<p>before</p>',
    };
    const first = buildRows(
      [base({ messageType: 'FORWARDED', forwardedFromName: 'Lin', forwardedSource: source })],
      ctx,
    );
    const second = buildRows(
      [
        base({
          messageType: 'FORWARDED',
          forwardedFromName: 'Lin',
          forwardedSource: { ...source, originalHtml: '<p>after</p>' },
        }),
      ],
      { ...ctx, previousRows: first },
    );

    const firstMessage = first.find(row => row.type === 'message');
    const secondMessage = second.find(row => row.type === 'message');
    assert.ok(firstMessage && secondMessage);
    assert.notEqual(firstMessage, secondMessage);
    assert.equal(secondMessage.model.forwarded?.originalMarkdown, 'after');
  });

  it('no row model contains a v2 alias field', (): void => {
    const rows = buildRows([base({ attachments: [{ id: 'a', mimetype: 'image/png' }] })], ctx);
    for (const row of rows) {
      if (row.type !== 'message') continue;
      for (const alias of FORBIDDEN_ALIAS_FIELDS) {
        assert.equal(Object.hasOwn(row.model, alias), false, alias);
      }
    }
  });
});
