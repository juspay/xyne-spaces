import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import { isJumboEmojiModel } from '../model/jumboEmoji';
import type { MessageRowModel } from '../model/chatRow.types';

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

const modelOf = (over: Partial<ConversationInput>): MessageRowModel => {
  const row = buildRows([input(over)], ctx).find(item => item.type === 'message');
  if (!row || row.type !== 'message') {
    throw new Error('expected a message row');
  }
  return row.model;
};

describe('isJumboEmojiModel', (): void => {
  it('jumbos one custom emoji', (): void => {
    assert.equal(isJumboEmojiModel(modelOf({ markdown: 'xemoji:e1:wave:emojix' })), true);
  });

  it('jumbos three custom emoji and not four', (): void => {
    const three = 'xemoji:e1:a:emojix xemoji:e2:b:emojix xemoji:e3:c:emojix';
    const four = `${three} xemoji:e4:d:emojix`;
    assert.equal(isJumboEmojiModel(modelOf({ markdown: three })), true);
    assert.equal(isJumboEmojiModel(modelOf({ markdown: four })), false);
  });

  it('does not jumbo emoji beside text', (): void => {
    assert.equal(isJumboEmojiModel(modelOf({ markdown: 'hi xemoji:e1:wave:emojix' })), false);
  });

  it('jumbos 1–3 unicode emoji and not mixed text', (): void => {
    assert.equal(isJumboEmojiModel(modelOf({ markdown: '👍' })), true);
    assert.equal(isJumboEmojiModel(modelOf({ markdown: '👍🎉🔥' })), true);
    assert.equal(isJumboEmojiModel(modelOf({ markdown: 'hello 👍' })), false);
  });

  it('jumbos skin-tone, zwj, flag, and spaced clusters without Intl.Segmenter', (): void => {
    assert.equal(isJumboEmojiModel(modelOf({ markdown: '👍🏽' })), true);
    assert.equal(isJumboEmojiModel(modelOf({ markdown: '👨‍👩‍👧' })), true);
    assert.equal(isJumboEmojiModel(modelOf({ markdown: '🇺🇸' })), true);
    assert.equal(isJumboEmojiModel(modelOf({ markdown: '👍 🎉' })), true);
    assert.equal(isJumboEmojiModel(modelOf({ markdown: '1️⃣' })), true);
    assert.equal(isJumboEmojiModel(modelOf({ markdown: '👍🎉🔥❤️' })), false);
  });

  it('does not jumbo media or deleted rows', (): void => {
    assert.equal(
      isJumboEmojiModel(
        modelOf({
          markdown: 'xemoji:e1:wave:emojix',
          attachments: [{ id: 'a', mimetype: 'image/png', width: 4, height: 3 }],
        }),
      ),
      false,
    );
    assert.equal(
      isJumboEmojiModel(modelOf({ markdown: 'xemoji:e1:wave:emojix', isDeleted: true })),
      false,
    );
  });
});
