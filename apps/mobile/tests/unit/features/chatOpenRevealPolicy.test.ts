import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessageItem } from '@/src/components/message-composer';
import {
  deriveChatOpenCase,
  deriveConversationOpenState,
  shouldBlockChatWindowReveal,
  shouldHoldWarmChatPlacement,
  shouldKeepSeededTailWindow,
  shouldRevealWarmChatWindow,
  shouldShowMissingChatAnchor,
} from '@/src/features/chat/v2/components/chat/chat-list-policy';
import {
  isThreadTargetCached,
  mergeOpeningThreadMessages,
  shouldHoldThreadTargetWhileEmpty,
} from '@/src/features/chat/v2/components/chat/chat-thread-helpers';

const createMessage = (messageId: string, createdAt: number, source: string): MessageItem =>
  ({
    messageId,
    createdAt,
    source,
    isSent: source === 'server',
    content: `content-${messageId}`,
  }) as unknown as MessageItem;

describe('chat open reveal policy', () => {
  it('classifies the three opening cases from one local snapshot', () => {
    assert.equal(
      deriveChatOpenCase({
        cachedRowCount: 0,
        hasRequestedAnchor: true,
        hasTargetInCachedRows: false,
      }),
      'empty',
    );
    assert.equal(
      deriveChatOpenCase({
        cachedRowCount: 4,
        hasRequestedAnchor: true,
        hasTargetInCachedRows: true,
      }),
      'seeded-target',
    );
    assert.equal(
      deriveChatOpenCase({
        cachedRowCount: 4,
        hasRequestedAnchor: true,
        hasTargetInCachedRows: false,
      }),
      'seeded-tail',
    );
    assert.equal(
      deriveChatOpenCase({
        cachedRowCount: 4,
        hasRequestedAnchor: false,
        hasTargetInCachedRows: false,
      }),
      'seeded-target',
    );
  });

  it('never reveals an empty window', () => {
    assert.equal(shouldRevealWarmChatWindow(0), false);
  });

  it('reveals a tail open as soon as it has rows', () => {
    assert.equal(shouldRevealWarmChatWindow(1), true);
  });

  it('does not make a direct tail open wait for anchored placement', () => {
    assert.equal(shouldRevealWarmChatWindow(1), true);
  });

  it('reveals a seeded tail immediately even while its anchored target is being fetched', () => {
    assert.equal(shouldRevealWarmChatWindow(5), true);
  });

  it('keeps a seeded-tail dataset after the user takes viewport ownership', () => {
    assert.equal(
      shouldKeepSeededTailWindow({
        openCase: 'seeded-tail',
        hasRequestedAnchor: true,
        hasTargetInLiveRows: true,
        didUserScroll: true,
      }),
      true,
    );
    assert.equal(
      shouldKeepSeededTailWindow({
        openCase: 'seeded-tail',
        hasRequestedAnchor: true,
        hasTargetInLiveRows: true,
        didUserScroll: false,
      }),
      false,
    );
    assert.equal(
      shouldKeepSeededTailWindow({
        openCase: 'seeded-target',
        hasRequestedAnchor: true,
        hasTargetInLiveRows: false,
        didUserScroll: true,
      }),
      false,
    );
    assert.equal(
      shouldKeepSeededTailWindow({
        openCase: 'seeded-tail',
        hasRequestedAnchor: true,
        hasTargetInLiveRows: false,
        didUserScroll: false,
      }),
      false,
    );
  });

  it('reveals an anchored open as soon as rows exist', () => {
    assert.equal(shouldRevealWarmChatWindow(1), true);
  });

  it('reveals provisional latest rows for an anchored open when rows exist', () => {
    assert.equal(shouldRevealWarmChatWindow(6), true);
  });

  it('does not put a second shimmer over a warm target while native placement confirms', () => {
    assert.equal(shouldRevealWarmChatWindow(1), true);
  });

  it('reveals an unanchored provisional window before the query completes', () => {
    assert.equal(shouldRevealWarmChatWindow(6), true);
  });

  it('lets a user drag or an already-revealable window take ownership over blocking', () => {
    assert.equal(
      shouldBlockChatWindowReveal({
        didUserScroll: true,
        canRevealWarmWindow: false,
        shouldPromoteLatestTail: true,
        hasRequestedAnchor: false,
        isWaitingForMissingRouteAnchor: true,
        didListInitialLoadComplete: false,
      }),
      false,
    );
    assert.equal(
      shouldBlockChatWindowReveal({
        didUserScroll: false,
        canRevealWarmWindow: true,
        shouldPromoteLatestTail: false,
        hasRequestedAnchor: true,
        isWaitingForMissingRouteAnchor: true,
        didListInitialLoadComplete: false,
      }),
      false,
    );
  });

  it('holds warm rows without showing a second shimmer until placement confirms', () => {
    assert.equal(
      shouldHoldWarmChatPlacement({
        openCase: 'seeded-target',
        hasRequestedAnchor: true,
        targetRowIndex: 4,
        didUserScroll: false,
        placementConfirmed: false,
      }),
      true,
    );
    assert.equal(
      shouldHoldWarmChatPlacement({
        openCase: 'seeded-target',
        hasRequestedAnchor: true,
        targetRowIndex: 4,
        didUserScroll: true,
        placementConfirmed: false,
      }),
      false,
    );
    assert.equal(
      shouldHoldWarmChatPlacement({
        openCase: 'empty',
        hasRequestedAnchor: true,
        targetRowIndex: 4,
        didUserScroll: false,
        placementConfirmed: false,
      }),
      false,
    );
  });

  it('does not conceal warm rows when the target has not arrived yet', () => {
    assert.equal(
      shouldHoldWarmChatPlacement({
        openCase: 'seeded-tail',
        hasRequestedAnchor: true,
        targetRowIndex: null,
        didUserScroll: false,
        placementConfirmed: false,
      }),
      false,
    );
  });

  it('blocks a tail open until the list finishes its initial load', () => {
    assert.equal(
      shouldBlockChatWindowReveal({
        didUserScroll: false,
        canRevealWarmWindow: false,
        shouldPromoteLatestTail: true,
        hasRequestedAnchor: false,
        isWaitingForMissingRouteAnchor: false,
        didListInitialLoadComplete: false,
      }),
      true,
    );
    assert.equal(
      shouldBlockChatWindowReveal({
        didUserScroll: false,
        canRevealWarmWindow: false,
        shouldPromoteLatestTail: true,
        hasRequestedAnchor: false,
        isWaitingForMissingRouteAnchor: false,
        didListInitialLoadComplete: true,
      }),
      false,
    );
  });

  it('blocks an anchored open while waiting for a missing route anchor or the initial load', () => {
    assert.equal(
      shouldBlockChatWindowReveal({
        didUserScroll: false,
        canRevealWarmWindow: false,
        shouldPromoteLatestTail: false,
        hasRequestedAnchor: true,
        isWaitingForMissingRouteAnchor: true,
        didListInitialLoadComplete: true,
      }),
      true,
    );
    assert.equal(
      shouldBlockChatWindowReveal({
        didUserScroll: false,
        canRevealWarmWindow: false,
        shouldPromoteLatestTail: false,
        hasRequestedAnchor: true,
        isWaitingForMissingRouteAnchor: false,
        didListInitialLoadComplete: false,
      }),
      true,
    );
    assert.equal(
      shouldBlockChatWindowReveal({
        didUserScroll: false,
        canRevealWarmWindow: false,
        shouldPromoteLatestTail: false,
        hasRequestedAnchor: true,
        isWaitingForMissingRouteAnchor: false,
        didListInitialLoadComplete: true,
      }),
      false,
    );
    assert.equal(
      shouldBlockChatWindowReveal({
        didUserScroll: false,
        canRevealWarmWindow: false,
        shouldPromoteLatestTail: false,
        hasRequestedAnchor: true,
        isWaitingForMissingRouteAnchor: false,
        isWaitingForAnchorPlacement: true,
        didListInitialLoadComplete: true,
      }),
      true,
    );
  });

  it('makes an exhausted missing anchor terminal instead of revealing unrelated rows', () => {
    assert.equal(
      shouldShowMissingChatAnchor({
        hasRequestedAnchor: true,
        isLinkResolving: false,
        hasTargetRow: false,
        openPhase: 'liveFresh',
        hasMoreBefore: true,
        hasMoreAfter: false,
        expansionPasses: 4,
        maxExpansionPasses: 4,
        hasWaitTimedOut: true,
      }),
      true,
    );
    assert.equal(
      shouldShowMissingChatAnchor({
        hasRequestedAnchor: true,
        isLinkResolving: false,
        hasTargetRow: false,
        openPhase: 'liveFresh',
        hasMoreBefore: false,
        hasMoreAfter: false,
        expansionPasses: 0,
        maxExpansionPasses: 4,
        hasWaitTimedOut: true,
      }),
      true,
    );
    assert.equal(
      shouldShowMissingChatAnchor({
        hasRequestedAnchor: true,
        isLinkResolving: false,
        hasTargetRow: false,
        openPhase: 'liveFresh',
        hasMoreBefore: false,
        hasMoreAfter: false,
        expansionPasses: 4,
        maxExpansionPasses: 4,
      }),
      false,
    );
  });

  it('does not make a missing anchor terminal while resolution, sync, or expansion is still active', () => {
    const base = {
      hasRequestedAnchor: true,
      hasTargetRow: false,
      openPhase: 'liveFresh' as const,
      expansionPasses: 0,
      maxExpansionPasses: 4,
      hasWaitTimedOut: true,
    };

    assert.equal(
      shouldShowMissingChatAnchor({
        ...base,
        isLinkResolving: true,
        hasMoreBefore: false,
        hasMoreAfter: false,
      }),
      false,
    );
    assert.equal(
      shouldShowMissingChatAnchor({
        ...base,
        isLinkResolving: false,
        openPhase: 'liveHydrating',
        hasMoreBefore: false,
        hasMoreAfter: false,
      }),
      false,
    );
    assert.equal(
      shouldShowMissingChatAnchor({
        ...base,
        isLinkResolving: false,
        hasWaitTimedOut: false,
        hasMoreBefore: false,
        hasMoreAfter: false,
      }),
      false,
    );
    assert.equal(
      shouldShowMissingChatAnchor({
        ...base,
        isLinkResolving: false,
        hasMoreBefore: true,
        hasMoreAfter: false,
        expansionPasses: 3,
      }),
      false,
    );
  });

  it('never shows a missing-anchor state after the exact target is present', () => {
    assert.equal(
      shouldShowMissingChatAnchor({
        hasRequestedAnchor: true,
        isLinkResolving: false,
        hasTargetRow: true,
        openPhase: 'liveFresh',
        hasMoreBefore: false,
        hasMoreAfter: false,
        expansionPasses: 4,
        maxExpansionPasses: 4,
        hasWaitTimedOut: true,
      }),
      false,
    );
  });

  it('does not reveal unrelated rows after an anchored target times out', () => {
    assert.equal(
      shouldShowMissingChatAnchor({
        hasRequestedAnchor: true,
        isLinkResolving: false,
        hasTargetRow: false,
        openPhase: 'liveFresh',
        hasMoreBefore: false,
        hasMoreAfter: false,
        expansionPasses: 4,
        maxExpansionPasses: 4,
        hasWaitTimedOut: true,
      }),
      true,
    );
  });

  it('lets any usable rows render before the query completes', () => {
    const provisional = deriveConversationOpenState({
      dataState: 'hydrating',
      hasMessages: true,
      isInitialLoading: true,
    });
    assert.equal(provisional.canRenderMessages, true);
  });

  it('lets cached notification rows paint while the live query hydrates', () => {
    assert.equal(
      deriveConversationOpenState({
        dataState: 'hydrating',
        hasMessages: true,
        isInitialLoading: true,
      }).canRenderMessages,
      true,
    );
  });

  it('never lets a warm anchor seed render messages that do not exist', () => {
    assert.equal(
      deriveConversationOpenState({
        dataState: 'hydrating',
        hasMessages: false,
        isInitialLoading: true,
      }).canRenderMessages,
      false,
    );
  });

  // isThreadTargetCached(messages, undefined) === true is load-bearing for
  // ChatThreadScreen's surface gate: an anchor-free thread open has no target
  // to wait for, so the gate must never hold it back behind a missing message.
  it('treats a thread without a requested target as already cached', () => {
    assert.equal(isThreadTargetCached([], undefined), true);
  });

  it('requires the exact target message before treating a cached thread as ready', () => {
    const parent = createMessage('parent', 100, 'server');
    const reply = createMessage('reply', 200, 'server');

    assert.equal(isThreadTargetCached([], 'reply'), false);
    assert.equal(isThreadTargetCached([parent], 'reply'), false);
    assert.equal(isThreadTargetCached([parent, reply], 'reply'), true);
  });

  it('retains the cached opening window until the live thread query completes', () => {
    const openingParent = createMessage('parent', 100, 'server');
    const openingTarget = createMessage('reply', 200, 'server');
    const liveParent = createMessage('parent', 100, 'server');
    const liveTarget = createMessage('reply', 200, 'server');

    const merged = mergeOpeningThreadMessages({
      openingMessages: [openingParent, openingTarget],
      liveMessages: [liveParent, liveTarget],
      messageId: 'reply',
      liveQueryComplete: false,
      threadId: 'thread-1',
    });

    assert.deepEqual(
      merged.map(message => message.messageId),
      ['parent', 'reply'],
    );
  });

  it('switches to the live thread result once the query completes', () => {
    const openingParent = createMessage('parent', 100, 'server');
    const openingTarget = createMessage('reply', 200, 'server');
    const liveParent = createMessage('parent', 100, 'server');
    const liveTarget = createMessage('reply', 200, 'server');

    const merged = mergeOpeningThreadMessages({
      openingMessages: [openingParent, openingTarget],
      liveMessages: [liveParent, liveTarget],
      messageId: 'reply',
      liveQueryComplete: true,
      threadId: 'thread-1',
    });

    assert.deepEqual(merged, [liveParent, liveTarget]);
  });

  it('falls back to the live result when the opening window never had the target', () => {
    const openingParent = createMessage('parent', 100, 'server');
    const liveParent = createMessage('parent', 100, 'server');
    const liveTarget = createMessage('reply', 200, 'server');

    const merged = mergeOpeningThreadMessages({
      openingMessages: [openingParent],
      liveMessages: [liveParent, liveTarget],
      messageId: 'reply',
      liveQueryComplete: false,
      threadId: 'thread-1',
    });

    assert.deepEqual(merged, [liveParent, liveTarget]);
  });

  it('falls back to the live result when there is no requested target at all', () => {
    const openingParent = createMessage('parent', 100, 'server');
    const liveParent = createMessage('parent', 100, 'server');

    const merged = mergeOpeningThreadMessages({
      openingMessages: [openingParent],
      liveMessages: [liveParent],
      messageId: undefined,
      liveQueryComplete: false,
      threadId: 'thread-1',
    });

    assert.deepEqual(merged, [liveParent]);
  });
});

/**
 * A notification open whose warm window was restored from disk. This composes
 * the same policy calls chat-thread.tsx makes, so the three guarantees the
 * surface owes a notification tap are pinned in one place: paint the complete
 * thread, never shimmer over data we already hold, and land on the notified
 * message rather than wherever the partial live window happens to start.
 */
describe('notification open with a restored warm window', () => {
  const threadId = 'thread-1';
  const notifiedId = 'notified-reply';
  // The push warms the complete thread; Zero is still materializing and can
  // only supply the message that just synced.
  const warmWindow = [
    createMessage('reply-1', 100, 'server'),
    createMessage('reply-2', 200, 'server'),
    createMessage(notifiedId, 300, 'server'),
  ];
  const partialLiveWindow = [createMessage(notifiedId, 300, 'server')];

  const openCase = deriveChatOpenCase({
    cachedRowCount: warmWindow.length,
    hasRequestedAnchor: true,
    hasTargetInCachedRows: isThreadTargetCached(warmWindow, notifiedId),
  });

  it('classifies the restored window as a seeded target', () => {
    assert.equal(openCase, 'seeded-target');
  });

  it('paints the complete thread instead of the partial live window', () => {
    const merged = mergeOpeningThreadMessages({
      openingMessages: warmWindow,
      liveMessages: partialLiveWindow,
      messageId: notifiedId,
      liveQueryComplete: false,
      threadId,
    });

    assert.equal(merged.length, warmWindow.length);
    assert.deepEqual(
      merged.map(message => message.messageId),
      ['reply-1', 'reply-2', notifiedId],
    );
  });

  it('never shows the skeleton while the warm window is on screen', () => {
    const targetRowIndex = warmWindow.findIndex(message => message.messageId === notifiedId);
    const canReveal = shouldRevealWarmChatWindow(warmWindow.length);
    // Placement is still pending, which is what would otherwise block reveal.
    const holdsPlacement = shouldHoldWarmChatPlacement({
      openCase,
      hasRequestedAnchor: true,
      targetRowIndex,
      didUserScroll: false,
      placementConfirmed: false,
    });

    assert.equal(canReveal, true);
    // chat-thread.tsx subtracts the placement hold from the placeholder
    // condition; holding position is not the same as having nothing to show.
    assert.equal(holdsPlacement, true);
    const showsSkeleton = !canReveal && !holdsPlacement;
    assert.equal(showsSkeleton, false);
  });

  it('holds placement until the notified row is positioned, then releases', () => {
    const targetRowIndex = warmWindow.findIndex(message => message.messageId === notifiedId);

    assert.equal(
      shouldHoldWarmChatPlacement({
        openCase,
        hasRequestedAnchor: true,
        targetRowIndex,
        didUserScroll: false,
        placementConfirmed: false,
      }),
      true,
    );
    assert.equal(
      shouldHoldWarmChatPlacement({
        openCase,
        hasRequestedAnchor: true,
        targetRowIndex,
        didUserScroll: false,
        placementConfirmed: true,
      }),
      false,
    );
  });

  it('still shows the skeleton when there genuinely is no warm data', () => {
    const emptyOpenCase = deriveChatOpenCase({
      cachedRowCount: 0,
      hasRequestedAnchor: true,
      hasTargetInCachedRows: false,
    });
    const canReveal = shouldRevealWarmChatWindow(0);
    const holdsPlacement = shouldHoldWarmChatPlacement({
      openCase: emptyOpenCase,
      hasRequestedAnchor: true,
      targetRowIndex: null,
      didUserScroll: false,
      placementConfirmed: false,
    });

    assert.equal(emptyOpenCase, 'empty');
    assert.equal(!canReveal && !holdsPlacement, true);
  });
});

/**
 * iOS cold start: the user had read this thread, killed the app, then tapped a
 * notification for a new reply that no warm window contains yet. Nothing about
 * that open justifies a skeleton — the thread is on disk and the missing reply
 * can only be newer than all of it.
 */
describe('notification open into a previously visited thread', () => {
  const threadId = 'thread-1';
  const notifiedId = 'brand-new-reply';
  const visitedWindow = [
    createMessage('reply-1', 100, 'server'),
    createMessage('reply-2', 200, 'server'),
    createMessage('reply-3', 300, 'server'),
  ];

  const paint = (liveMessages: MessageItem[], liveQueryComplete: boolean): MessageItem[] =>
    mergeOpeningThreadMessages({
      openingMessages: visitedWindow,
      liveMessages,
      messageId: notifiedId,
      liveQueryComplete,
      threadId,
    });

  /** The exact skeleton condition chat-thread.tsx evaluates for this open. */
  const showsSkeleton = (rows: MessageItem[]): boolean => {
    const hasRows = rows.length > 0;
    const isWaitingForAnchorTarget = !hasRows;
    const isResolvingDeepLink = !hasRows;
    const holdsExactTarget = shouldHoldThreadTargetWhileEmpty({
      messageId: notifiedId,
      hasWarmTarget: isThreadTargetCached(rows, notifiedId),
      hasMessages: hasRows,
      hasQueryError: false,
      didUserScroll: false,
    });
    // isSurfacePending is false because the screen has cached thread messages.
    return isWaitingForAnchorTarget || isResolvingDeepLink || holdsExactTarget;
  };

  it('paints the whole visited thread before the new reply syncs', () => {
    const rows = paint([], false);

    assert.deepEqual(
      rows.map(message => message.messageId),
      ['reply-1', 'reply-2', 'reply-3'],
    );
    assert.equal(showsSkeleton(rows), false);
  });

  it('does not let a partial live window evict the visited thread', () => {
    // Zero materializes the just-synced reply first.
    const rows = paint([createMessage(notifiedId, 400, 'server')], false);

    assert.deepEqual(
      rows.map(message => message.messageId),
      ['reply-1', 'reply-2', 'reply-3', notifiedId],
    );
    assert.equal(showsSkeleton(rows), false);
  });

  it('hands over to the settled live window once it is authoritative', () => {
    const settled = [...visitedWindow, createMessage(notifiedId, 400, 'server')];
    const rows = paint(settled, true);

    assert.deepEqual(rows, settled);
    assert.equal(showsSkeleton(rows), false);
  });

  it('still shows the skeleton when there is genuinely nothing cached', () => {
    const rows = mergeOpeningThreadMessages({
      openingMessages: [],
      liveMessages: [],
      messageId: notifiedId,
      liveQueryComplete: false,
      threadId,
    });

    assert.deepEqual(rows, []);
    assert.equal(showsSkeleton(rows), true);
  });

  it('keeps the surface revealed once the notified reply lands', () => {
    const rows = paint([createMessage(notifiedId, 400, 'server')], false);
    const targetRowIndex = rows.findIndex(message => message.messageId === notifiedId);

    // Placement is what stays pending, and it only holds while unrevealed.
    assert.notEqual(targetRowIndex, -1);
    assert.equal(
      shouldHoldWarmChatPlacement({
        openCase: 'seeded-tail',
        hasRequestedAnchor: true,
        targetRowIndex,
        didUserScroll: false,
        placementConfirmed: true,
      }),
      false,
    );
  });
});

/**
 * The channel/DM half of the same cycle. A notification's target message is
 * included in the warm cache, so the normal containment check passes and
 * correct data is shown immediately — no stale flash, no skeleton.
 */
describe('notification open into a previously visited channel', () => {
  const cachedTail = [
    { initialMessageId: 'msg-1', conversationId: 'conv-1' },
    { initialMessageId: 'msg-2', conversationId: 'conv-2' },
  ];

  it('reveals a window whenever rows are present, regardless of target', () => {
    assert.equal(shouldRevealWarmChatWindow(cachedTail.length), true);
    assert.equal(shouldRevealWarmChatWindow(0), false);
  });

  it('tears down a painted window when the anchor stays unplaced', () => {
    const base = {
      hasRequestedAnchor: true,
      isLinkResolving: false,
      hasTargetRow: false,
      openPhase: 'liveFresh' as const,
      hasMoreBefore: false,
      hasMoreAfter: false,
      expansionPasses: 3,
      maxExpansionPasses: 3,
      hasWaitTimedOut: true,
    };

    assert.equal(shouldShowMissingChatAnchor(base), true);
  });
});
