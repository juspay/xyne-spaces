import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRows } from '../model/buildRows';
import type { ChannelKind, ConversationInput } from '../model/conversationInput';
import { rowsAreEqual } from '../model/rowEquals';

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

const context = {
  channelId: 'ch',
  channelKind: 'channel' as const,
  currentUserId: 'me',
};

const messageRow = (value: ConversationInput, channelKind: ChannelKind = context.channelKind) => {
  const row = buildRows([value], { ...context, channelKind }).find(item => item.type === 'message');
  assert.ok(row && row.type === 'message');
  return row;
};

describe('contentSignature', (): void => {
  it('invalidates recycled rows when attachment paint data changes', (): void => {
    const base = {
      id: 'attachment-1',
      mimetype: 'application/pdf',
      originalFilename: 'brief.pdf',
      size: 10,
      durationSeconds: 1,
    };
    const original = messageRow(input({ attachments: [base] }));

    for (const changed of [
      { ...base, originalFilename: 'updated.pdf' },
      { ...base, size: 11 },
      { ...base, durationSeconds: 2 },
    ]) {
      assert.equal(rowsAreEqual(original, messageRow(input({ attachments: [changed] }))), false);
    }
  });

  it('invalidates recycled ticket rows when the assignee changes', (): void => {
    const original = messageRow(
      input({
        messageType: 'SYSTEM',
        ticketPreview: {
          ticketId: 'T-1',
          title: 'Ticket',
          description: null,
          statusLabel: 'Open',
          priority: 'HIGH',
          assigneeId: 'u1',
        },
      }),
    );
    const changed = messageRow(
      input({
        messageType: 'SYSTEM',
        ticketPreview: {
          ticketId: 'T-1',
          title: 'Ticket',
          description: null,
          statusLabel: 'Open',
          priority: 'HIGH',
          assigneeId: 'u2',
        },
      }),
    );
    assert.equal(rowsAreEqual(original, changed), false);
  });

  it('invalidates recycled rows when ticket classification metadata changes', (): void => {
    const original = messageRow(
      input({ messageType: 'SYSTEM', metadata: { isTicketActivity: true } }),
    );
    const changed = messageRow(input({ messageType: 'SYSTEM', metadata: { ticketId: 'T-1' } }));
    assert.equal(rowsAreEqual(original, changed), false);
  });

  it('invalidates recycled rows when timestamp, channel, or visibility changes', (): void => {
    const original = messageRow(input());
    for (const changed of [
      input({ createdAt: DAY + 1 }),
      input({ channelId: 'other-channel' }),
      input({ isVisibleToCurrentUser: false }),
    ]) {
      assert.equal(rowsAreEqual(original, messageRow(changed)), false);
    }
  });

  it('invalidates recycled rows when the channel surface changes DM identity policy', (): void => {
    const original = messageRow(input(), 'channel');
    const changed = messageRow(input(), 'dm');
    assert.equal(rowsAreEqual(original, changed), false);
  });
});
