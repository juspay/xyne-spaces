import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createForwardedMessageXml, MessageType } from '@xyne/shared';

import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import type { MessageActionsTarget } from '../overlays/MessageActionsHost';
import { actionsTargetFor } from '../overlays/actionTarget';
import { forwardSheetTargetFor } from '../overlays/forwardTarget';

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'c1',
  channelId: 'ch',
  createdAt: Date.UTC(2026, 7, 22, 12, 0, 0),
  messageId: 'm1',
  senderId: 'u2',
  senderDisplayName: 'Ada',
  senderAvatarUri: null,
  messageType: 'USER',
  html: '<p>hello</p>',
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

const targetFor = (over: Partial<ConversationInput> = {}): MessageActionsTarget => {
  const rows = buildRows([input(over)], {
    channelId: 'ch',
    channelKind: 'channel',
    currentUserId: 'me',
  });
  const row = rows.find(item => item.type === 'message');
  assert.ok(row);
  return {
    row,
    html: over.html ?? '<p>hello</p>',
    attachments: over.attachments ?? [],
    reactionsMd: over.reactionsMd ?? null,
  };
};

describe('forwardSheetTargetFor', (): void => {
  it('maps a v3 actions target onto the shared forward sheet', (): void => {
    const mapped = forwardSheetTargetFor(targetFor(), 'me');
    assert.ok(mapped);
    assert.equal(mapped.conversationId, 'c1');
    assert.equal(mapped.currentUserId, 'me');
    assert.equal(mapped.channelId, 'ch');
    const initialMessage = mapped.initialMessage;
    assert.ok(initialMessage);
    assert.equal(initialMessage.messageId, 'm1');
    assert.equal(initialMessage.content, '<p>hello</p>');
    assert.equal(initialMessage.msgType, MessageType.USER);
    assert.equal(initialMessage.hasAttachment, false);
  });

  it('returns null without a message id and defaults an absent current user', (): void => {
    assert.equal(forwardSheetTargetFor(targetFor({ messageId: null }), 'me'), null);
    const mapped = forwardSheetTargetFor(targetFor(), undefined);
    assert.ok(mapped);
    assert.equal(mapped.currentUserId, '');
  });

  it('maps BOT / SYSTEM / FORWARDED onto MessageType', (): void => {
    const cases = [
      ['BOT', MessageType.BOT],
      ['SYSTEM', MessageType.SYSTEM],
      ['FORWARDED', MessageType.FORWARDED],
    ] as const;
    for (const [name, expected] of cases) {
      const mapped = forwardSheetTargetFor(targetFor({ messageType: name }), 'me');
      assert.ok(mapped);
      const initialMessage = mapped.initialMessage;
      assert.ok(initialMessage);
      assert.equal(initialMessage.msgType, expected);
    }
  });

  it('copies attachments and edited/deleted/show-in-channel flags', (): void => {
    const mapped = forwardSheetTargetFor(
      targetFor({
        isEdited: true,
        isDeleted: true,
        showInChannel: true,
        attachments: [{ id: 'a1', mimetype: 'image/png', originalFilename: 'x.png', size: 12 }],
      }),
      'me',
    );
    assert.ok(mapped);
    const initialMessage = mapped.initialMessage;
    assert.ok(initialMessage);
    assert.equal(initialMessage.edited, true);
    assert.equal(initialMessage.isDeleted, true);
    assert.equal(initialMessage.showInChannel, true);
    assert.equal(initialMessage.hasAttachment, true);
    const attachment = initialMessage.attachments?.[0];
    assert.ok(attachment);
    assert.equal(attachment.id, 'a1');
    assert.equal(attachment.mimetype, 'image/png');
    assert.equal(attachment.originalFilename, 'x.png');
    assert.equal(attachment.size, 12);
  });

  it('preserves attachment size and video duration from the v3 action target', (): void => {
    const rows = buildRows(
      [
        input({
          attachments: [
            {
              id: 'a1',
              mimetype: 'video/mp4',
              originalFilename: 'clip.mp4',
              size: 2048,
              durationSeconds: 12,
            },
          ],
        }),
      ],
      {
        channelId: 'ch',
        channelKind: 'channel',
        currentUserId: 'me',
      },
    );
    const row = rows.find(item => item.type === 'message');
    assert.ok(row);

    const target = actionsTargetFor(row);
    assert.equal(target.attachments[0]?.size, 2048);
    assert.equal(target.attachments[0]?.durationSeconds, 12);

    const mapped = forwardSheetTargetFor(target, 'me');
    assert.ok(mapped);
    const initialMessage = mapped.initialMessage;
    assert.ok(initialMessage);
    const attachment = initialMessage.attachments?.[0];
    assert.ok(attachment);
    assert.equal(attachment.size, 2048);
    assert.deepEqual(attachment.metadata, { duration: 12 });
  });

  it('keeps the persisted forwarded wrapper for the action target', (): void => {
    const wrapper = createForwardedMessageXml({
      originalMessageId: 'original-1',
      originalSenderId: 'original-user',
      originalSenderName: 'Original User',
      originalCreatedAt: Date.UTC(2026, 7, 22, 11, 0, 0),
      originalChannelId: 'original-channel',
      originalConversationId: 'original-conversation',
      optionalText: 'See this',
      content: '<p>Original body</p>',
    });
    const rows = buildRows(
      [
        input({
          messageType: 'FORWARDED',
          html: 'See this',
          storedHtml: wrapper,
          forwardedFromName: 'Original User',
          forwardedSource: {
            originalSenderId: 'original-user',
            originalCreatedAt: Date.UTC(2026, 7, 22, 11, 0, 0),
            originalChannelId: 'original-channel',
            originalConversationId: 'original-conversation',
            originalMessageId: 'original-1',
            originalHtml: '<p>Original body</p>',
          },
        }),
      ],
      { channelId: 'ch', channelKind: 'channel', currentUserId: 'me' },
    );
    const row = rows.find(item => item.type === 'message');
    assert.ok(row);

    const target = actionsTargetFor(row);
    assert.equal(target.html, wrapper);
    const mapped = forwardSheetTargetFor(target, 'me');
    assert.ok(mapped);
    const initialMessage = mapped.initialMessage;
    assert.ok(initialMessage);
    assert.equal(initialMessage.content, wrapper);
  });
});
