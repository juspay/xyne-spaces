import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import type { ChatRow } from '../model/chatRow.types';
import {
  jumpHighlightConversationId,
  landingIdentity,
  landingIndex,
  canMountConversationList,
  targetFromState,
  visibleRowForReadCursor,
} from '../list/landing';

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

const rows = (): ChatRow[] =>
  buildRows(
    [
      input({ conversationId: 'c1', createdAt: DAY, messageId: 'm1' }),
      input({ conversationId: 'c2', createdAt: DAY + 1000, markdown: 'later', messageId: 'm2' }),
    ],
    {
      channelId: 'ch',
      channelKind: 'channel',
      currentUserId: 'me',
      unreadBoundaryAt: DAY + 500,
    },
  );

describe('landingIndex', (): void => {
  it('lands a tail open on the last row — unread is a divider, not a landing', (): void => {
    const list = rows();
    assert.equal(landingIndex(list, { kind: 'tail' }), list.length - 1);
    assert.equal(
      list.some(row => row.type === 'unread-divider'),
      true,
    );
  });

  it('lands an anchored open on the matching conversation id', (): void => {
    const list = rows();
    const index = landingIndex(list, {
      kind: 'anchor',
      conversationId: 'c2',
      messageId: 'm2',
      createdAt: DAY + 1000,
    });
    assert.notEqual(index, null);
    const row = list[index!];
    assert.equal(row?.type, 'message');
    if (row?.type === 'message') {
      assert.equal(row.model.conversationId, 'c2');
    }
  });

  it('prefers the activity reply messageId over the thread conversation id', (): void => {
    const list = rows();
    const later = list.find(row => row.type === 'message' && row.model.conversationId === 'c2');
    assert.ok(later && later.type === 'message');
    const index = landingIndex(list, {
      kind: 'anchor',
      conversationId: 'c1',
      createdAt: DAY,
      messageId: 'm2',
    });
    assert.equal(index, list.indexOf(later));
  });

  it('lands an anchored open on a matching message id', (): void => {
    const list = rows();
    const message = list.find(row => row.type === 'message');
    assert.ok(message && message.type === 'message' && message.model.messageId);
    const index = landingIndex(list, {
      kind: 'anchor',
      conversationId: message.model.conversationId,
      createdAt: message.model.createdAt,
      messageId: message.model.messageId ?? message.model.conversationId,
    });
    assert.equal(index, list.indexOf(message));
  });

  it('does not fall back to the thread parent when the reply messageId is missing', (): void => {
    const list = buildRows(
      [input({ conversationId: 'thread-root', createdAt: DAY, messageId: 'parent-msg' })],
      { channelId: 'ch', channelKind: 'channel', currentUserId: 'me' },
    );
    assert.equal(
      landingIndex(list, {
        kind: 'anchor',
        conversationId: 'thread-root',
        createdAt: DAY,
        messageId: 'reply-msg',
      }),
      null,
    );
  });

  it('returns null when the target row is missing', (): void => {
    assert.equal(landingIndex([], { kind: 'tail' }), null);
    assert.equal(
      landingIndex(rows(), {
        kind: 'anchor',
        conversationId: 'missing',
        messageId: 'missing',
        createdAt: 1,
      }),
      null,
    );
  });
});

describe('landingIdentity', (): void => {
  it('distinguishes two anchors that share a kind', (): void => {
    assert.notEqual(
      landingIdentity({ kind: 'anchor', conversationId: 'a', messageId: 'm-a', createdAt: 1 }),
      landingIdentity({ kind: 'anchor', conversationId: 'b', messageId: 'm-b', createdAt: 1 }),
    );
    assert.notEqual(
      landingIdentity({ kind: 'anchor', conversationId: 'a', createdAt: 1, messageId: 'm-1' }),
      landingIdentity({ kind: 'anchor', conversationId: 'a', createdAt: 1, messageId: 'm-2' }),
    );
  });
});

describe('jumpHighlightConversationId', (): void => {
  it('uses the landed row conversation id, not the route messageId', (): void => {
    const rows = buildRows([input({ conversationId: 'c-origin', messageId: 'm-reply' })], {
      channelId: 'ch',
      channelKind: 'channel',
      currentUserId: 'me',
    });
    assert.equal(
      jumpHighlightConversationId(rows, {
        kind: 'anchor',
        conversationId: 'c-other',
        createdAt: DAY,
        messageId: 'm-reply',
      }),
      'c-origin',
    );
  });

  it('falls back to the route messageId while the target row is still loading', (): void => {
    assert.equal(
      jumpHighlightConversationId([], {
        kind: 'anchor',
        conversationId: 'c-other',
        createdAt: DAY,
        messageId: 'm-reply',
      }),
      'm-reply',
    );
  });
});

describe('targetFromState', (): void => {
  it('has no landing target while resolving', (): void => {
    assert.equal(
      targetFromState({
        status: 'resolving',
        intent: {
          intentKey: 'channel:ch',
          surface: { kind: 'channel', channelId: 'ch' },
          entry: 'tap',
          isColdStart: false,
          raw: {},
          hint: { channelId: 'ch' },
        },
        startedAt: 1,
      }),
      null,
    );
  });
});

describe('visibleRowForReadCursor', (): void => {
  it('uses the last message at the tail even when the first visible row is chrome', (): void => {
    const list = rows();
    const last = [...list].reverse().find(row => row.type === 'message');
    assert.ok(last && last.type === 'message');
    const date = list.find(row => row.type === 'date');
    assert.ok(date);
    assert.deepEqual(visibleRowForReadCursor(date, list, true), {
      conversationId: last.model.conversationId,
      createdAt: last.model.createdAt,
    });
  });
});

describe('canMountConversationList', (): void => {
  it('does not mount until there is a target', (): void => {
    assert.equal(canMountConversationList(null, 'resolving', rows()), false);
  });

  it('does not mount until the landing row exists', (): void => {
    assert.equal(canMountConversationList({ kind: 'tail' }, 'loading', []), false);
    assert.equal(canMountConversationList({ kind: 'tail' }, 'loading', rows()), true);
    assert.equal(canMountConversationList({ kind: 'tail' }, 'ready', []), false);
  });
});
