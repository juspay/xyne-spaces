import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseOpenIntent } from '../intent/parseOpenIntent';
import { OPEN_PATH_CATALOG } from '../parity/openPathCatalog';
import { landingIndex } from '../list/landing';
import { legendListProps } from '../list/legendListProps';
import { classifyOpen } from '../machine/revealPolicy';
import type { OpenState } from '../machine/openState';
import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const mustParse = (raw: Record<string, unknown>) => {
  const result = parseOpenIntent(raw);
  assert.equal(result.ok, true, JSON.stringify(raw));
  if (!result.ok) throw new Error('parse failed');
  return result.value;
};

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'conversation-1',
  channelId: 'channel-1',
  createdAt: DAY,
  messageId: 'message-1',
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

describe('open-path landing wiring (P4)', (): void => {
  it('parses every open path into the expected entry and landing kind', (): void => {
    for (const entry of OPEN_PATH_CATALOG) {
      const intent = mustParse(entry.params);
      assert.equal(intent.entry, entry.expectedEntry, entry.id);
      if (entry.expectedColdStart !== undefined) {
        assert.equal(intent.isColdStart, entry.expectedColdStart, entry.id);
      }
      if (entry.expectedConversationId !== undefined) {
        assert.equal(intent.hint.conversationId, entry.expectedConversationId, entry.id);
      }
      const target = classifyOpen(intent);
      assert.equal(target.kind, entry.expectedLandingKind, entry.id);
      if (entry.expectedLandingKind === 'anchor' && entry.expectedConversationId) {
        assert.equal(
          target.kind === 'anchor' ? target.conversationId : '',
          entry.expectedConversationId,
          entry.id,
        );
      }
    }
  });

  it('forwards classifyOpen into legendListProps.initialScrollIndex', (): void => {
    const rows = buildRows(
      [
        input(),
        input({
          conversationId: 'conversation-2',
          createdAt: DAY + 2000,
          markdown: 'later',
          messageId: 'message-2',
        }),
      ],
      {
        channelId: 'channel-1',
        channelKind: 'channel',
        currentUserId: 'me',
        unreadBoundaryAt: DAY + 1000,
      },
    );

    const restore = (): boolean => true;
    const placing = (
      intent: ReturnType<typeof mustParse>,
    ): Extract<OpenState, { status: 'placing' }> => ({
      status: 'placing',
      intent,
      target: classifyOpen(intent),
      source: 'live',
      startedAt: 1,
    });

    const tailIntent = mustParse({ channelId: 'channel-1', source: 'tap' });
    const tailState = placing(tailIntent);
    const tailProps = legendListProps({
      state: tailState,
      surface: tailIntent.surface,
      target: tailState.target,
      rows,
      shouldRestorePosition: restore,
    });
    assert.equal(tailProps.initialScrollAtEnd, true);
    assert.equal(tailProps.initialScrollIndex, undefined);

    const unreadIntent = mustParse({
      channelId: 'channel-1',
      source: 'tap',
      unreadOpen: '1',
      unreadCount: '1',
      unreadLastViewedAt: String(DAY + 1000),
      unreadLastViewedConversationId: 'conversation-1',
    });
    const unreadState = placing(unreadIntent);
    const unreadProps = legendListProps({
      state: unreadState,
      surface: unreadIntent.surface,
      target: unreadState.target,
      rows,
      shouldRestorePosition: restore,
    });
    const unreadAt = rows.findIndex(row => row.type === 'unread-divider');
    assert.ok(unreadAt >= 0);
    assert.equal(unreadState.target.kind, 'tail');
    assert.equal(unreadProps.initialScrollAtEnd, tailProps.initialScrollAtEnd);
    assert.equal(unreadProps.initialScrollIndex, tailProps.initialScrollIndex);
    assert.equal(unreadProps.alignItemsAtEnd, tailProps.alignItemsAtEnd);
    assert.equal(
      unreadProps.maintainScrollAtEnd.on.dataChange,
      tailProps.maintainScrollAtEnd.on.dataChange,
    );

    const anchorIntent = mustParse({
      channelId: 'channel-1',
      origin: 'conversation-1',
      messageId: 'message-1',
      createdAt: String(DAY),
      source: 'activity',
    });
    const anchorState = placing(anchorIntent);
    const anchorProps = legendListProps({
      state: anchorState,
      surface: anchorIntent.surface,
      target: anchorState.target,
      rows,
      shouldRestorePosition: restore,
    });
    const anchorAt = landingIndex(rows, anchorState.target);
    assert.ok(anchorAt !== null);
    assert.deepEqual(anchorProps.initialScrollIndex, { index: anchorAt, viewPosition: 0.35 });

    const missingIntent = mustParse({
      channelId: 'channel-1',
      origin: 'missing',
      messageId: 'missing',
      createdAt: '1',
      source: 'activity',
    });
    const missingState = placing(missingIntent);
    const missingProps = legendListProps({
      state: missingState,
      surface: missingIntent.surface,
      target: missingState.target,
      rows,
      shouldRestorePosition: restore,
    });
    assert.equal(landingIndex(rows, missingState.target), null);
    assert.equal(missingProps.initialScrollIndex, undefined);
    assert.equal(missingProps.initialScrollAtEnd, false);
  });
});
