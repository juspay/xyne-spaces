import type { LegendListRef } from '@legendapp/list/react-native';
import { KeyboardAwareLegendList } from '@legendapp/list/keyboard';
import {
  forwardRef,
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ChannelScopeType, type User } from '@xyne/shared';

import { isChannelQueryMember } from '@/src/hooks/useJoinableChannel';
import { useChannelById, useGetChannelUserStatus } from '@/src/hooks/useChannels';
import { haptics } from '@/src/utils/haptics';
import { DatePill, formatDatePill } from '@/src/components/chat/date-pill';
import {
  ChatRenderProvider,
  useChatRenderTokens as useChatRenderContextTokens,
} from '@/src/features/chat/v2/components/chat/message-row';
import {
  ConversationSkeleton,
  type ConversationItem,
} from '@/src/features/chat/v2/components/conversation-composer';
import {
  ChatMessageListRow,
  createRowPresentationStore,
  hasHydratableMedia,
  type RowPresentationStore,
} from '@/src/features/chat/v2/components/chat/chat-message-list-row';
import { toSharedMessagesOptions } from '@/src/features/chat/messagesOptions.types';
import { RowEntranceController } from '@/src/features/chat/v2/components/chat/chat-row-entrance-controller';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/chat-render-tokens';
import {
  findTargetRowIndex,
  getChatListEstimatedItemSize,
  getChatRowFixedSize,
  hasLoadedTimestampBoundaryCoverage,
  useChatListRows,
  type ChatRow,
  type UnreadBoundaryCursor,
} from '@/src/features/chat/v2/components/chat/chat-list-rows';
import {
  ANCHOR_MESSAGE_VIEW_POSITION,
  ANCHOR_TOP_GAP,
  areChatRowsEqual,
  CHAT_OPEN_STABLE_WINDOW_MS,
  CHAT_OPEN_SYNC_TIMEOUT_MS,
  CONTENT_EXPANSION_ANCHOR_RELEASE_MS,
  FALLBACK_ROW_PROMOTION_BOTTOM_WINDOW,
  FLOATING_PILL_FADE_IN_DURATION,
  FLOATING_PILL_FADE_OUT_DURATION,
  FLOATING_PILL_FADE_OUT_MS,
  deriveConversationOpenState,
  getChatOpenPaintSource,
  getChatRowItemType,
  getElapsedMs,
  getRouteOpenLatencyMs,
  ROW_PROMOTION_NEAR_VISIBLE_BUFFER,
  keyExtractChatRow,
  LIST_FLEX_STYLE,
  MAX_ROUTE_ANCHOR_EXPANSION_PASSES,
  NEAR_END_AUTO_SCROLL_THRESHOLD,
  nowMs,
  OPEN_PLACEHOLDER_ROW_KEYS,
  resolveChatInitialScrollMode,
  SCROLL_EVENT_THROTTLE_MS,
  SCROLL_ROW_PROMOTION_DEBOUNCE_MS,
  SCROLL_TO_BOTTOM_THRESHOLD,
  deriveChatOpenCase,
  hasChatTargetInRows,
  shouldAllowChatPagination,
  shouldBlockChatWindowReveal,
  shouldConcealChatListForOpenIdentity,
  shouldPromoteLatestTailForOpen,
  shouldRevealWarmChatWindow,
  shouldKeepSeededTailWindow,
  shouldHoldWarmChatPlacement,
  shouldShowMissingChatAnchor,
  shouldRestoreAnchoredOpenPosition,
  resolveAnchorLandingPass,
  shouldSkipChatListRestoreForLocalSend,
  shouldFollowChatListTail,
  shouldSuspendVisibleContentAnchoringForTailOpen,
  areChatViewportAnchorsEqual,
  getLatestPendingSend,
  overlaySessionSendRow,
  resolveLocalSendTailTransition,
  selectChatListFetchedRows,
  selectChatListWindowWithLatest,
  shouldReleaseSessionSendOverlay,
  type ChatViewportAnchor,
  UNREAD_DIVIDER_TOP_OFFSET,
  type ConversationDataState,
  type ChatOpenCase,
  type ChatInitialScrollMode,
  resolveUnreadPlacement,
  UNREAD_OPEN_MAX_HOLD_MS,
} from '@/src/features/chat/v2/components/chat/chat-list-policy';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';

import { ReactionsSheetHost } from './reactions-sheet-host';
import {
  prefetchMediaPreviews,
  type MediaPreviewRequest,
} from '@/src/features/chat/v2/media/mediaPreviewCache';
import { prefetchMtlsEmojiUris } from '@/src/hooks/useMtlsEmoji';
import {
  estimateCharsPerLine,
  getUnreadDividerRowHeight,
} from '@/src/features/chat/v2/paint/chatPaintSizing';
import { collectPaintEmojiIds } from '@/src/features/chat/v2/paint/chatPaintEmoji';

import { isMeasuredRowVisible } from '@/src/features/chat/v2/landing/messageLanding';
import type { ChatComposerGeometry } from '@/src/features/chat/v2/hooks/use-chat-composer-geometry';
import {
  getChannelSnapshot,
  subscribeMessages,
  useMessages,
  usePendingForChannel,
} from '@xyne/shared/messages';
import { useConversationPaintRows } from '@/src/features/chat/v2/hooks/useConversationPaintRows';
import { CHAT_KEYBOARD_SHOULD_PERSIST_TAPS } from '@/src/features/chat/v2/chatKeyboardConfig';
import {
  logChatOpenSummary,
  type ChatOpenPaintSource,
} from '@/src/features/chat/v2/chatOpenTimingLogger';
import { Event, logger } from '@/src/utils/logger';
import {
  reportActivityChatSkeletonShown,
  reportActivityListReady,
  reportActivityMessageHighlighted,
} from '@/src/observability/logging/activity/reportActivityOpenMarks';
import {
  reportNotificationListReady,
  reportNotificationMessageHighlighted,
  reportNotificationChatSkeletonShown,
} from '@/src/observability/logging/notification/reportNotificationOpenMarks';
import {
  abandonChatOpenSkeleton,
  beginChatOpenSkeleton,
  completeChatOpenSkeleton,
} from '@/src/observability/logging/chat/chatOpenSkeleton';
import { emitChatOpenSkeletonCompleted } from '@/src/observability/logging/chat/emitChatOpenSkeletonCompleted';
import {
  createDateSeparatorObservationRecorder,
  type DateSeparatorObservationRecorder,
  type DateSeparatorSurface,
} from '@/src/observability/logging/chat/emitChatDateSeparatorObserved';

type VisibleRowWindow = { start: number; end: number };
type AnchorLandingSnapshot = {
  visible: boolean;
};

const EMPTY_PAINT_ROWS: ChatPaintRow[] = [];
const EMPTY_CHAT_ROWS: ChatRow[] = [];
const EMPTY_SEED_ROWS: ReturnType<typeof getChannelSnapshot> = [];
// `initialScrollAtEnd` opts out of LegendList's 50 px visible-first cap. Keep
// the first bottom-aligned allocation equally narrow so opening a chat does not
// synchronously mount an extra 250 px of message rows.
const CHAT_LIST_DRAW_DISTANCE = 50;
const INITIAL_LIST_LOAD_FALLBACK_MS = 1500;

type ChatOpenCycleState = {
  identityKey: string;
  initialScrollMode: ChatInitialScrollMode | null;
  // Landed at the tail only because the unread hold ran out; the divider may still arrive.
  awaitsLateUnreadDivider: boolean;
  didLogFinalLivePaint: boolean;
  initialSeedRows: number | null;
  lastOpenStateSignature: string | null;
  firstVisiblePaint: {
    latencyMs: number;
    source: ChatOpenPaintSource;
  } | null;
  startedAtMs: number;
  routeOpenLatencyMs: number | null;
  cycleId: string;
};

type FloatingDateState = {
  text: string | null;
  createdAt: number | null;
  fadeOutTimer: ReturnType<typeof setTimeout> | null;
  clearTimer: ReturnType<typeof setTimeout> | null;
};

type ContentExpansionAnchorState = {
  active: boolean;
  releaseTimer: ReturnType<typeof setTimeout> | null;
};

type TailTrackingState = {
  conversationId: string | null;
  createdAt: number | null;
  autoScrollReady: boolean;
};

type ChatScrollState = {
  distanceFromBottom: number;
  isScrolledUp: boolean;
  didUserScroll: boolean;
};

type RowPromotionState = {
  richConversationIds: Set<string>;
  mediaConversationIds: Set<string>;
  lastRichPassKey: string | null;
  lastMediaPassKey: string | null;
};

const createChatOpenCycleState = (
  identityKey: string,
  openStartedAtMs: number | null | undefined,
): ChatOpenCycleState => ({
  identityKey,
  initialScrollMode: null,
  awaitsLateUnreadDivider: false,
  didLogFinalLivePaint: false,
  initialSeedRows: null,
  lastOpenStateSignature: null,
  firstVisiblePaint: null,
  startedAtMs: nowMs(),
  routeOpenLatencyMs: getRouteOpenLatencyMs(openStartedAtMs),
  cycleId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
});

export type ChatListHandle = {
  getReadCursorConversationId: () => string | undefined;
  scrollToBottom: () => void;
  scrollToEnd: (params?: { animated?: boolean }) => Promise<void>;
  hasPaintedConversation: (conversationId: string) => boolean;
  registerLocalSend: (conversationId: string) => void;
};

type ChatListProps = {
  channelId: string;
  conversationId?: string | undefined;
  messageId?: string | undefined;
  createdAt?: string | undefined;
  currentUser: User | undefined;
  channelType?: ChannelScopeType | undefined;
  liveHydrationEnabled?: boolean | undefined;
  richHydrationEnabled?: boolean | undefined;
  isNotificationOpen?: boolean | undefined;
  isLinkResolving?: boolean | undefined;
  openStartedAtMs?: number | null | undefined;
  notificationOpenKind?: string | undefined;
  entryPoint?: string | undefined;
  isUnreadOpen?: boolean | undefined;
  unreadBoundaryLastViewedAt?: number | undefined;
  unreadBoundaryLastViewedConversationId?: string | undefined;
  unreadLastActivityAt?: number | undefined;
  unreadCount?: number | undefined;
  composerGeometry: ChatComposerGeometry;
  freeze?: SharedValue<boolean> | undefined;
  keyboardOffset?: number | undefined;
  onMessagePress: (conversation: ConversationItem, paintRow: ChatPaintRow) => void;
  onMessageLongPress: (conversation: ConversationItem) => void;
  onScrolledUpChange?: ((isScrolledUp: boolean) => void) | undefined;
  onFirstLayout?: (() => void) | undefined;
  onInitialLoadComplete?: (() => void) | undefined;
  onInitialLoadStateChange?: ((state: ChatInitialLoadState) => void) | undefined;
  onOpenPlaceholderChange?: ((visible: boolean) => void) | undefined;
  onReadCursorChange?: ((conversationId: string | undefined) => void) | undefined;
};

export type ChatInitialLoadState = 'loading' | 'ready' | 'error';

const getRowPromotionPassKey = ({
  window,
  rowCount,
  sourceCount,
  promotedCount,
}: {
  window: VisibleRowWindow;
  rowCount: number;
  sourceCount: number;
  promotedCount: number;
}): string => `${window.start}:${window.end}:${rowCount}:${sourceCount}:${promotedCount}`;

const getMediaPreviewRequest = (row: ChatPaintRow): MediaPreviewRequest | null => {
  const media = row.mediaPlaceholder;
  if (!media?.previewAttachmentId || !media.previewAttachmentKind) return null;
  return {
    attachmentId: media.previewAttachmentId,
    kind: media.previewAttachmentKind,
  };
};

const UNREAD_DIVIDER_CONTAINER_STYLE: ViewStyle = {
  height: getUnreadDividerRowHeight(),
  justifyContent: 'center',
};
const UnreadMessagesDivider = memo(function UnreadMessagesDivider(): ReactElement {
  const { ambientAccentColor } = useChatRenderContextTokens();

  return (
    <View className='px-4' style={UNREAD_DIVIDER_CONTAINER_STYLE}>
      <View className='flex-row items-center gap-3'>
        <View className='h-px flex-1' style={{ backgroundColor: ambientAccentColor }} />
        <Text className='text-xs font-semibold uppercase' style={{ color: ambientAccentColor }}>
          New messages
        </Text>
        <View className='h-px flex-1' style={{ backgroundColor: ambientAccentColor }} />
      </View>
    </View>
  );
});

export const ChatList = forwardRef<ChatListHandle, ChatListProps>(function ChatList(
  {
    channelId,
    conversationId,
    messageId,
    createdAt,
    currentUser,
    channelType,
    liveHydrationEnabled,
    richHydrationEnabled,
    isNotificationOpen,
    isLinkResolving = false,
    openStartedAtMs,
    notificationOpenKind,
    entryPoint,
    isUnreadOpen,
    unreadBoundaryLastViewedAt,
    unreadBoundaryLastViewedConversationId,
    unreadLastActivityAt,
    unreadCount,
    composerGeometry,
    freeze,
    keyboardOffset,
    onMessagePress,
    onMessageLongPress,
    onScrolledUpChange,
    onFirstLayout,
    onInitialLoadComplete,
    onInitialLoadStateChange,
    onOpenPlaceholderChange,
    onReadCursorChange,
  },
  ref,
): ReactElement {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const chatRenderTokens = useChatRenderTokens(windowWidth);
  const listRef = useRef<LegendListRef>(null);
  const didMarkLayoutRef = useRef(false);
  const [didMarkLayout, setDidMarkLayout] = useState(false);
  const [didUserScroll, setDidUserScroll] = useState(false);
  // Recent and notification opens can use the latest cache window immediately;
  // linked historical windows are selected separately.
  const hasRouteAnchor = !!conversationId || !!messageId;
  const hasUnreadOpenAnchor =
    !!isUnreadOpen &&
    !hasRouteAnchor &&
    !isNotificationOpen &&
    typeof unreadBoundaryLastViewedAt === 'number' &&
    Number.isFinite(unreadBoundaryLastViewedAt) &&
    unreadBoundaryLastViewedAt > 0;
  void unreadCount;
  const unreadBoundaryCursor = useMemo<UnreadBoundaryCursor | undefined>(() => {
    if (!hasUnreadOpenAnchor) return undefined;
    return {
      lastViewedAt: unreadBoundaryLastViewedAt,
      ...(unreadBoundaryLastViewedConversationId
        ? { lastViewedConversationId: unreadBoundaryLastViewedConversationId }
        : {}),
    };
  }, [hasUnreadOpenAnchor, unreadBoundaryLastViewedAt, unreadBoundaryLastViewedConversationId]);
  const anchorTargetKey = messageId ?? conversationId ?? 'latest';
  const anchorScrollKey = `${channelId}:${anchorTargetKey}:${createdAt ?? ''}`;
  const shouldUseStableActivityOpenIdentity = entryPoint === 'activity' && hasRouteAnchor;
  const openIdentityKey = `${anchorScrollKey}:${
    shouldUseStableActivityOpenIdentity ? 'activity-target' : (openStartedAtMs ?? 'warm')
  }`;
  const openCycleStateRef = useRef<ChatOpenCycleState | null>(null);
  if (openCycleStateRef.current?.identityKey !== openIdentityKey) {
    openCycleStateRef.current = createChatOpenCycleState(openIdentityKey, openStartedAtMs);
  }
  const openCycleState = openCycleStateRef.current;
  const openCaseRef = useRef<{ identityKey: string; value: ChatOpenCase } | null>(null);
  const shouldAnchorToUnreadBoundary = hasUnreadOpenAnchor;
  // Native list identity belongs to the conversation, not its landing target.
  // Re-anchoring within a channel must retain measured row sizes; a channel switch
  // still gets a new list instance and cannot expose the previous channel's offset.
  const listInstanceKey = channelId;
  // Issuing the initial scroll and confirming measured visibility are different
  // transitions. The former prevents LegendList from re-applying an initial index;
  // the latter authorizes hydration re-anchors and landing telemetry.
  const [anchorScrollIssuedKey, setAnchorScrollIssuedKey] = useState<string | null>(null);
  const [anchorLandingConfirmedKey, setAnchorLandingConfirmedKey] = useState<string | null>(null);
  const [routeAnchorPlacementUnavailableKey, setRouteAnchorPlacementUnavailableKey] = useState<
    string | null
  >(null);
  const [missingRouteAnchorTimedOutKey, setMissingRouteAnchorTimedOutKey] = useState<string | null>(
    null,
  );
  const appliedAnchorLayoutScrollKeyRef = useRef<string | null>(null);
  const newerPageRequestCursorRef = useRef<number | null>(null);
  const scheduleAnchorLandingRef = useRef<(() => void) | null>(null);
  const anchorConfirmationFrameRef = useRef<number | null>(null);
  const anchorConfirmationPassRef = useRef<{ key: string; passes: number }>({
    key: openIdentityKey,
    passes: 0,
  });
  const missingRouteAnchorExpansionRef = useRef<{ key: string; passes: number }>({
    key: openIdentityKey,
    passes: 0,
  });
  if (anchorConfirmationPassRef.current.key !== openIdentityKey) {
    anchorConfirmationPassRef.current = { key: openIdentityKey, passes: 0 };
  }
  const chatListRevealOpacity = useSharedValue(1);
  const revealedChatListIdentityKeyRef = useRef<string | null>(null);
  const [revealedChatListIdentityKey, setRevealedChatListIdentityKey] = useState<string | null>(
    null,
  );
  const wasBlockingChatListRevealRef = useRef(false);
  const chatListRevealStyle = useAnimatedStyle(() => ({
    opacity: chatListRevealOpacity.value,
    transform: [{ translateY: (1 - chatListRevealOpacity.value) * 4 }],
  }));
  const [loadedListIdentityKey, setLoadedListIdentityKey] = useState<string | null>(null);
  const didListInitialLoadComplete = loadedListIdentityKey === openIdentityKey;
  const notifiedInitialLoadIdentityRef = useRef<string | null>(null);
  const listInstanceLoadedRef = useRef(false);
  const directTailScrollKeyRef = useRef<string | null>(null);
  const estimatedItemSizeRef = useRef<{ identityKey: string; value: number } | null>(null);
  const [shouldMaintainTail, setShouldMaintainTail] = useState(true);

  const linkedCreatedAt = useMemo(() => {
    if (!createdAt) return undefined;
    const n = Number(createdAt);
    return Number.isFinite(n) ? n : undefined;
  }, [createdAt]);
  // Any external open with conversationId + createdAt can use the server cursor
  // to load the target conversation together with its surrounding window.
  // Message-only notification payloads still use the latest cache/live path.
  const unreadLinkedCreatedAt = shouldAnchorToUnreadBoundary
    ? unreadBoundaryLastViewedAt
    : undefined;
  const shouldUseLinkedWindow =
    (linkedCreatedAt !== undefined && !!conversationId) || unreadLinkedCreatedAt !== undefined;
  const resolvedLinkedCreatedAt = unreadLinkedCreatedAt ?? linkedCreatedAt;
  const linkOpts = useMemo<
    { linkedConversationId?: string | undefined; linkedCreatedAt?: number | undefined } | undefined
  >(() => {
    if (!shouldUseLinkedWindow || resolvedLinkedCreatedAt === undefined) return undefined;
    const linkedConversationId = shouldAnchorToUnreadBoundary ? undefined : conversationId;
    if (linkedConversationId) {
      return {
        linkedConversationId,
        linkedCreatedAt: resolvedLinkedCreatedAt,
      };
    }
    return {
      linkedCreatedAt: resolvedLinkedCreatedAt,
    };
  }, [
    conversationId,
    resolvedLinkedCreatedAt,
    shouldAnchorToUnreadBoundary,
    shouldUseLinkedWindow,
  ]);

  const hasAnchorOpen =
    linkOpts?.linkedConversationId !== undefined || linkOpts?.linkedCreatedAt !== undefined;
  const livePresentationEnabled =
    !!isNotificationOpen || hasAnchorOpen || (liveHydrationEnabled ?? true);
  const messageCycleKey = `${channelId}:${linkOpts?.linkedConversationId ?? 'recent'}:${linkOpts?.linkedCreatedAt ?? 'latest'}`;
  const channelForMembership = useChannelById(channelId);
  const channelMembership = useGetChannelUserStatus(channelId);
  const channelRef = useMemo(
    () => ({
      kind: 'channel' as const,
      channelId,
      isMember: isChannelQueryMember(channelForMembership, channelMembership),
    }),
    [channelForMembership, channelId, channelMembership],
  );
  const [cachedMessageRevision, setCachedMessageRevision] = useState(0);
  const cachedMessageSnapshotRef = useRef<{
    channelId: string;
    revision: number;
    rows: ReturnType<typeof getChannelSnapshot>;
  } | null>(null);
  // The revision is an explicit invalidation token for actor-side cache writes.
  if (
    cachedMessageSnapshotRef.current === null ||
    cachedMessageSnapshotRef.current.channelId !== channelId ||
    cachedMessageSnapshotRef.current.revision !== cachedMessageRevision
  ) {
    cachedMessageSnapshotRef.current = {
      channelId,
      revision: cachedMessageRevision,
      rows: getChannelSnapshot(channelRef),
    };
  }
  const cachedMessageSeedRows = cachedMessageSnapshotRef.current.rows;
  const hasPriorityMessageOpen = !!isNotificationOpen || hasAnchorOpen;
  const shouldPromoteLatestTail = shouldPromoteLatestTailForOpen({
    hasPriorityMessageOpen: hasPriorityMessageOpen || !!isUnreadOpen,
    hasRouteAnchor,
  });
  // Cache rows are rendered independently from the live query. Keep the live
  // query enabled for every mounted channel so a cache miss, a delayed cache
  // snapshot, or a resumed Zero client cannot leave the list in a permanent
  // shimmer-only state waiting for a post-paint hydration gate.
  const messageQueriesEnabled = channelId.length > 0;
  const cachedAnchorOpeningMessages = useMemo(
    () => (cachedMessageSeedRows.length > 0 ? cachedMessageSeedRows : EMPTY_SEED_ROWS),
    [cachedMessageSeedRows],
  );
  const hasWarmAnchorSeed = cachedAnchorOpeningMessages.length > 0;
  const {
    messages: liveMessages,
    latestConversationsList,
    initialLoadError,
    retryInitialLoad,
    loadOlder,
    loadNewer,
    newConversationsAnchor,
    hasReachedChannelStart,
    isInitialLoadComplete,
    setInViewAnchor,
  } = useMessages(
    channelRef,
    toSharedMessagesOptions({
      enabled: messageQueriesEnabled,
      channelPageSize: 25,
      // The latest query is the first visible window for a normal cold open.
      // Keep it aligned with the 25-row chat page so the complete query only
      // confirms/extends the same window instead of visibly growing 12 → 25.
      channelLatestLimit: 25,
      promoteLatestTailOnColdOpen: true,
      // No initial-load timeout is passed: shared's UseMessagesOptions has no such
      // option, so the value this call used to carry was silently dropped. Any
      // timeout must land in shared's useMessages first.
      ...(isNotificationOpen && messageId ? { notificationTargetMessageId: messageId } : {}),
      linkedConversationId: linkOpts?.linkedConversationId ?? null,
      linkedItemCreatedAt:
        linkOpts?.linkedCreatedAt !== undefined ? { createdAt: linkOpts.linkedCreatedAt } : null,
      lastViewedAt: isUnreadOpen ? (unreadBoundaryLastViewedAt ?? null) : null,
    }),
  );
  useEffect(() => {
    if (isInitialLoadComplete) return;

    return subscribeMessages(channelRef, () => {
      setCachedMessageRevision(revision => revision + 1);
    });
  }, [channelId, channelRef, isInitialLoadComplete]);
  const hasTargetInCachedRows = hasChatTargetInRows(cachedMessageSeedRows, {
    messageId,
    conversationId,
  });
  const derivedOpenCase = deriveChatOpenCase({
    cachedRowCount: cachedMessageSeedRows.length,
    hasRequestedAnchor: hasRouteAnchor,
    hasTargetInCachedRows,
  });
  if (openCaseRef.current?.identityKey !== openIdentityKey) {
    openCaseRef.current = { identityKey: openIdentityKey, value: derivedOpenCase };
  }
  const openCase = openCaseRef.current?.value ?? derivedOpenCase;
  const hasTargetInLiveMessages = hasChatTargetInRows(liveMessages, {
    messageId,
    conversationId,
  });
  // A seeded-tail open does not let its targetless cache own the first
  // viewport. The latest query may still provide provisional rows, but the
  // surface stays concealed until the exact route target is present.
  const shouldUseSeededTailWindow = shouldKeepSeededTailWindow({
    openCase,
    hasRequestedAnchor: hasRouteAnchor,
    hasTargetInLiveRows: hasTargetInLiveMessages,
    didUserScroll,
  });
  const cacheRowsForOpen = shouldUseSeededTailWindow
    ? cachedMessageSeedRows
    : !hasPriorityMessageOpen && cachedMessageSeedRows.length > 0 && !isInitialLoadComplete
      ? cachedMessageSeedRows
      : cachedAnchorOpeningMessages;
  const liveRowsForOpen = liveMessages;
  // Do not treat leftover pending on mount as a send — that would steal
  // unread/deeplink landing. Claim the tail only when a newer pending id
  // appears after the list has already observed, or when the composer
  // registers an in-session send. a9de318 drops pending on client-ok, so
  // the owner flag and session snapshot must outlive that queue.
  const pendingForChannel = usePendingForChannel(channelId);
  const latestPendingSend = getLatestPendingSend(pendingForChannel);
  const localSendTailConversationId = latestPendingSend?.conversationId ?? null;
  const localSendTailTimestamp = latestPendingSend?.timestamp ?? 0;
  const [localSendOwnsTail, setLocalSendOwnsTail] = useState(false);
  const localSendOwnsTailRef = useRef(false);
  localSendOwnsTailRef.current = localSendOwnsTail;
  const [shouldPaintLatestTail, setShouldPaintLatestTail] = useState(false);
  const [sessionSendRow, setSessionSendRow] = useState<(typeof liveMessages)[number] | null>(null);
  const sessionSendIdRef = useRef<string | null>(null);
  const sessionSendSeenInLiveRef = useRef(false);
  const isLiveWindowAuthoritative = isInitialLoadComplete && !shouldUseSeededTailWindow;
  const shouldMaintainTailRef = useRef(shouldMaintainTail);
  shouldMaintainTailRef.current = shouldMaintainTail;
  const previousLocalSendRef = useRef<{
    hasObserved: boolean;
    conversationId: string | null;
    timestamp: number;
  }>({ hasObserved: false, conversationId: null, timestamp: 0 });

  const messages = useMemo(() => {
    const fetched = selectChatListFetchedRows({
      cacheRows: cacheRowsForOpen,
      liveRows: liveRowsForOpen,
      isLiveWindowAuthoritative,
    });
    const windowed = selectChatListWindowWithLatest({
      fetched,
      latest: latestConversationsList,
      shouldPromoteLatest: shouldPaintLatestTail,
    });
    return overlaySessionSendRow(windowed, sessionSendRow);
  }, [
    cacheRowsForOpen,
    isLiveWindowAuthoritative,
    latestConversationsList,
    liveRowsForOpen,
    sessionSendRow,
    shouldPaintLatestTail,
  ]);
  // useMessages reads the actor/MMKV snapshot synchronously for its initial
  // state. Capture that seed once so a later live update cannot obscure
  // whether this open began with usable local rows.
  if (openCycleState.initialSeedRows === null) {
    openCycleState.initialSeedRows = messages.length;
  }
  const hasMoreBefore = !hasReachedChannelStart;
  const newerPageCursor = newConversationsAnchor?.createdAt ?? null;
  const hasMoreAfter = newerPageCursor !== null;
  const sourceIsInitialLoading = !isInitialLoadComplete && messages.length === 0;
  const linkedAnchorStatus: 'none' | 'pending' | 'resolved' | 'missing' = !isInitialLoadComplete
    ? linkOpts?.linkedConversationId
      ? 'pending'
      : linkOpts?.linkedCreatedAt !== undefined
        ? 'pending'
        : 'none'
    : linkOpts?.linkedConversationId
      ? messages.some(m => m.conversationId === linkOpts.linkedConversationId)
        ? 'resolved'
        : 'missing'
      : linkOpts?.linkedCreatedAt !== undefined
        ? 'resolved'
        : 'none';
  const viewportAnchorRef = useRef<ChatViewportAnchor | null>(null);
  const setViewportAnchor = useCallback(
    (next: ChatViewportAnchor | null): void => {
      if (areChatViewportAnchorsEqual(viewportAnchorRef.current, next)) return;
      viewportAnchorRef.current = next;
      setInViewAnchor(next);
    },
    [setInViewAnchor],
  );
  const { paintRows: projectedPaintRows, conversationsById } = useConversationPaintRows({
    channelId,
    cycleKey: messageCycleKey,
    conversations: messages,
    currentUser,
    channelType,
  });
  const conversationCount = conversationsById.size;
  const getConversationById = useCallback(
    (conversationId: string): ConversationItem | undefined => conversationsById.get(conversationId),
    [conversationsById],
  );
  const dataState: ConversationDataState = !livePresentationEnabled
    ? 'cache'
    : isInitialLoadComplete
      ? 'complete'
      : 'hydrating';
  const { canRenderMessages, openPhase, isInitialLoading } = deriveConversationOpenState({
    dataState,
    hasMessages: messages.length > 0,
    isInitialLoading: sourceIsInitialLoading,
  });
  const shouldHoldPendingAnchorRows =
    openCase === 'empty' &&
    messages.length === 0 &&
    ((isLinkResolving && !hasWarmAnchorSeed) ||
      (hasAnchorOpen &&
        !didUserScroll &&
        (!isInitialLoadComplete || linkedAnchorStatus === 'pending')));
  const paintRows =
    canRenderMessages && !shouldHoldPendingAnchorRows ? projectedPaintRows : EMPTY_PAINT_ROWS;
  const isRichRenderingEnabled = richHydrationEnabled ?? liveHydrationEnabled ?? true;

  const [floatingDateText, setFloatingDateText] = useState<string | null>(null);
  const [floatingDateCreatedAt, setFloatingDateCreatedAt] = useState<number | null>(null);
  const floatingDateStateRef = useRef<FloatingDateState>({
    text: null,
    createdAt: null,
    fadeOutTimer: null,
    clearTimer: null,
  });
  const scrollPromotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentExpansionAnchorStateRef = useRef<ContentExpansionAnchorState>({
    active: false,
    releaseTimer: null,
  });
  const pillOpacity = useSharedValue(0);
  const rowPresentationStoreRef = useRef<RowPresentationStore | null>(null);
  if (!rowPresentationStoreRef.current) {
    rowPresentationStoreRef.current = createRowPresentationStore();
  }
  const rowPresentationStore = rowPresentationStoreRef.current;
  const rowEntranceControllerRef = useRef<RowEntranceController<ChatRow> | null>(null);
  if (
    !rowEntranceControllerRef.current ||
    rowEntranceControllerRef.current.getIdentityKey() !== openIdentityKey
  ) {
    rowEntranceControllerRef.current = new RowEntranceController<ChatRow>(openIdentityKey, {
      getId: (row): string => row.id,
      isMessageLike: (row): boolean => row.type === 'message',
    });
  }
  const rowEntranceController = rowEntranceControllerRef.current;
  const [rowEntranceTick, setRowEntranceTick] = useState(0);
  const pendingEntranceCommitTickRef = useRef<number | null>(null);

  const tailTrackingStateRef = useRef<TailTrackingState>({
    conversationId: null,
    createdAt: null,
    autoScrollReady: false,
  });
  const scrollStateRef = useRef<ChatScrollState>({
    distanceFromBottom: 0,
    isScrolledUp: false,
    didUserScroll: false,
  });
  const dateSeparatorRecorderRef = useRef<DateSeparatorObservationRecorder | null>(null);
  if (dateSeparatorRecorderRef.current === null) {
    dateSeparatorRecorderRef.current = createDateSeparatorObservationRecorder();
  }
  useEffect(() => {
    dateSeparatorRecorderRef.current?.reset();
  }, [channelId, conversationId, messageId]);
  const recordDateSeparatorLayout = useCallback(
    (
      surface: DateSeparatorSurface,
      boundaryId: string | null,
      createdAtMs: number,
      formattedLabel: string,
      layout: { width: number; height: number },
    ): void => {
      dateSeparatorRecorderRef.current?.record({
        surface,
        phase: scrollStateRef.current.didUserScroll ? 'interaction' : 'initial-open',
        channelId,
        conversationId: conversationId ?? null,
        boundaryId,
        createdAtMs,
        formattedLabel,
        layout,
        screenWidthDp: windowWidth,
        fontScale,
      });
    },
    [channelId, conversationId, fontScale, windowWidth],
  );

  const pillAnimatedStyle = useAnimatedStyle(() => ({ opacity: pillOpacity.value }));
  const handleRowContentExpanded = useCallback(
    (conversationId: string): void => {
      contentExpansionAnchorStateRef.current.active = true;
      setShouldMaintainTail(false);
      if (contentExpansionAnchorStateRef.current.releaseTimer) {
        clearTimeout(contentExpansionAnchorStateRef.current.releaseTimer);
      }
      contentExpansionAnchorStateRef.current.releaseTimer = setTimeout(() => {
        contentExpansionAnchorStateRef.current.active = false;
        contentExpansionAnchorStateRef.current.releaseTimer = null;
      }, CONTENT_EXPANSION_ANCHOR_RELEASE_MS);

      if (isRichRenderingEnabled && conversationsById.has(conversationId)) {
        rowPromotionStateRef.current.richConversationIds.add(conversationId);
        rowPresentationStore.promoteRich(conversationId);
      }
      rowPresentationStore.expand(conversationId);
    },
    [conversationsById, isRichRenderingEnabled, rowPresentationStore],
  );

  const claimLocalSendTail = useCallback(
    (conversationId: string): void => {
      sessionSendIdRef.current = conversationId;
      sessionSendSeenInLiveRef.current = false;
      const row =
        liveMessages.find(message => message.conversationId === conversationId) ??
        latestConversationsList.find(message => message.conversationId === conversationId) ??
        null;
      if (row) setSessionSendRow(row);
      shouldMaintainTailRef.current = true;
      localSendOwnsTailRef.current = true;
      setShouldMaintainTail(true);
      setLocalSendOwnsTail(true);
      setShouldPaintLatestTail(true);
      setViewportAnchor(null);
    },
    [latestConversationsList, liveMessages, setViewportAnchor],
  );
  const registerLocalSend = useCallback(
    (conversationId: string): void => {
      claimLocalSendTail(conversationId);
    },
    [claimLocalSendTail],
  );
  const scrollToBottom = useCallback((): void => {
    setShouldMaintainTail(true);
    setShouldPaintLatestTail(true);
    setViewportAnchor(null);
    listRef.current?.scrollToEnd({ animated: true });
  }, [setViewportAnchor]);
  const scrollToEnd = useCallback(
    async (params?: { animated?: boolean }): Promise<void> => {
      setShouldMaintainTail(true);
      setShouldPaintLatestTail(true);
      setViewportAnchor(null);
      await listRef.current?.scrollToEnd(params);
    },
    [setViewportAnchor],
  );
  useLayoutEffect(() => {
    const previous = previousLocalSendRef.current;
    const transition = resolveLocalSendTailTransition({
      hasObserved: previous.hasObserved,
      previousId: previous.conversationId,
      previousTimestamp: previous.timestamp,
      nextId: localSendTailConversationId,
      nextTimestamp: localSendTailTimestamp,
    });
    previousLocalSendRef.current = {
      hasObserved: true,
      conversationId: localSendTailConversationId,
      timestamp: localSendTailTimestamp,
    };
    if (transition === 'ignore') return;
    if (transition === 'observe') return;
    // Pending is gone (client-ok on a9de318). Keep following the in-session
    // send until the user leaves the tail or this open identity resets.
    if (transition === 'release') return;
    if (localSendTailConversationId === null) return;
    claimLocalSendTail(localSendTailConversationId);
  }, [claimLocalSendTail, localSendTailConversationId, localSendTailTimestamp]);
  useLayoutEffect(() => {
    const conversationId = sessionSendIdRef.current;
    if (!conversationId) {
      sessionSendSeenInLiveRef.current = false;
      return;
    }
    const isPresentInLiveWindow = liveMessages.some(
      message => message.conversationId === conversationId,
    );
    if (isPresentInLiveWindow) sessionSendSeenInLiveRef.current = true;
    if (
      shouldReleaseSessionSendOverlay({
        isLiveWindowAuthoritative,
        wasSeenInLiveWindow: sessionSendSeenInLiveRef.current,
        isPresentInLiveWindow,
      })
    ) {
      sessionSendIdRef.current = null;
      sessionSendSeenInLiveRef.current = false;
      setSessionSendRow(null);
      return;
    }
    if (sessionSendRow?.conversationId === conversationId) return;
    const row =
      liveMessages.find(message => message.conversationId === conversationId) ??
      latestConversationsList.find(message => message.conversationId === conversationId) ??
      null;
    if (row) setSessionSendRow(row);
  }, [isLiveWindowAuthoritative, latestConversationsList, liveMessages, sessionSendRow]);
  useLayoutEffect(() => {
    if (!shouldPaintLatestTail) return;
    if (latestConversationsList.length === 0) return;
    if (
      hasMoreAfter &&
      isInitialLoadComplete &&
      newerPageCursor !== null &&
      newerPageRequestCursorRef.current !== newerPageCursor
    ) {
      newerPageRequestCursorRef.current = newerPageCursor;
      loadNewer();
    }
  }, [
    hasMoreAfter,
    isInitialLoadComplete,
    loadNewer,
    latestConversationsList.length,
    messages.length,
    newerPageCursor,
    shouldPaintLatestTail,
  ]);
  const readCursorConversationId =
    openPhase === 'liveFresh' && !hasMoreAfter
      ? paintRows[paintRows.length - 1]?.conversationId
      : undefined;
  useEffect(() => {
    onReadCursorChange?.(readCursorConversationId);
  }, [onReadCursorChange, readCursorConversationId]);
  const getReadCursorConversationId = useCallback(
    (): string | undefined => readCursorConversationId,
    [readCursorConversationId],
  );

  useEffect(() => {
    const floatingDateState = floatingDateStateRef.current;
    const contentExpansionAnchorState = contentExpansionAnchorStateRef.current;

    return (): void => {
      if (floatingDateState.fadeOutTimer) {
        clearTimeout(floatingDateState.fadeOutTimer);
      }
      if (floatingDateState.clearTimer) {
        clearTimeout(floatingDateState.clearTimer);
      }
      if (scrollPromotionTimerRef.current) clearTimeout(scrollPromotionTimerRef.current);
      if (anchorConfirmationFrameRef.current !== null) {
        cancelAnimationFrame(anchorConfirmationFrameRef.current);
        anchorConfirmationFrameRef.current = null;
      }
      if (contentExpansionAnchorState.releaseTimer) {
        clearTimeout(contentExpansionAnchorState.releaseTimer);
        contentExpansionAnchorState.releaseTimer = null;
      }
      contentExpansionAnchorState.active = false;
    };
  }, []);

  const { rows, displayRows, displayRowIndexes } = useChatListRows({
    channelId,
    channelType,
    currentUser,
    hasRouteAnchor,
    isNotificationOpen,
    messageId,
    paintRows,
    unreadBoundaryCursor,
  });
  const estimatedItemSize = useMemo(() => {
    const cachedEstimate = estimatedItemSizeRef.current;
    if (cachedEstimate?.identityKey === openIdentityKey) return cachedEstimate.value;
    if (displayRows.length === 0) return 72;

    const estimate = getChatListEstimatedItemSize(
      displayRows,
      estimateCharsPerLine(Math.max(120, windowWidth * 0.78 - 12)),
    );
    estimatedItemSizeRef.current = { identityKey: openIdentityKey, value: estimate };
    return estimate;
  }, [displayRows, openIdentityKey, windowWidth]);

  const handleFirstLayout = useCallback(() => {
    if (didMarkLayoutRef.current) return;
    didMarkLayoutRef.current = true;
    setDidMarkLayout(true);
    onFirstLayout?.();
  }, [onFirstLayout]);

  useLayoutEffect(() => {
    const shouldKeepMountedLayout = !hasRouteAnchor && didMarkLayoutRef.current;
    didMarkLayoutRef.current = shouldKeepMountedLayout;
    setDidMarkLayout(shouldKeepMountedLayout);
    setFloatingDateText(null);
    floatingDateStateRef.current.text = null;
    pillOpacity.value = 0;
    if (floatingDateStateRef.current.fadeOutTimer) {
      clearTimeout(floatingDateStateRef.current.fadeOutTimer);
      floatingDateStateRef.current.fadeOutTimer = null;
    }
    if (floatingDateStateRef.current.clearTimer) {
      clearTimeout(floatingDateStateRef.current.clearTimer);
      floatingDateStateRef.current.clearTimer = null;
    }
    if (contentExpansionAnchorStateRef.current.releaseTimer) {
      clearTimeout(contentExpansionAnchorStateRef.current.releaseTimer);
      contentExpansionAnchorStateRef.current.releaseTimer = null;
    }
    contentExpansionAnchorStateRef.current.active = false;
    tailTrackingStateRef.current.autoScrollReady = false;
    setDidUserScroll(false);
    scrollStateRef.current.didUserScroll = false;
    viewportAnchorRef.current = null;
    newerPageRequestCursorRef.current = null;
    missingRouteAnchorExpansionRef.current = { key: openIdentityKey, passes: 0 };
    revealedChatListIdentityKeyRef.current = null;
    setRevealedChatListIdentityKey(null);
    setRouteAnchorPlacementUnavailableKey(null);
    setMissingRouteAnchorTimedOutKey(null);
    wasBlockingChatListRevealRef.current = false;
    chatListRevealOpacity.value = 1;
    tailTrackingStateRef.current.createdAt = null;
    appliedAnchorLayoutScrollKeyRef.current = null;
    directTailScrollKeyRef.current = null;
    if (anchorConfirmationFrameRef.current !== null) {
      cancelAnimationFrame(anchorConfirmationFrameRef.current);
      anchorConfirmationFrameRef.current = null;
    }
    anchorConfirmationPassRef.current = { key: openIdentityKey, passes: 0 };
    setAnchorScrollIssuedKey(null);
    setAnchorLandingConfirmedKey(null);
    shouldMaintainTailRef.current = true;
    localSendOwnsTailRef.current = false;
    sessionSendIdRef.current = null;
    sessionSendSeenInLiveRef.current = false;
    setShouldMaintainTail(true);
    setLocalSendOwnsTail(false);
    setShouldPaintLatestTail(false);
    setSessionSendRow(null);
  }, [hasUnreadOpenAnchor, hasRouteAnchor, openIdentityKey, pillOpacity, chatListRevealOpacity]);

  const rowsRef = useRef<ChatRow[]>(displayRows);
  const displayRowIndexesRef = useRef(displayRowIndexes);
  rowsRef.current = displayRows;
  displayRowIndexesRef.current = displayRowIndexes;
  const hasPaintedConversation = useCallback((conversationId: string): boolean => {
    return displayRowIndexesRef.current.byConversationId.has(conversationId);
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      getReadCursorConversationId,
      scrollToBottom,
      scrollToEnd,
      hasPaintedConversation,
      registerLocalSend,
    }),
    [
      getReadCursorConversationId,
      hasPaintedConversation,
      registerLocalSend,
      scrollToBottom,
      scrollToEnd,
    ],
  );
  useLayoutEffect(() => {
    rowsRef.current = displayRows;
    displayRowIndexesRef.current = displayRowIndexes;
  }, [displayRowIndexes, displayRows]);

  const targetRowIndex = useMemo(
    () => findTargetRowIndex(displayRowIndexes, conversationId, messageId),
    [conversationId, displayRowIndexes, messageId],
  );
  const targetConversationId =
    targetRowIndex !== null && displayRows[targetRowIndex]?.type === 'message'
      ? displayRows[targetRowIndex].id
      : undefined;
  const hasRequestedAnchor = hasRouteAnchor;
  const unreadDividerRowIndex = useMemo(
    () => displayRows.findIndex(row => row.type === 'unread-divider'),
    [displayRows],
  );
  const hasUnreadInitialScrollTarget = hasUnreadOpenAnchor && unreadDividerRowIndex >= 0;
  const hasScrollTarget = hasRequestedAnchor && targetRowIndex !== null;
  const isMissingRouteAnchor =
    hasRequestedAnchor &&
    !isLinkResolving &&
    targetRowIndex === null &&
    openPhase === 'liveFresh' &&
    !didUserScroll;
  const isMissingRouteAnchorTimedOut = missingRouteAnchorTimedOutKey === openIdentityKey;
  useEffect(() => {
    if (!isMissingRouteAnchor) {
      setMissingRouteAnchorTimedOutKey(currentKey =>
        currentKey === openIdentityKey ? null : currentKey,
      );
      return;
    }

    const timer = setTimeout(() => {
      setMissingRouteAnchorTimedOutKey(openIdentityKey);
    }, CHAT_OPEN_SYNC_TIMEOUT_MS);
    return (): void => clearTimeout(timer);
  }, [isMissingRouteAnchor, openIdentityKey]);
  // One bound for the whole unread hold, so a slow sync can never keep the shimmer up.
  const [unreadHoldExpiredKey, setUnreadHoldExpiredKey] = useState<string | null>(null);
  const hasUnreadHoldExpired = unreadHoldExpiredKey === openIdentityKey;
  useEffect(() => {
    if (!shouldAnchorToUnreadBoundary) return;
    const timer = setTimeout(() => {
      setUnreadHoldExpiredKey(openIdentityKey);
    }, UNREAD_OPEN_MAX_HOLD_MS);
    return (): void => clearTimeout(timer);
  }, [openIdentityKey, shouldAnchorToUnreadBoundary]);
  const hasUnreadBoundaryCoverage = useMemo(
    () =>
      shouldAnchorToUnreadBoundary &&
      hasLoadedTimestampBoundaryCoverage(displayRows, unreadBoundaryLastViewedAt),
    [displayRows, shouldAnchorToUnreadBoundary, unreadBoundaryLastViewedAt],
  );
  // Rows reaching the channel's last activity mean the cache already holds
  // everything new, so its answer (divider or not) needs no network wait.
  const isUnreadCacheCurrent = useMemo(() => {
    if (!shouldAnchorToUnreadBoundary || unreadLastActivityAt === undefined) return false;
    for (let index = displayRows.length - 1; index >= 0; index -= 1) {
      const row = displayRows[index];
      if (row?.type === 'message') return row.paint.createdAt >= unreadLastActivityAt;
    }
    return false;
  }, [displayRows, shouldAnchorToUnreadBoundary, unreadLastActivityAt]);
  const unreadPlacementInput = {
    shouldAnchorToUnreadBoundary,
    isInitialLoadComplete,
    isLiveFresh: openPhase === 'liveFresh',
    hasDivider: unreadDividerRowIndex >= 0,
    hasBoundaryCoverage: hasUnreadBoundaryCoverage,
    isCacheCurrent: isUnreadCacheCurrent,
    hasInitialLoadError: initialLoadError !== null,
  };
  const unreadPlacement = resolveUnreadPlacement({
    ...unreadPlacementInput,
    hasHoldExpired: hasUnreadHoldExpired,
  });
  // The placement the open would reach without the hold's time limit.
  const lateUnreadPlacement = resolveUnreadPlacement({
    ...unreadPlacementInput,
    hasHoldExpired: false,
  });
  const routeAnchorExpansionPasses =
    missingRouteAnchorExpansionRef.current.key === openIdentityKey
      ? missingRouteAnchorExpansionRef.current.passes
      : 0;
  const hasRouteAnchorExpansionBudget =
    (hasMoreBefore || hasMoreAfter) &&
    routeAnchorExpansionPasses < MAX_ROUTE_ANCHOR_EXPANSION_PASSES;
  const shouldWaitForMissingRouteAnchor =
    targetRowIndex === null &&
    (isLinkResolving ||
      openPhase !== 'liveFresh' ||
      linkedAnchorStatus === 'pending' ||
      hasRouteAnchorExpansionBudget ||
      (isMissingRouteAnchor && !isMissingRouteAnchorTimedOut));
  const hasAnchorPlacementReady =
    !hasRequestedAnchor || anchorLandingConfirmedKey === anchorScrollKey;
  const isRouteAnchorPlacementUnavailable = routeAnchorPlacementUnavailableKey === openIdentityKey;
  const isRouteAnchorUnavailable = shouldShowMissingChatAnchor({
    hasRequestedAnchor,
    isLinkResolving,
    hasTargetRow: targetRowIndex !== null,
    openPhase,
    hasMoreBefore,
    hasMoreAfter,
    expansionPasses: routeAnchorExpansionPasses,
    maxExpansionPasses: MAX_ROUTE_ANCHOR_EXPANSION_PASSES,
    hasWaitTimedOut: isMissingRouteAnchorTimedOut,
  });
  const openingScrollMode = resolveChatInitialScrollMode({
    hasRows: displayRows.length > 0,
    hasRouteAnchor: hasRequestedAnchor,
    hasTarget: targetRowIndex !== null,
    targetIsAtTail: targetRowIndex === displayRows.length - 1 && !hasMoreAfter,
    shouldAnchorToUnreadBoundary,
    unreadPlacement,
  });
  if (openCycleState.initialScrollMode === null && openingScrollMode !== null) {
    openCycleState.initialScrollMode = openingScrollMode;
    openCycleState.awaitsLateUnreadDivider =
      openingScrollMode === 'tail' &&
      unreadPlacement === 'none' &&
      lateUnreadPlacement === 'pending';
  }
  const initialScrollMode = openCycleState.initialScrollMode ?? openingScrollMode;
  const isRouteAnchorAtTail = hasRequestedAnchor && initialScrollMode === 'tail';
  // The list applies its initial placement once, when it first gets rows.
  // Hold them until an unread open has decided where to land.
  const isListRowsWithheld =
    shouldAnchorToUnreadBoundary && initialScrollMode === null && displayRows.length > 0;
  const listRows = isListRowsWithheld ? EMPTY_CHAT_ROWS : displayRows;
  // Keep the shimmer up until the list reports it has loaded at its initial
  // position; LegendList places the divider itself and keeps it there. With no
  // rows there is nothing to place, so the regular empty/loading states apply.
  const isUnreadPlacementHeld =
    shouldAnchorToUnreadBoundary &&
    !hasUnreadHoldExpired &&
    displayRows.length > 0 &&
    (initialScrollMode === null || !didListInitialLoadComplete);
  // A divider landing owns the viewport: stop the tail from claiming it.
  useLayoutEffect(() => {
    if (!shouldAnchorToUnreadBoundary || initialScrollMode !== 'unread') return;
    scrollStateRef.current.didUserScroll = true;
    setDidUserScroll(true);
    shouldMaintainTailRef.current = false;
    localSendOwnsTailRef.current = false;
    setShouldMaintainTail(false);
    setLocalSendOwnsTail(false);
  }, [initialScrollMode, openIdentityKey, shouldAnchorToUnreadBoundary]);
  // New messages that arrive after a timed-out hold bring the divider late:
  // move to it once, unless the user has scrolled or sent since. An open that
  // settles without a divider stops waiting, so later live messages never jump.
  useLayoutEffect(() => {
    if (!openCycleState.awaitsLateUnreadDivider) return;
    if (lateUnreadPlacement === 'none') {
      openCycleState.awaitsLateUnreadDivider = false;
      return;
    }
    if (lateUnreadPlacement !== 'divider' || !didListInitialLoadComplete) return;
    openCycleState.awaitsLateUnreadDivider = false;
    if (scrollStateRef.current.didUserScroll || localSendOwnsTailRef.current) return;
    scrollStateRef.current.didUserScroll = true;
    setDidUserScroll(true);
    shouldMaintainTailRef.current = false;
    localSendOwnsTailRef.current = false;
    setShouldMaintainTail(false);
    setLocalSendOwnsTail(false);
    void listRef.current?.scrollToIndex({
      index: unreadDividerRowIndex,
      viewOffset: UNREAD_DIVIDER_TOP_OFFSET,
      animated: false,
    });
  }, [didListInitialLoadComplete, lateUnreadPlacement, openCycleState, unreadDividerRowIndex]);
  const initialScrollIndex = useMemo(() => {
    if (displayRows.length === 0) return undefined;
    if (listInstanceLoadedRef.current) return undefined;
    if (hasRequestedAnchor && targetRowIndex !== null && initialScrollMode === 'target') {
      return {
        index: targetRowIndex,
        viewPosition: ANCHOR_MESSAGE_VIEW_POSITION,
      };
    }
    if (hasUnreadInitialScrollTarget && initialScrollMode === 'unread') {
      return { index: unreadDividerRowIndex, viewOffset: UNREAD_DIVIDER_TOP_OFFSET };
    }
    return undefined;
  }, [
    displayRows,
    hasRequestedAnchor,
    hasUnreadInitialScrollTarget,
    initialScrollMode,
    targetRowIndex,
    unreadDividerRowIndex,
  ]);
  const shouldExposeInitialScrollIndex =
    initialScrollIndex !== undefined &&
    !listInstanceLoadedRef.current &&
    (!hasRequestedAnchor || anchorScrollIssuedKey !== anchorScrollKey);
  const usesInitialAnchorPlacement =
    !listInstanceLoadedRef.current &&
    hasRequestedAnchor &&
    (initialScrollMode === 'tail' ||
      (initialScrollMode === 'target' && initialScrollIndex !== undefined));
  const shouldRevealWarmWindow = shouldRevealWarmChatWindow(messages.length);
  const hasRevealedChatOpen = revealedChatListIdentityKeyRef.current === openIdentityKey;
  // Warm data can mount with an initial index, but the surface must remain
  // visually concealed until that one native placement owner confirms the
  // target is readable. This is an opacity gate, not a second shimmer.
  const isWarmAnchorPlacementPending =
    !hasRevealedChatOpen &&
    shouldHoldWarmChatPlacement({
      openCase,
      hasRequestedAnchor,
      targetRowIndex,
      didUserScroll,
      placementConfirmed: anchorLandingConfirmedKey === anchorScrollKey,
    });
  // Reveal as soon as rows exist. Landing retries in the background and must
  // not conceal a loaded window behind a placement overlay.
  const shouldBlockChatListReveal =
    isRouteAnchorUnavailable ||
    (isRouteAnchorPlacementUnavailable && !hasRevealedChatOpen && displayRows.length === 0) ||
    (isWarmAnchorPlacementPending && displayRows.length === 0) ||
    (!hasRevealedChatOpen && isUnreadPlacementHeld) ||
    (!hasRevealedChatOpen &&
      shouldBlockChatWindowReveal({
        didUserScroll,
        canRevealWarmWindow: shouldRevealWarmWindow,
        shouldPromoteLatestTail,
        hasRequestedAnchor,
        isWaitingForMissingRouteAnchor: shouldWaitForMissingRouteAnchor,
        isWaitingForAnchorPlacement: hasRequestedAnchor && !hasAnchorPlacementReady,
        didListInitialLoadComplete,
      }));
  const { minimumHeight: composerMinimumHeight, totalHeight: composerTotalHeight } =
    composerGeometry;

  useLayoutEffect(() => {
    const shouldConcealChatList =
      isRouteAnchorUnavailable ||
      shouldConcealChatListForOpenIdentity({
        identityKey: openIdentityKey,
        revealedIdentityKey: revealedChatListIdentityKeyRef.current,
        shouldBlockListReveal: shouldBlockChatListReveal,
        shouldWaitForRevealSettle: false,
      });

    if (revealedChatListIdentityKeyRef.current !== openIdentityKey) {
      wasBlockingChatListRevealRef.current = shouldConcealChatList;
      chatListRevealOpacity.value = shouldConcealChatList ? 0 : 1;
      if (!shouldConcealChatList) {
        revealedChatListIdentityKeyRef.current = openIdentityKey;
        setRevealedChatListIdentityKey(openIdentityKey);
      }
      return;
    }

    if (shouldConcealChatList) {
      wasBlockingChatListRevealRef.current = true;
      chatListRevealOpacity.value = 0;
      return;
    }

    revealedChatListIdentityKeyRef.current = openIdentityKey;
    if (!wasBlockingChatListRevealRef.current) {
      chatListRevealOpacity.value = 1;
      return;
    }

    wasBlockingChatListRevealRef.current = false;
    chatListRevealOpacity.value = withTiming(1, { duration: 120 });
  }, [
    chatListRevealOpacity,
    isRouteAnchorUnavailable,
    openIdentityKey,
    setRevealedChatListIdentityKey,
    shouldBlockChatListReveal,
  ]);

  // The resting composer is reserved as real content padding (see
  // ChatComposerGeometry); only growth beyond it arrives as a content inset.
  const listContentContainerStyle = useMemo<ViewStyle>(
    () => ({ paddingBottom: composerMinimumHeight }),
    [composerMinimumHeight],
  );
  // Overlays sit on top of the list rather than inside its content, so they
  // clear the reserved composer slot. Shimmer uses this too: skeletons stay in
  // the message viewport and the input place stays empty.
  const composerErrorOverlayStyle = useAnimatedStyle(
    () => ({ paddingBottom: composerTotalHeight.value }),
    [composerTotalHeight],
  );

  const getTargetLandingSnapshot = useCallback((): AnchorLandingSnapshot | null => {
    if (!targetConversationId) return null;
    const targetIndex =
      displayRowIndexesRef.current.byConversationId.get(targetConversationId) ?? -1;
    const state = listRef.current?.getState?.();
    if (!state || targetIndex < 0) {
      return {
        visible: false,
      };
    }
    return {
      visible: isMeasuredRowVisible({
        state,
        key: targetConversationId,
        index: targetIndex,
        readableTop: ANCHOR_TOP_GAP,
        readableBottom: state.scrollLength - composerTotalHeight.value,
      }),
    };
  }, [composerTotalHeight, targetConversationId]);
  const isTargetLandingConfirmed = useCallback((): boolean => {
    return getTargetLandingSnapshot()?.visible === true;
  }, [getTargetLandingSnapshot]);
  const reportOpenMessageHighlighted = useCallback((): void => {
    reportNotificationMessageHighlighted({
      channelId,
      ...(messageId ? { messageId } : {}),
    });
    reportActivityMessageHighlighted({
      channelId,
      ...(messageId ? { messageId } : {}),
    });
  }, [channelId, messageId]);
  const markAnchorLandingObserved = useCallback(
    (snapshot = getTargetLandingSnapshot()): boolean => {
      if (!snapshot?.visible) return false;
      setAnchorLandingConfirmedKey(anchorScrollKey);
      setRouteAnchorPlacementUnavailableKey(currentKey =>
        currentKey === openIdentityKey ? null : currentKey,
      );
      reportOpenMessageHighlighted();
      return true;
    },
    [anchorScrollKey, getTargetLandingSnapshot, openIdentityKey, reportOpenMessageHighlighted],
  );
  const scheduleAnchorLandingConfirmation = useCallback((): void => {
    if (!targetConversationId) return;
    if (anchorConfirmationFrameRef.current !== null) return;

    const runPass = (): void => {
      anchorConfirmationFrameRef.current = null;
      const snapshot = getTargetLandingSnapshot();
      if (anchorLandingConfirmedKey === anchorScrollKey && snapshot?.visible) {
        reportOpenMessageHighlighted();
        return;
      }
      if (scrollStateRef.current.didUserScroll) {
        return;
      }

      if (markAnchorLandingObserved(snapshot)) {
        return;
      }

      const listState = listRef.current?.getState?.();
      const isListReady = (listState?.scrollLength ?? 0) > 0;
      const confirmationKey = openIdentityKey;
      const currentPassState =
        anchorConfirmationPassRef.current.key === confirmationKey
          ? anchorConfirmationPassRef.current
          : { key: confirmationKey, passes: 0 };
      const decision = resolveAnchorLandingPass({
        isTargetVisible: snapshot?.visible === true,
        isListReady,
        passes: currentPassState.passes,
      });
      if (decision === 'wait') {
        anchorConfirmationPassRef.current = {
          key: confirmationKey,
          passes: currentPassState.passes + 1,
        };
        anchorConfirmationFrameRef.current = requestAnimationFrame(() => {
          anchorConfirmationFrameRef.current = requestAnimationFrame(runPass);
        });
        return;
      }
      if (decision === 'accept') {
        setAnchorLandingConfirmedKey(anchorScrollKey);
        setRouteAnchorPlacementUnavailableKey(currentKey =>
          currentKey === openIdentityKey ? null : currentKey,
        );
        // Measurement budget expired, but the row is in data and the list is
        // revealed. The CSS highlight is already painted; telemetry must agree.
        reportOpenMessageHighlighted();
        return;
      }

      anchorConfirmationPassRef.current = {
        key: confirmationKey,
        passes: currentPassState.passes + 1,
      };
      appliedAnchorLayoutScrollKeyRef.current = null;
      scheduleAnchorLandingRef.current?.();
    };

    anchorConfirmationFrameRef.current = requestAnimationFrame(() => {
      anchorConfirmationFrameRef.current = requestAnimationFrame(runPass);
    });
  }, [
    anchorLandingConfirmedKey,
    anchorScrollKey,
    getTargetLandingSnapshot,
    markAnchorLandingObserved,
    openIdentityKey,
    reportOpenMessageHighlighted,
    targetConversationId,
  ]);
  const confirmInitialAnchorPlacement = useCallback((): void => {
    if (!usesInitialAnchorPlacement || targetRowIndex === null) return;
    if (anchorScrollIssuedKey === anchorScrollKey) return;

    setAnchorScrollIssuedKey(anchorScrollKey);
    scheduleAnchorLandingConfirmation();
  }, [
    anchorScrollIssuedKey,
    anchorScrollKey,
    scheduleAnchorLandingConfirmation,
    targetRowIndex,
    usesInitialAnchorPlacement,
  ]);
  const scheduleAnchorLanding = useCallback((): void => {
    if (!targetConversationId) return;
    if (scrollStateRef.current.didUserScroll) return;
    if (anchorLandingConfirmedKey === anchorScrollKey) {
      const snapshot = getTargetLandingSnapshot();
      if (snapshot?.visible) {
        reportOpenMessageHighlighted();
        return;
      }
    }

    const targetIndex =
      displayRowIndexesRef.current.byConversationId.get(targetConversationId) ?? -1;
    if (targetIndex < 0) return;
    if (appliedAnchorLayoutScrollKeyRef.current === anchorScrollKey) return;

    const list = listRef.current;
    if (!list?.scrollToIndex) return;
    appliedAnchorLayoutScrollKeyRef.current = anchorScrollKey;

    void (async (): Promise<void> => {
      try {
        setAnchorScrollIssuedKey(anchorScrollKey);
        await list.scrollToIndex({
          index: targetIndex,
          animated: false,
          viewPosition: ANCHOR_MESSAGE_VIEW_POSITION,
        });
        const snapshot = getTargetLandingSnapshot();
        if (!markAnchorLandingObserved(snapshot)) {
          scheduleAnchorLandingConfirmation();
        }
      } catch {
        appliedAnchorLayoutScrollKeyRef.current = null;
      }
    })();
  }, [
    anchorLandingConfirmedKey,
    anchorScrollKey,
    getTargetLandingSnapshot,
    markAnchorLandingObserved,
    reportOpenMessageHighlighted,
    scheduleAnchorLandingConfirmation,
    targetConversationId,
  ]);
  scheduleAnchorLandingRef.current = scheduleAnchorLanding;
  useLayoutEffect(() => {
    if (!hasScrollTarget || targetRowIndex === null || usesInitialAnchorPlacement) return;
    scheduleAnchorLanding();
  }, [
    anchorScrollKey,
    hasScrollTarget,
    scheduleAnchorLanding,
    targetRowIndex,
    usesInitialAnchorPlacement,
  ]);

  const isUnreadAnchoredOpen = shouldAnchorToUnreadBoundary && initialScrollMode !== 'tail';
  const shouldUseInitialScrollAtEnd =
    displayRows.length > 0 &&
    !isUnreadAnchoredOpen &&
    (!hasRequestedAnchor || initialScrollMode === 'tail');
  const scheduleDirectTailLanding = useCallback((): void => {
    if (
      hasRequestedAnchor ||
      !shouldUseInitialScrollAtEnd ||
      !listInstanceLoadedRef.current ||
      scrollStateRef.current.didUserScroll ||
      displayRows.length === 0 ||
      directTailScrollKeyRef.current === openIdentityKey
    ) {
      return;
    }
    // Land after the latest window replaces the unread one, not on the window being swapped out.
    if (shouldAnchorToUnreadBoundary && hasMoreAfter && !shouldPaintLatestTail) return;

    const list = listRef.current;
    if (!list?.scrollToEnd) return;
    directTailScrollKeyRef.current = openIdentityKey;
    void list.scrollToEnd({ animated: false }).catch(() => {
      if (directTailScrollKeyRef.current === openIdentityKey) {
        directTailScrollKeyRef.current = null;
      }
    });
  }, [
    displayRows.length,
    hasMoreAfter,
    hasRequestedAnchor,
    openIdentityKey,
    shouldAnchorToUnreadBoundary,
    shouldPaintLatestTail,
    shouldUseInitialScrollAtEnd,
  ]);

  // The load flag lives in a ref, so re-run once it lands: an unread open that
  // decided "tail" before the list loaded still needs its landing issued.
  useLayoutEffect(() => {
    scheduleDirectTailLanding();
  }, [didListInitialLoadComplete, scheduleDirectTailLanding]);

  const unreadTailExpansionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!shouldAnchorToUnreadBoundary || initialScrollMode !== 'tail' || !hasMoreAfter) return;
    if (unreadTailExpansionKeyRef.current === openIdentityKey) return;
    if (scrollStateRef.current.didUserScroll) return;
    unreadTailExpansionKeyRef.current = openIdentityKey;
    setShouldMaintainTail(true);
    setShouldPaintLatestTail(true);
  }, [hasMoreAfter, initialScrollMode, openIdentityKey, shouldAnchorToUnreadBoundary]);

  const maintainScrollAtEnd = useMemo(
    () =>
      shouldFollowChatListTail({
        shouldMaintainTail,
        localSendOwnsTail,
        shouldAnchorToUnreadBoundary: isUnreadAnchoredOpen,
        hasRequestedAnchor,
      })
        ? {
            animated: false,
            // Composer/inset measurement is layout, not a new message. Keep
            // the latest row above the composer while a direct open owns the
            // tail. Route-anchored opens must never acquire end-following
            // unless a local send currently owns the tail.
            on: {
              dataChange: true,
              itemLayout: true,
            },
          }
        : false,
    [hasRequestedAnchor, isUnreadAnchoredOpen, localSendOwnsTail, shouldMaintainTail],
  );
  useEffect(() => {
    const missingRouteAnchor = hasRequestedAnchor && !isLinkResolving && targetRowIndex === null;
    if (!missingRouteAnchor) {
      missingRouteAnchorExpansionRef.current = { key: openIdentityKey, passes: 0 };
      return;
    }

    if (openPhase !== 'liveFresh') return;
    if (scrollStateRef.current.didUserScroll) return;

    if (missingRouteAnchorExpansionRef.current.key !== openIdentityKey) {
      missingRouteAnchorExpansionRef.current = { key: openIdentityKey, passes: 0 };
    }
    if (missingRouteAnchorExpansionRef.current.passes >= MAX_ROUTE_ANCHOR_EXPANSION_PASSES) {
      return;
    }

    let didRequestMoreRows = false;
    if (hasMoreBefore) {
      loadOlder();
      didRequestMoreRows = true;
    }
    if (hasMoreAfter) {
      loadNewer();
      didRequestMoreRows = true;
    }
    if (didRequestMoreRows) {
      const nextPasses = missingRouteAnchorExpansionRef.current.passes + 1;
      missingRouteAnchorExpansionRef.current = {
        key: openIdentityKey,
        passes: nextPasses,
      };
    }
  }, [
    displayRows.length,
    hasMoreAfter,
    hasMoreBefore,
    hasRequestedAnchor,
    isLinkResolving,
    loadNewer,
    loadOlder,
    openPhase,
    openIdentityKey,
    targetRowIndex,
  ]);

  useEffect(() => {
    if (paintRows.length === 0) {
      tailTrackingStateRef.current.conversationId = null;
      tailTrackingStateRef.current.createdAt = null;
      return;
    }
    const tailMessage = paintRows[paintRows.length - 1];
    if (!tailMessage) {
      tailTrackingStateRef.current.conversationId = null;
      tailTrackingStateRef.current.createdAt = null;
      return;
    }
    const tailId = tailMessage.conversationId;
    const tailCreatedAt = tailMessage.createdAt;
    const prevTailId = tailTrackingStateRef.current.conversationId;
    const prevTailCreatedAt = tailTrackingStateRef.current.createdAt;
    tailTrackingStateRef.current.conversationId = tailId;
    tailTrackingStateRef.current.createdAt = tailCreatedAt;

    if (prevTailId === null || prevTailId === tailId) return;

    const isNewerTail = prevTailCreatedAt === null || tailCreatedAt > prevTailCreatedAt;

    if (hasRequestedAnchor && !isRouteAnchorAtTail) {
      return;
    }

    if (!tailTrackingStateRef.current.autoScrollReady) {
      return;
    }

    // Only chase a genuinely newer tail. A cache-to-live swap or reorder can surface
    // a different-but-not-newer tail, which reads as a random jump. Local sends are
    // handled by `useKeyboardScrollToEnd` so the keyboard and list move together.
    if (!isNewerTail) return;

    // Near the bottom, maintainScrollAtEnd follows the new message natively — no manual
    // scroll (a second animated scroll here races scrollMessageToEnd on send = flicker).
    // Only buzz when the user is scrolled up so they know a new message arrived.
    if (scrollStateRef.current.distanceFromBottom > NEAR_END_AUTO_SCROLL_THRESHOLD) {
      void haptics.gestureEnd();
    }
  }, [hasRequestedAnchor, isRouteAnchorAtTail, paintRows]);

  const rowPromotionStateRef = useRef<RowPromotionState>({
    richConversationIds: new Set(),
    mediaConversationIds: new Set(),
    lastRichPassKey: null,
    lastMediaPassKey: null,
  });

  useEffect(() => {
    rowPresentationStore.clear();
    rowPromotionStateRef.current.richConversationIds.clear();
    rowPromotionStateRef.current.mediaConversationIds.clear();
    rowPromotionStateRef.current.lastRichPassKey = null;
    rowPromotionStateRef.current.lastMediaPassKey = null;
    scrollStateRef.current.distanceFromBottom = 0;
    scrollStateRef.current.isScrolledUp = false;
  }, [channelId, conversationId, rowPresentationStore]);

  const chatOpenStableKey = useMemo(() => {
    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    return [rows.length, firstRow?.id ?? 'none', lastRow?.id ?? 'none'].join(':');
  }, [rows]);

  useLayoutEffect(() => {
    if (!didMarkLayout) return;
    if (displayRows.length === 0) return;
    if (!openCycleState.firstVisiblePaint) {
      openCycleState.firstVisiblePaint = {
        latencyMs: getElapsedMs(openCycleState.startedAtMs),
        source: getChatOpenPaintSource(openPhase),
      };
    }
    if (openPhase !== 'liveFresh') return;
    if (openCycleState.didLogFinalLivePaint) return;
    openCycleState.didLogFinalLivePaint = true;

    const dataSource = getChatOpenPaintSource(openPhase);
    const firstVisiblePaint = openCycleState.firstVisiblePaint ?? {
      latencyMs: getElapsedMs(openCycleState.startedAtMs),
      source: dataSource,
    };
    const finalLivePaintLatencyMs = getElapsedMs(openCycleState.startedAtMs);
    logChatOpenSummary({
      cycleId: openCycleState.cycleId,
      channelId,
      startedAtMs: openCycleState.startedAtMs,
      entryPoint,
      notificationOpenKind,
      routeOpenLatencyMs: openCycleState.routeOpenLatencyMs,
      firstPaintSource: firstVisiblePaint.source,
      firstPaintLatencyMs: firstVisiblePaint.latencyMs,
      finalLivePaintLatencyMs,
      telemetry: {
        cacheHit: (openCycleState.initialSeedRows ?? 0) > 0,
        cacheRows: openCycleState.initialSeedRows ?? 0,
        initialFetchStatus: isInitialLoadComplete ? 'complete' : 'running',
      },
    });
  }, [
    channelId,
    didMarkLayout,
    displayRows.length,
    entryPoint,
    notificationOpenKind,
    isInitialLoadComplete,
    openCycleState,
    openPhase,
  ]);

  useEffect(() => {
    if (displayRows.length === 0) return;

    const timer = setTimeout(() => {
      tailTrackingStateRef.current.autoScrollReady = true;
    }, CHAT_OPEN_STABLE_WINDOW_MS);

    return (): void => {
      clearTimeout(timer);
    };
  }, [chatOpenStableKey, displayRows.length, openPhase]);

  const promoteRowsInWindow = useCallback(
    (
      window: VisibleRowWindow,
      opts?: { allowRichPromotion?: boolean; allowMediaPromotion?: boolean },
    ): void => {
      const rows = rowsRef.current;
      const requests: MediaPreviewRequest[] = [];
      const emojiIds = new Set<string>();
      const allowRichPromotion = opts?.allowRichPromotion ?? true;
      const allowMediaPromotion = opts?.allowMediaPromotion ?? true;
      const canPromoteRichRows =
        allowRichPromotion && isRichRenderingEnabled && conversationCount > 0;
      const richPassKey = canPromoteRichRows
        ? getRowPromotionPassKey({
            window,
            rowCount: rows.length,
            sourceCount: conversationCount,
            promotedCount: rowPromotionStateRef.current.richConversationIds.size,
          })
        : null;
      const shouldPromoteRich =
        richPassKey !== null && rowPromotionStateRef.current.lastRichPassKey !== richPassKey;
      if (shouldPromoteRich) {
        rowPromotionStateRef.current.lastRichPassKey = richPassKey;
      }

      let richDidChange = false;

      for (let index = window.end; index >= window.start; index--) {
        const row = rows[index];
        if (!row || row.type !== 'message') continue;
        const request = getMediaPreviewRequest(row.paint);
        if (request) requests.push(request);
        for (const emojiId of collectPaintEmojiIds([row.paint])) emojiIds.add(emojiId);
        if (
          shouldPromoteRich &&
          conversationsById.has(row.paint.conversationId) &&
          !rowPromotionStateRef.current.richConversationIds.has(row.paint.conversationId)
        ) {
          rowPromotionStateRef.current.richConversationIds.add(row.paint.conversationId);
          richDidChange =
            rowPresentationStore.promoteRich(row.paint.conversationId) || richDidChange;
        }
      }

      if (requests.length > 0) {
        prefetchMediaPreviews(requests);
      }

      if (emojiIds.size > 0) {
        void prefetchMtlsEmojiUris([...emojiIds]);
      }

      if (richDidChange) rowPromotionStateRef.current.lastMediaPassKey = null;

      if (!allowMediaPromotion) return;

      const mediaPassKey = canPromoteRichRows
        ? getRowPromotionPassKey({
            window,
            rowCount: rows.length,
            sourceCount: rowPromotionStateRef.current.richConversationIds.size,
            promotedCount: rowPromotionStateRef.current.mediaConversationIds.size,
          })
        : null;
      const shouldPromoteMedia =
        mediaPassKey !== null && rowPromotionStateRef.current.lastMediaPassKey !== mediaPassKey;
      if (!shouldPromoteMedia) return;

      rowPromotionStateRef.current.lastMediaPassKey = mediaPassKey;
      for (let index = window.end; index >= window.start; index--) {
        const row = rows[index];
        if (!row || row.type !== 'message') continue;
        const conversationIdForRow = row.paint.conversationId;
        if (!hasHydratableMedia(row.paint)) continue;
        if (!rowPromotionStateRef.current.richConversationIds.has(conversationIdForRow)) continue;
        if (rowPromotionStateRef.current.mediaConversationIds.has(conversationIdForRow)) continue;
        rowPromotionStateRef.current.mediaConversationIds.add(conversationIdForRow);
        rowPresentationStore.promoteMedia(conversationIdForRow);
      }
    },
    [conversationCount, conversationsById, isRichRenderingEnabled, rowPresentationStore],
  );

  const promoteVisibleRows = useCallback((): void => {
    const listState = listRef.current?.getState();
    const rowCount = rowsRef.current.length;
    if (rowCount === 0) return;

    if (!listState || listState.start < 0 || listState.end < 0) {
      const targetIndex = targetConversationId
        ? (displayRowIndexesRef.current.byConversationId.get(targetConversationId) ?? -1)
        : -1;
      if (targetIndex >= 0) {
        promoteRowsInWindow({
          start: Math.max(0, targetIndex - ROW_PROMOTION_NEAR_VISIBLE_BUFFER),
          end: Math.min(rowCount - 1, targetIndex + ROW_PROMOTION_NEAR_VISIBLE_BUFFER),
        });
        return;
      }

      promoteRowsInWindow({
        start: Math.max(0, rowCount - FALLBACK_ROW_PROMOTION_BOTTOM_WINDOW),
        end: rowCount - 1,
      });
      return;
    }

    const start = Math.max(
      0,
      Math.min(rowCount - 1, listState.start - ROW_PROMOTION_NEAR_VISIBLE_BUFFER),
    );
    promoteRowsInWindow({
      start,
      end: Math.min(
        rowCount - 1,
        Math.max(start, listState.end + ROW_PROMOTION_NEAR_VISIBLE_BUFFER),
      ),
    });
  }, [promoteRowsInWindow, targetConversationId]);

  const handleItemSizeChanged = useCallback(
    ({ index }: { index: number }): void => {
      const didConfirmFromMeasurement =
        anchorLandingConfirmedKey !== anchorScrollKey &&
        targetConversationId &&
        !scrollStateRef.current.didUserScroll &&
        isTargetLandingConfirmed();
      if (didConfirmFromMeasurement) {
        setAnchorLandingConfirmedKey(anchorScrollKey);
      }
      // Rich text/media hydration can shift measured positions after the exact
      // target is revealed. Re-anchor only when the target has actually drifted
      // out of the readable viewport; otherwise leave the user's stable view alone.
      if (
        anchorLandingConfirmedKey !== anchorScrollKey ||
        !targetConversationId ||
        scrollStateRef.current.didUserScroll
      ) {
        return;
      }
      const currentTargetIndex =
        displayRowIndexesRef.current.byConversationId.get(targetConversationId) ?? -1;
      if (currentTargetIndex < 0 || index > currentTargetIndex) return;
      if (getTargetLandingSnapshot()?.visible) return;

      appliedAnchorLayoutScrollKeyRef.current = null;
      scheduleAnchorLanding();
    },
    [
      anchorScrollKey,
      anchorLandingConfirmedKey,
      scheduleAnchorLanding,
      getTargetLandingSnapshot,
      isTargetLandingConfirmed,
      targetConversationId,
    ],
  );

  const setViewportAnchorFromVisibleTail = useCallback(
    (listState: { start: number; end: number }): void => {
      const currentRows = rowsRef.current;
      for (
        let index = Math.min(listState.end, currentRows.length - 1);
        index >= listState.start;
        index -= 1
      ) {
        const row = currentRows[index];
        if (row?.type !== 'message') continue;
        setViewportAnchor({
          conversationId: row.paint.conversationId,
          createdAt: row.paint.createdAt,
          direction: 'backward',
        });
        return;
      }
    },
    [setViewportAnchor],
  );

  const requestNewerPageFromUserScroll = useCallback((): void => {
    if (!isInitialLoadComplete) return;
    if (
      !shouldAllowChatPagination({
        didUserScroll: scrollStateRef.current.didUserScroll,
        hasMore: hasMoreAfter,
        displayRowCount: displayRows.length,
      })
    ) {
      return;
    }
    if (newerPageCursor === null || newerPageRequestCursorRef.current === newerPageCursor) {
      return;
    }

    // LegendList's reached-edge callback is the primary path, but a data
    // update can leave the native edge latch closed while the user is already
    // at the end of the current historical window. Keep this fallback
    // user-owned and issue at most one request for each cursor.
    newerPageRequestCursorRef.current = newerPageCursor;
    loadNewer();
  }, [displayRows.length, hasMoreAfter, isInitialLoadComplete, loadNewer, newerPageCursor]);

  const onScroll = useCallback((): void => {
    const state = listRef.current?.getState();
    if (!state) return;

    const distanceFromBottom = state.contentLength - (state.scroll + state.scrollLength);
    scrollStateRef.current.distanceFromBottom = distanceFromBottom;
    if (distanceFromBottom <= NEAR_END_AUTO_SCROLL_THRESHOLD) {
      setViewportAnchor(null);
      requestNewerPageFromUserScroll();
    }
    if (
      !shouldMaintainTail &&
      !hasRequestedAnchor &&
      distanceFromBottom <= NEAR_END_AUTO_SCROLL_THRESHOLD
    ) {
      setShouldMaintainTail(true);
    }
    const nextIsScrolledUp = distanceFromBottom > SCROLL_TO_BOTTOM_THRESHOLD;
    if (nextIsScrolledUp !== scrollStateRef.current.isScrolledUp) {
      scrollStateRef.current.isScrolledUp = nextIsScrolledUp;
      onScrolledUpChange?.(nextIsScrolledUp);
    }

    if (!scrollStateRef.current.didUserScroll) return;

    const currentRows = rowsRef.current;
    let topDate: number | null = null;
    for (let i = state.start; i < currentRows.length; i++) {
      const row = currentRows[i];
      if (!row) continue;
      if (row.type === 'unread-divider') continue;
      topDate = row.type === 'date' ? row.date : row.paint.createdAt;
      break;
    }
    if (topDate === null) return;

    const text = formatDatePill(topDate);
    floatingDateStateRef.current.createdAt = topDate;
    if (text !== floatingDateStateRef.current.text) {
      floatingDateStateRef.current.text = text;
      setFloatingDateText(text);
    }
    setFloatingDateCreatedAt(topDate);

    pillOpacity.value = withTiming(1, { duration: FLOATING_PILL_FADE_IN_DURATION });
    if (floatingDateStateRef.current.fadeOutTimer) {
      clearTimeout(floatingDateStateRef.current.fadeOutTimer);
    }
    if (floatingDateStateRef.current.clearTimer) {
      clearTimeout(floatingDateStateRef.current.clearTimer);
    }
    floatingDateStateRef.current.fadeOutTimer = setTimeout(() => {
      pillOpacity.value = withTiming(0, { duration: FLOATING_PILL_FADE_OUT_DURATION });
      floatingDateStateRef.current.clearTimer = setTimeout(() => {
        floatingDateStateRef.current.text = null;
        floatingDateStateRef.current.createdAt = null;
        setFloatingDateText(null);
        setFloatingDateCreatedAt(null);
      }, FLOATING_PILL_FADE_OUT_DURATION);
    }, FLOATING_PILL_FADE_OUT_MS);
    if (isRichRenderingEnabled) {
      if (scrollPromotionTimerRef.current) clearTimeout(scrollPromotionTimerRef.current);
      scrollPromotionTimerRef.current = setTimeout(() => {
        promoteVisibleRows();
      }, SCROLL_ROW_PROMOTION_DEBOUNCE_MS);
    }
  }, [
    isRichRenderingEnabled,
    onScrolledUpChange,
    pillOpacity,
    promoteVisibleRows,
    requestNewerPageFromUserScroll,
    setViewportAnchor,
    hasRequestedAnchor,
    shouldMaintainTail,
  ]);

  const handleScrollBeginDrag = useCallback((): void => {
    setDidUserScroll(true);
    scrollStateRef.current.didUserScroll = true;
    setRouteAnchorPlacementUnavailableKey(null);
    shouldMaintainTailRef.current = false;
    localSendOwnsTailRef.current = false;
    setShouldMaintainTail(false);
    setLocalSendOwnsTail(false);
  }, []);

  const handleScrollSettled = useCallback((): void => {
    const listState = listRef.current?.getState();
    const distanceFromBottom = listState
      ? listState.contentLength - (listState.scroll + listState.scrollLength)
      : null;

    if (scrollStateRef.current.didUserScroll) {
      if (listState) {
        if (distanceFromBottom !== null && distanceFromBottom <= NEAR_END_AUTO_SCROLL_THRESHOLD) {
          setViewportAnchorFromVisibleTail(listState);
          requestNewerPageFromUserScroll();
        } else {
          setViewportAnchorFromVisibleTail(listState);
        }
      }
    }

    if (isRichRenderingEnabled) {
      promoteVisibleRows();
    }
  }, [
    isRichRenderingEnabled,
    promoteVisibleRows,
    requestNewerPageFromUserScroll,
    setViewportAnchorFromVisibleTail,
  ]);

  const markInitialLoadComplete = useCallback((): void => {
    if (notifiedInitialLoadIdentityRef.current === openIdentityKey) return;
    const wasListInstanceLoaded = listInstanceLoadedRef.current;
    listInstanceLoadedRef.current = true;
    if (!wasListInstanceLoaded && !shouldAnchorToUnreadBoundary) {
      directTailScrollKeyRef.current = openIdentityKey;
    }
    notifiedInitialLoadIdentityRef.current = openIdentityKey;
    setLoadedListIdentityKey(openIdentityKey);
    onInitialLoadComplete?.();
  }, [onInitialLoadComplete, openIdentityKey, shouldAnchorToUnreadBoundary]);
  const handleListLoad = useCallback((): void => {
    // The list is intentionally mounted before it has rows. Its empty-data
    // load event is not the chat's first usable paint.
    if (isListRowsWithheld || (displayRows.length === 0 && openPhase !== 'liveFresh')) return;
    if (usesInitialAnchorPlacement && targetRowIndex !== null) {
      confirmInitialAnchorPlacement();
    }
    markInitialLoadComplete();
    if (isRichRenderingEnabled) promoteVisibleRows();
  }, [
    displayRows.length,
    isListRowsWithheld,
    isRichRenderingEnabled,
    markInitialLoadComplete,
    openPhase,
    promoteVisibleRows,
    confirmInitialAnchorPlacement,
    targetRowIndex,
    usesInitialAnchorPlacement,
  ]);

  useEffect(() => {
    if (!isRichRenderingEnabled || conversationCount === 0) return;

    const frame = requestAnimationFrame(() => {
      promoteVisibleRows();
    });
    return (): void => {
      cancelAnimationFrame(frame);
    };
  }, [
    channelId,
    targetConversationId,
    conversationCount,
    isRichRenderingEnabled,
    promoteVisibleRows,
    rows.length,
  ]);

  const handleTargetRowReady = useCallback(
    (rowId: string): void => {
      if (!targetConversationId || rowId !== targetConversationId) return;
      if (scrollStateRef.current.didUserScroll) return;

      const targetIndex =
        displayRowIndexesRef.current.byConversationId.get(targetConversationId) ?? -1;
      if (targetIndex < 0) return;
      if (usesInitialAnchorPlacement) {
        confirmInitialAnchorPlacement();
        return;
      }
      scheduleAnchorLanding();
    },
    [
      confirmInitialAnchorPlacement,
      scheduleAnchorLanding,
      targetConversationId,
      usesInitialAnchorPlacement,
    ],
  );

  const renderRow = useCallback(
    ({ item }: { item: ChatRow }): ReactElement => {
      if (item.type === 'date') {
        const dateText = formatDatePill(item.date);
        return (
          <DatePill
            dateText={dateText}
            onLayout={layout =>
              recordDateSeparatorLayout('channel-inline', item.id, item.date, dateText, layout)
            }
          />
        );
      }
      if (item.type === 'unread-divider') {
        return <UnreadMessagesDivider />;
      }
      const animateEntrance = rowEntranceController.getPending().has(item.id);
      return (
        <ChatMessageListRow
          item={item}
          animateEntrance={animateEntrance}
          {...(channelType !== undefined ? { channelType } : {})}
          {...(targetConversationId !== undefined ? { targetConversationId } : {})}
          currentUser={currentUser}
          conversation={conversationsById.get(item.paint.conversationId)}
          presentationStore={rowPresentationStore}
          handleTargetRowReady={handleTargetRowReady}
          isRichRenderingEnabled={isRichRenderingEnabled}
          onRowContentExpanded={handleRowContentExpanded}
          onMessageLongPress={onMessageLongPress}
          onMessagePress={onMessagePress}
        />
      );
    },
    // rowEntranceTick is intentionally included so this callback is recreated when
    // the set of pending entrance animations changes, even though the callback body
    // only reads the controller indirectly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      currentUser,
      channelType,
      conversationsById,
      handleRowContentExpanded,
      rowEntranceController,
      rowEntranceTick,
      rowPresentationStore,
      isRichRenderingEnabled,
      onMessagePress,
      onMessageLongPress,
      handleTargetRowReady,
      recordDateSeparatorLayout,
      targetConversationId,
    ],
  );

  const onStartReached = useCallback(() => {
    if (
      !shouldAllowChatPagination({
        didUserScroll: scrollStateRef.current.didUserScroll,
        hasMore: hasMoreBefore,
        displayRowCount: displayRows.length,
      })
    ) {
      return;
    }
    loadOlder();
  }, [displayRows.length, hasMoreBefore, loadOlder]);

  const onEndReached = useCallback(() => {
    requestNewerPageFromUserScroll();
  }, [requestNewerPageFromUserScroll]);
  // Direct bottom opens follow the LegendList chat contract: initialScrollAtEnd +
  // maintainScrollAtEnd own tail positioning. Keep MVCP's data setting stable;
  // changing the native MVCP contract
  // during an open can make iOS recalculate from a stale offset. The callback
  // below temporarily declines position restoration while the direct tail is
  // stabilizing, without detaching and reattaching the native behavior.
  //
  // `shouldRestorePosition` decides when LegendList anchors visible content across data changes
  // (true = anchor/keep position, false = skip so `maintainScrollAtEnd` owns the tail). An
  // unscrolled route-anchored open keeps data-change MVCP active even after
  // the target is confirmed. Only the user's drag transfers ownership; after
  // that, we anchor whenever the settled viewport is away from the bottom —
  // either the user scrolled up, OR the open landed on the unread divider.
  // Anchoring after a divider landing is essential: when newer messages stream
  // in, MVCP holds the divider in place instead of letting the position drift.
  // For settled direct opens, we skip anchoring only at the true bottom, where
  // `maintainScrollAtEnd` must follow new messages down. Read the list's live state so it reflects
  // the exact position when LegendList runs the anchor instead of relying on a possibly-delayed
  // React scroll event.
  const hasRequestedAnchorRef = useRef(hasRequestedAnchor);
  hasRequestedAnchorRef.current = hasRequestedAnchor;
  const maintainVisibleContentPosition = useMemo(
    () => ({
      data: true,
      // Match the thread list: anchor visible content across pure row-height
      // changes (async markdown/image/link-preview measurement, lite->rich row
      // promotion) so growth above the viewport does not shift what the user is
      // reading. The library skips this adjustment while maintainScrollAtEnd owns
      // the tail (shouldSkipAdjustForMaintainedEnd), so tail-follow is unaffected.
      size: true,
      shouldRestorePosition: (): boolean => {
        if (
          shouldSkipChatListRestoreForLocalSend({
            localSendOwnsTail: localSendOwnsTailRef.current,
            shouldMaintainTail: shouldMaintainTailRef.current,
          })
        ) {
          return false;
        }
        if (
          shouldRestoreAnchoredOpenPosition({
            hasRequestedAnchor: hasRequestedAnchorRef.current,
            didUserScroll: scrollStateRef.current.didUserScroll,
          })
        ) {
          return true;
        }
        if (
          shouldSuspendVisibleContentAnchoringForTailOpen({
            shouldPromoteLatestTail,
            shouldMaintainTail,
            didUserScroll: scrollStateRef.current.didUserScroll,
          })
        ) {
          return false;
        }
        if (contentExpansionAnchorStateRef.current.active) return true;
        const listState = listRef.current?.getState();
        const distanceFromBottom = listState
          ? listState.contentLength - (listState.scroll + listState.scrollLength)
          : scrollStateRef.current.distanceFromBottom;
        return distanceFromBottom > NEAR_END_AUTO_SCROLL_THRESHOLD;
      },
    }),
    [shouldMaintainTail, shouldPromoteLatestTail],
  );
  const shouldShowInitialLoadError = messages.length === 0 && initialLoadError !== null;
  const showSkeleton =
    !shouldShowInitialLoadError &&
    rows.length === 0 &&
    (isInitialLoading ||
      openPhase !== 'liveFresh' ||
      (hasRequestedAnchor && linkedAnchorStatus === 'pending'));
  const shouldCompleteEmptyInitialLoad =
    !didListInitialLoadComplete &&
    displayRows.length === 0 &&
    !showSkeleton &&
    !isInitialLoading &&
    openPhase === 'liveFresh';
  const shouldUseInitialLoadFallback =
    !didListInitialLoadComplete &&
    !isInitialLoading &&
    !isListRowsWithheld &&
    (displayRows.length > 0 || openPhase === 'liveFresh');
  useEffect(() => {
    if (!shouldCompleteEmptyInitialLoad) return;
    markInitialLoadComplete();
  }, [markInitialLoadComplete, shouldCompleteEmptyInitialLoad]);
  useEffect(() => {
    if (!shouldUseInitialLoadFallback) return;
    const timer = setTimeout(() => {
      // A native onLoad can fire while the list is empty and never fire again
      // when data arrives. Keep the open state bounded so rich hydration and
      // the parent shell cannot wait forever on that one callback.
      if (shouldUseInitialLoadFallback) markInitialLoadComplete();
    }, INITIAL_LIST_LOAD_FALLBACK_MS);
    return (): void => clearTimeout(timer);
  }, [markInitialLoadComplete, openIdentityKey, shouldUseInitialLoadFallback]);
  const isOpenSurfaceRevealed = revealedChatListIdentityKey === openIdentityKey;
  const shouldShowOpenPlaceholder =
    !isOpenSurfaceRevealed &&
    !isRouteAnchorUnavailable &&
    !(isRouteAnchorPlacementUnavailable && !hasRevealedChatOpen && displayRows.length === 0) &&
    !isWarmAnchorPlacementPending &&
    ((isLinkResolving && !hasWarmAnchorSeed && displayRows.length === 0) ||
      (!shouldShowInitialLoadError &&
        ((displayRows.length === 0 &&
          !hasRequestedAnchor &&
          (isInitialLoading || openPhase !== 'liveFresh')) ||
          shouldBlockChatListReveal)));

  const initialLoadState: ChatInitialLoadState = shouldShowInitialLoadError
    ? isLinkResolving
      ? 'loading'
      : 'error'
    : shouldShowOpenPlaceholder || !didListInitialLoadComplete
      ? 'loading'
      : 'ready';

  useEffect(() => {
    if (shouldShowOpenPlaceholder) {
      reportNotificationChatSkeletonShown({ channelId });
      reportActivityChatSkeletonShown({ channelId });
      beginChatOpenSkeleton({
        identityKey: openIdentityKey,
        surface: 'channel',
        entry: isNotificationOpen ? 'notification' : 'direct',
      });
      return;
    }

    reportNotificationListReady({ channelId });
    reportActivityListReady({ channelId });
    // The user-visible highlight overlay (see MessageHighlight in the row
    // renderer) paints as soon as the target row is in data and the list is
    // revealed. Scroll landing confirmation is a separate concern and can be
    // skipped when the row is already near the viewport, which would otherwise
    // leave the highlight watchdog to time out on an already-highlighted open.
    if (hasRouteAnchor && targetRowIndex !== null) {
      reportOpenMessageHighlighted();
    }
    emitChatOpenSkeletonCompleted(
      completeChatOpenSkeleton({
        identityKey: openIdentityKey,
        surface: 'channel',
      }),
    );
  }, [
    channelId,
    hasRouteAnchor,
    isNotificationOpen,
    openIdentityKey,
    reportOpenMessageHighlighted,
    shouldShowOpenPlaceholder,
    targetRowIndex,
  ]);

  useEffect(() => {
    const identityKey = openIdentityKey;
    return (): void => {
      emitChatOpenSkeletonCompleted(abandonChatOpenSkeleton({ identityKey, surface: 'channel' }));
    };
  }, [openIdentityKey]);

  useLayoutEffect(() => {
    onOpenPlaceholderChange?.(shouldShowOpenPlaceholder);
  }, [onOpenPlaceholderChange, openIdentityKey, shouldShowOpenPlaceholder]);

  useEffect(() => {
    onInitialLoadStateChange?.(initialLoadState);
  }, [initialLoadState, onInitialLoadStateChange]);

  useEffect(() => {
    const signature = [
      openCycleState.initialSeedRows,
      messages.length,
      latestConversationsList.length,
      paintRows.length,
      displayRows.length,
      isInitialLoadComplete,
      openPhase,
      shouldShowOpenPlaceholder,
    ].join(':');
    if (openCycleState.lastOpenStateSignature === signature) return;
    openCycleState.lastOpenStateSignature = signature;

    logger.info(Event.LOTUS_CHAT_OPEN_TIMING, {
      milestone: 'chat_open_data_state',
      cycleId: openCycleState.cycleId,
      channelId,
      ...(entryPoint ? { entryPoint } : {}),
      ...(isNotificationOpen ? { notificationOpen: true } : {}),
      ...(hasRequestedAnchor ? { hasRequestedAnchor: true } : {}),
      seedRows: openCycleState.initialSeedRows,
      messageRows: messages.length,
      latestRows: latestConversationsList.length,
      displaySource: messages.length > 0 ? 'window' : 'empty',
      paintRows: paintRows.length,
      displayRows: displayRows.length,
      initialLoadComplete: isInitialLoadComplete,
      openPhase,
      placeholderShown: shouldShowOpenPlaceholder,
      openLatencyMs: getElapsedMs(openCycleState.startedAtMs),
    });
  }, [
    channelId,
    displayRows.length,
    entryPoint,
    hasRequestedAnchor,
    isInitialLoadComplete,
    isNotificationOpen,
    latestConversationsList.length,
    messageQueriesEnabled,
    messages.length,
    openCycleState,
    openPhase,
    paintRows.length,
    shouldShowOpenPlaceholder,
  ]);

  useEffect(() => {
    if (rowEntranceController.hasRevealed()) return;
    rowEntranceController.onRevealed(displayRows);
    setRowEntranceTick(tick => tick + 1);
  }, [displayRows, rowEntranceController]);

  useEffect(() => {
    if (!rowEntranceController.hasRevealed()) return;
    if (rowEntranceController.trackNewRows(displayRows)) {
      pendingEntranceCommitTickRef.current = rowEntranceTick + 1;
      setRowEntranceTick(tick => tick + 1);
    }
  }, [displayRows, rowEntranceController, rowEntranceTick]);

  useEffect(() => {
    // The tick that queued pending rows has rendered the animated wrappers. Mark
    // them seen only after that commit so the entrance plays exactly once.
    if (pendingEntranceCommitTickRef.current !== rowEntranceTick) return;
    rowEntranceController.flushPending();
    pendingEntranceCommitTickRef.current = null;
  }, [rowEntranceController, rowEntranceTick]);

  const keyboardAwareList = (
    <KeyboardAwareLegendList
      ref={listRef}
      alignItemsAtEnd
      applyWorkaroundForContentInsetHitTestBug
      automaticallyAdjustContentInsets={false}
      contentContainerStyle={listContentContainerStyle}
      contentInsetAdjustmentBehavior='never'
      contentInsetEndAdjustment={composerGeometry.extraHeight}
      data={listRows}
      drawDistance={CHAT_LIST_DRAW_DISTANCE}
      {...(freeze ? { freeze } : {})}
      key={listInstanceKey}
      recycleItems
      estimatedItemSize={estimatedItemSize}
      getFixedItemSize={getChatRowFixedSize}
      getItemType={getChatRowItemType}
      initialScrollAtEnd={shouldUseInitialScrollAtEnd}
      {...(shouldExposeInitialScrollIndex ? { initialScrollIndex } : {})}
      itemsAreEqual={areChatRowsEqual}
      keyboardShouldPersistTaps={CHAT_KEYBOARD_SHOULD_PERSIST_TAPS}
      keyExtractor={keyExtractChatRow}
      maintainScrollAtEnd={maintainScrollAtEnd}
      maintainVisibleContentPosition={maintainVisibleContentPosition}
      onItemSizeChanged={handleItemSizeChanged}
      onLoad={handleListLoad}
      onScroll={onScroll}
      onScrollBeginDrag={handleScrollBeginDrag}
      onScrollEndDrag={handleScrollSettled}
      onMomentumScrollEnd={handleScrollSettled}
      scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
      onStartReached={onStartReached}
      onStartReachedThreshold={1.5}
      onEndReached={onEndReached}
      onEndReachedThreshold={1.5}
      renderItem={renderRow}
      {...(keyboardOffset !== undefined ? { keyboardOffset } : {})}
      style={LIST_FLEX_STYLE}
    />
  );
  const chatList = (
    <ChatRenderProvider value={chatRenderTokens}>{keyboardAwareList}</ChatRenderProvider>
  );

  return (
    <ReactionsSheetHost getConversationById={getConversationById} currentUser={currentUser}>
      <View style={{ flex: 1 }} onLayout={handleFirstLayout}>
        <Animated.View style={[{ flex: 1 }, chatListRevealStyle]}>{chatList}</Animated.View>

        {shouldShowInitialLoadError && !isLinkResolving ? (
          <Animated.View
            className='absolute inset-0 items-center justify-center gap-3 px-8'
            style={composerErrorOverlayStyle}
          >
            <Text className='text-center text-base font-medium text-foreground'>
              Couldn&apos;t load messages
            </Text>
            <Text className='text-center text-sm text-muted-foreground'>
              Check your connection and try again.
            </Text>
            <Pressable
              accessibilityRole='button'
              className='rounded-full bg-primary px-5 py-2.5'
              onPress={retryInitialLoad}
            >
              <Text className='font-medium text-primary-foreground'>Try again</Text>
            </Pressable>
          </Animated.View>
        ) : null}

        {isRouteAnchorUnavailable ? (
          <Animated.View
            pointerEvents='none'
            className='absolute inset-0 items-center justify-center px-6'
            style={composerErrorOverlayStyle}
          >
            <Text className='text-center text-base font-medium text-foreground'>
              {messageId ? 'This message is unavailable.' : 'This conversation is unavailable.'}
            </Text>
          </Animated.View>
        ) : null}

        {isRouteAnchorPlacementUnavailable && !hasRevealedChatOpen && displayRows.length === 0 ? (
          <Animated.View
            pointerEvents='none'
            className='absolute inset-0 items-center justify-center px-6'
            style={composerErrorOverlayStyle}
          >
            <Text className='text-center text-base font-medium text-foreground'>
              Couldn&apos;t position this message.
            </Text>
          </Animated.View>
        ) : null}

        {shouldShowOpenPlaceholder ? (
          <Animated.View
            pointerEvents='none'
            style={[
              {
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                justifyContent: 'flex-end',
                overflow: 'hidden',
                paddingHorizontal: 16,
              },
              composerErrorOverlayStyle,
            ]}
          >
            {OPEN_PLACEHOLDER_ROW_KEYS.map(key => (
              <ConversationSkeleton key={key} />
            ))}
          </Animated.View>
        ) : null}

        {floatingDateText && floatingDateCreatedAt !== null ? (
          <Animated.View
            pointerEvents='none'
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                zIndex: 10,
              },
              pillAnimatedStyle,
            ]}
          >
            <DatePill
              dateText={floatingDateText}
              onLayout={layout =>
                recordDateSeparatorLayout(
                  'channel-floating',
                  null,
                  floatingDateCreatedAt,
                  floatingDateText,
                  layout,
                )
              }
            />
          </Animated.View>
        ) : null}
      </View>
    </ReactionsSheetHost>
  );
});
