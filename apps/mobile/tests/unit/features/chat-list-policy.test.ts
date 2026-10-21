import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MessageType, serializeInitialMessageMd } from '@xyne/shared';

import {
  findTargetRowIndex,
  type ChatRow,
} from '@/src/features/chat/v2/components/chat/chat-list-rows';
import {
  areChatRowsEqual,
  dedupeAndSortChatConversations,
  getDuplicateChatConversationIds,
  getDuplicateChatRowIds,
  getChatRowItemType,
  resolveChatInitialScrollMode,
  shouldAllowChatPagination,
  shouldRestoreAnchoredOpenPosition,
  shouldPromoteLatestTailForOpen,
  shouldSuspendVisibleContentAnchoringForTailOpen,
  shouldRestoreThreadVisiblePosition,
  shouldKeepThreadLandingScroll,
  resolveAnchorLandingPass,
  areChatViewportAnchorsEqual,
  shouldHoldChatComposer,
  shouldConcealChatListForOpenIdentity,
  getLatestPendingConversationId,
  overlaySessionSendRow,
  resolveLocalSendTailTransition,
  selectChatListFetchedRows,
  selectChatListWindowWithLatest,
  shouldFollowChatListTail,
  shouldReleaseSessionSendOverlay,
  shouldSkipChatListRestoreForLocalSend,
  shouldRetrySendScrollUntilReady,
  MAX_SEND_SCROLL_READY_FRAMES,
} from '@/src/features/chat/v2/components/chat/chat-list-policy';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';

const createMessageRow = (paint: ChatPaintRow): ChatRow => ({
  type: 'message',
  id: paint.conversationId,
  paint,
});

describe('chat list policy', () => {
  it('keeps the initial landing mode independent from later pagination changes', () => {
    assert.equal(
      resolveChatInitialScrollMode({
        hasRows: true,
        hasRouteAnchor: true,
        hasTarget: true,
        targetIsAtTail: true,
        shouldAnchorToUnreadBoundary: false,
      }),
      'tail',
    );
    assert.equal(
      resolveChatInitialScrollMode({
        hasRows: true,
        hasRouteAnchor: true,
        hasTarget: true,
        targetIsAtTail: false,
        shouldAnchorToUnreadBoundary: false,
      }),
      'target',
    );
    assert.equal(
      resolveChatInitialScrollMode({
        hasRows: true,
        hasRouteAnchor: false,
        hasTarget: false,
        targetIsAtTail: false,
        shouldAnchorToUnreadBoundary: true,
      }),
      'unread',
    );
  });

  it('falls back to the conversation row when the linked message is not the root row', () => {
    assert.equal(
      findTargetRowIndex(
        {
          byConversationId: new Map([['conversation-1', 4]]),
          byMessageId: new Map([['root-message-1', 4]]),
        },
        'conversation-1',
        'reply-message-1',
      ),
      4,
    );
  });

  it('promotes the latest tail only for unanchored direct opens', () => {
    assert.equal(
      shouldPromoteLatestTailForOpen({ hasPriorityMessageOpen: false, hasRouteAnchor: false }),
      true,
    );
    assert.equal(
      shouldPromoteLatestTailForOpen({ hasPriorityMessageOpen: true, hasRouteAnchor: false }),
      false,
    );
    assert.equal(
      shouldPromoteLatestTailForOpen({ hasPriorityMessageOpen: false, hasRouteAnchor: true }),
      false,
    );
  });

  it('keeps data-change MVCP active for an anchored open until user scrolls', () => {
    assert.equal(
      shouldRestoreAnchoredOpenPosition({
        hasRequestedAnchor: false,
        didUserScroll: false,
      }),
      false,
    );
    assert.equal(
      shouldRestoreAnchoredOpenPosition({
        hasRequestedAnchor: true,
        didUserScroll: false,
      }),
      true,
    );
    assert.equal(
      shouldRestoreAnchoredOpenPosition({
        hasRequestedAnchor: true,
        didUserScroll: true,
      }),
      false,
    );
  });

  it('dedupes viewport anchors by conversation, cursor, and direction', () => {
    const backward = {
      conversationId: 'conversation',
      createdAt: 100,
      direction: 'backward' as const,
    };
    assert.equal(areChatViewportAnchorsEqual(backward, { ...backward }), true);
    assert.equal(
      areChatViewportAnchorsEqual(backward, { ...backward, direction: 'forward' }),
      false,
    );
    assert.equal(areChatViewportAnchorsEqual(backward, { ...backward, createdAt: 101 }), false);
    assert.equal(areChatViewportAnchorsEqual(null, null), true);
    assert.equal(areChatViewportAnchorsEqual(null, backward), false);
  });

  it('only paginates after user scroll with a visible window', () => {
    assert.equal(
      shouldAllowChatPagination({ didUserScroll: false, hasMore: true, displayRowCount: 10 }),
      false,
    );
    assert.equal(
      shouldAllowChatPagination({ didUserScroll: true, hasMore: false, displayRowCount: 10 }),
      false,
    );
    assert.equal(
      shouldAllowChatPagination({ didUserScroll: true, hasMore: true, displayRowCount: 0 }),
      false,
    );
    assert.equal(
      shouldAllowChatPagination({ didUserScroll: true, hasMore: true, displayRowCount: 10 }),
      true,
    );
  });

  it('suspends visible-position anchoring while an unscrolled direct tail owns the viewport', () => {
    assert.equal(
      shouldSuspendVisibleContentAnchoringForTailOpen({
        shouldPromoteLatestTail: true,
        shouldMaintainTail: true,
        didUserScroll: false,
      }),
      true,
    );
    assert.equal(
      shouldSuspendVisibleContentAnchoringForTailOpen({
        shouldPromoteLatestTail: false,
        shouldMaintainTail: true,
        didUserScroll: false,
      }),
      false,
    );
    assert.equal(
      shouldSuspendVisibleContentAnchoringForTailOpen({
        shouldPromoteLatestTail: true,
        shouldMaintainTail: true,
        didUserScroll: true,
      }),
      false,
    );
    assert.equal(
      shouldSuspendVisibleContentAnchoringForTailOpen({
        shouldPromoteLatestTail: true,
        shouldMaintainTail: false,
        didUserScroll: false,
      }),
      false,
    );
  });

  it('holds an unscrolled activity land, and follows the tail after a send', () => {
    assert.equal(
      shouldRestoreThreadVisiblePosition({
        hasRouteAnchor: true,
        didUserScroll: false,
        isFollowingTail: true,
      }),
      false,
    );
    assert.equal(
      shouldRestoreThreadVisiblePosition({
        hasRouteAnchor: true,
        didUserScroll: false,
        isFollowingTail: false,
      }),
      true,
    );
    assert.equal(
      shouldRestoreThreadVisiblePosition({
        hasRouteAnchor: false,
        didUserScroll: false,
        isFollowingTail: true,
      }),
      false,
    );
    assert.equal(
      shouldRestoreThreadVisiblePosition({
        hasRouteAnchor: false,
        didUserScroll: false,
        isFollowingTail: false,
      }),
      false,
    );
    assert.equal(
      shouldRestoreThreadVisiblePosition({
        hasRouteAnchor: true,
        didUserScroll: true,
        isFollowingTail: false,
      }),
      true,
    );
  });

  it('does not re-run thread landing after a send or a confirmed land', () => {
    assert.equal(
      shouldKeepThreadLandingScroll({
        hasRouteMessageId: true,
        didUserScroll: false,
        isFollowingTail: false,
        isLandingConfirmed: false,
      }),
      true,
    );
    assert.equal(
      shouldKeepThreadLandingScroll({
        hasRouteMessageId: true,
        didUserScroll: false,
        isFollowingTail: true,
        isLandingConfirmed: false,
      }),
      false,
    );
    assert.equal(
      shouldKeepThreadLandingScroll({
        hasRouteMessageId: true,
        didUserScroll: false,
        isFollowingTail: false,
        isLandingConfirmed: true,
      }),
      false,
    );
    assert.equal(
      shouldKeepThreadLandingScroll({
        hasRouteMessageId: true,
        didUserScroll: true,
        isFollowingTail: false,
        isLandingConfirmed: false,
      }),
      false,
    );
  });

  it('does not treat an unmeasured activity land as missing, then accepts the row', () => {
    assert.equal(
      resolveAnchorLandingPass({
        isTargetVisible: false,
        isListReady: false,
        passes: 20,
      }),
      'accept',
    );
    assert.equal(
      resolveAnchorLandingPass({
        isTargetVisible: false,
        isListReady: false,
        passes: 0,
      }),
      'wait',
    );
    assert.equal(
      resolveAnchorLandingPass({
        isTargetVisible: true,
        isListReady: true,
        passes: 0,
      }),
      'confirm',
    );
    assert.equal(
      resolveAnchorLandingPass({
        isTargetVisible: false,
        isListReady: true,
        passes: 0,
      }),
      'retry',
    );
    assert.equal(
      resolveAnchorLandingPass({
        isTargetVisible: false,
        isListReady: true,
        passes: 8,
      }),
      'accept',
    );
  });

  it('holds the composer only while shimmer is showing, and never on a terminal error', () => {
    assert.equal(
      shouldHoldChatComposer({
        shouldShowOpenPlaceholder: true,
        hasTerminalOpenError: false,
      }),
      true,
    );
    assert.equal(
      shouldHoldChatComposer({
        shouldShowOpenPlaceholder: false,
        hasTerminalOpenError: false,
      }),
      false,
    );
    assert.equal(
      shouldHoldChatComposer({
        shouldShowOpenPlaceholder: true,
        hasTerminalOpenError: true,
      }),
      false,
    );
    assert.equal(
      shouldHoldChatComposer({
        shouldShowOpenPlaceholder: false,
        hasTerminalOpenError: true,
      }),
      false,
    );
  });

  it('preserves unchanged message rows that wrap the same immutable paint object', () => {
    const paint = { conversationId: 'conversation' } as ChatPaintRow;
    assert.equal(areChatRowsEqual(createMessageRow(paint), createMessageRow(paint)), true);
  });

  it('refreshes a message row when its paint object changes', () => {
    const previous = { conversationId: 'conversation' } as ChatPaintRow;
    const next = { conversationId: 'conversation' } as ChatPaintRow;
    assert.equal(areChatRowsEqual(createMessageRow(previous), createMessageRow(next)), false);
  });

  it('keeps attachment messages in a stable semantic recycling pool', () => {
    const mediaRow = createMessageRow({
      conversationId: 'media-conversation',
      estimatedHeight: 320,
      mediaPlaceholder: { mediaKind: 'image' },
      rowType: 'media',
    } as unknown as ChatPaintRow);

    assert.equal(getChatRowItemType(mediaRow), 'media');
  });

  it('keeps emoji and Read more bodies in their own recycling pools', () => {
    const emojiRow = createMessageRow({
      conversationId: 'emoji-conversation',
      rowType: 'message',
      body: { customEmojiIds: ['wave'] },
      collapse: { isCollapsible: false },
    } as unknown as ChatPaintRow);
    const collapseRow = createMessageRow({
      conversationId: 'collapse-conversation',
      rowType: 'message',
      body: { customEmojiIds: [] },
      collapse: { isCollapsible: true, collapsedLines: 12 },
    } as unknown as ChatPaintRow);
    const plainRow = createMessageRow({
      conversationId: 'plain-conversation',
      rowType: 'message',
      body: { customEmojiIds: [] },
      collapse: { isCollapsible: false },
    } as unknown as ChatPaintRow);

    assert.equal(getChatRowItemType(emojiRow), 'message-emoji');
    assert.equal(getChatRowItemType(collapseRow), 'message-collapse');
    assert.equal(getChatRowItemType(plainRow), 'message');
  });

  it('detects duplicate render keys before they reach the recycled list', () => {
    const row = createMessageRow({ conversationId: 'duplicate' } as ChatPaintRow);
    assert.deepEqual(getDuplicateChatRowIds([row, row]), ['duplicate']);
  });

  it('dedupes mobile conversation input by render key and explicitly keeps the server row', () => {
    const serverRow = { conversationId: 'same', createdAt: 200, source: 'server' };
    const pendingRow = {
      conversationId: 'same',
      createdAt: 200,
      source: 'pending',
      initial_message_md: serializeInitialMessageMd({
        messageId: 'message-same',
        conversationId: 'same',
        senderId: 'sender',
        content: 'pending',
        msgType: MessageType.USER,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        showInChannel: false,
        visibleTo: null,
        createdAt: 200,
        metadata: null,
        nudgeCount: null,
        isSent: false,
        reactions_md: null,
        link_preview_md: null,
        childConversationId: null,
      }),
    };
    const earlierRow = { conversationId: 'earlier', createdAt: 100, source: 'server' };

    const normalized = dedupeAndSortChatConversations([pendingRow, serverRow, earlierRow]);

    assert.deepEqual(
      normalized.map(row => row.conversationId),
      ['earlier', 'same'],
    );
    assert.equal(normalized[1], serverRow);
    assert.deepEqual(getDuplicateChatConversationIds([serverRow, pendingRow]), ['same']);
  });

  it('never conceals an already revealed list for the same open identity', () => {
    assert.equal(
      shouldConcealChatListForOpenIdentity({
        identityKey: 'channel-a',
        revealedIdentityKey: 'channel-a',
        shouldBlockListReveal: true,
        shouldWaitForRevealSettle: true,
      }),
      false,
    );
  });

  it('applies the reveal gate again when the open identity changes', () => {
    assert.equal(
      shouldConcealChatListForOpenIdentity({
        identityKey: 'channel-b',
        revealedIdentityKey: 'channel-a',
        shouldBlockListReveal: true,
        shouldWaitForRevealSettle: false,
      }),
      true,
    );
  });

  it('picks the newest pending conversation as the send tail', () => {
    assert.equal(getLatestPendingConversationId([]), null);
    assert.equal(
      getLatestPendingConversationId([
        { conversationId: 'older', timestamp: 10 },
        { conversationId: 'newer', timestamp: 20 },
        { conversationId: 'same-time', timestamp: 20 },
      ]),
      'same-time',
    );
  });

  it('claims the tail only for a newer in-session send, not leftover pending', () => {
    assert.equal(
      resolveLocalSendTailTransition({
        hasObserved: false,
        previousId: null,
        previousTimestamp: 0,
        nextId: 'leftover',
        nextTimestamp: 10,
      }),
      'observe',
    );
    assert.equal(
      resolveLocalSendTailTransition({
        hasObserved: true,
        previousId: null,
        previousTimestamp: 0,
        nextId: 'sent',
        nextTimestamp: 20,
      }),
      'claim',
    );
    assert.equal(
      resolveLocalSendTailTransition({
        hasObserved: true,
        previousId: 'sent',
        previousTimestamp: 20,
        nextId: 'sent',
        nextTimestamp: 20,
      }),
      'ignore',
    );
    assert.equal(
      resolveLocalSendTailTransition({
        hasObserved: true,
        previousId: 'sent',
        previousTimestamp: 20,
        nextId: null,
        nextTimestamp: 0,
      }),
      'release',
    );
    assert.equal(
      resolveLocalSendTailTransition({
        hasObserved: true,
        previousId: 'sent',
        previousTimestamp: 20,
        nextId: 'older-failed',
        nextTimestamp: 10,
      }),
      'observe',
    );
    assert.equal(
      resolveLocalSendTailTransition({
        hasObserved: true,
        previousId: 'first',
        previousTimestamp: 20,
        nextId: 'second',
        nextTimestamp: 21,
      }),
      'claim',
    );
  });

  it('stops unioning cache rows once the live window is authoritative', () => {
    const cacheRows = [
      { conversationId: 'kept', createdAt: 1 },
      { conversationId: 'deleted', createdAt: 2 },
    ];
    const liveRows = [{ conversationId: 'kept', createdAt: 1 }];
    assert.deepEqual(
      selectChatListFetchedRows({
        cacheRows,
        liveRows,
        isLiveWindowAuthoritative: false,
      }).map(row => row.conversationId),
      ['kept', 'deleted'],
    );
    assert.deepEqual(
      selectChatListFetchedRows({
        cacheRows,
        liveRows,
        isLiveWindowAuthoritative: true,
      }).map(row => row.conversationId),
      ['kept'],
    );
  });

  it('releases a session-send overlay after that row has been seen live and then deleted', () => {
    assert.equal(
      shouldReleaseSessionSendOverlay({
        isLiveWindowAuthoritative: true,
        wasSeenInLiveWindow: true,
        isPresentInLiveWindow: false,
      }),
      true,
    );
    assert.equal(
      shouldReleaseSessionSendOverlay({
        isLiveWindowAuthoritative: true,
        wasSeenInLiveWindow: false,
        isPresentInLiveWindow: false,
      }),
      false,
    );
  });

  it('paints the queued latest tail after a local send without a shared commit API', () => {
    const fetched = [
      { conversationId: 'old-1', createdAt: 1 },
      { conversationId: 'old-2', createdAt: 2 },
    ];
    const latest = [
      { conversationId: 'new-1', createdAt: 100 },
      { conversationId: 'sent', createdAt: 102 },
    ];
    assert.deepEqual(
      selectChatListWindowWithLatest({
        fetched,
        latest,
        shouldPromoteLatest: false,
      }).map(row => row.conversationId),
      ['old-1', 'old-2'],
    );
    assert.deepEqual(
      selectChatListWindowWithLatest({
        fetched,
        latest,
        shouldPromoteLatest: true,
      }).map(row => row.conversationId),
      ['new-1', 'sent'],
    );
    assert.deepEqual(
      overlaySessionSendRow(fetched, { conversationId: 'sent', createdAt: 102 }).map(
        row => row.conversationId,
      ),
      ['old-1', 'old-2', 'sent'],
    );
  });

  it('follows the tail after a local send, then drops it once the user leaves the tail', () => {
    assert.equal(
      shouldFollowChatListTail({
        shouldMaintainTail: true,
        localSendOwnsTail: true,
        shouldAnchorToUnreadBoundary: true,
        hasRequestedAnchor: true,
      }),
      true,
    );
    assert.equal(
      shouldFollowChatListTail({
        shouldMaintainTail: false,
        localSendOwnsTail: true,
        shouldAnchorToUnreadBoundary: false,
        hasRequestedAnchor: false,
      }),
      false,
    );
    assert.equal(
      shouldFollowChatListTail({
        shouldMaintainTail: true,
        localSendOwnsTail: false,
        shouldAnchorToUnreadBoundary: true,
        hasRequestedAnchor: false,
      }),
      false,
    );
    assert.equal(
      shouldFollowChatListTail({
        shouldMaintainTail: true,
        localSendOwnsTail: false,
        shouldAnchorToUnreadBoundary: false,
        hasRequestedAnchor: false,
      }),
      true,
    );
  });

  it('skips MVCP for a local send only while the list is still following the tail', () => {
    assert.equal(
      shouldSkipChatListRestoreForLocalSend({
        localSendOwnsTail: true,
        shouldMaintainTail: true,
      }),
      true,
    );
    assert.equal(
      shouldSkipChatListRestoreForLocalSend({
        localSendOwnsTail: true,
        shouldMaintainTail: false,
      }),
      false,
    );
    assert.equal(
      shouldSkipChatListRestoreForLocalSend({
        localSendOwnsTail: false,
        shouldMaintainTail: true,
      }),
      false,
    );
  });

  it('retries send-scroll until the painted row exists, then stops', () => {
    assert.equal(shouldRetrySendScrollUntilReady(false, 0), true);
    assert.equal(shouldRetrySendScrollUntilReady(true, 0), false);
    assert.equal(shouldRetrySendScrollUntilReady(false, MAX_SEND_SCROLL_READY_FRAMES), false);
    assert.equal(shouldRetrySendScrollUntilReady(false, MAX_SEND_SCROLL_READY_FRAMES - 1), true);
  });
});
