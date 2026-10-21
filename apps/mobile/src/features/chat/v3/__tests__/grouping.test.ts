import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChannelScopeType } from '@xyne/shared';
import { applyGrouping, applySenderNames, applyTrailingGroupAvatars } from '../model/buildGrouping';
import { buildRows } from '../model/buildRows';
import { channelKindOf, rowKindFor, type ConversationInput } from '../model/conversationInput';
import type { ChatRow, MessageRowModel } from '../model/chatRow.types';

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);
const NEXT_DAY = Date.UTC(2026, 7, 23, 12, 0, 0);

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

const ctx = {
  channelId: 'ch',
  channelKind: 'channel' as const,
  currentUserId: 'me',
};

const messages = (rows: ChatRow[]): MessageRowModel[] =>
  rows.filter(row => row.type === 'message').map(row => row.model);

describe('§9.0 grouping', (): void => {
  it('showSenderName look-backward — first of a consecutive group', (): void => {
    const rows = messages(
      buildRows(
        [
          input({ conversationId: 'a', senderId: 'u2' }),
          input({ conversationId: 'b', senderId: 'u2', createdAt: DAY + 1000 }),
        ],
        ctx,
      ),
    );
    assert.equal(rows[0]?.showSenderName, true);
    assert.equal(rows[1]?.showSenderName, false);
  });

  it('showAvatar look-ahead — last of a group', (): void => {
    const rows = messages(
      buildRows(
        [
          input({ conversationId: 'a', senderId: 'u2' }),
          input({ conversationId: 'b', senderId: 'u2', createdAt: DAY + 1000 }),
        ],
        ctx,
      ),
    );
    assert.equal(rows[0]?.showAvatar, false);
    assert.equal(rows[1]?.showAvatar, true);
  });

  it('DM: no avatars, no identity', (): void => {
    const rows = messages(buildRows([input({ senderId: 'u2' })], { ...ctx, channelKind: 'dm' }));
    assert.equal(rows[0]?.showAvatar, false);
    assert.equal(rows[0]?.showSenderName, false);
  });

  it('group DMs keep avatars — only 1:1 DMs hide identity', (): void => {
    assert.equal(channelKindOf(ChannelScopeType.DM), 'dm');
    assert.equal(channelKindOf(ChannelScopeType.GROUP_DM), 'channel');
    const rows = messages(
      buildRows([input({ senderId: 'u2' })], {
        ...ctx,
        channelKind: channelKindOf(ChannelScopeType.GROUP_DM),
      }),
    );
    assert.equal(rows[0]?.showAvatar, true);
    assert.equal(rows[0]?.showSenderName, true);
  });

  it('CURRENT_USER: no avatar, still breaks groups', (): void => {
    const rows = messages(
      buildRows(
        [
          input({ conversationId: 'a', senderId: 'u2' }),
          input({ conversationId: 'b', senderId: 'me', messageId: 'm2' }),
          input({ conversationId: 'c', senderId: 'u2', messageId: 'm3', createdAt: DAY + 2000 }),
        ],
        ctx,
      ),
    );
    assert.equal(rows[1]?.rowKind, 'CURRENT_USER');
    assert.equal(rows[1]?.showAvatar, false);
    assert.equal(rows[2]?.showSenderName, true);
  });

  it('SYSTEM: no identity, never breaks a group', (): void => {
    const rows = messages(
      buildRows(
        [
          input({ conversationId: 'a', senderId: 'u2' }),
          input({
            conversationId: 'sys',
            senderId: 'system',
            messageType: 'SYSTEM',
            markdown: 'joined',
            createdAt: DAY + 500,
          }),
          input({ conversationId: 'c', senderId: 'u2', createdAt: DAY + 1000 }),
        ],
        ctx,
      ),
    );
    assert.equal(rows[1]?.rowKind, 'SYSTEM');
    assert.equal(rows[1]?.showAvatar, false);
    assert.equal(rows[1]?.showSenderName, false);
    assert.equal(rows[2]?.showSenderName, false);
    assert.equal(rows[2]?.showAvatar, true);
  });

  it('BOT: always identity + avatar, never grouped', (): void => {
    const rows = messages(
      buildRows(
        [
          input({ conversationId: 'a', senderId: 'bot', messageType: 'BOT' }),
          input({
            conversationId: 'b',
            senderId: 'bot',
            messageType: 'BOT',
            createdAt: DAY + 1000,
          }),
        ],
        ctx,
      ),
    );
    assert.equal(rows[0]?.rowKind, 'BOT');
    assert.equal(rows[0]?.showSenderName, true);
    assert.equal(rows[0]?.showAvatar, true);
    assert.equal(rows[1]?.showSenderName, true);
    assert.equal(rows[1]?.showAvatar, true);
  });

  it('flow-json SYSTEM: no identity or avatar, like other system chrome', (): void => {
    const rows = messages(
      buildRows(
        [
          input({
            conversationId: 'sys',
            senderId: 'bot',
            messageType: 'SYSTEM',
            isFlowJson: true,
            markdown: '{"flow":true}',
          }),
        ],
        ctx,
      ),
    );
    assert.equal(rows[0]?.rowKind, 'SYSTEM');
    assert.equal(rows[0]?.showAvatar, false);
    assert.equal(rows[0]?.showSenderName, false);
  });

  it('TICKET / ticketPreview rows: no sender name', (): void => {
    const rows = messages(
      buildRows(
        [
          input({
            conversationId: 't',
            messageType: 'SYSTEM',
            metadata: { ticketId: 'tk-1' },
            ticketPreview: {
              ticketId: 'tk-1',
              title: 'Bug',
              description: null,
              statusLabel: 'open',
              priority: 'P1',
            },
          }),
        ],
        ctx,
      ),
    );
    assert.equal(rows[0]?.rowKind, 'TICKET');
    assert.equal(rows[0]?.showSenderName, false);
  });

  it('day boundary breaks a group even for the same sender', (): void => {
    const rows = messages(
      buildRows(
        [
          input({ conversationId: 'a', senderId: 'u2', createdAt: DAY }),
          input({ conversationId: 'b', senderId: 'u2', createdAt: NEXT_DAY }),
        ],
        ctx,
      ),
    );
    assert.equal(rows[0]?.showAvatar, true);
    assert.equal(rows[1]?.showSenderName, true);
    assert.equal(rows[1]?.showAvatar, true);
  });

  it('reference equality is preserved for unchanged rows', (): void => {
    const conversations = [
      input({ conversationId: 'a', senderId: 'u2' }),
      input({ conversationId: 'b', senderId: 'u2', createdAt: DAY + 1000 }),
    ];
    const first = buildRows(conversations, ctx);
    const second = buildRows(conversations, { ...ctx, previousRows: first });
    const firstB = first.find(row => row.type === 'message' && row.model.conversationId === 'b');
    const secondB = second.find(row => row.type === 'message' && row.model.conversationId === 'b');
    assert.equal(firstB, secondB);
  });
});

describe('grouping helpers', (): void => {
  it('applySenderNames names only the first of a consecutive group', (): void => {
    const [first, second] = messages(
      buildRows(
        [
          input({ conversationId: 'a', senderId: 'u2' }),
          input({ conversationId: 'b', senderId: 'u2', createdAt: DAY + 1000 }),
        ],
        ctx,
      ),
    );
    assert.ok(first && second);
    const next = applySenderNames(
      [
        { ...first, showSenderName: false },
        { ...second, showSenderName: true },
      ],
      'channel',
    );
    assert.equal(next[0]?.showSenderName, true);
    assert.equal(next[1]?.showSenderName, false);
  });

  it('applyTrailingGroupAvatars puts the avatar on the last of a group', (): void => {
    const [first, second] = messages(
      buildRows(
        [
          input({ conversationId: 'a', senderId: 'u2' }),
          input({ conversationId: 'b', senderId: 'u2', createdAt: DAY + 1000 }),
        ],
        ctx,
      ),
    );
    assert.ok(first && second);
    const next = applyTrailingGroupAvatars(
      [
        { ...first, showAvatar: true },
        { ...second, showAvatar: false },
      ],
      'channel',
    );
    assert.equal(next[0]?.showAvatar, false);
    assert.equal(next[1]?.showAvatar, true);
  });

  it('applyGrouping clears avatars in DMs', (): void => {
    const [row] = messages(buildRows([input({ senderId: 'u2' })], ctx));
    assert.ok(row);
    const next = applyGrouping([{ ...row, showAvatar: true }], 'dm');
    assert.equal(next[0]?.showAvatar, false);
  });
});

describe('rowKindFor', (): void => {
  it('classifies bot, ticket-system, own, and other rows', (): void => {
    assert.equal(rowKindFor('BOT', 'x', 'me', null, null), 'BOT');
    assert.equal(rowKindFor('SYSTEM', 'x', 'me', { isTicketActivity: true }, null), 'SYSTEM');
    assert.equal(rowKindFor('SYSTEM', 'x', 'me', { ticketId: 't-1' }, null), 'TICKET');
    assert.equal(rowKindFor('USER', 'me', 'me', null, null), 'CURRENT_USER');
    assert.equal(rowKindFor('USER', 'u2', 'me', null, null), 'OTHER_USER');
  });
});
