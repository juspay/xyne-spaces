import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import type { ChatRow } from '../model/chatRow.types';
import { MENTION_USER_SCHEME, mentionUrlFor } from '../model/text/mentionSchemes';
import { actionFlagsFor, actionVisibility, type ActionFlags } from '../overlays/actionVisibility';
import { toggleReaction } from '../overlays/toggleReaction';

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

describe('mentionUrlFor', (): void => {
  it('encodes each mention kind onto the v2 schemes', (): void => {
    assert.equal(mentionUrlFor('user', 'u1'), `${MENTION_USER_SCHEME}u1`);
    assert.equal(mentionUrlFor('channel', 'c1').endsWith('c1'), true);
    assert.equal(mentionUrlFor('group', 'g1').endsWith('g1'), true);
    assert.equal(mentionUrlFor('broadcast', 'b1').endsWith('b1'), true);
  });
});

describe('buildRows mentions and reactions', (): void => {
  it('keeps the mention url on preview segments', (): void => {
    const url = mentionUrlFor('user', 'u2');
    const model = message(buildRows([base({ markdown: `[Ada](${url})` })], ctx));
    const mention = model.body.segments.find(segment => segment.kind === 'mention');
    assert.ok(mention && mention.kind === 'mention');
    assert.equal(mention.url, url);
    assert.equal(mention.mentionsYou, undefined);
  });

  it('marks a mention of the current user', (): void => {
    const url = mentionUrlFor('user', 'me');
    const model = message(buildRows([base({ markdown: `[You](${url})` })], ctx));
    const mention = model.body.segments.find(segment => segment.kind === 'mention');
    assert.ok(mention && mention.kind === 'mention');
    assert.equal(mention.mentionsYou, true);
  });

  it('parses who reacted from reactions md so add/remove can toggle', (): void => {
    const md = [':::reactions', '👍: [me, u2]', '🎉: [u3]', ':::'].join('\n');
    const model = message(buildRows([base({ reactionsMd: md })], ctx));
    const preview = model.reactionPreview;
    assert.ok(preview);
    assert.equal(preview.md, md);
    assert.equal(preview.totalCount, 3);
    assert.equal(preview.groups.length, 2);
    assert.equal(
      preview.reactions.some(item => item.emojiName === '👍' && item.userId === 'me'),
      true,
    );
    assert.equal(
      preview.reactions.some(item => item.emojiName === '🎉' && item.userId === 'me'),
      false,
    );
  });
});

describe('toggleReaction', (): void => {
  it('adds a reaction with fresh ids and removes without them', (): void => {
    const added: unknown[] = [];
    const removed: unknown[] = [];
    let n = 0;
    const createId = (): string => {
      n += 1;
      return `id-${n}`;
    };
    toggleReaction(
      {
        mutate: (payload: unknown): void => {
          added.push(payload);
        },
      },
      {
        messageId: 'm1',
        emojiName: '👍',
        hasReacted: false,
        createId,
        now: 10,
      },
    );
    toggleReaction(
      {
        mutate: (payload: unknown): void => {
          removed.push(payload);
        },
      },
      {
        messageId: 'm1',
        emojiName: '👍',
        hasReacted: true,
        createId,
        now: 11,
      },
    );
    assert.equal(added.length, 1);
    assert.equal(removed.length, 1);
    const addArg = JSON.stringify(added[0]);
    const removeArg = JSON.stringify(removed[0]);
    assert.equal(addArg.includes('"add"') || addArg.includes('add'), true);
    assert.equal(removeArg.includes('"remove"') || removeArg.includes('remove'), true);
  });
});

const flags = (over: Partial<ActionFlags> = {}): ActionFlags => ({
  isMessageDeleted: false,
  isSystemMessage: false,
  isTicketCreationMessage: false,
  isCallMessage: false,
  isShowInChannel: false,
  isOwnMessage: true,
  canEditMessage: true,
  hasImages: false,
  hasTextContent: true,
  isThread: false,
  isChannelArchived: false,
  isFirstInThread: false,
  hasTicket: false,
  repliesEnabled: true,
  hasEditHandler: true,
  hasReminderHandler: true,
  isPending: false,
  isFailed: false,
  canDeletePending: false,
  ...over,
});

describe('deleted tombstone action matrix', (): void => {
  it('hides mutating actions on a deleted message', (): void => {
    const visible = actionVisibility(flags({ isMessageDeleted: true, canEditMessage: false }));
    assert.equal(visible.has('copy-message'), false);
    assert.equal(visible.has('copy-image'), false);
    assert.equal(visible.has('forward-message'), false);
    assert.equal(visible.has('pin'), false);
    assert.equal(visible.has('bookmark'), false);
    assert.equal(visible.has('remind-me'), false);
    assert.equal(visible.has('delete'), false);
    assert.equal(visible.has('edit-in-chat'), false);
    assert.equal(visible.has('send-to-channel'), false);
    assert.equal(visible.has('mark-as-unread'), false);
    assert.equal(visible.has('start-call'), false);
  });

  it('flags a deleted row from the row model', (): void => {
    const model = message(buildRows([base({ isDeleted: true })], ctx));
    const derived = actionFlagsFor(model, {
      isThread: false,
      isChannelArchived: false,
      isFirstInThread: false,
      hasTicket: false,
      repliesEnabled: true,
      hasEditHandler: true,
      hasReminderHandler: true,
      isPending: false,
      isFailed: false,
      canDeletePending: false,
    });
    assert.equal(derived.isMessageDeleted, true);
    assert.equal(derived.canEditMessage, false);
  });
});
