import type { LegendListRef } from '@legendapp/list/react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSelector } from '@xstate/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  Alert,
  BackHandler,
  InteractionManager,
  Keyboard,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { KeyboardAwareLegendList, useKeyboardScrollToEnd } from '@legendapp/list/keyboard';
import { KeyboardController, KeyboardGestureArea } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, parseInitialMessageMd } from '@xyne/shared';

import { MessageHighlight } from '@/src/components/chat/message-highlight';
import { DatePillBadge, resolveTopIndex } from '@/src/components/chat/date-pill';
import { formatDateLabel, isSameDay } from '@/src/components/chat/message/message.utils';
import {
  getThreadHeaderCollapsedHeight,
  ThreadHeaderV3,
} from '@/src/components/chat/thread-header-v3';
import { CallTranscriptCard } from '@/src/components/chat/call-transcript-card';
import {
  MessageActionsSheet,
  type MessageActionsSheetHandle,
  MessageReminderOptionsSheet,
  type MessageActionsTarget,
  messageItemToActionsTarget,
  useMessageActions,
} from '@/src/features/chat/v2/components/message-actions-sheet';
import { JoinChannelCard } from '@/src/components/chat/join-channel-card';
import {
  ConversationInput,
  getConversationInputMinimumHeight,
  type ChatInputEditingMessage,
  type ChatInputSendPayload,
} from '@/src/components/input-composer';
import { findZeroDraftForComposer } from '@/src/components/input-composer/utils/drafts';
import { getZeroDraftFlushContent } from '@/src/components/input-composer/utils/flushComposerDraft';
import { composerDraftLookupId } from '@/src/features/drafts-sent/drafts-sent-utils';
import type { MessageItem } from '@/src/components/message-composer';
import { useJoinableChannel } from '@/src/hooks/useJoinableChannel';
import { useSelf } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { stateMachineActor } from '@/src/machines/stateMachine';
import { mutators } from '@/src/zero/mutators';
import { subscribeMutationRestore } from '@/src/zero/awaitMutation';
import {
  getStatus,
  getThreadSnapshot,
  sendMessage,
  useMessages,
  usePendingForThread,
} from '@xyne/shared/messages';
import { buildComposerContentForSend } from '@/src/utils/prepareComposerContentForSend';
import { dismissRegisteredComposerFocus } from '@/src/utils/composerFocusDismissRegistry';
import { consumeListTapDismissSuppression } from '@/src/utils/listTapDismissSuppression';
import { toSharedMessagesOptions } from '@/src/features/chat/messagesOptions.types';
import { awaitKeyboardHidden } from '@/src/features/chat/v2/keyboard/awaitKeyboardHidden';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';
import {
  CHAT_KEYBOARD_GESTURE_INTERPOLATOR,
  CHAT_KEYBOARD_GESTURE_OFFSET,
  getChatKeyboardGeometry,
  includesChatComposerBottomSafeArea,
  type ChatComposerInsetMode,
  CHAT_KEYBOARD_SHOULD_PERSIST_TAPS,
} from '@/src/features/chat/v2/chatKeyboardConfig';
import {
  ChatComposerDock,
  ChatComposerScrollToBottomButton,
} from '@/src/features/chat/v2/components/chat/chat-composer-dock';
import { useChatComposerGeometry } from '@/src/features/chat/v2/hooks/use-chat-composer-geometry';
import { useSendScrollToTail } from '@/src/features/chat/v2/hooks/useSendScrollToTail';
import { ChatRenderProvider } from '@/src/features/chat/v2/components/chat/message-row';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/chat-render-tokens';
import { ChatPaintRowLite } from '@/src/features/chat/v2/components/chat/chat-paint-row-lite';
import { ChatRowEntrance } from '@/src/features/chat/v2/components/chat/chat-row-entrance';
import { ChatUserProfileActionsSheetProvider } from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import { ReactionsSheetHost } from '@/src/features/chat/v2/components/chat/reactions-sheet-host';
import { RowEntranceController } from '@/src/features/chat/v2/components/chat/chat-row-entrance-controller';
import {
  ChatComposer,
  ConversationSkeleton,
  type ConversationItem,
} from '@/src/features/chat/v2/components/conversation-composer';
import { buildChatPaintRows } from '@/src/features/chat/v2/paint/buildChatPaintRows';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { retryPendingMessageFromV2 } from '@/src/features/chat/v2/pendingRetryTelemetry';
import { collectPaintEmojiIds } from '@/src/features/chat/v2/paint/chatPaintEmoji';
import {
  estimateCharsPerLine,
  getChatRowEstimatedHeight,
  getDateRowEstimatedHeight,
} from '@/src/features/chat/v2/paint/chatPaintSizing';
import {
  prefetchMediaPreviews,
  type MediaPreviewRequest,
} from '@/src/features/chat/v2/media/mediaPreviewCache';
import { prefetchMtlsEmojiUris } from '@/src/hooks/useMtlsEmoji';
import {
  getThreadMediaPreviewRequest,
  getThreadMessageId,
  dedupeAndSortThreadMessages,
  isThreadTargetCached,
  mergeOpeningThreadMessages,
  readPositiveCount,
  shouldHoldThreadTargetWhileEmpty,
  toThreadPaintConversation,
  withoutThreadReplyChrome,
  type ThreadPaintItem,
} from '@/src/features/chat/v2/components/chat/chat-thread-helpers';
import {
  logChatOpenSummary,
  type ChatOpenPaintSource,
  type ChatOpenTimingTelemetry,
} from '@/src/features/chat/v2/chatOpenTimingLogger';
import {
  CHAT_OPEN_SYNC_TIMEOUT_MS,
  deriveChatOpenCase,
  getChatPaintMessageItemType,
  shouldConcealChatListForOpenIdentity,
  shouldHoldWarmChatPlacement,
  shouldKeepSeededTailWindow,
  shouldRevealWarmChatWindow,
  shouldRestoreThreadVisiblePosition,
  shouldKeepThreadLandingScroll,
  shouldHoldChatComposer,
  resolveAnchorLandingPass,
  type ChatOpenCase,
} from '@/src/features/chat/v2/components/chat/chat-list-policy';
import { isMeasuredRowVisible } from '@/src/features/chat/v2/landing/messageLanding';
import { releaseChatOpen } from '@/src/utils/openChatRoute';
import { isFlowJsonHtml } from '@/src/utils/flowJsonMarkdown';
import { shouldKeepChatPaintPreview } from '@/src/features/chat/v2/components/chat/chat-paint-preview-policy';
import { logger } from '@/src/utils/logger';
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
import { HTML_TAG_OR_EMPTY, stripHtmlTags } from '@/src/utils/htmlText';

const ANCHOR_TOP_GAP = 12;
const TAP_DISMISS_MOVE_THRESHOLD = 8;
const SCROLL_TO_BOTTOM_THRESHOLD = 200;
const THREAD_RICH_HYDRATION_DELAY_MS = 220;
const THREAD_MEDIA_HYDRATION_DELAY_MS = 360;
const THREAD_OPEN_REVEAL_DURATION_MS = 160;
const THREAD_VISIBLE_MEDIA_FALLBACK_WINDOW = 8;
const THREAD_REPLY_DIVIDER_HEIGHT = 42;
const THREAD_REPLY_DIVIDER_TOP_GAP = 8;
const THREAD_REPLY_DIVIDER_GUTTER = 40;
const THREAD_REPLY_DIVIDER_LABEL_MIN_WIDTH = 64;

const THREAD_OPEN_PLACEHOLDER_ROW_KEYS = Array.from(
  { length: 5 },
  (_, index) => `thread-open-placeholder-${index}`,
);
const EMPTY_THREAD_MESSAGES: MessageItem[] = [];
const THREAD_MAINTAIN_VISIBLE_CONTENT_POSITION = { data: true, size: true } as const;
const THREAD_LIST_DRAW_DISTANCE = 250;
const MAX_REASONABLE_ROUTE_OPEN_LATENCY_MS = 30_000;

const stripHtml = (html: string): string =>
  stripHtmlTags(html, HTML_TAG_OR_EMPTY)
    .replace(/&nbsp;/g, ' ')
    .trim();

const getRouteOpenLatencyMs = (openStartedAtMs: number | null | undefined): number | null => {
  if (typeof openStartedAtMs !== 'number' || !Number.isFinite(openStartedAtMs)) return null;
  const latencyMs = Math.max(0, Date.now() - openStartedAtMs);
  return latencyMs <= MAX_REASONABLE_ROUTE_OPEN_LATENCY_MS ? Math.round(latencyMs) : null;
};

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const getElapsedMs = (startedAtMs: number): number =>
  Math.max(0, Math.round(nowMs() - startedAtMs));

const runAfterFirstPaint = (callback: () => void): { cancel: () => void } => {
  let cancelled = false;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;

  firstFrame = requestAnimationFrame(() => {
    if (cancelled) return;
    secondFrame = requestAnimationFrame(() => {
      if (!cancelled) callback();
    });
  });

  return {
    cancel: (): void => {
      cancelled = true;
      if (firstFrame !== null) cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) cancelAnimationFrame(secondFrame);
    },
  };
};

export type ChatThreadProps = {
  channelId: string;
  threadId: string;
  composerInsetMode: ChatComposerInsetMode;
  messageId?: string;
  parentTicketMd?: string | null;
  parentTicketId?: string | null;
  /**
   * Called when the ticket card of the injected parent-ticket row is tapped.
   * Hosts that already show the ticket (ticket details) use this to switch to
   * their Overview tab instead of navigating to the ticket route.
   */
  onParentTicketPress?: () => void;
  from?: string;
  openStartedAtMs?: number | null | undefined;
  chatOpenAttemptId?: string | undefined;
  notificationOpenKind?: string | undefined;
  // Keep the header mounted while route-level surface checks are pending.
  isSurfacePending?: boolean;
  hideHeader?: boolean;
  isTranscript?: boolean;
};

type EditingTarget = {
  messageId: string;
  conversationId: string;
  channelId: string;
  content: string;
};

type ThreadOpenMessageSource = 'none' | 'thread_cache' | 'mixed_zero_thread_cache' | 'zero';
type ThreadLandingSnapshot = {
  visible: boolean;
};

const getThreadOpenPaintSource = (source: ThreadOpenMessageSource): ChatOpenPaintSource =>
  source === 'zero' ? 'backend' : source;

export function ChatThread(props: ChatThreadProps): ReactElement {
  return (
    <ChatUserProfileActionsSheetProvider>
      <ChatThreadInner {...props} />
    </ChatUserProfileActionsSheetProvider>
  );
}

function ChatThreadInner({
  channelId,
  threadId,
  messageId,
  parentTicketMd,
  parentTicketId,
  onParentTicketPress,
  from,
  openStartedAtMs,
  chatOpenAttemptId,
  notificationOpenKind,
  isSurfacePending = false,
  hideHeader = false,
  isTranscript = false,
  composerInsetMode,
}: ChatThreadProps): ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const includeBottomSafeArea = includesChatComposerBottomSafeArea(composerInsetMode);
  const keyboardGeometry = useMemo(
    () => getChatKeyboardGeometry(insets.bottom, composerInsetMode),
    [composerInsetMode, insets.bottom],
  );
  const threadHeaderHeight = hideHeader ? 0 : getThreadHeaderCollapsedHeight(insets.top);
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const estimatedCharsPerLine = useMemo(
    () => estimateCharsPerLine(Math.max(120, windowWidth * 0.78 - 12)),
    [windowWidth],
  );
  const scrollProgress = useSharedValue(0);
  const threadListRevealOpacity = useSharedValue(1);
  const didLogThreadOpenSummaryRef = useRef(false);
  const firstVisibleThreadPaintRef = useRef<{
    latencyMs: number;
    source: ChatOpenPaintSource;
  } | null>(null);
  const threadOpenStartedAtRef = useRef(nowMs());
  const routeOpenLatencyMsRef = useRef(getRouteOpenLatencyMs(openStartedAtMs));
  const threadOpenCycleIdRef = useRef(
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const loggedThreadOpenIdentityKeyRef = useRef<string | null>(null);

  const datePillAnimatedStyle = useAnimatedStyle(() => ({
    opacity: scrollProgress.value < 0.05 ? 0 : 1,
    transform: [{ translateY: (1 - scrollProgress.value) * -30 }],
  }));
  const threadListRevealStyle = useAnimatedStyle(() => ({
    opacity: threadListRevealOpacity.value,
    transform: [{ translateY: (1 - threadListRevealOpacity.value) * 4 }],
  }));

  const [datePillLabel, setDatePillLabel] = useState<string | null>(null);
  const [datePillCreatedAt, setDatePillCreatedAt] = useState<number | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const currentUser = useSelf();
  const usersForIdentityRefresh = useSelector(stateMachineActor, state => state.context.users);
  const zero = useZero();
  const zeroRef = useRef(zero);
  zeroRef.current = zero;
  const [zeroDrafts] = useQuery(queries.userDrafts());
  const existingZeroDraftContentRef = useRef('');
  existingZeroDraftContentRef.current =
    findZeroDraftForComposer(zeroDrafts ?? [], channelId ?? '', threadId)?.content ?? '';
  const { channel, shouldShowJoinChannel } = useJoinableChannel(channelId);
  const composerHeightResetKey = `${channelId}:${threadId}:${hideHeader ? 'embedded' : 'full'}:${composerInsetMode}`;
  const listRef = useRef<LegendListRef>(null);
  // Freezes keyboard-driven list layout while a bottom sheet is open or a send
  // scroll is in flight, so the KeyboardStickyView composer doesn't visibly
  // settle mid-animation behind either. scrollMessageToEnd (send) and the
  // sheets both need to freeze the list, and neither knows about the other —
  // applyFreeze below is the single writer that ORs both owners together.
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });
  const isLongPressPendingRef = useRef(false);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!channelId || !threadId) return;
    return (): void => {
      void zeroRef.current.mutate(
        mutators.activities.markThreadActivitiesAsReadV2({
          conversationId: threadId,
          timestamp: Date.now(),
          draftMessageId: uuidv4(),
          draftMessage: getZeroDraftFlushContent(
            composerDraftLookupId(channelId, threadId),
            existingZeroDraftContentRef.current,
          ),
          participantId: uuidv4(),
        }),
      );
    };
  }, [channelId, threadId]);
  const postPaintTaskRef = useRef<{ cancel: () => void } | null>(null);
  const richHydrationInteractionRef = useRef<ReturnType<
    typeof InteractionManager.runAfterInteractions
  > | null>(null);
  const richHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapDismissTouchRef = useRef({ pageX: 0, pageY: 0, moved: false });
  const paintItemsRef = useRef<ThreadPaintItem[]>([]);
  const didUserScrollRef = useRef(false);
  const dateSeparatorRecorderRef = useRef<DateSeparatorObservationRecorder | null>(null);
  if (dateSeparatorRecorderRef.current === null) {
    dateSeparatorRecorderRef.current = createDateSeparatorObservationRecorder();
  }
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
        phase: didUserScrollRef.current ? 'interaction' : 'initial-open',
        channelId,
        conversationId: threadId,
        boundaryId,
        createdAtMs,
        formattedLabel,
        layout,
        screenWidthDp: windowWidth,
        fontScale,
      });
    },
    [channelId, fontScale, threadId, windowWidth],
  );
  const confirmedThreadAnchorKeyRef = useRef<string | null>(null);
  const isSendFollowingTailRef = useRef(false);
  // Mirror of `shouldMaintainThreadTail` (computed below) so the MVCP
  // `shouldRestorePosition` callback can read the live value when LegendList
  // runs it, without reordering the memo above its definition.
  const shouldMaintainThreadTailRef = useRef(false);
  const [shouldMaintainThreadTail, setShouldMaintainThreadTail] = useState(!messageId);
  const [didUserScroll, setDidUserScroll] = useState(false);
  // Live mirror of the list's scrolled-up state so an edit-send can decide,
  // without a re-render, whether to re-pin to the tail (same signal the
  // scroll-to-bottom button reads).
  const isScrolledUpRef = useRef(false);
  const [postPaintReady, setPostPaintReady] = useState(false);
  const [richHydrationReady, setRichHydrationReady] = useState(false);
  const [mediaHydrationReady, setMediaHydrationReady] = useState(false);
  const [expandedConversationIds, setExpandedConversationIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const expandedConversationKey = useMemo(
    () => Array.from(expandedConversationIds).sort().join(':'),
    [expandedConversationIds],
  );
  const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null);
  const composerGeometry = useChatComposerGeometry(
    getConversationInputMinimumHeight(insets.bottom, includeBottomSafeArea),
    composerHeightResetKey,
  );
  const [threadListViewportHeight, setThreadListViewportHeight] = useState(0);
  // Tracks a send-scroll owning the freeze SharedValue, separately from the
  // sheet-derived owners below, so closing one doesn't clobber a freeze the
  // other still needs (mirrors ChatChannelScreen's ref-counting).
  const isSendScrollInFlightRef = useRef(false);
  const sendScrollSequenceRef = useRef(0);
  const handleBackNavigation = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace({
      pathname: '/chat/[channelId]',
      params: { channelId },
    });
  }, [channelId, router]);

  useFocusEffect(
    useCallback(() => {
      if (hideHeader) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBackNavigation();
        return true;
      });
      return (): void => {
        subscription.remove();
      };
    }, [handleBackNavigation, hideHeader]),
  );

  const anchorKey = `${threadId}:${messageId ?? ''}`;
  const shouldUseStableActivityOpenIdentity = from === 'activity' && !!messageId;
  const threadOpenIdentityKey = `${anchorKey}:${
    shouldUseStableActivityOpenIdentity ? 'activity-target' : (openStartedAtMs ?? 'warm')
  }`;
  const threadOpenCaseRef = useRef<{ identityKey: string; value: ChatOpenCase } | null>(null);
  useLayoutEffect(() => {
    setThreadListViewportHeight(0);
  }, [threadOpenIdentityKey]);
  const threadRef = useMemo(
    () => ({
      kind: 'thread' as const,
      channelId,
      conversationId: threadId ?? '',
      isMember: true,
    }),
    [channelId, threadId],
  );
  const openingThreadMessages = useMemo(() => {
    const snapshot = getThreadSnapshot(threadRef);
    return dedupeAndSortThreadMessages(
      (snapshot?.messages ?? EMPTY_THREAD_MESSAGES) as MessageItem[],
      threadId ?? '',
    );
  }, [threadId, threadRef]);
  const derivedThreadOpenCase = deriveChatOpenCase({
    cachedRowCount: openingThreadMessages.length,
    hasRequestedAnchor: !!messageId,
    hasTargetInCachedRows: isThreadTargetCached(openingThreadMessages, messageId),
  });
  if (threadOpenCaseRef.current?.identityKey !== threadOpenIdentityKey) {
    threadOpenCaseRef.current = {
      identityKey: threadOpenIdentityKey,
      value: derivedThreadOpenCase,
    };
  }
  const threadOpenCase = threadOpenCaseRef.current?.value ?? derivedThreadOpenCase;
  useEffect(() => {
    if (!channelId || !threadId || isSurfacePending) return;
    releaseChatOpen(chatOpenAttemptId);
  }, [channelId, chatOpenAttemptId, isSurfacePending, messageId, threadId, threadOpenIdentityKey]);
  const appliedThreadLandingScrollKeyRef = useRef<string | null>(null);
  const threadLandingFrameRef = useRef<number | null>(null);
  const threadLandingPassRef = useRef<{ key: string; passes: number }>({
    key: threadOpenIdentityKey,
    passes: 0,
  });
  const [threadLandingScrollIssuedKey, setThreadLandingScrollIssuedKey] = useState<string | null>(
    null,
  );
  const threadListInstanceLoadedRef = useRef(false);
  const scheduleThreadLandingRef = useRef<(() => void) | null>(null);
  if (
    threadLandingPassRef.current.key !== threadOpenIdentityKey &&
    !threadLandingPassRef.current.key.startsWith(`${threadOpenIdentityKey}:`)
  ) {
    threadLandingPassRef.current = { key: threadOpenIdentityKey, passes: 0 };
  }
  const rowEntranceControllerRef = useRef<RowEntranceController<MessageItem> | null>(null);
  if (
    !rowEntranceControllerRef.current ||
    rowEntranceControllerRef.current.getIdentityKey() !== threadOpenIdentityKey
  ) {
    rowEntranceControllerRef.current = new RowEntranceController<MessageItem>(
      threadOpenIdentityKey,
      {
        getId: (item): string => item.messageId,
      },
    );
  }
  const rowEntranceController = rowEntranceControllerRef.current;
  const [rowEntranceTick, setRowEntranceTick] = useState(0);
  const pendingEntranceCommitTickRef = useRef<number | null>(null);
  const missingPaintItemBreadcrumbKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setExpandedConversationIds(new Set());
  }, [threadId]);

  const handleThreadContentExpanded = useCallback((conversationId: string): void => {
    setExpandedConversationIds(prevIds => {
      if (prevIds.has(conversationId)) return prevIds;
      const nextIds = new Set(prevIds);
      nextIds.add(conversationId);
      return nextIds;
    });
  }, []);

  // Kept for downstream telemetry logging in this file.
  const threadOpenEntryPoint =
    from === 'notification'
      ? 'notification'
      : from === 'activity'
        ? 'activity'
        : from === 'deeplink'
          ? 'thread_deeplink'
          : from === 'channel_thread'
            ? 'channel_thread'
            : 'thread_route';
  void threadOpenEntryPoint;
  void openStartedAtMs;
  void notificationOpenKind;

  const thread = useMessages(
    threadRef,
    toSharedMessagesOptions({
      ...(from === 'notification' && messageId ? { notificationTargetMessageId: messageId } : {}),
    }),
  );
  const pendingForThread = usePendingForThread(threadId ?? '');
  const pendingByMessageId = useMemo(
    () => new Map(pendingForThread.map(entry => [entry.messageId, entry] as const)),
    [pendingForThread],
  );
  // Second call gives us the fetch-status tag. Zero's useQuery dedupes by
  // (query, args) so this doesn't add a real subscription — the two share the
  // same IVM pipeline.
  const [, messagesDetails] = useQuery(
    queries.threadConversationV2({
      conversationId: threadId ?? '',
      channelId,
      isMember: true,
    }),
    { enabled: Boolean(threadId) },
  );
  const messages = useMemo(
    () => dedupeAndSortThreadMessages((thread?.messages ?? []) as MessageItem[], threadId ?? ''),
    [thread, threadId],
  );
  const shouldKeepOpeningThreadWindow =
    shouldKeepSeededTailWindow({
      openCase: threadOpenCase,
      hasRequestedAnchor: !!messageId,
      hasTargetInLiveRows: isThreadTargetCached(messages, messageId),
      didUserScroll,
    }) && messagesDetails.type !== 'complete';
  const messagesForRender = useMemo(() => {
    const merged = mergeOpeningThreadMessages({
      openingMessages: openingThreadMessages,
      liveMessages: messages,
      messageId,
      liveQueryComplete: messagesDetails.type === 'complete',
      threadId: threadId ?? '',
      preserveOpeningWindow: shouldKeepOpeningThreadWindow,
    });
    return merged;
  }, [
    messageId,
    messages,
    messagesDetails.type,
    openingThreadMessages,
    shouldKeepOpeningThreadWindow,
    threadId,
  ]);
  const isThreadQueryError = messagesDetails.type === 'error';
  const isThreadInitialLoading =
    !thread && !isThreadQueryError && messagesDetails.type !== 'complete';
  // Zero is authoritative once the wrapper is present; before that we're
  // rendering from the warm-start cache (or nothing).
  const messageSource: ThreadOpenMessageSource = thread
    ? messagesDetails.type === 'complete'
      ? 'zero'
      : 'thread_cache'
    : 'none';
  const openTelemetry: ChatOpenTimingTelemetry = useMemo(
    () => ({
      cacheHit: !!thread,
      cacheRows: thread?.messages?.length ?? 0,
      initialFetchStatus: messagesDetails.type === 'complete' ? 'complete' : 'running',
    }),
    [thread, messagesDetails.type],
  );

  // `ticket_md` lives on the conversation row, never on `messages`, so row 0 of
  // a ticket thread would otherwise paint as an empty message body. Hosts that
  // already hold the ticket pass it down; everyone else reads it off the thread
  // conversation we are already subscribed to.
  const resolvedParentTicketMd = parentTicketMd ?? thread?.ticket_md ?? null;
  const resolvedParentTicketId = parentTicketId ?? thread?.ticketId ?? null;

  const data = useMemo<MessageItem[]>(() => {
    const threadMessages = messagesForRender;
    if (threadMessages.length === 0 || (!resolvedParentTicketMd && !resolvedParentTicketId)) {
      return threadMessages;
    }

    return threadMessages.map((message, index) =>
      index === 0
        ? ({
            ...message,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            ticket_md: resolvedParentTicketMd,
            ticketId: resolvedParentTicketId,
          } as MessageItem)
        : message,
    );
  }, [messagesForRender, resolvedParentTicketId, resolvedParentTicketMd]);
  const dataRef = useRef(data);
  dataRef.current = data;
  const dataIndexesByMessageId = useMemo(() => {
    const indexes = new Map<string, number>();
    for (let index = 0; index < data.length; index += 1) {
      const messageIdForRow = data[index]?.messageId;
      if (messageIdForRow) {
        indexes.set(messageIdForRow, index);
      }
    }
    return indexes;
  }, [data]);
  const chatRenderTokens = useChatRenderTokens(windowWidth);
  const callThreadMeta = useMemo(() => {
    const parentMessage = data[0];
    if (!parentMessage) return null;

    const meta = parentMessage.metadata as Record<string, unknown> | null | undefined;
    if (meta?.['isCallMessage'] === true && typeof meta?.['callId'] === 'string') {
      return {
        callContent: stripHtml(parentMessage.content ?? ''),
        callId: meta['callId'] as string,
      };
    }
    return null;
  }, [data]);
  const threadConversations = useMemo(
    () =>
      data.map((message, index) =>
        toThreadPaintConversation(message, index, channelId ?? '', threadId ?? ''),
      ),
    [channelId, data, threadId],
  );

  const paintRows = useMemo(() => {
    void usersForIdentityRefresh;
    void data;
    return buildChatPaintRows({
      channelId: channelId ?? '',
      channelType: channel?.scopeType,
      conversations: threadConversations,
      currentUser,
    }).map(row => withoutThreadReplyChrome(row));
  }, [
    channel?.scopeType,
    channelId,
    currentUser,
    data,
    threadConversations,
    usersForIdentityRefresh,
  ]);

  const paintItems = useMemo<ThreadPaintItem[]>(
    () =>
      data.flatMap((message, index) => {
        const conversation = threadConversations[index];
        const paint = paintRows[index];
        if (!conversation || !paint) return [];
        return [{ message, conversation, paint }];
      }),
    [data, paintRows, threadConversations],
  );
  const estimatedThreadItemSizeRef = useRef<{ identityKey: string; value: number } | null>(null);
  const estimatedThreadItemSize = useMemo(() => {
    const cachedEstimate = estimatedThreadItemSizeRef.current;
    if (cachedEstimate?.identityKey === threadOpenIdentityKey) return cachedEstimate.value;
    if (paintItems.length === 0) return 120;

    const sample = paintItems.slice(0, 8);
    const total = sample.reduce(
      (sum, item) => sum + getChatRowEstimatedHeight(item.paint, estimatedCharsPerLine),
      0,
    );
    const estimate = Math.max(72, Math.round(total / sample.length));
    estimatedThreadItemSizeRef.current = { identityKey: threadOpenIdentityKey, value: estimate };
    return estimate;
  }, [estimatedCharsPerLine, paintItems, threadOpenIdentityKey]);
  const paintItemsByMessageId = useMemo(() => {
    const itemsByMessageId = new Map<string, ThreadPaintItem>();
    for (let index = 0; index < paintItems.length; index += 1) {
      const paintItem = paintItems[index];
      if (!paintItem) continue;
      itemsByMessageId.set(getThreadMessageId(paintItem.message, index, threadId ?? ''), paintItem);
    }
    return itemsByMessageId;
  }, [paintItems, threadId]);
  const getPaintItemForMessage = useCallback(
    (message: MessageItem, index: number): ThreadPaintItem | undefined =>
      paintItemsByMessageId.get(getThreadMessageId(message, index, threadId ?? '')),
    [paintItemsByMessageId, threadId],
  );
  useLayoutEffect(() => {
    paintItemsRef.current = paintItems;
  }, [paintItems]);

  const getThreadConversationById = useCallback(
    (conversationId: string): ConversationItem | undefined =>
      paintItems.find(entry => entry.conversation.conversationId === conversationId)?.conversation,
    [paintItems],
  );

  const replyCount = useMemo(() => {
    const loadedReplyCount = data.length > 1 ? data.length - 1 : 0;
    const parentMessage = data[0] as Record<string, unknown> | undefined;
    const parentReplyCount =
      readPositiveCount(parentMessage?.['replyCount']) ||
      readPositiveCount(parentMessage?.['repliesCount']);
    return Math.max(parentReplyCount, loadedReplyCount);
  }, [data]);
  const targetIndex = useMemo(() => {
    if (!messageId) return null;
    const idx = dataIndexesByMessageId.get(messageId) ?? -1;
    return idx >= 0 ? idx : null;
  }, [dataIndexesByMessageId, messageId]);
  const hasWarmThreadTarget = !!messageId && targetIndex !== null;
  const canPositionThreadTarget = messagesDetails.type === 'complete' || hasWarmThreadTarget;
  const landingEmojiIds = useMemo(() => {
    if (!messageId || paintItems.length === 0) return [];
    const priorityIndexes = new Set(
      [0, targetIndex].filter((index): index is number => index !== null),
    );
    return collectPaintEmojiIds(
      [...priorityIndexes]
        .map(index => paintItems[index]?.paint)
        .filter((row): row is ChatPaintRow => row !== undefined),
    );
  }, [messageId, paintItems, targetIndex]);

  useEffect(() => {
    if (landingEmojiIds.length === 0) return;
    // Start the exact landing/root requests as soon as the paint model exists;
    // waiting for list layout makes a background tap compete with every other
    // visible-row warmup and is the source of the delayed emoji pop-in.
    void prefetchMtlsEmojiUris(landingEmojiIds, 2);
  }, [landingEmojiIds]);
  const [confirmedThreadAnchorKey, setConfirmedThreadAnchorKey] = useState<string | null>(null);
  const [revealedThreadOpenIdentityKey, setRevealedThreadOpenIdentityKey] = useState<string | null>(
    null,
  );
  const [loadedThreadOpenIdentityKey, setLoadedThreadOpenIdentityKey] = useState<string | null>(
    null,
  );
  const [threadPlacementUnavailableKey, setThreadPlacementUnavailableKey] = useState<string | null>(
    null,
  );
  const [threadTargetSyncTimedOutKey, setThreadTargetSyncTimedOutKey] = useState<string | null>(
    null,
  );
  useEffect(() => {
    setThreadTargetSyncTimedOutKey(currentKey =>
      currentKey === threadOpenIdentityKey ? null : currentKey,
    );
    if (!messageId || hasWarmThreadTarget || messagesDetails.type !== 'complete') return;

    const timer = setTimeout(() => {
      setThreadTargetSyncTimedOutKey(threadOpenIdentityKey);
    }, CHAT_OPEN_SYNC_TIMEOUT_MS);
    return (): void => clearTimeout(timer);
  }, [hasWarmThreadTarget, messageId, messagesDetails.type, threadOpenIdentityKey]);
  const threadLandingScrollKey = [threadOpenIdentityKey, targetIndex ?? 'missing'].join(':');
  const shouldHoldExactThreadTarget = shouldHoldThreadTargetWhileEmpty({
    messageId,
    hasWarmTarget: hasWarmThreadTarget,
    hasMessages: data.length > 0,
    hasQueryError: isThreadQueryError,
    didUserScroll,
  });
  const getThreadLandingSnapshot = useCallback((): ThreadLandingSnapshot | null => {
    if (!messageId || targetIndex === null) return null;
    const state = listRef.current?.getState?.();
    if (!state) {
      return {
        visible: false,
      };
    }
    return {
      visible: isMeasuredRowVisible({
        state,
        key: messageId,
        index: targetIndex,
        readableTop: (hideHeader ? 12 : 0) + ANCHOR_TOP_GAP,
        readableBottom: state.scrollLength - composerGeometry.totalHeight.value,
      }),
    };
  }, [composerGeometry.totalHeight, hideHeader, messageId, targetIndex]);
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
  const markThreadLandingObserved = useCallback(
    (snapshot = getThreadLandingSnapshot()): boolean => {
      if (!snapshot?.visible) return false;
      confirmedThreadAnchorKeyRef.current = threadLandingScrollKey;
      setConfirmedThreadAnchorKey(threadLandingScrollKey);
      setThreadPlacementUnavailableKey(currentKey =>
        currentKey === threadOpenIdentityKey ? null : currentKey,
      );
      setThreadTargetSyncTimedOutKey(currentKey =>
        currentKey === threadOpenIdentityKey ? null : currentKey,
      );
      reportOpenMessageHighlighted();
      return true;
    },
    [
      getThreadLandingSnapshot,
      reportOpenMessageHighlighted,
      threadLandingScrollKey,
      threadOpenIdentityKey,
    ],
  );
  const acceptThreadLanding = useCallback((): void => {
    confirmedThreadAnchorKeyRef.current = threadLandingScrollKey;
    setConfirmedThreadAnchorKey(threadLandingScrollKey);
    setThreadPlacementUnavailableKey(currentKey =>
      currentKey === threadOpenIdentityKey ? null : currentKey,
    );
    reportOpenMessageHighlighted();
  }, [reportOpenMessageHighlighted, threadLandingScrollKey, threadOpenIdentityKey]);
  const shouldUseThreadInitialScrollAtEnd = !messageId && data.length > 0;
  const usesInitialThreadAnchorPlacement =
    !threadListInstanceLoadedRef.current &&
    !!messageId &&
    canPositionThreadTarget &&
    targetIndex !== null;
  // Initial placement owns an anchored open until the exact row is measured;
  // otherwise MVCP can preserve the pre-open viewport during composer/list layout.
  const maintainVisibleContentPosition = useMemo(
    () => ({
      ...THREAD_MAINTAIN_VISIBLE_CONTENT_POSITION,
      shouldRestorePosition: (): boolean =>
        shouldRestoreThreadVisiblePosition({
          hasRouteAnchor: !!messageId,
          didUserScroll: didUserScrollRef.current,
          isFollowingTail:
            isSendFollowingTailRef.current ||
            (shouldMaintainThreadTailRef.current && !isScrolledUpRef.current),
        }),
    }),
    [messageId, threadOpenIdentityKey],
  );
  const initialScrollIndex = useMemo(() => {
    if (data.length === 0) return undefined;
    if (!canPositionThreadTarget) return undefined;
    if (shouldUseThreadInitialScrollAtEnd) return undefined;
    if (messageId && targetIndex !== null) {
      return {
        index: targetIndex,
        viewPosition: 0,
        viewOffset: (hideHeader ? 12 : 0) + ANCHOR_TOP_GAP,
      };
    }
    return undefined;
  }, [
    data.length,
    canPositionThreadTarget,
    hideHeader,
    messageId,
    shouldUseThreadInitialScrollAtEnd,
    targetIndex,
  ]);
  const shouldExposeInitialScrollIndex =
    initialScrollIndex !== undefined &&
    !threadListInstanceLoadedRef.current &&
    threadLandingScrollIssuedKey !== threadLandingScrollKey;

  if (confirmedThreadAnchorKey !== null) {
    confirmedThreadAnchorKeyRef.current = confirmedThreadAnchorKey;
  }
  shouldMaintainThreadTailRef.current = !shouldShowJoinChannel && shouldMaintainThreadTail;

  const isResolvingDeepLink =
    !!messageId &&
    !isThreadInitialLoading &&
    !isThreadQueryError &&
    messagesDetails?.type !== 'complete' &&
    data.length === 0;
  const isWaitingForAnchorTarget =
    !!messageId &&
    data.length === 0 &&
    targetIndex === null &&
    !isThreadQueryError &&
    messagesDetails?.type !== 'complete' &&
    !didUserScroll;
  const isThreadSurfaceRevealed = revealedThreadOpenIdentityKey === threadOpenIdentityKey;
  const isThreadTargetPlacementPending =
    !!messageId &&
    targetIndex !== null &&
    !didUserScroll &&
    !isThreadSurfaceRevealed &&
    confirmedThreadAnchorKey !== threadLandingScrollKey;
  const isThreadPlacementUnavailable = threadPlacementUnavailableKey === threadOpenIdentityKey;
  const isThreadTargetSyncTimedOut = threadTargetSyncTimedOutKey === threadOpenIdentityKey;
  const shouldShowThreadQueryError =
    isThreadQueryError && (!messageId ? data.length === 0 : !hasWarmThreadTarget);
  const shouldShowThreadTargetSyncTimeout =
    isThreadTargetSyncTimedOut &&
    !!messageId &&
    !hasWarmThreadTarget &&
    data.length === 0 &&
    !didUserScroll;
  const hasEverHadThreadRows = loadedThreadOpenIdentityKey === threadOpenIdentityKey;
  const canRevealThreadWindow = shouldRevealWarmChatWindow(data.length);
  const shouldHoldWarmThreadPlacement =
    !isThreadSurfaceRevealed &&
    shouldHoldWarmChatPlacement({
      openCase: threadOpenCase,
      hasRequestedAnchor: !!messageId,
      targetRowIndex: targetIndex,
      didUserScroll,
      placementConfirmed: confirmedThreadAnchorKey === threadLandingScrollKey,
    });
  // Route resolution and message hydration share one placeholder in the
  // message viewport; once rows have been shown for this open identity, later
  // cache/query transitions cannot put the list back behind the shimmer.
  const shouldBlockThreadListReveal =
    (isThreadPlacementUnavailable && !isThreadSurfaceRevealed && data.length === 0) ||
    (!canRevealThreadWindow &&
      (isThreadTargetPlacementPending ||
        shouldHoldWarmThreadPlacement ||
        (!hasEverHadThreadRows &&
          (isSurfacePending ||
            shouldShowThreadQueryError ||
            (isThreadInitialLoading && data.length === 0) ||
            isResolvingDeepLink ||
            isWaitingForAnchorTarget ||
            shouldHoldExactThreadTarget))));
  // The header and composer stay mounted while an empty open resolves. Hold
  // the painted input only while shimmer is up so messages and composer appear
  // together; the dock height stays reserved so the list inset does not jump.
  const shouldShowThreadOpenPlaceholder =
    !isThreadSurfaceRevealed &&
    shouldBlockThreadListReveal &&
    data.length === 0 &&
    !shouldHoldWarmThreadPlacement &&
    !shouldShowThreadQueryError &&
    !shouldShowThreadTargetSyncTimeout &&
    !isThreadPlacementUnavailable;

  useEffect(() => {
    if (shouldShowThreadOpenPlaceholder) {
      reportNotificationChatSkeletonShown({ channelId });
      reportActivityChatSkeletonShown({ channelId });
      beginChatOpenSkeleton({
        identityKey: threadOpenIdentityKey,
        surface: 'thread',
        entry: notificationOpenKind ? 'notification' : 'direct',
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
    if (messageId && targetIndex !== null) {
      reportOpenMessageHighlighted();
    }
    emitChatOpenSkeletonCompleted(
      completeChatOpenSkeleton({
        identityKey: threadOpenIdentityKey,
        surface: 'thread',
      }),
    );
  }, [
    channelId,
    messageId,
    notificationOpenKind,
    reportOpenMessageHighlighted,
    shouldShowThreadOpenPlaceholder,
    targetIndex,
    threadOpenIdentityKey,
  ]);

  useEffect(() => {
    const identityKey = threadOpenIdentityKey;
    return (): void => {
      emitChatOpenSkeletonCompleted(abandonChatOpenSkeleton({ identityKey, surface: 'thread' }));
    };
  }, [threadOpenIdentityKey]);

  const isComposerDisabled = shouldHoldChatComposer({
    shouldShowOpenPlaceholder: shouldShowThreadOpenPlaceholder,
    hasTerminalOpenError:
      shouldShowThreadQueryError ||
      shouldShowThreadTargetSyncTimeout ||
      isThreadPlacementUnavailable,
  });

  if (loggedThreadOpenIdentityKeyRef.current !== threadOpenIdentityKey) {
    loggedThreadOpenIdentityKeyRef.current = threadOpenIdentityKey;
    didLogThreadOpenSummaryRef.current = false;
    firstVisibleThreadPaintRef.current = null;
    threadOpenCycleIdRef.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    threadOpenStartedAtRef.current = nowMs();
    routeOpenLatencyMsRef.current = getRouteOpenLatencyMs(openStartedAtMs);
  }

  const threadRevealAnchorKeyRef = useRef(threadOpenIdentityKey);
  const wasBlockingThreadRevealRef = useRef(shouldBlockThreadListReveal);

  useLayoutEffect(() => {
    const shouldConcealThreadList = shouldConcealChatListForOpenIdentity({
      identityKey: threadOpenIdentityKey,
      revealedIdentityKey: revealedThreadOpenIdentityKey,
      shouldBlockListReveal: shouldBlockThreadListReveal,
      shouldWaitForRevealSettle: false,
    });

    if (threadRevealAnchorKeyRef.current !== threadOpenIdentityKey) {
      threadRevealAnchorKeyRef.current = threadOpenIdentityKey;
      wasBlockingThreadRevealRef.current = shouldConcealThreadList;
      threadListRevealOpacity.value = shouldConcealThreadList ? 0 : 1;
      if (!shouldConcealThreadList) {
        setRevealedThreadOpenIdentityKey(threadOpenIdentityKey);
      }
      return;
    }

    if (shouldConcealThreadList) {
      wasBlockingThreadRevealRef.current = true;
      threadListRevealOpacity.value = 0;
      return;
    }

    setRevealedThreadOpenIdentityKey(threadOpenIdentityKey);
    if (!wasBlockingThreadRevealRef.current) {
      threadListRevealOpacity.value = 1;
      return;
    }

    wasBlockingThreadRevealRef.current = false;
    threadListRevealOpacity.value = withTiming(1, {
      duration: THREAD_OPEN_REVEAL_DURATION_MS,
    });
  }, [
    revealedThreadOpenIdentityKey,
    setRevealedThreadOpenIdentityKey,
    shouldBlockThreadListReveal,
    threadListRevealOpacity,
    threadOpenIdentityKey,
  ]);

  useEffect(() => {
    if (shouldBlockThreadListReveal || rowEntranceController.hasRevealed()) return;
    rowEntranceController.onRevealed(data);
    setRowEntranceTick(tick => tick + 1);
  }, [data, rowEntranceController, shouldBlockThreadListReveal]);

  useEffect(() => {
    if (!rowEntranceController.hasRevealed()) return;
    if (rowEntranceController.trackNewRows(data)) {
      pendingEntranceCommitTickRef.current = rowEntranceTick + 1;
      setRowEntranceTick(tick => tick + 1);
    }
  }, [data, rowEntranceController, rowEntranceTick]);

  useEffect(() => {
    // The tick that queued pending rows has rendered the animated wrappers. Mark
    // them seen only after that commit so the entrance plays exactly once.
    if (pendingEntranceCommitTickRef.current !== rowEntranceTick) return;
    rowEntranceController.flushPending();
    pendingEntranceCommitTickRef.current = null;
  }, [rowEntranceController, rowEntranceTick]);

  const [actionsMessageId, setActionsMessageId] = useState<string | null>(null);
  const [isActionsSheetClosing, setIsActionsSheetClosing] = useState(false);
  const [reminderTarget, setReminderTarget] = useState<MessageActionsTarget | null>(null);
  const [isReminderSheetOpen, setIsReminderSheetOpen] = useState(false);

  const actionsMessageIdRef = useRef(actionsMessageId);
  const isActionsSheetClosingRef = useRef(isActionsSheetClosing);
  const isReminderSheetOpenRef = useRef(isReminderSheetOpen);

  // Single writer for the freeze SharedValue: ORs the latest sheet-derived
  // owners with the send-scroll owner. The refs keep an async send completion
  // from applying a stale render's sheet state after a newer render commits.
  const applyFreeze = useCallback((): void => {
    freeze.set(
      actionsMessageIdRef.current !== null ||
        isActionsSheetClosingRef.current ||
        isReminderSheetOpenRef.current ||
        isSendScrollInFlightRef.current,
    );
  }, [freeze]);

  useLayoutEffect(() => {
    actionsMessageIdRef.current = actionsMessageId;
    isActionsSheetClosingRef.current = isActionsSheetClosing;
    isReminderSheetOpenRef.current = isReminderSheetOpen;
    applyFreeze();
  }, [actionsMessageId, applyFreeze, isActionsSheetClosing, isReminderSheetOpen]);

  useEffect(() => {
    didUserScrollRef.current = false;
    dateSeparatorRecorderRef.current?.reset();
    isSendFollowingTailRef.current = false;
    confirmedThreadAnchorKeyRef.current = null;
    setDidUserScroll(false);
    setShouldMaintainThreadTail(!messageId);
    setConfirmedThreadAnchorKey(null);
    setRevealedThreadOpenIdentityKey(null);
    setThreadPlacementUnavailableKey(null);
    setThreadTargetSyncTimedOutKey(null);
    setThreadLandingScrollIssuedKey(null);
    appliedThreadLandingScrollKeyRef.current = null;
    if (threadLandingFrameRef.current !== null) {
      cancelAnimationFrame(threadLandingFrameRef.current);
      threadLandingFrameRef.current = null;
    }
    threadLandingPassRef.current = { key: threadOpenIdentityKey, passes: 0 };
    // A thread switch mid-scroll must not leave a stale freeze owner behind.
    sendScrollSequenceRef.current += 1;
    isSendScrollInFlightRef.current = false;
    applyFreeze();
    setPostPaintReady(false);
    setRichHydrationReady(false);
    setMediaHydrationReady(false);
    postPaintTaskRef.current?.cancel();
    postPaintTaskRef.current = null;
    richHydrationInteractionRef.current?.cancel();
    richHydrationInteractionRef.current = null;
    if (richHydrationTimerRef.current) {
      clearTimeout(richHydrationTimerRef.current);
      richHydrationTimerRef.current = null;
    }
    if (mediaHydrationTimerRef.current) {
      clearTimeout(mediaHydrationTimerRef.current);
      mediaHydrationTimerRef.current = null;
    }
    // Keep this reset scoped to the thread identity. applyFreeze is stable and
    // is invoked above only to clear a stale send owner during a switch.
  }, [applyFreeze, messageId, threadOpenIdentityKey]);

  const scheduleThreadLandingConfirmation = useCallback((): void => {
    if (!messageId || targetIndex === null) return;
    if (threadLandingFrameRef.current !== null) return;

    const runPass = (): void => {
      threadLandingFrameRef.current = null;
      if (confirmedThreadAnchorKeyRef.current === threadLandingScrollKey) {
        const snapshot = getThreadLandingSnapshot();
        if (snapshot?.visible) {
          reportOpenMessageHighlighted();
        }
        return;
      }
      if (
        !shouldKeepThreadLandingScroll({
          hasRouteMessageId: !!messageId,
          didUserScroll: didUserScrollRef.current,
          isFollowingTail:
            isSendFollowingTailRef.current ||
            (shouldMaintainThreadTailRef.current && !isScrolledUpRef.current),
          isLandingConfirmed: false,
        })
      ) {
        return;
      }

      const snapshot = getThreadLandingSnapshot();
      if (markThreadLandingObserved(snapshot)) {
        return;
      }

      const listState = listRef.current?.getState?.();
      const isListReady = threadListViewportHeight > 0 && (listState?.scrollLength ?? 0) > 0;
      const currentPassState =
        threadLandingPassRef.current.key === threadLandingScrollKey
          ? threadLandingPassRef.current
          : { key: threadLandingScrollKey, passes: 0 };
      const decision = resolveAnchorLandingPass({
        isTargetVisible: snapshot?.visible === true,
        isListReady,
        passes: currentPassState.passes,
      });
      if (decision === 'wait') {
        threadLandingPassRef.current = {
          key: threadLandingScrollKey,
          passes: currentPassState.passes + 1,
        };
        threadLandingFrameRef.current = requestAnimationFrame(() => {
          threadLandingFrameRef.current = requestAnimationFrame(runPass);
        });
        return;
      }
      if (decision === 'accept') {
        acceptThreadLanding();
        return;
      }

      threadLandingPassRef.current = {
        key: threadLandingScrollKey,
        passes: currentPassState.passes + 1,
      };
      appliedThreadLandingScrollKeyRef.current = null;
      scheduleThreadLandingRef.current?.();
    };

    threadLandingFrameRef.current = requestAnimationFrame(() => {
      threadLandingFrameRef.current = requestAnimationFrame(runPass);
    });
  }, [
    acceptThreadLanding,
    getThreadLandingSnapshot,
    markThreadLandingObserved,
    messageId,
    reportOpenMessageHighlighted,
    targetIndex,
    threadLandingScrollKey,
    threadListViewportHeight,
  ]);

  const scheduleThreadLanding = useCallback((): void => {
    if (confirmedThreadAnchorKeyRef.current === threadLandingScrollKey) {
      const snapshot = getThreadLandingSnapshot();
      if (snapshot?.visible) {
        reportOpenMessageHighlighted();
      }
      return;
    }
    if (
      !shouldKeepThreadLandingScroll({
        hasRouteMessageId: !!messageId,
        didUserScroll: didUserScrollRef.current,
        isFollowingTail:
          isSendFollowingTailRef.current ||
          (shouldMaintainThreadTailRef.current && !isScrolledUpRef.current),
        isLandingConfirmed: false,
      })
    ) {
      return;
    }
    if (shouldHoldExactThreadTarget) return;
    if (targetIndex === null) return;
    if (appliedThreadLandingScrollKeyRef.current === threadLandingScrollKey) return;

    const list = listRef.current;
    if (!list?.scrollToIndex) return;
    appliedThreadLandingScrollKeyRef.current = threadLandingScrollKey;

    void (async (): Promise<void> => {
      try {
        await list.scrollToIndex({
          index: targetIndex,
          animated: false,
          viewPosition: 0,
          viewOffset: (hideHeader ? 12 : 0) + ANCHOR_TOP_GAP,
        });
        const snapshot = getThreadLandingSnapshot();
        if (!markThreadLandingObserved(snapshot)) {
          scheduleThreadLandingConfirmation();
        }
      } catch (error) {
        logger.addBreadcrumb('error', 'chat_thread_landing_scroll_failed', {
          channelId,
          threadId,
          messageId,
          targetIndex,
          dataLength: data.length,
          error: error instanceof Error ? error.message : String(error),
        });
        appliedThreadLandingScrollKeyRef.current = null;
      }
    })();
  }, [
    channelId,
    data.length,
    getThreadLandingSnapshot,
    hideHeader,
    markThreadLandingObserved,
    messageId,
    reportOpenMessageHighlighted,
    scheduleThreadLandingConfirmation,
    shouldHoldExactThreadTarget,
    targetIndex,
    threadId,
    threadLandingScrollKey,
  ]);
  scheduleThreadLandingRef.current = scheduleThreadLanding;

  useLayoutEffect(() => {
    if (!messageId || usesInitialThreadAnchorPlacement) return;
    scheduleThreadLanding();
  }, [messageId, scheduleThreadLanding, threadLandingScrollKey, usesInitialThreadAnchorPlacement]);

  const confirmInitialThreadPlacement = useCallback((): void => {
    if (!usesInitialThreadAnchorPlacement || targetIndex === null) return;
    if (threadLandingScrollIssuedKey === threadLandingScrollKey) return;

    setThreadLandingScrollIssuedKey(threadLandingScrollKey);
    scheduleThreadLandingConfirmation();
  }, [
    scheduleThreadLandingConfirmation,
    targetIndex,
    threadLandingScrollIssuedKey,
    threadLandingScrollKey,
    usesInitialThreadAnchorPlacement,
  ]);

  const handleThreadListLoad = useCallback((): void => {
    threadListInstanceLoadedRef.current = true;
    if (data.length === 0) return;
    setLoadedThreadOpenIdentityKey(threadOpenIdentityKey);
    if (messageId && targetIndex === null && !didUserScrollRef.current) {
      listRef.current?.scrollToEnd({ animated: false });
    }
    confirmInitialThreadPlacement();
  }, [confirmInitialThreadPlacement, data.length, messageId, targetIndex, threadOpenIdentityKey]);

  useEffect(() => {
    if (loadedThreadOpenIdentityKey === threadOpenIdentityKey || data.length === 0) return;
    const timer = setTimeout(() => {
      // LegendList can report its empty-data load before rows arrive and then
      // omit a second load callback. The latch keeps a warm thread visible.
      setLoadedThreadOpenIdentityKey(threadOpenIdentityKey);
    }, 1500);
    return (): void => clearTimeout(timer);
  }, [data.length, loadedThreadOpenIdentityKey, threadOpenIdentityKey]);

  const handleThreadItemSizeChanged = useCallback(
    ({ index }: { index: number }): void => {
      if (!messageId || didUserScrollRef.current) return;
      if (isSendFollowingTailRef.current) return;
      if (confirmedThreadAnchorKeyRef.current === threadLandingScrollKey) {
        markThreadLandingObserved();
        return;
      }
      if (
        usesInitialThreadAnchorPlacement &&
        threadLandingScrollIssuedKey !== threadLandingScrollKey
      ) {
        confirmInitialThreadPlacement();
        return;
      }
      if (markThreadLandingObserved()) {
        return;
      }
      if (targetIndex !== null && index > targetIndex) return;
      scheduleThreadLandingConfirmation();
    },
    [
      confirmInitialThreadPlacement,
      markThreadLandingObserved,
      messageId,
      reportOpenMessageHighlighted,
      scheduleThreadLandingConfirmation,
      targetIndex,
      threadLandingScrollIssuedKey,
      threadLandingScrollKey,
      usesInitialThreadAnchorPlacement,
    ],
  );

  useEffect(() => {
    return (): void => {
      postPaintTaskRef.current?.cancel();
      postPaintTaskRef.current = null;
      richHydrationInteractionRef.current?.cancel();
      richHydrationInteractionRef.current = null;
      if (richHydrationTimerRef.current) {
        clearTimeout(richHydrationTimerRef.current);
        richHydrationTimerRef.current = null;
      }
      if (mediaHydrationTimerRef.current) {
        clearTimeout(mediaHydrationTimerRef.current);
        mediaHydrationTimerRef.current = null;
      }
      if (threadLandingFrameRef.current !== null) {
        cancelAnimationFrame(threadLandingFrameRef.current);
        threadLandingFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!postPaintReady) return;

    let cancelled = false;
    richHydrationInteractionRef.current?.cancel();
    if (richHydrationTimerRef.current) {
      clearTimeout(richHydrationTimerRef.current);
      richHydrationTimerRef.current = null;
    }
    if (mediaHydrationTimerRef.current) {
      clearTimeout(mediaHydrationTimerRef.current);
      mediaHydrationTimerRef.current = null;
    }

    richHydrationInteractionRef.current = InteractionManager.runAfterInteractions(() => {
      richHydrationTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setRichHydrationReady(true);
      }, THREAD_RICH_HYDRATION_DELAY_MS);
      mediaHydrationTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setMediaHydrationReady(true);
      }, THREAD_MEDIA_HYDRATION_DELAY_MS);
    });

    return (): void => {
      cancelled = true;
      richHydrationInteractionRef.current?.cancel();
      richHydrationInteractionRef.current = null;
      if (richHydrationTimerRef.current) {
        clearTimeout(richHydrationTimerRef.current);
        richHydrationTimerRef.current = null;
      }
      if (mediaHydrationTimerRef.current) {
        clearTimeout(mediaHydrationTimerRef.current);
        mediaHydrationTimerRef.current = null;
      }
    };
  }, [postPaintReady]);

  useEffect(() => {
    if (!shouldShowJoinChannel) return;
    setActionsMessageId(null);
    setIsActionsSheetClosing(false);
    setEditingTarget(null);
  }, [shouldShowJoinChannel]);

  const handleLongPress = useCallback(
    (id: string): void => {
      if (shouldShowJoinChannel) return;
      if (isLongPressPendingRef.current) return;

      isLongPressPendingRef.current = true;
      // Start dismissal before blurring the composer. Always force the native
      // dismissal and wait one frame: isVisible() can still be false during
      // the first frame after focus, before the IME emits keyboardWillShow.
      const keyboardHidden = awaitKeyboardHidden(KeyboardController, { wasVisible: true });
      dismissRegisteredComposerFocus();
      void keyboardHidden.finally(() => {
        requestAnimationFrame(() => {
          isLongPressPendingRef.current = false;
          if (!isMountedRef.current) return;
          setIsActionsSheetClosing(false);
          setActionsMessageId(id);
        });
      });
    },
    [shouldShowJoinChannel],
  );

  const handleActionsOpenChange = useCallback(
    (open: boolean): void => {
      if (open) {
        setIsActionsSheetClosing(false);
        return;
      }
      if (actionsMessageId !== null) setIsActionsSheetClosing(true);
      setActionsMessageId(null);
    },
    [actionsMessageId],
  );
  const handleActionsSheetDismiss = useCallback((): void => {
    setIsActionsSheetClosing(false);
  }, []);
  const handleReminderSheetOpenChange = useCallback((open: boolean) => {
    setIsReminderSheetOpen(open);
    if (!open) setReminderTarget(null);
  }, []);

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
    KeyboardController.dismiss();
  }, []);

  const handleThreadMessagePress = useCallback(
    (messageId: string): void => {
      const pending = pendingByMessageId.get(messageId);
      if (pending && getStatus(pending) === 'failed') {
        retryPendingMessageFromV2(zero, pending, 'thread_message_row');
        return;
      }
      dismissKeyboard();
    },
    [dismissKeyboard, pendingByMessageId, zero],
  );

  useEffect(() => {
    if (isComposerDisabled) dismissKeyboard();
  }, [dismissKeyboard, isComposerDisabled]);

  const handleListTouchStart = useCallback((event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent;
    tapDismissTouchRef.current = { pageX, pageY, moved: false };
  }, []);

  const handleListTouchMove = useCallback((event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent;
    const start = tapDismissTouchRef.current;
    if (
      Math.abs(pageX - start.pageX) > TAP_DISMISS_MOVE_THRESHOLD ||
      Math.abs(pageY - start.pageY) > TAP_DISMISS_MOVE_THRESHOLD
    ) {
      start.moved = true;
    }
  }, []);

  const handleListTouchEnd = useCallback(() => {
    if (!tapDismissTouchRef.current.moved && !consumeListTapDismissSuppression()) {
      dismissKeyboard();
    }
  }, [dismissKeyboard]);

  const updateDatePillLabel = useCallback(() => {
    const state = listRef.current?.getState?.();
    if (!state) return;

    if (data.length === 0) {
      setDatePillLabel(null);
      setDatePillCreatedAt(null);
      return;
    }

    let topIndex = state.start;
    const resolvedTopIndex = resolveTopIndex(topIndex, state.end, data.length);
    if (resolvedTopIndex === null) {
      setDatePillLabel(null);
      setDatePillCreatedAt(null);
      return;
    }
    topIndex = resolvedTopIndex;

    let label: string | null = null;
    let labelCreatedAt: number | null = null;
    for (let i = topIndex; i >= 0; i--) {
      const current = data[i];
      if (!current) continue;
      const prev = i > 0 ? data[i - 1] : undefined;
      if (!prev || !isSameDay(prev.createdAt, current.createdAt)) {
        label = formatDateLabel(current.createdAt);
        labelCreatedAt = current.createdAt;
        break;
      }
    }

    setDatePillLabel(prev => (prev === label ? prev : label));
    setDatePillCreatedAt(prev => (prev === labelCreatedAt ? prev : labelCreatedAt));
  }, [data]);

  const checkScrollPosition = useCallback(() => {
    const state = listRef.current?.getState?.();
    if (!state) return;

    const distanceFromBottom = state.contentLength - (state.scroll + state.scrollLength);
    const nextIsScrolledUp = distanceFromBottom > SCROLL_TO_BOTTOM_THRESHOLD;
    isScrolledUpRef.current = nextIsScrolledUp;
    if (distanceFromBottom <= SCROLL_TO_BOTTOM_THRESHOLD) {
      setShouldMaintainThreadTail(true);
    }
    setIsScrolledUp(prev => {
      if (prev !== nextIsScrolledUp) {
        return nextIsScrolledUp;
      }
      return prev;
    });
  }, []);

  const getVisiblePaintItems = useCallback((): ThreadPaintItem[] => {
    const items = paintItemsRef.current;
    if (items.length === 0) return [];
    const state = listRef.current?.getState?.();
    if (state && state.start >= 0 && state.end >= 0) {
      return items.slice(Math.max(0, state.start), Math.min(items.length, state.end + 1));
    }
    if (targetIndex !== null) {
      return items.slice(Math.max(0, targetIndex - 3), Math.min(items.length, targetIndex + 4));
    }
    return items.slice(Math.max(0, items.length - THREAD_VISIBLE_MEDIA_FALLBACK_WINDOW));
  }, [targetIndex]);

  const prefetchVisibleThreadMedia = useCallback((): void => {
    const requests = getVisiblePaintItems()
      .map(item => getThreadMediaPreviewRequest(item.paint))
      .filter((request): request is MediaPreviewRequest => request !== null);
    if (requests.length === 0) return;
    prefetchMediaPreviews(requests);
  }, [getVisiblePaintItems]);

  const prefetchVisibleThreadEmojiUris = useCallback((): void => {
    const emojiIds = collectPaintEmojiIds(getVisiblePaintItems().map(item => item.paint));
    if (emojiIds.length === 0) return;
    void prefetchMtlsEmojiUris(emojiIds);
  }, [getVisiblePaintItems]);

  useEffect(() => {
    updateDatePillLabel();
  }, [updateDatePillLabel]);

  // Check scroll position after data loads and list positions itself
  useEffect(() => {
    if (data.length === 0 || isResolvingDeepLink) return;

    checkScrollPosition();
    const timer = setTimeout(() => checkScrollPosition(), 100);

    return (): void => {
      clearTimeout(timer);
    };
  }, [data.length, isResolvingDeepLink, checkScrollPosition]);

  const handleListScroll = useCallback((): void => {
    updateDatePillLabel();
    checkScrollPosition();
    if (postPaintReady) {
      prefetchVisibleThreadMedia();
      prefetchVisibleThreadEmojiUris();
    }
  }, [
    checkScrollPosition,
    postPaintReady,
    prefetchVisibleThreadEmojiUris,
    prefetchVisibleThreadMedia,
    updateDatePillLabel,
  ]);

  const handleListLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const nextHeight = Math.ceil(event.nativeEvent.layout.height);
      if (Number.isFinite(nextHeight) && nextHeight > 0) {
        setThreadListViewportHeight(currentHeight =>
          currentHeight === nextHeight ? currentHeight : nextHeight,
        );
      }

      if (postPaintTaskRef.current) return;
      postPaintTaskRef.current = runAfterFirstPaint(() => {
        setPostPaintReady(true);
        prefetchVisibleThreadEmojiUris();
        prefetchVisibleThreadMedia();
      });
    },
    [prefetchVisibleThreadEmojiUris, prefetchVisibleThreadMedia],
  );

  useEffect(() => {
    const hasVisibleThreadData = data.length > 0 && (!messageId || targetIndex !== null);
    const hasCompletedEmptyThread =
      !messageId && messagesDetails.type === 'complete' && data.length === 0;
    if (
      firstVisibleThreadPaintRef.current ||
      isResolvingDeepLink ||
      isThreadInitialLoading ||
      (!hasVisibleThreadData && !hasCompletedEmptyThread)
    ) {
      return;
    }

    firstVisibleThreadPaintRef.current = {
      latencyMs: getElapsedMs(threadOpenStartedAtRef.current),
      source: hasCompletedEmptyThread ? 'backend' : getThreadOpenPaintSource(messageSource),
    };
  }, [
    data.length,
    isResolvingDeepLink,
    isThreadInitialLoading,
    messageId,
    messageSource,
    messagesDetails.type,
    targetIndex,
  ]);

  useEffect(() => {
    const hasVisibleThreadData = data.length > 0 && (!messageId || targetIndex !== null);
    const hasCompletedEmptyThread =
      !messageId && messagesDetails.type === 'complete' && data.length === 0;
    const hasFinalLiveThreadData =
      (messagesDetails.type === 'complete' && messageSource === 'zero' && hasVisibleThreadData) ||
      hasCompletedEmptyThread;
    if (
      didLogThreadOpenSummaryRef.current ||
      isResolvingDeepLink ||
      isThreadInitialLoading ||
      !hasFinalLiveThreadData
    ) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (didLogThreadOpenSummaryRef.current) return;
      didLogThreadOpenSummaryRef.current = true;
      const finalFirstPaintFallbackSource: ChatOpenPaintSource = hasCompletedEmptyThread
        ? 'backend'
        : getThreadOpenPaintSource(messageSource);
      const firstVisiblePaint = firstVisibleThreadPaintRef.current ?? {
        latencyMs: getElapsedMs(threadOpenStartedAtRef.current),
        source: finalFirstPaintFallbackSource,
      };
      const finalLivePaintLatencyMs = getElapsedMs(threadOpenStartedAtRef.current);
      logChatOpenSummary({
        cycleId: threadOpenCycleIdRef.current,
        channelId,
        startedAtMs: threadOpenStartedAtRef.current,
        threadId,
        entryPoint: threadOpenEntryPoint,
        notificationOpenKind,
        routeOpenLatencyMs: routeOpenLatencyMsRef.current,
        firstPaintSource: firstVisiblePaint.source,
        firstPaintLatencyMs: firstVisiblePaint.latencyMs,
        finalLivePaintLatencyMs,
        telemetry: openTelemetry,
      });
    });
    return (): void => {
      cancelAnimationFrame(frame);
    };
  }, [
    channelId,
    data.length,
    from,
    isResolvingDeepLink,
    isThreadInitialLoading,
    messageId,
    messageSource,
    messagesDetails.type,
    notificationOpenKind,
    openStartedAtMs,
    openTelemetry,
    targetIndex,
    threadOpenEntryPoint,
    threadId,
  ]);

  const handleEditInChat = useCallback(
    (payload: ChatInputEditingMessage) => {
      if (shouldShowJoinChannel) {
        Alert.alert('Join channel', 'Join this channel before editing messages.');
        return;
      }
      setEditingTarget(payload);
    },
    [shouldShowJoinChannel],
  );

  const selectedAction = useMemo(() => {
    if (!actionsMessageId) return { message: null as MessageItem | null, isFirst: false };
    const idx = data.findIndex(m => m.messageId === actionsMessageId);
    if (idx < 0) return { message: null, isFirst: false };
    return { message: data[idx] ?? null, isFirst: idx === 0 };
  }, [actionsMessageId, data]);

  const actionsSheetRef = useRef<MessageActionsSheetHandle>(null);
  const closeActionSheet = useCallback(
    (afterDismiss?: () => void) => actionsSheetRef.current?.closeActionSheet(afterDismiss),
    [],
  );
  const openForward = useCallback(() => actionsSheetRef.current?.openForward(), []);

  const actionsTarget = useMemo(
    () =>
      messageItemToActionsTarget(selectedAction.message, {
        channelId: channelId ?? '',
        threadId: threadId ?? undefined,
        currentUserId: currentUser?.id,
        isFirstInThread: selectedAction.isFirst,
        isChannelArchived: channel?.isArchived ?? false,
        channelName: channel?.name,
        channelScopeType: channel?.scopeType,
      }),
    [
      channel?.isArchived,
      channel?.name,
      channel?.scopeType,
      channelId,
      currentUser?.id,
      selectedAction,
      threadId,
    ],
  );

  const openReminderOptions = useCallback((nextTarget: MessageActionsTarget): void => {
    setReminderTarget(nextTarget);
    setIsReminderSheetOpen(true);
  }, []);

  const threadActions = useMessageActions({
    target: actionsTarget,
    currentUserId: currentUser?.id,
    context: 'thread',
    closeActionSheet,
    openForward,
    openReminderOptions,
    onEditInChat: handleEditInChat,
  });

  const renderItem = useCallback(
    ({ item, index }: { item: MessageItem; index: number }): ReactElement => {
      const paintItem = getPaintItemForMessage(item, index);
      if (!paintItem) {
        const breadcrumbKey = `${threadOpenIdentityKey}:${item.messageId}:${index}`;
        if (missingPaintItemBreadcrumbKeyRef.current !== breadcrumbKey) {
          missingPaintItemBreadcrumbKeyRef.current = breadcrumbKey;
          logger.addBreadcrumb('error', 'chat_thread_paint_item_missing', {
            channelId,
            threadId,
            messageId: item.messageId,
            index,
            dataLength: data.length,
            paintItemCount: paintItems.length,
          });
        }
        return <View style={{ height: getDateRowEstimatedHeight() }} />;
      }
      const isHighlightTarget = !!messageId && item.messageId === messageId;
      // The parent ticket card is synthesized onto row 0 (see the `data` memo),
      // so a genuine ticket message further down the thread keeps its default
      // press behaviour.
      const isParentTicketRow =
        index === 0 &&
        !!paintItem.paint.ticketPreview &&
        (!!resolvedParentTicketMd || !!resolvedParentTicketId);
      const handleParentTicketPress =
        isParentTicketRow && onParentTicketPress
          ? (): void => {
              dismissKeyboard();
              onParentTicketPress();
            }
          : undefined;
      const previousMessage = index > 0 ? data[index - 1] : undefined;
      const showDateDivider =
        !previousMessage || !isSameDay(previousMessage.createdAt, item.createdAt);
      const dateText = showDateDivider ? formatDateLabel(item.createdAt) : null;
      const previousPaintItem =
        index > 0 ? getPaintItemForMessage(data[index - 1] as MessageItem, index - 1) : undefined;
      const nextPaintItem =
        index + 1 < data.length
          ? getPaintItemForMessage(data[index + 1] as MessageItem, index + 1)
          : undefined;
      const isContentExpanded = expandedConversationIds.has(paintItem.paint.conversationId);
      const isTicketActivity = paintItem.paint.isTicketActivity === true;
      const initialMessageSummary = parseInitialMessageMd(
        paintItem.conversation.initial_message_md,
      );
      const isForwardedMessage = initialMessageSummary?.msgType === MessageType.FORWARDED;
      const isFlowJsonMessage = isFlowJsonHtml(initialMessageSummary?.content ?? '');
      const shouldKeepPaintPreview = shouldKeepChatPaintPreview({
        isCollapsible: paintItem.paint.collapse.isCollapsible,
        isForwardedMessage,
        isFlowJsonMessage,
        customEmojiCount: paintItem.paint.body?.customEmojiIds.length ?? 0,
        hasMediaPlaceholder: !!paintItem.paint.mediaPlaceholder,
      });
      const canRenderLandingRichContent = !isTicketActivity && !shouldKeepPaintPreview;
      const animateEntrance = rowEntranceController.getPending().has(item.messageId);
      const content =
        canRenderLandingRichContent &&
        (richHydrationReady || isForwardedMessage || isFlowJsonMessage) ? (
          <ChatComposer
            key={paintItem.paint.conversationId}
            conversation={paintItem.conversation}
            currentUser={currentUser}
            {...(channel?.scopeType !== undefined ? { channelType: channel.scopeType } : {})}
            paintRow={paintItem.paint}
            allowMediaHydration={mediaHydrationReady || isForwardedMessage || isFlowJsonMessage}
            allowInlineEmojiHydration={
              richHydrationReady || isForwardedMessage || isFlowJsonMessage
            }
            isContentExpanded={isContentExpanded}
            onContentExpanded={handleThreadContentExpanded}
            onPress={() => handleThreadMessagePress(item.messageId)}
            {...(handleParentTicketPress ? { onTicketPress: handleParentTicketPress } : {})}
            {...(!shouldShowJoinChannel
              ? { onLongPress: (): void => handleLongPress(item.messageId) }
              : {})}
          />
        ) : (
          <Pressable
            onPress={() => handleThreadMessagePress(item.messageId)}
            onLongPress={
              !shouldShowJoinChannel ? (): void => handleLongPress(item.messageId) : undefined
            }
            delayLongPress={300}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
          >
            <ChatPaintRowLite
              key={paintItem.paint.conversationId}
              row={paintItem.paint}
              {...(channel?.scopeType !== undefined ? { channelType: channel.scopeType } : {})}
              isPreviousTicketActivity={previousPaintItem?.paint.isTicketActivity === true}
              isNextTicketActivity={nextPaintItem?.paint.isTicketActivity === true}
              hydrateInlineEmoji={postPaintReady}
              isExpanded={isContentExpanded}
              onExpand={handleThreadContentExpanded}
              {...(handleParentTicketPress ? { onTicketPress: handleParentTicketPress } : {})}
              {...(handleParentTicketPress && !shouldShowJoinChannel
                ? { onTicketLongPress: (): void => handleLongPress(item.messageId) }
                : {})}
            />
          </Pressable>
        );

      return (
        <View>
          <MessageHighlight enabled={isHighlightTarget}>
            {showDateDivider ? (
              <View className='items-center justify-center py-4.5'>
                <DatePillBadge
                  key={`thread-date-${item.createdAt}`}
                  dateText={dateText ?? ''}
                  onLayout={layout =>
                    recordDateSeparatorLayout(
                      'thread-inline',
                      item.messageId,
                      item.createdAt,
                      dateText ?? '',
                      layout,
                    )
                  }
                />
              </View>
            ) : null}
            <View className='px-3'>
              <View>
                {animateEntrance ? <ChatRowEntrance>{content}</ChatRowEntrance> : content}
              </View>
              {index === 0 && replyCount > 0 ? (
                <View
                  className='flex-row items-center pr-1'
                  style={{
                    minHeight: THREAD_REPLY_DIVIDER_HEIGHT,
                    marginLeft: THREAD_REPLY_DIVIDER_GUTTER,
                    marginTop: THREAD_REPLY_DIVIDER_TOP_GAP,
                    paddingTop: 8,
                    paddingBottom: 10,
                  }}
                >
                  <Text
                    className='text-xs text-secondary-foreground'
                    numberOfLines={1}
                    style={{
                      flexShrink: 0,
                      lineHeight: 18,
                      minWidth: THREAD_REPLY_DIVIDER_LABEL_MIN_WIDTH,
                    }}
                  >
                    {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                  </Text>
                  <View className='h-px flex-1 bg-border opacity-70' style={{ marginLeft: 8 }} />
                </View>
              ) : null}
            </View>
          </MessageHighlight>
        </View>
      );
    },
    // rowEntranceTick is intentionally included so this callback is recreated when
    // the set of pending entrance animations changes, even though the callback body
    // only reads the controller indirectly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      channelId,
      channel?.scopeType,
      currentUser,
      data,
      dismissKeyboard,
      expandedConversationIds,
      getPaintItemForMessage,
      handleLongPress,
      handleThreadMessagePress,
      handleThreadContentExpanded,
      mediaHydrationReady,
      messageId,
      onParentTicketPress,
      paintItems.length,
      resolvedParentTicketId,
      resolvedParentTicketMd,
      postPaintReady,
      recordDateSeparatorLayout,
      replyCount,
      richHydrationReady,
      rowEntranceController,
      rowEntranceTick,
      shouldShowJoinChannel,
      threadId,
      threadOpenIdentityKey,
    ],
  );

  const keyExtractor = useCallback(
    (item: MessageItem, index: number): string => getThreadMessageId(item, index, threadId),
    [threadId],
  );

  const getThreadItemType = useCallback(
    (item: MessageItem, index: number): string => {
      const paint = getPaintItemForMessage(item, index)?.paint;
      if (!paint) return 'message';
      if (paint.rowType === 'system') return 'system';
      if (paint.ticketPreview) return 'ticket';
      if (paint.mediaPlaceholder) return 'media';
      return getChatPaintMessageItemType(paint);
    },
    [getPaintItemForMessage],
  );

  const handleScrollToBottomPress = useCallback(() => {
    isScrolledUpRef.current = false;
    isSendFollowingTailRef.current = true;
    confirmedThreadAnchorKeyRef.current = threadLandingScrollKey;
    setConfirmedThreadAnchorKey(threadLandingScrollKey);
    setShouldMaintainThreadTail(true);
    void listRef.current?.scrollToEnd({ animated: true }).finally(() => {
      isSendFollowingTailRef.current = false;
    });
  }, [threadLandingScrollKey]);

  const runSendScrollToTail = useSendScrollToTail({
    isMountedRef,
    isSendScrollInFlightRef,
    sendScrollSequenceRef,
    scrollMessageToEnd,
    applyFreeze,
  });

  const handleSend = useCallback(
    (
      { text, html, attachments, alsoSendToChannel = false }: ChatInputSendPayload,
      restore: () => void,
    ): void => {
      if (shouldShowJoinChannel) {
        Alert.alert('Join channel', 'Join this channel before replying to threads.');
        restore();
        return;
      }

      if (editingTarget) {
        const transformedHtml = buildComposerContentForSend(text, html);
        if (!transformedHtml) return;
        const editingMessageId = editingTarget.messageId;
        setEditingTarget(null);
        subscribeMutationRestore(
          zero.mutate(
            mutators.messages.update({
              messageId: editingMessageId,
              content: transformedHtml,
            }),
          ),
          () => {
            Alert.alert('Failed to update message', 'Please try again.');
            restore();
          },
        );
        // Editing re-emits the thread and collapses the composer (editing
        // banner + populated draft gone). At the tail that otherwise drifts the
        // viewport onto an older message; re-pin -- but only when already at the
        // tail, so editing history while scrolled up does not yank the user down.
        if (!isScrolledUpRef.current) {
          isSendFollowingTailRef.current = true;
          setShouldMaintainThreadTail(true);
          runSendScrollToTail({
            onSettled: () => {
              isSendFollowingTailRef.current = false;
            },
          });
        }
        return;
      }

      if (!threadId) {
        Alert.alert('Error', 'Unable to send message. Missing thread context.');
        return;
      }
      const transformedHtml = buildComposerContentForSend(text, html);
      const hasContent = transformedHtml !== null;
      const hasAttachments = attachments.length > 0;
      if (!hasContent && !hasAttachments) return;

      const content = hasContent ? transformedHtml : '<p></p>';
      const messageIdForSend = uuidv4();
      const pendingAttachments = attachments
        .filter(a => a.status === 'uploaded')
        .map(a => ({
          attachmentId: a.attachmentId,
          originalFilename: a.originalFilename,
          mimetype: a.mimetype,
          size: a.size,
          ...(a.width !== undefined && { width: a.width }),
          ...(a.height !== undefined && { height: a.height }),
        }));
      sendMessage(
        zero,
        { kind: 'thread', channelId, conversationId: threadId },
        {
          content,
          text,
          alsoSendToChannel,
          messageId: messageIdForSend,
          ...(pendingAttachments.length > 0 && { attachments: pendingAttachments }),
        },
      );

      isSendFollowingTailRef.current = true;
      isScrolledUpRef.current = false;
      confirmedThreadAnchorKeyRef.current = threadLandingScrollKey;
      setConfirmedThreadAnchorKey(threadLandingScrollKey);
      setShouldMaintainThreadTail(true);
      runSendScrollToTail({
        isReady: () => dataRef.current.some(message => message.messageId === messageIdForSend),
        onSettled: () => {
          isSendFollowingTailRef.current = false;
        },
      });
    },
    [
      channelId,
      editingTarget,
      runSendScrollToTail,
      shouldShowJoinChannel,
      threadId,
      threadLandingScrollKey,
      zero,
    ],
  );

  // The resting composer is reserved as real content padding (see
  // ChatComposerGeometry); only growth beyond it arrives as a content inset.
  const threadListContentContainerStyle = useMemo<ViewStyle>(
    () => ({
      paddingTop: hideHeader ? 12 : 0,
      paddingBottom: composerGeometry.minimumHeight,
    }),
    [composerGeometry.minimumHeight, hideHeader],
  );
  // Keep shimmer in the message viewport. The composer slot stays empty while
  // the painted input is held off-screen.
  const threadComposerSlotOverlayStyle = useAnimatedStyle(
    () => ({ paddingBottom: composerGeometry.totalHeight.value }),
    [composerGeometry.totalHeight],
  );
  const threadOpenPlaceholder = (
    <Animated.View
      pointerEvents='none'
      style={[
        {
          bottom: 0,
          left: 0,
          paddingTop: hideHeader ? 12 : 0,
          paddingHorizontal: 16,
          position: 'absolute',
          right: 0,
          top: 0,
          justifyContent: 'flex-end',
          overflow: 'hidden',
        },
        threadComposerSlotOverlayStyle,
      ]}
      onLayout={shouldShowThreadOpenPlaceholder ? handleListLayout : undefined}
    >
      {THREAD_OPEN_PLACEHOLDER_ROW_KEYS.map(key => (
        <ConversationSkeleton key={key} />
      ))}
    </Animated.View>
  );

  return (
    <ReactionsSheetHost getConversationById={getThreadConversationById} currentUser={currentUser}>
      <View className='flex-1 bg-chat-screen'>
        {!hideHeader && (
          <ThreadHeaderV3
            channelId={channelId ?? ''}
            threadId={threadId ?? ''}
            onBack={handleBackNavigation}
          />
        )}
        {!hideHeader ? <View pointerEvents='none' style={{ height: threadHeaderHeight }} /> : null}

        <View className='flex-1 overflow-hidden rounded-t-[10px]'>
          {isTranscript && callThreadMeta ? (
            <View
              style={{
                flex: 1,
                paddingTop: hideHeader ? 12 : 0,
              }}
            >
              <CallTranscriptCard
                callId={callThreadMeta.callId}
                callContent={callThreadMeta.callContent}
                isExpand={isTranscript}
                fullHeight={isTranscript}
              />
            </View>
          ) : (
            <>
              <KeyboardGestureArea
                interpolator={CHAT_KEYBOARD_GESTURE_INTERPOLATOR}
                offset={CHAT_KEYBOARD_GESTURE_OFFSET}
                style={{ flex: 1 }}
              >
                <Animated.View
                  style={[{ flex: 1 }, threadListRevealStyle]}
                  onLayout={handleListLayout}
                >
                  <ChatRenderProvider value={chatRenderTokens}>
                    {/* The keyboard wrapper owns keyboard movement and the composer inset. */}
                    <KeyboardAwareLegendList
                      ref={listRef}
                      alignItemsAtEnd
                      applyWorkaroundForContentInsetHitTestBug
                      automaticallyAdjustContentInsets={false}
                      data={data}
                      extraData={expandedConversationKey}
                      keyExtractor={keyExtractor}
                      estimatedItemSize={estimatedThreadItemSize}
                      getItemType={getThreadItemType}
                      drawDistance={THREAD_LIST_DRAW_DISTANCE}
                      initialScrollAtEnd={shouldUseThreadInitialScrollAtEnd}
                      {...(shouldExposeInitialScrollIndex ? { initialScrollIndex } : {})}
                      onItemSizeChanged={handleThreadItemSizeChanged}
                      onLoad={handleThreadListLoad}
                      recycleItems
                      maintainScrollAtEnd={
                        !shouldShowJoinChannel && shouldMaintainThreadTail
                          ? {
                              animated: false,
                              on: { dataChange: true, itemLayout: true },
                            }
                          : false
                      }
                      maintainVisibleContentPosition={maintainVisibleContentPosition}
                      {...({ enableAverages: false } as { enableAverages: boolean })} // DONT REMOVE THIS
                      contentContainerStyle={threadListContentContainerStyle}
                      contentInsetAdjustmentBehavior='never'
                      contentInsetEndAdjustment={composerGeometry.extraHeight}
                      keyboardOffset={keyboardGeometry.listOffset}
                      freeze={freeze}
                      style={{ flex: 1 }}
                      keyboardShouldPersistTaps={CHAT_KEYBOARD_SHOULD_PERSIST_TAPS}
                      onTouchStart={handleListTouchStart}
                      onTouchMove={handleListTouchMove}
                      onTouchEnd={handleListTouchEnd}
                      onScrollBeginDrag={() => {
                        didUserScrollRef.current = true;
                        isSendFollowingTailRef.current = false;
                        setDidUserScroll(true);
                        setShouldMaintainThreadTail(false);
                        setThreadPlacementUnavailableKey(null);
                        setThreadTargetSyncTimedOutKey(null);
                        scrollProgress.set(withSpring(1));
                        updateDatePillLabel();
                      }}
                      onScrollEndDrag={event => {
                        const velocityY = event.nativeEvent.velocity?.y ?? 0;
                        if (Math.abs(velocityY) < 0.1) {
                          scrollProgress.set(withSpring(0));
                        }
                      }}
                      onMomentumScrollEnd={() => {
                        scrollProgress.set(withSpring(0));
                        checkScrollPosition();
                      }}
                      onScroll={handleListScroll}
                      scrollEventThrottle={16}
                      ListEmptyComponent={
                        shouldShowThreadQueryError ? null : (
                          <View className='items-center p-6'>
                            <Text className='text-sm text-secondary-foreground'>
                              No messages yet
                            </Text>
                          </View>
                        )
                      }
                      renderItem={renderItem}
                    />
                  </ChatRenderProvider>
                </Animated.View>
              </KeyboardGestureArea>
              {shouldShowThreadOpenPlaceholder ? threadOpenPlaceholder : null}
              {shouldShowThreadQueryError ? (
                <View
                  pointerEvents='none'
                  className='absolute inset-0 items-center justify-center px-6'
                >
                  <Text className='text-center text-sm text-secondary-foreground'>
                    Couldn&apos;t load messages.
                  </Text>
                </View>
              ) : null}
              {shouldShowThreadTargetSyncTimeout ||
              (isThreadPlacementUnavailable && !isThreadSurfaceRevealed && data.length === 0) ? (
                <View
                  pointerEvents='none'
                  className='absolute inset-0 items-center justify-center px-6'
                >
                  <Text className='text-center text-sm text-secondary-foreground'>
                    {isThreadPlacementUnavailable
                      ? "Couldn't position this message."
                      : 'This message is still syncing.'}
                  </Text>
                </View>
              ) : null}
              {datePillLabel && datePillCreatedAt !== null ? (
                <Animated.View
                  pointerEvents='none'
                  style={[
                    {
                      alignItems: 'center',
                      left: 0,
                      position: 'absolute',
                      right: 0,
                      top: 1,
                      zIndex: 1,
                    },
                    datePillAnimatedStyle,
                  ]}
                >
                  <DatePillBadge
                    key={`thread-floating-date-${datePillCreatedAt}`}
                    dateText={datePillLabel}
                    onLayout={layout =>
                      recordDateSeparatorLayout(
                        'thread-floating',
                        null,
                        datePillCreatedAt,
                        datePillLabel,
                        layout,
                      )
                    }
                  />
                </Animated.View>
              ) : null}
              <ChatComposerDock
                composerHeight={composerGeometry.totalHeight}
                disabled={isComposerDisabled}
                onComposerHeight={composerGeometry.onComposerHeight}
                keyboardGeometry={keyboardGeometry}
                onComposerLayout={composerGeometry.onComposerLayout}
                scrollToBottomSlot={
                  <ChatComposerScrollToBottomButton
                    composerHeight={composerGeometry.totalHeight}
                    enabled={postPaintReady}
                    onPress={handleScrollToBottomPress}
                    visible={isScrolledUp}
                  />
                }
              >
                {shouldShowJoinChannel ? (
                  <JoinChannelCard channelId={channelId ?? ''} channelTitle={channel?.name} />
                ) : (
                  <ConversationInput
                    conversationId={channelId ?? ''}
                    threadId={threadId}
                    disabled={isComposerDisabled}
                    includeBottomSafeArea={includeBottomSafeArea}
                    onSend={handleSend}
                    placeholder='Reply to thread'
                    editingMessage={editingTarget}
                    onCancelEdit={() => setEditingTarget(null)}
                  />
                )}
              </ChatComposerDock>
            </>
          )}
        </View>
        <MessageActionsSheet
          ref={actionsSheetRef}
          target={actionsTarget}
          actions={threadActions}
          isOpen={actionsMessageId !== null}
          onOpenChange={handleActionsOpenChange}
          onDismiss={handleActionsSheetDismiss}
          currentUserId={currentUser?.id}
        />
        <MessageReminderOptionsSheet
          target={reminderTarget}
          isOpen={isReminderSheetOpen}
          onOpenChange={handleReminderSheetOpenChange}
          currentUserId={currentUser?.id}
        />
      </View>
    </ReactionsSheetHost>
  );
}
