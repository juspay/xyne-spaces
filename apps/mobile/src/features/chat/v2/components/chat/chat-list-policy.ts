import type { ViewStyle } from 'react-native';
import { parseInitialMessageMd } from '@xyne/shared';

import type { ChatOpenPaintSource } from '@/src/features/chat/v2/chatOpenTimingLogger';
import type { ChatRow } from '@/src/features/chat/v2/components/chat/chat-list-rows';

export type ChatOpenPhase = 'paintOnly' | 'liveHydrating' | 'liveFresh';
export type ChatOpenCase = 'seeded-target' | 'seeded-tail' | 'empty';
export type ConversationDataState = 'cache' | 'hydrating' | 'complete';

export const deriveConversationOpenState = ({
  dataState,
  hasMessages,
  isInitialLoading,
}: {
  dataState: ConversationDataState;
  hasMessages: boolean;
  isInitialLoading: boolean;
}): {
  canRenderMessages: boolean;
  openPhase: ChatOpenPhase;
  isInitialLoading: boolean;
} => {
  // A non-empty cache or live window is already useful UI. Exact placement is
  // handled by the list after rows are mounted; it must not gate first paint.
  const canRenderMessages = dataState === 'complete' || hasMessages;

  return {
    canRenderMessages,
    openPhase:
      dataState === 'cache'
        ? 'paintOnly'
        : dataState === 'complete'
          ? 'liveFresh'
          : 'liveHydrating',
    isInitialLoading: canRenderMessages ? false : isInitialLoading,
  };
};

export type ChatInitialScrollMode = 'tail' | 'target' | 'unread';

/**
 * Direct opens keep the latest tail as viewport owner while cached and live
 * windows reconcile. Priority and anchored opens preserve their target window.
 */
export const shouldPromoteLatestTailForOpen = ({
  hasPriorityMessageOpen,
  hasRouteAnchor,
}: {
  hasPriorityMessageOpen: boolean;
  hasRouteAnchor: boolean;
}): boolean => !hasPriorityMessageOpen && !hasRouteAnchor;

export type ChatTargetRow = {
  initialMessageId?: string | undefined;
  conversationId?: string | undefined;
};

export const hasChatTargetInRows = (
  rows: readonly ChatTargetRow[],
  target: { messageId?: string | undefined; conversationId?: string | undefined },
): boolean =>
  rows.some(
    row =>
      (target.messageId !== undefined && row.initialMessageId === target.messageId) ||
      (target.conversationId !== undefined && row.conversationId === target.conversationId),
  );

/**
 * Choose the opening data contract once from the local snapshot. A targetless
 * cached window is still useful context, but it must be replaced by the live
 * anchored window rather than concatenated with it.
 */
export const deriveChatOpenCase = ({
  cachedRowCount,
  hasRequestedAnchor,
  hasTargetInCachedRows,
}: {
  cachedRowCount: number;
  hasRequestedAnchor: boolean;
  hasTargetInCachedRows: boolean;
}): ChatOpenCase => {
  if (cachedRowCount === 0) return 'empty';
  if (!hasRequestedAnchor || hasTargetInCachedRows) return 'seeded-target';
  return 'seeded-tail';
};

/**
 * A targetless seed must not own the viewport for an anchored open. It is safe
 * to keep it only after the user has taken ownership, or for an unanchored
 * provisional open.
 */
export const shouldKeepSeededTailWindow = ({
  openCase,
  hasRequestedAnchor,
  hasTargetInLiveRows,
  didUserScroll,
}: {
  openCase: ChatOpenCase;
  hasRequestedAnchor: boolean;
  hasTargetInLiveRows: boolean;
  didUserScroll: boolean;
}): boolean =>
  openCase === 'seeded-tail' && (didUserScroll || (!hasRequestedAnchor && !hasTargetInLiveRows));

/**
 * Warm rows are allowed to mount without a shimmer, but their opacity stays
 * held until the single native placement owner confirms the target viewport.
 *
 * When the target is not yet in the data (`targetRowIndex === null`) but warm
 * rows exist, the surface is revealed immediately — cached rows are always
 * better than a blank shimmer. The target will scroll into view when it arrives.
 */
export const shouldHoldWarmChatPlacement = ({
  openCase,
  hasRequestedAnchor,
  targetRowIndex,
  didUserScroll,
  placementConfirmed,
}: {
  openCase: ChatOpenCase;
  hasRequestedAnchor: boolean;
  targetRowIndex: number | null;
  didUserScroll: boolean;
  placementConfirmed: boolean;
}): boolean =>
  openCase !== 'empty' &&
  hasRequestedAnchor &&
  !didUserScroll &&
  targetRowIndex !== null &&
  !placementConfirmed;

/**
 * Reveal is owned by data readiness alone: any non-zero row count (cached or
 * live) is immediately shown. Shimmer appears only when there are zero rows.
 */
export const shouldRevealWarmChatWindow = (messageCount: number): boolean => messageCount > 0;

/**
 * Hold the composer while the temporary open shimmer is showing.
 *
 * The dock stays mounted at full height so list insets, draft, and focus do
 * not jump. The painted input is withheld (off-screen + covered) until
 * shimmer ends. Permanent replacements (join / read-only) own hiding by
 * swapping children, not this gate. Terminal errors stay interactive so an
 * offline draft is not trapped.
 */
export const shouldHoldChatComposer = ({
  shouldShowOpenPlaceholder,
  hasTerminalOpenError,
}: {
  shouldShowOpenPlaceholder: boolean;
  hasTerminalOpenError: boolean;
}): boolean => shouldShowOpenPlaceholder && !hasTerminalOpenError;

/**
 * Concealment is the complement of the reveal decision: hold the list only
 * while a usable, placeable window does not exist yet. A user drag always
 * takes ownership of the viewport away from the opening sequence.
 */
export const shouldBlockChatWindowReveal = ({
  didUserScroll,
  canRevealWarmWindow,
  shouldPromoteLatestTail,
  hasRequestedAnchor,
  isWaitingForMissingRouteAnchor,
  isWaitingForAnchorPlacement = false,
  didListInitialLoadComplete,
}: {
  didUserScroll: boolean;
  canRevealWarmWindow: boolean;
  shouldPromoteLatestTail: boolean;
  hasRequestedAnchor: boolean;
  isWaitingForMissingRouteAnchor: boolean;
  isWaitingForAnchorPlacement?: boolean;
  didListInitialLoadComplete: boolean;
}): boolean =>
  !didUserScroll &&
  !canRevealWarmWindow &&
  ((shouldPromoteLatestTail && !didListInitialLoadComplete) ||
    (hasRequestedAnchor &&
      (isWaitingForMissingRouteAnchor ||
        isWaitingForAnchorPlacement ||
        !didListInitialLoadComplete)));

/**
 * A linked channel must not fall back to showing whichever rows happen to be
 * loaded after the bounded expansion budget is exhausted. Once there is no
 * cursor left, or the budget is spent, the caller owns a terminal surface after
 * its bounded sync wait instead of revealing an unrelated viewport.
 */
export const shouldShowMissingChatAnchor = ({
  hasRequestedAnchor,
  isLinkResolving,
  hasTargetRow,
  openPhase,
  hasMoreBefore,
  hasMoreAfter,
  expansionPasses,
  maxExpansionPasses,
  hasWaitTimedOut = false,
}: {
  hasRequestedAnchor: boolean;
  isLinkResolving: boolean;
  hasTargetRow: boolean;
  openPhase: ChatOpenPhase;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  expansionPasses: number;
  maxExpansionPasses: number;
  hasWaitTimedOut?: boolean;
}): boolean =>
  hasRequestedAnchor &&
  !isLinkResolving &&
  !hasTargetRow &&
  openPhase === 'liveFresh' &&
  hasWaitTimedOut &&
  ((!hasMoreBefore && !hasMoreAfter) || expansionPasses >= maxExpansionPasses);

/**
 * Keep data-change MVCP active for the entire unscrolled lifetime of an
 * anchored open. Confirming the target records landing, but it must not hand
 * the viewport to another owner; only a deliberate user drag does that.
 */
export const shouldRestoreAnchoredOpenPosition = ({
  hasRequestedAnchor,
  didUserScroll,
}: {
  hasRequestedAnchor: boolean;
  didUserScroll: boolean;
}): boolean => hasRequestedAnchor && !didUserScroll;

export type ChatViewportAnchor = {
  direction: 'forward' | 'backward';
  conversationId: string;
  createdAt: number;
};

export const areChatViewportAnchorsEqual = (
  previous: ChatViewportAnchor | null,
  next: ChatViewportAnchor | null,
): boolean =>
  previous === next ||
  (previous !== null &&
    next !== null &&
    previous.conversationId === next.conversationId &&
    previous.createdAt === next.createdAt &&
    previous.direction === next.direction);

/**
 * Pagination is meaningful only after the list has rows and the user owns the
 * viewport. This prevents an empty initial list from starting a competing page
 * request from a native reached callback.
 */
export const shouldAllowChatPagination = ({
  didUserScroll,
  hasMore,
  displayRowCount,
}: {
  didUserScroll: boolean;
  hasMore: boolean;
  displayRowCount: number;
}): boolean => didUserScroll && hasMore && displayRowCount > 0;

/**
 * During a direct open, `initialScrollAtEnd` and `maintainScrollAtEnd` own the
 * tail. Do not let MVCP preserve an intermediate row until the user takes over
 * or explicitly leaves tail-following mode.
 */
export const shouldSuspendVisibleContentAnchoringForTailOpen = ({
  shouldPromoteLatestTail,
  shouldMaintainTail,
  didUserScroll,
}: {
  shouldPromoteLatestTail: boolean;
  shouldMaintainTail: boolean;
  didUserScroll: boolean;
}): boolean => shouldPromoteLatestTail && shouldMaintainTail && !didUserScroll;

/**
 * Thread viewport owner, matching the channel list: `maintainScrollAtEnd`
 * owns the tail; MVCP holds an unscrolled activity/deeplink land. Only a
 * user drag transfers ownership. Pinning restore to the parent index during
 * landing made composer/keyboard layout yank a tail reply back to the top.
 */
export const shouldRestoreThreadVisiblePosition = ({
  hasRouteAnchor,
  didUserScroll,
  isFollowingTail,
}: {
  hasRouteAnchor: boolean;
  didUserScroll: boolean;
  isFollowingTail: boolean;
}): boolean => {
  if (isFollowingTail) return false;
  if (hasRouteAnchor && !didUserScroll) return true;
  return didUserScroll;
};

/**
 * Landing must run once per target index. Composer resize and a new reply must
 * not rebuild a scroll-to-parent, but a later row for the same open (cache →
 * live thread) must be allowed to land again.
 */
export const shouldKeepThreadLandingScroll = ({
  hasRouteMessageId,
  didUserScroll,
  isFollowingTail,
  isLandingConfirmed,
}: {
  hasRouteMessageId: boolean;
  didUserScroll: boolean;
  isFollowingTail: boolean;
  isLandingConfirmed: boolean;
}): boolean => hasRouteMessageId && !didUserScroll && !isFollowingTail && !isLandingConfirmed;

export const MAX_SEND_SCROLL_READY_FRAMES = 90;

export const shouldRetrySendScrollUntilReady = (
  isReady: boolean,
  framesElapsed: number,
  maxFrames: number = MAX_SEND_SCROLL_READY_FRAMES,
): boolean => !isReady && framesElapsed < maxFrames;

export const getLatestPendingSend = (
  pending: readonly { conversationId: string; timestamp: number }[],
): { conversationId: string; timestamp: number } | null => {
  if (pending.length === 0) return null;
  let latest = pending[0]!;
  for (const entry of pending) {
    if (entry.timestamp >= latest.timestamp) latest = entry;
  }
  return { conversationId: latest.conversationId, timestamp: latest.timestamp };
};

export const getLatestPendingConversationId = (
  pending: readonly { conversationId: string; timestamp: number }[],
): string | null => getLatestPendingSend(pending)?.conversationId ?? null;

/**
 * First observation of leftover pending must not steal unread/deeplink landing.
 * A later newer pending id is an in-session send. Falling back to an older
 * leftover after the latest send confirms must not re-claim the tail.
 */
export const resolveLocalSendTailTransition = ({
  hasObserved,
  previousId,
  previousTimestamp,
  nextId,
  nextTimestamp,
}: {
  hasObserved: boolean;
  previousId: string | null;
  previousTimestamp: number;
  nextId: string | null;
  nextTimestamp: number;
}): 'observe' | 'release' | 'ignore' | 'claim' => {
  if (!hasObserved) return 'observe';
  if (nextId === null) return 'release';
  if (nextId === previousId) return 'ignore';
  if (previousId !== null && nextTimestamp < previousTimestamp) return 'observe';
  return 'claim';
};

type ChatWindowRow = { conversationId: string; createdAt: number };

const compareChatWindowRows = <T extends ChatWindowRow>(left: T, right: T): number =>
  left.createdAt - right.createdAt || left.conversationId.localeCompare(right.conversationId);

/**
 * Cache seeds the first paint. After the live window is authoritative, live
 * membership wins so hard-deleted conversations cannot be unioned back in.
 */
export const selectChatListFetchedRows = <T extends ChatWindowRow>({
  cacheRows,
  liveRows,
  isLiveWindowAuthoritative,
}: {
  cacheRows: readonly T[];
  liveRows: readonly T[];
  isLiveWindowAuthoritative: boolean;
}): readonly T[] => {
  if (isLiveWindowAuthoritative || cacheRows.length === 0) return liveRows;
  if (liveRows.length === 0) return cacheRows;

  const byId = new Map<string, T>();
  for (const row of cacheRows) byId.set(row.conversationId, row);
  for (const row of liveRows) byId.set(row.conversationId, row);
  return Array.from(byId.values()).sort(compareChatWindowRows);
};

/**
 * `useMessages` on a9de318 queues `latest` when the painted window is disjoint
 * and does not expose a commit API. After a local send or jump-to-bottom, paint
 * that queued tail instead of leaving the send in a historical page.
 */
export const selectChatListWindowWithLatest = <T extends ChatWindowRow>({
  fetched,
  latest,
  shouldPromoteLatest,
}: {
  fetched: readonly T[];
  latest: readonly T[];
  shouldPromoteLatest: boolean;
}): readonly T[] => (shouldPromoteLatest && latest.length > 0 ? latest : fetched);

/**
 * a9de318 drops pending on client-ok. Keep the in-session send visible until
 * the live window or queued latest actually contains that conversation id.
 */
export const overlaySessionSendRow = <T extends ChatWindowRow>(
  rows: readonly T[],
  sessionSendRow: T | null,
): T[] => {
  if (sessionSendRow === null) return rows as T[];
  if (rows.some(row => row.conversationId === sessionSendRow.conversationId)) {
    return rows as T[];
  }
  return [...rows, sessionSendRow].sort(compareChatWindowRows);
};

/**
 * Overlay exists to cover client-ok before the live row appears. Once that row
 * has been seen live and then disappears, the conversation was deleted.
 */
export const shouldReleaseSessionSendOverlay = ({
  isLiveWindowAuthoritative,
  wasSeenInLiveWindow,
  isPresentInLiveWindow,
}: {
  isLiveWindowAuthoritative: boolean;
  wasSeenInLiveWindow: boolean;
  isPresentInLiveWindow: boolean;
}): boolean => isLiveWindowAuthoritative && wasSeenInLiveWindow && !isPresentInLiveWindow;

/**
 * Follow the tail after a local send even on unread/deeplink opens. Only an
 * in-session send that currently owns the tail may override unread/anchor
 * landing. Pending can clear on client-ok; the owner flag must outlive that.
 */
export const shouldFollowChatListTail = ({
  shouldMaintainTail,
  localSendOwnsTail,
  shouldAnchorToUnreadBoundary,
  hasRequestedAnchor,
}: {
  shouldMaintainTail: boolean;
  localSendOwnsTail: boolean;
  shouldAnchorToUnreadBoundary: boolean;
  hasRequestedAnchor: boolean;
}): boolean =>
  shouldMaintainTail &&
  (localSendOwnsTail || (!shouldAnchorToUnreadBoundary && !hasRequestedAnchor));

/**
 * Skip MVCP only while a local send still owns the tail. Once the user drags
 * away, restore visible position so pagination into the live window does not
 * yank the viewport.
 */
export const shouldSkipChatListRestoreForLocalSend = ({
  localSendOwnsTail,
  shouldMaintainTail,
}: {
  localSendOwnsTail: boolean;
  shouldMaintainTail: boolean;
}): boolean => localSendOwnsTail && shouldMaintainTail;

/**
 * Select the initial landing contract from one opening snapshot. Pagination
 * cursors may change after this decision, but they must not change the mode
 * that LegendList is already using for the current open.
 */
export const resolveChatInitialScrollMode = ({
  hasRows,
  hasRouteAnchor,
  hasTarget,
  targetIsAtTail,
  shouldAnchorToUnreadBoundary,
}: {
  hasRows: boolean;
  hasRouteAnchor: boolean;
  hasTarget: boolean;
  targetIsAtTail: boolean;
  shouldAnchorToUnreadBoundary: boolean;
}): ChatInitialScrollMode | null => {
  if (!hasRows) return null;
  if (shouldAnchorToUnreadBoundary) return 'unread';
  if (!hasRouteAnchor) return 'tail';
  if (!hasTarget) return null;
  return targetIsAtTail ? 'tail' : 'target';
};

export const SCROLL_TO_BOTTOM_THRESHOLD = 1000;
export const NEAR_END_AUTO_SCROLL_THRESHOLD = 200;
export const FLOATING_PILL_FADE_OUT_MS = 1200;
export const FLOATING_PILL_FADE_IN_DURATION = 120;
export const FLOATING_PILL_FADE_OUT_DURATION = 240;
export const SCROLL_ROW_PROMOTION_DEBOUNCE_MS = 90;
export const SCROLL_EVENT_THROTTLE_MS = 32;
export const CHAT_OPEN_STABLE_WINDOW_MS = 500;
// Empty opens get a short terminal boundary; once rows exist, the list stays
// visible and exact-target sync continues without covering it with a loader.
export const CHAT_OPEN_SYNC_TIMEOUT_MS = 2_000;
export const MAX_REASONABLE_ROUTE_OPEN_LATENCY_MS = 30_000;
export const OPEN_PLACEHOLDER_ROW_COUNT = 4;
export const OPEN_PLACEHOLDER_ROW_KEYS = Array.from(
  { length: OPEN_PLACEHOLDER_ROW_COUNT },
  (_, index) => `open-placeholder-${index}`,
);
export const ROW_PROMOTION_NEAR_VISIBLE_BUFFER = 3;
export const UNREAD_JUMP_PREFETCH_BEFORE = 4;
export const UNREAD_JUMP_PREFETCH_AFTER = 16;
export const FALLBACK_ROW_PROMOTION_BOTTOM_WINDOW = 12;
export const ANCHOR_TOP_GAP = 12;
export const ANCHOR_MESSAGE_VIEW_POSITION = 0.5;
export const UNREAD_DIVIDER_VIEW_POSITION = 0.38;
export const UNREAD_FIRST_MESSAGE_VIEW_POSITION = 0.44;
export const UNREAD_JUMP_MAX_CORRECTION_PASSES = 24;
export const UNREAD_JUMP_POSITION_TOLERANCE_PX = 32;
export const UNREAD_JUMP_STABLE_HOLD_MS = 720;
export const CONTENT_EXPANSION_ANCHOR_RELEASE_MS = 220;
export const MAX_ROUTE_ANCHOR_EXPANSION_PASSES = 4;
export const MAX_UNREAD_BOUNDARY_EXPANSION_PASSES = 4;
export const ANCHOR_LANDING_CONFIRMATION_PASSES = 8;

/**
 * Unmeasured lists fail the first visibility check. Wait until layout exists,
 * then retry; if the budget expires with the row in data, accept the land
 * instead of treating it as missing.
 */
export type AnchorLandingPassResult = 'confirm' | 'wait' | 'retry' | 'accept';

export const resolveAnchorLandingPass = ({
  isTargetVisible,
  isListReady,
  passes,
  maxPasses = ANCHOR_LANDING_CONFIRMATION_PASSES,
}: {
  isTargetVisible: boolean;
  isListReady: boolean;
  passes: number;
  maxPasses?: number;
}): AnchorLandingPassResult => {
  if (isTargetVisible) return 'confirm';
  if (passes >= maxPasses) return 'accept';
  if (!isListReady) return 'wait';
  return 'retry';
};
export const LIST_FLEX_STYLE: ViewStyle = { flex: 1 };

type ChatConversationIdentity = {
  conversationId: string;
  createdAt: number;
  initial_message_md?: string | null | undefined;
};

const isServerAuthoritativeConversation = (conversation: ChatConversationIdentity): boolean =>
  parseInitialMessageMd(conversation.initial_message_md)?.isSent !== false;

/**
 * Last-mile mobile protection for the data handed to the paint pipeline.
 *
 * The shared pending merge currently emits live rows before pending rows. Keep
 * the first row for a duplicate render key so the live/server row wins, then
 * restore the ordering required by date rows and LegendList. This is a mobile
 * safety net; it does not replace the source merge in shared/.
 */
export const dedupeAndSortChatConversations = <T extends ChatConversationIdentity>(
  conversations: readonly T[],
): T[] => {
  const byConversationId = new Map<string, T>();
  for (const conversation of conversations) {
    const current = byConversationId.get(conversation.conversationId);
    if (
      !current ||
      (!isServerAuthoritativeConversation(current) &&
        isServerAuthoritativeConversation(conversation))
    ) {
      byConversationId.set(conversation.conversationId, conversation);
    }
  }

  return Array.from(byConversationId.values()).sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.conversationId.localeCompare(right.conversationId),
  );
};

export const getDuplicateChatConversationIds = <
  T extends Pick<ChatConversationIdentity, 'conversationId'>,
>(
  conversations: readonly T[],
): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const conversation of conversations) {
    if (seen.has(conversation.conversationId)) duplicates.add(conversation.conversationId);
    seen.add(conversation.conversationId);
  }
  return [...duplicates];
};

export type ChatRowItemType =
  | 'date'
  | 'unread-divider'
  | 'message'
  | 'message-emoji'
  | 'message-collapse'
  | 'media'
  | 'system'
  | 'ticket';

type ChatPaintMessageItemType = Extract<
  ChatRowItemType,
  'message' | 'message-emoji' | 'message-collapse'
>;

/**
 * Recycle pools for message bodies that own native hosts (md4c / emoji images).
 * Mixing those with plain Text rows is what glitches while scrolling older messages.
 */
export const getChatPaintMessageItemType = (paint: {
  body?: { customEmojiIds?: readonly string[] } | undefined;
  collapse?: { isCollapsible?: boolean } | undefined;
}): ChatPaintMessageItemType => {
  if ((paint.body?.customEmojiIds?.length ?? 0) > 0) return 'message-emoji';
  if (paint.collapse?.isCollapsible) return 'message-collapse';
  return 'message';
};

export const getDuplicateChatRowIds = (rows: readonly ChatRow[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) duplicates.add(row.id);
    seen.add(row.id);
  }
  return [...duplicates];
};

// Pool identity is semantic and immutable. Dynamic content changes should be
// handled by measurement, not by moving a mounted row between size buckets.
export const getChatRowItemType = (item: ChatRow): ChatRowItemType => {
  if (item.type === 'date') return 'date';
  if (item.type === 'unread-divider') return 'unread-divider';
  const paint = item.paint;
  if (paint.rowType === 'system') return 'system';
  if (paint.ticketPreview) return 'ticket';
  if (paint.mediaPlaceholder) return 'media';
  return getChatPaintMessageItemType(paint);
};

export const keyExtractChatRow = (item: ChatRow): string => item.id;

export const shouldConcealChatListForOpenIdentity = ({
  identityKey,
  revealedIdentityKey,
  shouldBlockListReveal,
  shouldWaitForRevealSettle,
}: {
  identityKey: string;
  revealedIdentityKey: string | null;
  shouldBlockListReveal: boolean;
  shouldWaitForRevealSettle: boolean;
}): boolean =>
  revealedIdentityKey !== identityKey && (shouldBlockListReveal || shouldWaitForRevealSettle);

// Row wrapper objects are rebuilt when date/unread/notification overlays change. Preserve
// LegendList's measured geometry when the logical row and immutable paint object are unchanged.
export const areChatRowsEqual = (previous: ChatRow, next: ChatRow): boolean => {
  if (previous === next) return true;
  if (previous.type !== next.type || previous.id !== next.id) return false;
  if (previous.type === 'message' && next.type === 'message') {
    return previous.paint === next.paint;
  }
  if (previous.type === 'date' && next.type === 'date') {
    return previous.date === next.date;
  }
  return previous.type === 'unread-divider' && next.type === 'unread-divider';
};

export const nowMs = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export const getElapsedMs = (startedAtMs: number): number =>
  Math.max(0, Math.round(nowMs() - startedAtMs));

export const getRouteOpenLatencyMs = (
  openStartedAtMs: number | null | undefined,
): number | null => {
  if (typeof openStartedAtMs !== 'number' || !Number.isFinite(openStartedAtMs)) return null;
  const latencyMs = Math.max(0, Date.now() - openStartedAtMs);
  return latencyMs <= MAX_REASONABLE_ROUTE_OPEN_LATENCY_MS ? Math.round(latencyMs) : null;
};

export const getChatOpenPaintSource = (openPhase: ChatOpenPhase): ChatOpenPaintSource =>
  openPhase === 'liveFresh' ? 'backend' : openPhase === 'liveHydrating' ? 'local' : 'cache';

export const getUnreadJumpViewPosition = (row: ChatRow | undefined): number =>
  row?.type === 'message' ? UNREAD_FIRST_MESSAGE_VIEW_POSITION : UNREAD_DIVIDER_VIEW_POSITION;
