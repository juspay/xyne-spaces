import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ReactElement,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, BackHandler, Text, InteractionManager, Pressable, View } from 'react-native';
import { useKeyboardScrollToEnd } from '@legendapp/list/keyboard';
import { KeyboardController, KeyboardGestureArea } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SharedValue } from 'react-native-reanimated';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { ChannelScopeType, parseTicketMd, type User } from '@xyne/shared';

import { ChatHeaderV3, getChatHeaderCollapsedHeight } from '@/src/components/chat/chat-header-v3';
import {
  ChatList,
  type ChatInitialLoadState,
  type ChatListHandle,
} from '@/src/features/chat/v2/components/chat/chat-list';
import {
  ChatComposerDock,
  ChatComposerScrollToBottomButton,
} from '@/src/features/chat/v2/components/chat/chat-composer-dock';
import { useChatComposerGeometry } from '@/src/features/chat/v2/hooks/use-chat-composer-geometry';
import { useSendScrollToTail } from '@/src/features/chat/v2/hooks/useSendScrollToTail';
import { ChatUserProfileActionsSheetProvider } from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import { type ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import {
  ConversationInput,
  getConversationInputMinimumHeight,
  type ChatInputSendPayload,
} from '@/src/components/input-composer';
import type { ChatInputEditingMessage } from '@/src/components/input-composer/input-composer.types';
import { JoinChannelCard } from '@/src/components/chat/join-channel-card';
import {
  canMarkChannelAsViewed,
  findZeroDraftForComposer,
} from '@/src/components/input-composer/utils/drafts';
import { getZeroDraftFlushContent } from '@/src/components/input-composer/utils/flushComposerDraft';
import {
  conversationItemToActionsTarget,
  MessageActionsSheet,
  type MessageActionsSheetHandle,
  MessageReminderOptionsSheet,
  type MessageActionsTarget,
  useMessageActions,
} from '@/src/features/chat/v2/components/message-actions-sheet';
import { sendMessage } from '@xyne/shared/messages';
import { useChannelDisplayName } from '@/src/hooks/useChannels';
import { useJoinableChannel } from '@/src/hooks/useJoinableChannel';
import { useSelf } from '@/src/hooks/useUsers';
import { useAuth } from '@/src/contexts/AuthContext';
import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { queries } from '@/src/zero/queries';
import { mutators } from '@/src/zero/mutators';
import { subscribeMutationRestore } from '@/src/zero/awaitMutation';
import { buildComposerContentForSend } from '@/src/utils/prepareComposerContentForSend';
import { dismissRegisteredComposerFocus } from '@/src/utils/composerFocusDismissRegistry';
import { awaitKeyboardHidden } from '@/src/features/chat/v2/keyboard/awaitKeyboardHidden';
import type { BaseConversationSurface } from '@/src/features/chat/baseConversationSurface';
import { rememberLastOpenChannel } from '@/src/features/chat/lastOpenChannel';
import { openBaseConversationListRoute, releaseChatOpen } from '@/src/utils/openChatRoute';
import { endCriticalWindow, getChatCriticalWindowTag } from '@/src/utils/interactionCriticalWindow';
import { getBaseConversationSurfacePath } from '@/src/features/chat/baseConversationSurface';
import { Event, logger } from '@/src/utils/logger';
import { useReportNotificationPhase } from '@/src/observability/logging/hooks/notification/useReportNotificationPhase';
import {
  CHAT_KEYBOARD_GESTURE_INTERPOLATOR,
  CHAT_KEYBOARD_GESTURE_OFFSET,
  getChatKeyboardGeometry,
  includesChatComposerBottomSafeArea,
  type ChatComposerInsetMode,
} from '@/src/features/chat/v2/chatKeyboardConfig';
import { shouldHoldChatComposer } from '@/src/features/chat/v2/components/chat/chat-list-policy';

const RICH_HYDRATION_AFTER_TRANSITION_DELAY_MS = 420;
const FLEX_STYLE = { flex: 1 } as const;

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

type ScrollToBottomButtonControllerHandle = {
  setVisible: (visible: boolean) => void;
};

type ScrollToBottomButtonControllerProps = {
  composerHeight: SharedValue<number>;
  enabled: boolean;
  onPress: () => void;
};

const ScrollToBottomButtonController = forwardRef<
  ScrollToBottomButtonControllerHandle,
  ScrollToBottomButtonControllerProps
>(function ScrollToBottomButtonController(
  { composerHeight, enabled, onPress },
  ref,
): ReactElement | null {
  const [visible, setVisible] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      setVisible: (nextVisible: boolean): void => {
        setVisible(currentVisible =>
          currentVisible === nextVisible ? currentVisible : nextVisible,
        );
      },
    }),
    [],
  );

  return (
    <ChatComposerScrollToBottomButton
      composerHeight={composerHeight}
      enabled={enabled}
      onPress={onPress}
      visible={visible}
    />
  );
});

type ChatChannelMessageActionsControllerHandle = {
  open: (conversation: ConversationItem) => void;
};

type ChatChannelMessageActionsControllerProps = {
  currentUserId: string | undefined;
  isChannelArchived: boolean;
  channelName?: string | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  disabled: boolean;
  onEditInChat: (payload: ChatInputEditingMessage) => void;
  onBeforeMarkUnread: () => void;
  onMarkUnreadFailure: () => void;
  onActionsOpenChange?: (open: boolean) => void;
  onActionsDismiss?: () => void;
};

type MountedMessageActionsProps = Omit<ChatChannelMessageActionsControllerProps, 'disabled'> & {
  conversation: ConversationItem | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const MountedMessageActions = memo(function MountedMessageActions({
  conversation,
  isOpen,
  onOpenChange,
  currentUserId,
  isChannelArchived,
  channelName,
  channelScopeType,
  onEditInChat,
  onBeforeMarkUnread,
  onMarkUnreadFailure,
  onActionsDismiss,
}: MountedMessageActionsProps): ReactElement {
  const sheetRef = useRef<MessageActionsSheetHandle>(null);
  const [reminderTarget, setReminderTarget] = useState<MessageActionsTarget | null>(null);
  const [isReminderSheetOpen, setIsReminderSheetOpen] = useState(false);
  const target = useMemo(
    () =>
      conversation
        ? conversationItemToActionsTarget(conversation, currentUserId, {
            isChannelArchived,
            channelName,
            channelScopeType,
          })
        : null,
    [channelName, channelScopeType, conversation, currentUserId, isChannelArchived],
  );
  const closeActionSheet = useCallback(
    (afterDismiss?: () => void): void => sheetRef.current?.closeActionSheet(afterDismiss),
    [],
  );
  const openForward = useCallback((): void => sheetRef.current?.openForward(), []);
  const openReminderOptions = useCallback((nextTarget: MessageActionsTarget): void => {
    setReminderTarget(nextTarget);
    setIsReminderSheetOpen(true);
  }, []);
  const handleReminderSheetOpenChange = useCallback((open: boolean): void => {
    setIsReminderSheetOpen(open);
    if (!open) setReminderTarget(null);
  }, []);
  const actions = useMessageActions({
    target,
    currentUserId,
    context: 'channel',
    closeActionSheet,
    openForward,
    openReminderOptions,
    onEditInChat,
    onBeforeMarkUnread,
    onMarkUnreadFailure,
  });

  return (
    <>
      <MessageActionsSheet
        ref={sheetRef}
        target={target}
        actions={actions}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        onDismiss={onActionsDismiss}
        currentUserId={currentUserId}
      />
      <MessageReminderOptionsSheet
        target={reminderTarget}
        isOpen={isReminderSheetOpen}
        onOpenChange={handleReminderSheetOpenChange}
        currentUserId={currentUserId}
      />
    </>
  );
});

const ChatChannelMessageActionsController = forwardRef<
  ChatChannelMessageActionsControllerHandle,
  ChatChannelMessageActionsControllerProps
>(function ChatChannelMessageActionsController(
  { disabled, onActionsOpenChange, ...mountedProps },
  ref,
): ReactElement | null {
  const [conversation, setConversation] = useState<ConversationItem | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const effectiveOpen = isOpen && !disabled;

  useImperativeHandle(
    ref,
    () => ({
      open: (nextConversation: ConversationItem): void => {
        if (disabled) return;
        setConversation(nextConversation);
        setIsOpen(true);
      },
    }),
    [disabled],
  );

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    onActionsOpenChange?.(effectiveOpen);
  }, [effectiveOpen, onActionsOpenChange]);

  const handleOpenChange = useCallback((open: boolean): void => setIsOpen(open), []);

  return (
    <MountedMessageActions
      {...mountedProps}
      conversation={conversation}
      isOpen={effectiveOpen}
      onOpenChange={handleOpenChange}
    />
  );
});

const ChatChannelScreen = (): ReactElement => {
  useReportNotificationPhase('chat_visible');
  const {
    channelId,
    conversationId,
    messageId,
    createdAt,
    from,
    source,
    scopeType: scopeTypeParam,
    surface: surfaceParam,
    openStartedAtMs: openStartedAtMsParam,
    chatOpenAttemptId,
    notificationOpenKind,
    resolving,
    unreadOpen,
    unreadCount: unreadCountParam,
    unreadLastViewedAt: unreadLastViewedAtParam,
    unreadLastViewedConversationId: unreadLastViewedConversationIdParam,
  } = useLocalSearchParams<{
    channelId: string;
    conversationId?: string;
    messageId?: string;
    createdAt?: string;
    from?: string;
    source?: string;
    scopeType?: string;
    surface?: string;
    openStartedAtMs?: string;
    chatOpenAttemptId?: string;
    notificationOpenKind?: string;
    resolving?: string;
    unreadOpen?: string;
    unreadCount?: string;
    unreadLastViewedAt?: string;
    unreadLastViewedConversationId?: string;
  }>();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const composerInsetMode: ChatComposerInsetMode = 'screen';
  const includeBottomSafeArea = includesChatComposerBottomSafeArea(composerInsetMode);
  const keyboardGeometry = useMemo(
    () => getChatKeyboardGeometry(insets.bottom, composerInsetMode),
    [composerInsetMode, insets.bottom],
  );
  const zero = useZero();
  const zeroRef = useRef(zero);
  zeroRef.current = zero;
  const chatListRef = useRef<ChatListHandle>(null);
  const scrollToBottomButtonRef = useRef<ScrollToBottomButtonControllerHandle>(null);
  const messageActionsControllerRef = useRef<ChatChannelMessageActionsControllerHandle>(null);
  const isMessageLongPressPendingRef = useRef(false);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);
  const messageNavigationPendingRef = useRef(false);
  const skipMarkAsReadRef = useRef(false);
  const existingZeroDraftContentRef = useRef('');
  const canMarkChannelAsViewedRef = useRef(false);
  const [zeroDrafts] = useQuery(queries.userDrafts());
  const channelUserStatusQuery = useMemo(
    () => queries.getChannelUserStatus({ channelId: channelId ?? '' }),
    [channelId],
  );
  const [zeroChannelUserStatus] = useQuery(channelUserStatusQuery, {
    enabled: Boolean(channelId),
  });
  existingZeroDraftContentRef.current =
    findZeroDraftForComposer(zeroDrafts ?? [], channelId ?? '', undefined)?.content ?? '';
  canMarkChannelAsViewedRef.current = canMarkChannelAsViewed(zeroChannelUserStatus);
  const postPaintTaskRef = useRef<{ cancel: () => void } | null>(null);
  const openChannelIdRef = useRef<string | null>(channelId ?? null);
  const fallbackOpenStartedAtMsRef = useRef<{ key: string; value: number }>({
    key: '',
    value: Date.now(),
  });
  const richHydrationInteractionRef = useRef<ReturnType<
    typeof InteractionManager.runAfterInteractions
  > | null>(null);
  const richHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeOpenFallbackKey = useMemo(
    () =>
      [
        channelId ?? '',
        conversationId ?? '',
        messageId ?? '',
        createdAt ?? '',
        source ?? '',
        from ?? '',
        surfaceParam ?? '',
        notificationOpenKind ?? '',
        unreadOpen ?? '',
        unreadLastViewedAtParam ?? '',
        unreadLastViewedConversationIdParam ?? '',
      ].join(':'),
    [
      channelId,
      conversationId,
      createdAt,
      from,
      messageId,
      notificationOpenKind,
      source,
      surfaceParam,
      unreadLastViewedAtParam,
      unreadLastViewedConversationIdParam,
      unreadOpen,
    ],
  );
  const openStartedAtMs = useMemo(() => {
    const parsedOpenStartedAtMs = Number(openStartedAtMsParam);
    if (Number.isFinite(parsedOpenStartedAtMs)) return parsedOpenStartedAtMs;
    if (fallbackOpenStartedAtMsRef.current.key !== routeOpenFallbackKey) {
      fallbackOpenStartedAtMsRef.current = {
        key: routeOpenFallbackKey,
        value: Date.now(),
      };
    }
    return fallbackOpenStartedAtMsRef.current.value;
  }, [openStartedAtMsParam, routeOpenFallbackKey]);
  const currentUser = useSelf();
  const { user } = useAuth();
  const chatListCurrentUser = useMemo<User | undefined>(() => {
    if (currentUser || !user?.user_id) return currentUser;
    return {
      id: user.user_id,
      name: user.name || 'You',
      picture: user.photo_url ?? null,
    } as User;
  }, [currentUser, user?.name, user?.photo_url, user?.user_id]);
  const {
    channel: activeChannel,
    channelUserStatus,
    shouldShowJoinChannel,
  } = useJoinableChannel(channelId);
  const isUnreadOpen = unreadOpen === '1';
  const chatOpenSource = source ?? from;
  const isNotificationOpen = chatOpenSource === 'notification';
  const isResolvingLinkCursor =
    !isNotificationOpen && resolving === '1' && !!conversationId && !createdAt && !messageId;
  const isLinkResolving = resolving === '1';
  const isResolvingLinkUnavailable = resolving === 'unavailable';

  const scopeTypeFromParam =
    scopeTypeParam === ChannelScopeType.DM || scopeTypeParam === ChannelScopeType.GROUP_DM
      ? scopeTypeParam
      : undefined;
  const channelType = activeChannel?.scopeType ?? scopeTypeFromParam;
  const displayName = useChannelDisplayName(activeChannel, currentUser?.id ?? '');
  const isDM = channelType === ChannelScopeType.DM;
  const surfaceFromParam: BaseConversationSurface | undefined =
    surfaceParam === 'channels' || surfaceParam === 'dms' ? surfaceParam : undefined;
  const baseConversationSurface: BaseConversationSurface =
    surfaceFromParam ??
    (channelType === ChannelScopeType.DM || channelType === ChannelScopeType.GROUP_DM
      ? 'dms'
      : 'channels');
  const telemetryNotificationOpenKind =
    notificationOpenKind === 'cold_start' || notificationOpenKind === 'resume'
      ? notificationOpenKind
      : undefined;
  const chatOpenEntryPoint =
    chatOpenSource === 'notification'
      ? 'notification'
      : chatOpenSource === 'activity'
        ? 'activity'
        : chatOpenSource === 'deeplink'
          ? `${baseConversationSurface}_deeplink`
          : `${baseConversationSurface}_direct`;

  const [postPaintReady, setPostPaintReady] = useState(false);
  const [initialLoadState, setInitialLoadState] = useState<ChatInitialLoadState>('loading');
  const [placeholderReport, setPlaceholderReport] = useState<{
    identityKey: string;
    visible: boolean;
  }>({ identityKey: '', visible: true });
  const shouldUseStableActivityOpenIdentity =
    chatOpenSource === 'activity' && (!!conversationId || !!messageId);
  // A notification re-anchors an already-mounted channel through setParams.
  // Key the cycle by its target so a new target resets placement without
  // restarting the screen for every render.
  const requestedNotificationTarget = messageId ?? conversationId ?? '';
  const screenOpenIdentityKey = isNotificationOpen
    ? `${channelId ?? ''}:notification:${requestedNotificationTarget}`
    : `${routeOpenFallbackKey}:${
        shouldUseStableActivityOpenIdentity ? 'activity-target' : openStartedAtMs
      }`;
  const routeMountedIdentityRef = useRef<string | null>(null);
  const routeMountedChannelIdRef = useRef<string | null>(null);
  const [loadedListIdentityKey, setLoadedListIdentityKey] = useState<string | null>(null);
  const listInitialLoadComplete = loadedListIdentityKey === screenOpenIdentityKey;

  useLayoutEffect(() => {
    if (!channelId || routeMountedIdentityRef.current === screenOpenIdentityKey) return;
    const isSameMountedChannel = routeMountedChannelIdRef.current === channelId;
    routeMountedIdentityRef.current = screenOpenIdentityKey;
    routeMountedChannelIdRef.current = channelId;
    if (isSameMountedChannel && postPaintReady) {
      // A singular route can replace params for the same channel without
      // remounting the list. Its old first-paint task is already complete, so
      // release the new window immediately instead of waiting for the cap.
      endCriticalWindow(getChatCriticalWindowTag(channelId));
    }
  }, [channelId, postPaintReady, screenOpenIdentityKey]);
  const [keyboardShellReadyIdentityKey, setKeyboardShellReadyIdentityKey] = useState<string | null>(
    null,
  );
  const keyboardShellReady = keyboardShellReadyIdentityKey === screenOpenIdentityKey;
  const [richHydrationReady, setRichHydrationReady] = useState(false);
  const [editingTarget, setEditingTarget] = useState<ChatInputEditingMessage | null>(null);

  useEffect(() => {
    if (!channelId || isLinkResolving) return;
    releaseChatOpen(chatOpenAttemptId);
  }, [channelId, chatOpenAttemptId, isLinkResolving, screenOpenIdentityKey]);
  const editingTargetRef = useRef<ChatInputEditingMessage | null>(null);
  const setEditingTargetState = useCallback((target: ChatInputEditingMessage | null): void => {
    editingTargetRef.current = target;
    setEditingTarget(target);
  }, []);
  const composerGeometry = useChatComposerGeometry(
    getConversationInputMinimumHeight(insets.bottom, includeBottomSafeArea),
    channelId ?? '',
  );
  const channelLastActivityAt = activeChannel?.lastActivityAt ?? null;
  const rawLastViewedAt =
    typeof channelUserStatus?.lastViewedAt === 'number' &&
    Number.isFinite(channelUserStatus.lastViewedAt)
      ? channelUserStatus.lastViewedAt
      : undefined;
  const hasUnreadMessages =
    rawLastViewedAt !== undefined &&
    typeof channelLastActivityAt === 'number' &&
    Number.isFinite(channelLastActivityAt) &&
    rawLastViewedAt < channelLastActivityAt;
  const parsedUnreadLastViewedAt = Number(unreadLastViewedAtParam);
  const requestedUnreadLastViewedAt =
    Number.isFinite(parsedUnreadLastViewedAt) && parsedUnreadLastViewedAt > 0
      ? parsedUnreadLastViewedAt
      : undefined;
  const parsedUnreadCount = Number(unreadCountParam);
  const requestedUnreadCount =
    Number.isFinite(parsedUnreadCount) && parsedUnreadCount >= 0 ? parsedUnreadCount : undefined;
  const frozenUnreadBoundaryLastViewedAt = isUnreadOpen
    ? (requestedUnreadLastViewedAt ?? (hasUnreadMessages ? rawLastViewedAt : undefined))
    : undefined;
  const frozenUnreadBoundaryLastViewedConversationId = isUnreadOpen
    ? (unreadLastViewedConversationIdParam ??
      (hasUnreadMessages ? (channelUserStatus?.lastViewedConversationId ?? undefined) : undefined))
    : undefined;
  const frozenUnreadCount = isUnreadOpen
    ? (requestedUnreadCount ?? channelUserStatus?.unreadCount ?? undefined)
    : undefined;
  const isOpenRevealReady = postPaintReady && listInitialLoadComplete && keyboardShellReady;
  // The list is the only writer of shimmer visibility. Do not reset this to
  // true in a parent layout effect — that runs after the list reports "no
  // shimmer" and leaves the input hidden while messages are already visible.
  const isComposerDisabled = shouldHoldChatComposer({
    // ChatList is unmounted on the unavailable-link surface, so it cannot
    // clear the placeholder. Do not hold the composer there.
    // An identity mismatch (channel switch / notification re-anchor) must
    // hold until that list reports; a stale `false` from the previous open
    // would flash the input before shimmer.
    shouldShowOpenPlaceholder:
      !isResolvingLinkUnavailable &&
      (placeholderReport.identityKey !== screenOpenIdentityKey || placeholderReport.visible),
    hasTerminalOpenError: initialLoadState === 'error',
  });
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef: chatListRef });
  // scrollMessageToEnd (send) and the message-actions sheet both need to
  // freeze the list, and neither knows about the other. Track each owner
  // separately so closing one doesn't clobber a freeze the other still needs.
  const isActionsSheetOpenRef = useRef(false);
  const isSendScrollInFlightRef = useRef(false);
  // Live mirror of the list's scrolled-up state so an edit-send can decide,
  // without a re-render, whether to re-pin to the tail.
  const isScrolledUpRef = useRef(false);
  const sendScrollSequenceRef = useRef(0);
  const applyFreeze = useCallback((): void => {
    freeze.set(isActionsSheetOpenRef.current || isSendScrollInFlightRef.current);
  }, [freeze]);
  const handleActionsSheetOpenChange = useCallback(
    (open: boolean): void => {
      if (open) isActionsSheetOpenRef.current = true;
      applyFreeze();
    },
    [applyFreeze],
  );
  const handleActionsSheetDismiss = useCallback((): void => {
    isActionsSheetOpenRef.current = false;
    applyFreeze();
  }, [applyFreeze]);

  useLayoutEffect(() => {
    isActionsSheetOpenRef.current = false;
    sendScrollSequenceRef.current += 1;
    isSendScrollInFlightRef.current = false;
    applyFreeze();
  }, [applyFreeze, screenOpenIdentityKey]);

  useEffect(() => {
    if (!isComposerDisabled || !KeyboardController.isVisible()) return;
    void KeyboardController.dismiss();
  }, [isComposerDisabled]);

  useEffect(() => {
    if (!isResolvingLinkCursor || !conversationId) return;
    let cancelled = false;
    void zero
      .run(queries.getConversationById({ conversationId }), { type: 'complete' })
      .then(conversation => {
        if (cancelled) return;
        if (!conversation || !Number.isFinite(conversation.createdAt)) {
          router.setParams({ resolving: 'unavailable' });
          return;
        }
        router.setParams({ createdAt: String(conversation.createdAt), resolving: undefined });
      })
      .catch(() => {
        if (cancelled) return;
        router.setParams({ resolving: 'unavailable' });
      });
    return (): void => {
      cancelled = true;
    };
  }, [conversationId, isResolvingLinkCursor, router, zero]);

  // Skip when there is no channel_user_status — the mutator throws
  // "Not a channel participant" and rolls the leave flush back.
  useEffect(() => {
    if (!channelId) return;
    return (): void => {
      if (skipMarkAsReadRef.current) {
        skipMarkAsReadRef.current = false;
        return;
      }
      if (!canMarkChannelAsViewedRef.current) return;
      zeroRef.current.mutate(
        mutators.channel.markChannelAsViewed({
          channelId,
          timestamp: Date.now(),
          draftMessageId: uuidv4(),
          draftMessage: getZeroDraftFlushContent(channelId, existingZeroDraftContentRef.current),
        }),
      );
    };
  }, [channelId]);
  const handleBackNavigation = useCallback((): void => {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const logAfterPaint = (): void => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
          logger.info(Event.LOTUS_TAB_SWITCH, {
            from_route: `conversation/${channelId}`,
            to_route:
              chatOpenSource === 'activity'
                ? 'activity'
                : getBaseConversationSurfacePath(baseConversationSurface),
            latency_ms: Math.round(end - start),
            stage: 'back_navigation',
          });
        });
      });
    };

    if (router.canGoBack()) {
      router.back();
    } else {
      openBaseConversationListRoute(router, baseConversationSurface);
    }
    logAfterPaint();
  }, [baseConversationSurface, channelId, chatOpenSource, router]);

  useFocusEffect(
    useCallback(() => {
      // A fast second tap can arrive before Expo Router commits the first push.
      // Reset only when this conversation becomes the focused route again.
      messageNavigationPendingRef.current = false;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBackNavigation();
        return true;
      });
      return (): void => {
        subscription.remove();
      };
    }, [handleBackNavigation]),
  );

  useEffect(() => {
    if (channelId && baseConversationSurface === 'channels') {
      rememberLastOpenChannel(channelId);
    }
  }, [baseConversationSurface, channelId]);

  useLayoutEffect(() => {
    openChannelIdRef.current = channelId ?? null;
    setPostPaintReady(false);
    setInitialLoadState('loading');
    setRichHydrationReady(false);
    postPaintTaskRef.current?.cancel();
    postPaintTaskRef.current = null;
    richHydrationInteractionRef.current?.cancel();
    richHydrationInteractionRef.current = null;
    if (richHydrationTimerRef.current) {
      clearTimeout(richHydrationTimerRef.current);
      richHydrationTimerRef.current = null;
    }
    return (): void => {
      postPaintTaskRef.current?.cancel();
      postPaintTaskRef.current = null;
      // If navigation removes the route before the list gets its first
      // layout, release the interaction window here rather than waiting for
      // the ten-second safety cap to expire and holding unrelated queries.
      if (channelId) {
        endCriticalWindow(getChatCriticalWindowTag(channelId));
      }
      richHydrationInteractionRef.current?.cancel();
      richHydrationInteractionRef.current = null;
      if (richHydrationTimerRef.current) {
        clearTimeout(richHydrationTimerRef.current);
        richHydrationTimerRef.current = null;
      }
    };
  }, [channelId]);

  useLayoutEffect(() => {
    setKeyboardShellReadyIdentityKey(null);
    setInitialLoadState('loading');
  }, [screenOpenIdentityKey]);

  useEffect(() => {
    if (!isOpenRevealReady) return;

    let cancelled = false;
    richHydrationInteractionRef.current?.cancel();
    if (richHydrationTimerRef.current) {
      clearTimeout(richHydrationTimerRef.current);
      richHydrationTimerRef.current = null;
    }

    richHydrationInteractionRef.current = InteractionManager.runAfterInteractions(() => {
      richHydrationTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setRichHydrationReady(true);
      }, RICH_HYDRATION_AFTER_TRANSITION_DELAY_MS);
    });

    return (): void => {
      cancelled = true;
      richHydrationInteractionRef.current?.cancel();
      richHydrationInteractionRef.current = null;
      if (richHydrationTimerRef.current) {
        clearTimeout(richHydrationTimerRef.current);
        richHydrationTimerRef.current = null;
      }
    };
  }, [isOpenRevealReady]);

  const handleChatListFirstLayout = useCallback((): void => {
    if (postPaintTaskRef.current) return;
    postPaintTaskRef.current = runAfterFirstPaint(() => {
      if (channelId && Number.isFinite(openStartedAtMs)) {
        endCriticalWindow(getChatCriticalWindowTag(channelId));
      }
      setPostPaintReady(true);
    });
  }, [channelId, openStartedAtMs]);

  const handleChatListInitialLoadComplete = useCallback((): void => {
    setLoadedListIdentityKey(screenOpenIdentityKey);
  }, [screenOpenIdentityKey]);

  const handleChatListInitialLoadStateChange = useCallback((state: ChatInitialLoadState): void => {
    setInitialLoadState(state);
  }, []);

  const handleOpenPlaceholderChange = useCallback(
    (visible: boolean): void => {
      setPlaceholderReport({ identityKey: screenOpenIdentityKey, visible });
    },
    [screenOpenIdentityKey],
  );

  const handleComposerShellReady = useCallback((): void => {
    setKeyboardShellReadyIdentityKey(screenOpenIdentityKey);
  }, [screenOpenIdentityKey]);

  const runSendScrollToTail = useSendScrollToTail({
    isMountedRef,
    isSendScrollInFlightRef,
    sendScrollSequenceRef,
    scrollMessageToEnd,
    applyFreeze,
  });

  const handleSend = useCallback(
    ({ text, html, attachments }: ChatInputSendPayload, restore: () => void): void => {
      if (shouldShowJoinChannel) {
        Alert.alert('Join channel', 'Join this channel before sending messages.');
        restore();
        return;
      }
      if (!channelId) {
        Alert.alert('Error', 'Unable to send message. Missing channel context.');
        restore();
        return;
      }

      const transformedHtml = buildComposerContentForSend(text, html);
      const hasAttachments = attachments.length > 0;
      if (!transformedHtml && !hasAttachments) return;

      const editingTarget = editingTargetRef.current;
      if (editingTarget) {
        if (!transformedHtml) return;
        const editingMessageId = editingTarget.messageId;
        setEditingTargetState(null);
        const mutation = zero.mutate(
          mutators.messages.update({
            messageId: editingMessageId,
            content: transformedHtml,
          }),
        );
        subscribeMutationRestore(mutation, () => {
          Alert.alert('Failed to update message', 'Please try again.');
          restore();
        });
        // Editing re-emits the message list and collapses the composer (the
        // editing banner and populated draft are gone). When the user is at the
        // tail that layout change otherwise drifts the viewport onto an older
        // message. Re-pin to the tail -- but only when already at the tail, so a
        // user who scrolled up to edit history is not yanked back down.
        if (!isScrolledUpRef.current) {
          runSendScrollToTail();
        }
        return;
      }

      const content = transformedHtml ?? '<p></p>';
      const messageIdForSend = uuidv4();
      const conversationIdForSend = uuidv4();
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
        { kind: 'channel', channelId },
        {
          content,
          text,
          messageId: messageIdForSend,
          conversationId: conversationIdForSend,
          ...(pendingAttachments.length > 0 && { attachments: pendingAttachments }),
        },
      );
      chatListRef.current?.registerLocalSend(conversationIdForSend);
      void hasAttachments;

      runSendScrollToTail({
        isReady: () => chatListRef.current?.hasPaintedConversation(conversationIdForSend) === true,
      });
    },
    [channelId, runSendScrollToTail, setEditingTargetState, shouldShowJoinChannel, zero],
  );

  const handleEditInChat = useCallback(
    (payload: ChatInputEditingMessage): void => {
      setEditingTargetState(payload);
    },
    [setEditingTargetState],
  );

  const handleCancelEdit = useCallback(
    (): void => setEditingTargetState(null),
    [setEditingTargetState],
  );

  const handleBeforeMarkUnread = useCallback((): void => {
    skipMarkAsReadRef.current = true;
  }, []);

  const handleMarkUnreadFailure = useCallback((): void => {
    skipMarkAsReadRef.current = false;
  }, []);

  const handleMessageLongPress = useCallback(
    (conversation: ConversationItem): void => {
      if (shouldShowJoinChannel) return;
      if (isMessageLongPressPendingRef.current) return;

      const keyboardWasVisible = KeyboardController.isVisible();

      if (keyboardWasVisible) {
        isMessageLongPressPendingRef.current = true;

        // Start the native dismissal before blurring the composer. Blurring
        // updates KeyboardController's visibility state immediately on some
        // devices, even though KeyboardStickyView is still animating.
        const keyboardHidden = awaitKeyboardHidden(KeyboardController, {
          wasVisible: true,
        });
        dismissRegisteredComposerFocus();

        // Opening the sheet before the IME hide animation settles leaves the
        // KeyboardStickyView composer floating mid-screen for a few frames.
        void keyboardHidden.finally(() => {
          isMessageLongPressPendingRef.current = false;
          if (!isMountedRef.current) return;
          messageActionsControllerRef.current?.open(conversation);
        });
        return;
      }

      // There is no active IME to synchronize, so clear any composer panels
      // and open the actions sheet immediately.
      dismissRegisteredComposerFocus();
      messageActionsControllerRef.current?.open(conversation);
    },
    [shouldShowJoinChannel],
  );

  const handleScrolledUpChange = useCallback((isScrolledUp: boolean): void => {
    isScrolledUpRef.current = isScrolledUp;
    scrollToBottomButtonRef.current?.setVisible(isScrolledUp);
  }, []);

  const handleScrollToBottomPress = useCallback((): void => {
    chatListRef.current?.scrollToBottom();
  }, []);

  const handleMessagePress = useCallback(
    (conversation: ConversationItem, paintRow: ChatPaintRow): void => {
      if (KeyboardController.isVisible()) {
        void KeyboardController.dismiss();
        return;
      }
      if (messageNavigationPendingRef.current) return;
      messageNavigationPendingRef.current = true;

      const routeThreadId = paintRow.parentConversationId ?? conversation.conversationId;
      const routeMessageId = paintRow.parentConversationId
        ? paintRow.parentPreview?.messageId
        : undefined;

      const parsedTicket = parseTicketMd(conversation.ticket_md ?? null);
      const resolvedTicketId = conversation.ticketId || parsedTicket?.id || '';
      if (resolvedTicketId) {
        router.push({
          pathname: '/ticket/[ticketId]',
          params: {
            ticketId: resolvedTicketId,
            channelId: conversation.channelId || channelId || '',
            threadId: conversation.conversationId,
          },
        });
        return;
      }

      router.push({
        pathname: '/chat/[channelId]/[threadId]',
        params: {
          channelId: conversation.channelId || channelId || '',
          threadId: routeThreadId,
          from: 'channel_thread',
          openStartedAtMs: String(Date.now()),
          surface: baseConversationSurface,
          ...(channelType !== undefined ? { scopeType: channelType } : {}),
          ...(routeMessageId ? { messageId: routeMessageId } : {}),
        },
      });
    },
    [baseConversationSurface, channelId, channelType, router],
  );

  return (
    <View className='flex-1 bg-chat-screen '>
      <ChatHeaderV3
        channelId={channelId ?? ''}
        postPaintReady={postPaintReady}
        onBack={handleBackNavigation}
      />
      <View pointerEvents='none' style={{ height: getChatHeaderCollapsedHeight(insets.top) }} />

      <ChatUserProfileActionsSheetProvider>
        <KeyboardGestureArea
          interpolator={CHAT_KEYBOARD_GESTURE_INTERPOLATOR}
          offset={CHAT_KEYBOARD_GESTURE_OFFSET}
          style={FLEX_STYLE}
        >
          {isResolvingLinkUnavailable ? (
            <View className='flex-1 items-center justify-center gap-3 px-6'>
              <Text className='text-center text-foreground'>This message is unavailable.</Text>
              <Pressable
                accessibilityRole='button'
                onPress={() => router.setParams({ resolving: '1' })}
              >
                <Text className='text-primary'>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <ChatList
              // Reset message state for a channel switch or a late-resolved
              // notification cursor. The shared hook reads its initial window
              // once, so the cursor must be present when this list mounts.
              key={`${channelId}:${createdAt ?? ''}`}
              ref={chatListRef}
              channelId={channelId ?? ''}
              conversationId={conversationId}
              messageId={messageId}
              createdAt={createdAt}
              currentUser={chatListCurrentUser}
              channelType={channelType}
              liveHydrationEnabled={postPaintReady}
              richHydrationEnabled={richHydrationReady}
              isNotificationOpen={isNotificationOpen}
              isLinkResolving={isLinkResolving}
              openStartedAtMs={openStartedAtMs}
              notificationOpenKind={telemetryNotificationOpenKind}
              entryPoint={chatOpenEntryPoint}
              isUnreadOpen={isUnreadOpen}
              unreadBoundaryLastViewedAt={frozenUnreadBoundaryLastViewedAt}
              unreadBoundaryLastViewedConversationId={frozenUnreadBoundaryLastViewedConversationId}
              unreadCount={frozenUnreadCount}
              composerGeometry={composerGeometry}
              freeze={freeze}
              keyboardOffset={keyboardGeometry.listOffset}
              onMessagePress={handleMessagePress}
              onMessageLongPress={handleMessageLongPress}
              onScrolledUpChange={handleScrolledUpChange}
              onFirstLayout={handleChatListFirstLayout}
              onInitialLoadComplete={handleChatListInitialLoadComplete}
              onInitialLoadStateChange={handleChatListInitialLoadStateChange}
              onOpenPlaceholderChange={handleOpenPlaceholderChange}
            />
          )}
        </KeyboardGestureArea>
      </ChatUserProfileActionsSheetProvider>

      <ChatComposerDock
        composerHeight={composerGeometry.totalHeight}
        disabled={isComposerDisabled}
        onComposerHeight={composerGeometry.onComposerHeight}
        keyboardGeometry={keyboardGeometry}
        onComposerLayout={composerGeometry.onComposerLayout}
        onShellReady={handleComposerShellReady}
        shellReadyKey={screenOpenIdentityKey}
        scrollToBottomSlot={
          <ScrollToBottomButtonController
            key={`scroll-to-bottom:${screenOpenIdentityKey}`}
            ref={scrollToBottomButtonRef}
            composerHeight={composerGeometry.totalHeight}
            enabled={postPaintReady}
            onPress={handleScrollToBottomPress}
          />
        }
      >
        {shouldShowJoinChannel ? (
          <JoinChannelCard channelId={channelId ?? ''} channelTitle={activeChannel?.name} />
        ) : (
          <ConversationInput
            // Remount the composer on a channel switch so no draft, attachment,
            // or in-flight compose state from a previous channel (e.g. a DM) can
            // be sent into the newly opened channel. Mirrors the ChatList key above.
            key={channelId}
            conversationId={channelId ?? ''}
            disabled={isComposerDisabled}
            includeBottomSafeArea={includeBottomSafeArea}
            onSend={handleSend}
            editingMessage={editingTarget}
            onCancelEdit={handleCancelEdit}
            placeholder={isDM ? `Message ${displayName}` : 'Type a message...'}
          />
        )}
      </ChatComposerDock>

      <ChatChannelMessageActionsController
        key={screenOpenIdentityKey}
        ref={messageActionsControllerRef}
        currentUserId={currentUser?.id}
        isChannelArchived={Boolean(activeChannel?.isArchived)}
        channelName={displayName}
        channelScopeType={channelType}
        disabled={shouldShowJoinChannel}
        onEditInChat={handleEditInChat}
        onBeforeMarkUnread={handleBeforeMarkUnread}
        onMarkUnreadFailure={handleMarkUnreadFailure}
        onActionsOpenChange={handleActionsSheetOpenChange}
        onActionsDismiss={handleActionsSheetDismiss}
      />
    </View>
  );
};

export default ChatChannelScreen;
