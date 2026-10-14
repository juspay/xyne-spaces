import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ACTION_ORDER,
  QUICK_REACTIONS,
  actionFlagsFor,
  actionVisibility,
  dividerBeforeDelete,
  dividerBeforeMarkAsUnread,
  rowPressIntent,
  type ActionFlags,
  type MessageActionId,
} from '../overlays/actionVisibility';
import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';

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

const has = (over: Partial<ActionFlags>, id: MessageActionId): boolean =>
  actionVisibility(flags(over)).has(id);

describe('actionVisibility', (): void => {
  it('reply-in-thread — channel, replies on, not show-in-channel', (): void => {
    assert.equal(has({}, 'reply-in-thread'), true);
    assert.equal(has({ isThread: true }, 'reply-in-thread'), false);
    assert.equal(has({ repliesEnabled: false }, 'reply-in-thread'), false);
    assert.equal(has({ isShowInChannel: true }, 'reply-in-thread'), false);
    assert.equal(has({ isSystemMessage: true }, 'reply-in-thread'), false);
    assert.equal(has({ isSystemMessage: true, isCallMessage: true }, 'reply-in-thread'), true);
    assert.equal(
      has({ isSystemMessage: true, isTicketCreationMessage: true }, 'reply-in-thread'),
      true,
    );
  });

  it('send-to-channel — own thread reply, not first, not show-in-channel', (): void => {
    assert.equal(has({ isThread: true, isFirstInThread: false }, 'send-to-channel'), true);
    assert.equal(has({}, 'send-to-channel'), false);
    assert.equal(has({ isThread: true, isOwnMessage: false }, 'send-to-channel'), false);
    assert.equal(has({ isThread: true, isFirstInThread: true }, 'send-to-channel'), false);
    assert.equal(has({ isThread: true, isShowInChannel: true }, 'send-to-channel'), false);
    assert.equal(has({ isThread: true, isMessageDeleted: true }, 'send-to-channel'), false);
  });

  it('edit-in-chat — editable, not archived, handler present', (): void => {
    assert.equal(has({}, 'edit-in-chat'), true);
    assert.equal(has({ isChannelArchived: true }, 'edit-in-chat'), false);
    assert.equal(has({ hasEditHandler: false }, 'edit-in-chat'), false);
    assert.equal(has({ canEditMessage: false }, 'edit-in-chat'), false);
  });

  it('copy-message / copy-image / copy-link', (): void => {
    assert.equal(has({}, 'copy-message'), true);
    assert.equal(has({ hasTextContent: false }, 'copy-message'), false);
    assert.equal(has({ isMessageDeleted: true }, 'copy-message'), false);
    assert.equal(has({ hasImages: true }, 'copy-image'), true);
    assert.equal(has({}, 'copy-image'), false);
    assert.equal(has({}, 'copy-link'), true);
    assert.equal(has({ isMessageDeleted: true }, 'copy-link'), false);
    assert.equal(has({ isThread: true, isMessageDeleted: true }, 'copy-link'), true);
  });

  it('forward / pin / bookmark / remind-me / start-call / mark-as-unread / delete', (): void => {
    assert.equal(has({}, 'forward-message'), true);
    assert.equal(has({ isMessageDeleted: true }, 'forward-message'), false);
    assert.equal(has({ isMessageDeleted: true }, 'pin'), false);
    assert.equal(has({ isMessageDeleted: true }, 'remind-me'), false);
    assert.equal(has({ isMessageDeleted: true, isThread: true }, 'start-call'), false);
    assert.equal(has({ isMessageDeleted: true }, 'mark-as-unread'), false);
    assert.equal(has({ isMessageDeleted: true, canEditMessage: false }, 'edit-in-chat'), false);
    assert.equal(has({ isMessageDeleted: true, canEditMessage: false }, 'delete'), false);
    assert.equal(has({ isSystemMessage: true }, 'forward-message'), false);
    assert.equal(has({}, 'pin'), true);
    assert.equal(has({ isThread: true }, 'pin'), false);
    assert.equal(has({ isSystemMessage: true }, 'pin'), false);
    assert.equal(has({ isSystemMessage: true, isTicketCreationMessage: true }, 'pin'), true);
    assert.equal(has({}, 'bookmark'), true);
    assert.equal(has({ isMessageDeleted: true }, 'bookmark'), false);
    assert.equal(has({}, 'remind-me'), true);
    assert.equal(has({ hasReminderHandler: false }, 'remind-me'), false);
    assert.equal(has({ isThread: true }, 'start-call'), true);
    assert.equal(has({}, 'start-call'), false);
    assert.equal(has({}, 'mark-as-unread'), true);
    assert.equal(has({ isTicketCreationMessage: true }, 'mark-as-unread'), false);
    assert.equal(has({}, 'delete'), true);
    assert.equal(has({ hasTicket: true }, 'delete'), false);
  });

  it('pending rows replace the rest of the sheet', (): void => {
    const failed = actionVisibility(
      flags({ isPending: true, isFailed: true, canDeletePending: true }),
    );
    assert.equal(failed.has('pending-retry'), true);
    assert.equal(failed.has('pending-delete'), true);
    assert.equal(failed.has('reply-in-thread'), false);
    assert.equal(failed.has('delete'), false);
    const inflight = actionVisibility(
      flags({ isPending: true, isFailed: false, canDeletePending: false }),
    );
    assert.equal(inflight.size, 0);
  });

  it('section dividers follow edit/delete and unread visibility', (): void => {
    assert.equal(dividerBeforeMarkAsUnread(actionVisibility(flags())), true);
    assert.equal(
      dividerBeforeMarkAsUnread(actionVisibility(flags({ canEditMessage: false }))),
      false,
    );
    assert.equal(dividerBeforeDelete(actionVisibility(flags())), false);
    assert.equal(dividerBeforeDelete(actionVisibility(flags({ isSystemMessage: true }))), true);
  });

  it('quick reactions are the documented six', (): void => {
    assert.deepEqual([...QUICK_REACTIONS], ['👍', '😂', '✅', '🙌', '🎉', '❤️']);
  });

  it('sheet order matches v2', (): void => {
    assert.deepEqual(
      [...ACTION_ORDER],
      [
        'pending-retry',
        'pending-delete',
        'reply-in-thread',
        'send-to-channel',
        'edit-in-chat',
        'copy-message',
        'copy-link',
        'forward-message',
        'copy-image',
        'pin',
        'bookmark',
        'remind-me',
        'start-call',
        'mark-as-unread',
        'delete',
      ],
    );
  });
});

describe('actionFlagsFor', (): void => {
  const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
    conversationId: 'c1',
    channelId: 'ch',
    createdAt: Date.UTC(2026, 7, 22, 12, 0, 0),
    messageId: 'm1',
    senderId: 'me',
    senderDisplayName: 'Me',
    senderAvatarUri: null,
    messageType: 'USER',
    html: '<p>hi</p>',
    markdown: 'hi',
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
  };

  it('derives own-message editability and image/text from the row model', (): void => {
    const rows = buildRows([input()], {
      channelId: 'ch',
      channelKind: 'channel',
      currentUserId: 'me',
    });
    const model = rows.find(row => row.type === 'message')?.model;
    assert.ok(model);
    const derived = actionFlagsFor(model, ctx);
    assert.equal(derived.isOwnMessage, true);
    assert.equal(derived.canEditMessage, true);
    assert.equal(derived.hasTextContent, true);
    assert.equal(derived.hasImages, false);
    assert.equal(derived.isSystemMessage, false);
  });

  it('keeps copy for mention-only composer HTML', (): void => {
    const rows = buildRows(
      [input({ html: '<p><mention data-id="u1">@Ada</mention></p>', markdown: '' })],
      {
        channelId: 'ch',
        channelKind: 'channel',
        currentUserId: 'me',
      },
    );
    const model = rows.find(row => row.type === 'message')?.model;
    assert.ok(model);
    const derived = actionFlagsFor(model, ctx);
    assert.equal(derived.hasTextContent, true);
  });

  it('uses channel copy semantics for emoji-only HTML', (): void => {
    const rows = buildRows(
      [
        input({
          html: '<p><img data-emoji="true" alt=":wave:"></p>',
          markdown: '',
        }),
      ],
      {
        channelId: 'ch',
        channelKind: 'channel',
        currentUserId: 'me',
      },
    );
    const model = rows.find(row => row.type === 'message')?.model;
    assert.ok(model);
    assert.equal(actionFlagsFor(model, ctx).hasTextContent, true);
    assert.equal(actionFlagsFor(model, { ...ctx, isThread: true }).hasTextContent, false);
  });

  it('derives copy-image from every attachment, regardless of media ordering', (): void => {
    const rows = buildRows(
      [
        input({
          attachments: [
            { id: 'video', mimetype: 'video/mp4' },
            { id: 'image', mimetype: 'image/png' },
          ],
        }),
      ],
      {
        channelId: 'ch',
        channelKind: 'channel',
        currentUserId: 'me',
      },
    );
    const model = rows.find(row => row.type === 'message')?.model;
    assert.ok(model);
    assert.equal(actionFlagsFor(model, ctx).hasImages, true);
    assert.equal(actionVisibility(actionFlagsFor(model, ctx)).has('copy-image'), true);
  });

  it('derives copy-image from a filename when the server MIME is generic', (): void => {
    const rows = buildRows(
      [
        input({
          attachments: [
            {
              id: 'image',
              mimetype: 'application/octet-stream',
              originalFilename: 'photo.png',
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
    const model = rows.find(row => row.type === 'message')?.model;
    assert.ok(model);
    assert.equal(actionFlagsFor(model, ctx).hasImages, true);
  });
});

describe('rowPressIntent', (): void => {
  it('retries a failed row, opens the sheet on pending chrome, else opens the thread', (): void => {
    assert.equal(rowPressIntent(false, null), 'open');
    assert.equal(rowPressIntent(true, 'failed'), 'retry');
    assert.equal(rowPressIntent(true, 'connecting'), 'actions');
    assert.equal(rowPressIntent(true, null), 'open');
  });

  it('is wired on MessageRow via the pending store, not extraData', (): void => {
    const source = readFileSync(
      fileURLToPath(new URL('../rows/MessageRow.tsx', import.meta.url)),
      'utf8',
    );
    assert.equal(/rowPressIntent/.test(source), true);
    assert.equal(/firePendingMutator/.test(source), true);
    assert.equal(/usePendingByMessageId/.test(source), true);
    assert.equal(/usePendingStatusByMessageId/.test(source), true);
    assert.equal(/extraData=/.test(source), false);
  });
});
