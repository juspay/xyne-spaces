import { Event } from '@xyne/shared/logger';

import type { DefineLogEventMap } from './types';

/** Catalog of structured log events. See `EVENTS.md` in this directory for purpose and when each fires. */

export type AuthProvider = 'google' | 'microsoft' | 'email';

export const CHAT_PENDING_RETRY_TAPPED = 'chat_pending_retry_tapped' as const;
export const CHAT_PENDING_RETRY_MUTATION_RESULT = 'chat_pending_retry_mutation_result' as const;

export type ChatPendingRetrySurface =
  'conversation_message_row' | 'thread_message_row' | 'message_actions';

/**
 * Zero query / mutation / run events. Names are imported from shared so they
 * stay identical to the web dashboard (`zero_query_complete`, etc.).
 */
type ZeroLogEvents = {
  [Event.ZERO_SOCKET_CONNECTING]: Readonly<{
    reason: unknown;
    zeroReconnectionAttempts: number;
    currentState: string;
    previousState: string;
  }>;
  [Event.ZERO_SOCKET_CONNECTED]: Readonly<{
    latencyMs: number;
    totalLatencyMs: number;
    currentState: string;
    previousState: string;
    connectionAttempts: number;
  }>;
  [Event.ZERO_SOCKET_DISCONNECTED]: Readonly<{
    reason: unknown;
    currentState: string;
    previousState: string;
    sessionDurationMs: number | null;
  }>;
  [Event.ZERO_SOCKET_AUTH_REQUIRED]: Readonly<{
    stage?: 'refresh_retries_exhausted' | 'refresh_retry_scheduled' | 'refresh_exception';
    reason?: unknown;
    attempt?: number;
    delayMs?: number;
    error?: unknown;
    currentState?: string;
    previousState?: string;
  }>;
  [Event.ZERO_SOCKET_CONNECTION_ERROR]: Readonly<{
    reason: unknown;
    currentState: string;
    previousState: string;
  }>;
  [Event.ZERO_QUERY_CALLED]: Readonly<{
    query: string;
  }>;
  [Event.ZERO_QUERY_COMPLETE]: Readonly<{
    query: string;
    durationMs: number;
    skewed: boolean;
    rowCount: number;
  }>;
  [Event.ZERO_QUERY_FAILED]: Readonly<{
    query: string;
    error: unknown;
  }>;
  [Event.ZERO_MUTATION_CALLED]: Readonly<{
    mutation: string;
  }>;
  [Event.ZERO_MUTATION_COMPLETE]: Readonly<{
    mutation: string;
    duration: number;
    skewed: boolean;
  }>;
  [Event.ZERO_MUTATION_ERROR]: Readonly<{
    mutation: string;
    error: unknown;
    duration?: number;
    skewed?: boolean;
  }>;
  [Event.ZERO_RUN_CALLED]: Readonly<{
    query: string;
  }>;
  [Event.ZERO_RUN_COMPLETE]: Readonly<{
    query: string;
    duration: number;
    skewed: boolean;
  }>;
  [Event.ZERO_RUN_ERROR]: Readonly<{
    query: string;
    error: unknown;
    skewed: boolean;
  }>;
};

type AppLogEvents = {
  app_started: undefined;

  [CHAT_PENDING_RETRY_TAPPED]: Readonly<{
    retryAttemptId: string;
    surface: ChatPendingRetrySurface;
    messageId: string;
    conversationId: string;
    channelId: string;
    sendKind: 'thread' | 'channel';
    mutation: 'messages.send' | 'conversations.send';
    failureReason:
      'previous_session' | 'mutator_app_error' | 'zero_state_at_send_failed' | 'unknown';
    zeroStateAtSend: string;
    zeroStateNow: string;
  }>;
  [CHAT_PENDING_RETRY_MUTATION_RESULT]: Readonly<{
    retryAttemptId: string;
    surface: ChatPendingRetrySurface;
    messageId: string;
    conversationId: string;
    channelId: string;
    sendKind: 'thread' | 'channel';
    mutation: 'messages.send' | 'conversations.send';
    phase: 'dispatch' | 'client' | 'server';
    outcome: 'started' | 'success' | 'error' | 'unknown';
    durationMs: number;
    zeroMutateCalled: boolean;
    errorType?: string;
    error?: string;
  }>;

  deep_link_workspace_switch_started: Readonly<{
    targetWorkspaceId: string;
  }>;

  deep_link_workspace_switch_failed: Readonly<{
    targetWorkspaceId: string;
    error: unknown;
  }>;

  /** The link named a workspace the user is not a member of. */
  deep_link_workspace_switch_not_a_member: Readonly<{
    segments: readonly string[];
  }>;

  /** The member workspace list could not be loaded, so the target workspace was
   *  chosen from the link's scope segments alone. */
  deep_link_workspace_switch_member_list_failed: Readonly<{
    error: unknown;
  }>;

  deep_link_copy_link_workspace_missing: Readonly<{
    context: string;
  }>;

  navigation_tab_changed: Readonly<{
    fromTab: string;
    toTab: string;
    durationMs: number;
  }>;

  app_startup_completed: Readonly<{
    durationMs: number;
    launchCause: 'direct' | 'notification' | 'call' | 'deeplink' | 'share';
    destination: 'dms' | 'login' | 'enrollment';
    nativeAnchor: 'app' | 'activity';
  }>;

  /** Startup measurement rejected as implausible (e.g. iOS background contamination). */
  app_startup_dropped: Readonly<{
    durationMs: number;
    launchCause: 'direct' | 'notification' | 'call' | 'deeplink' | 'share';
    destination: 'dms' | 'login' | 'enrollment';
    nativeAnchor: 'app' | 'activity';
    reason: 'exceeds_max_valid_duration';
    maxValidMs: number;
  }>;

  notification_open_completed: Readonly<{
    durationMs: number;
    outcome: 'highlighted' | 'skeleton_timeout' | 'highlight_timeout' | 'abandoned';
    surface: 'channel' | 'thread';
    appState: 'cold' | 'warm';
    nativeAnchor: 'app' | 'activity';
    idealPath: string;
    realPath: string;
    pathMatched: boolean;
    chatSkeletonShown: boolean;
    messageHighlighted: boolean;
    channelId: string;
    messageId: string | null;
    threadId: string | null;
  }>;

  notification_header_resolved: Readonly<{
    durationMs: number;
    outcome: 'resolved' | 'missing' | 'timeout' | 'abandoned';
    headerStatus: 'pending' | 'resolved' | 'unknown' | 'unknown_user' | 'group_fallback';
    channelPresentInVisibleChannels: boolean;
    visibleChannelListPublished: boolean;
    userDirectoryPublished: boolean;
    scopeType: string | null;
    surface: 'channel' | 'thread';
    nativeAnchor: 'app' | 'activity';
    channelId: string;
    messageId: string | null;
    threadId: string | null;
    notificationId: string | null;
    notificationType: string | null;
    metadata: string | null;
  }>;

  chat_open_skeleton_completed: Readonly<{
    durationMs: number;
    outcome: 'revealed' | 'abandoned';
    surface: 'channel' | 'thread';
    entry: 'direct' | 'notification';
  }>;

  chat_date_separator_observed: Readonly<{
    surface: 'channel-inline' | 'channel-floating' | 'thread-inline' | 'thread-floating';
    phase: 'initial-open' | 'interaction';
    reason: 'baseline' | 'long-date-boundary' | 'anomaly';
    channelId: string;
    conversationId: string | null;
    boundaryId: string | null;
    createdAtMs: number | null;
    timestampStatus: 'valid-ms' | 'seconds-like' | 'invalid';
    formattedLabel: string;
    labelShape:
      | 'relative'
      | 'weekday-day-month'
      | 'weekday-month-day'
      | 'weekday-day-only'
      | 'unavailable'
      | 'empty'
      | 'other';
    measurementStatus: 'measured' | 'zero-size';
    badgeWidthDp: number;
    badgeHeightDp: number;
    screenWidthDp: number;
    fontScale: number;
  }>;

  activity_open_completed: Readonly<{
    durationMs: number;
    outcome: 'highlighted' | 'skeleton_timeout' | 'highlight_timeout' | 'abandoned';
    surface: 'channel' | 'thread';
    chatSkeletonShown: boolean;
    messageHighlighted: boolean;
    channelId: string;
    messageId: string | null;
    threadId: string | null;
  }>;

  notification_payload_received: Readonly<{
    notificationId: string | null;
    notificationType: string | null;
    category: 'chat' | 'sos' | 'reminder' | 'control' | 'call' | 'prefetch' | 'ticket' | 'unknown';
    fcmMessageId: string | null;
    deliveryContext: 'foreground' | 'background';
    hasNotificationPayload: boolean;
    fcmSentTime: number | null;
  }>;

  notification_displayed: Readonly<{
    notificationId: string | null;
    notificationType: string | null;
    category: 'chat' | 'sos' | 'reminder' | 'ticket';
    fcmMessageId: string | null;
    deliveryContext: 'foreground' | 'background';
    hasNotificationPayload: boolean;
    fcmSentTime: number | null;
    presentationOwner: 'app' | 'operating_system';
    trayNotificationId: string | null;
  }>;

  notification_display_skipped: Readonly<{
    notificationId: string | null;
    notificationType: string | null;
    category: 'chat' | 'sos' | 'reminder' | 'control' | 'call' | 'prefetch' | 'ticket' | 'unknown';
    fcmMessageId: string | null;
    deliveryContext: 'foreground' | 'background';
    hasNotificationPayload: boolean;
    fcmSentTime: number | null;
    reason:
      | 'silent_control_signal'
      | 'prefetch_only'
      | 'conversation_already_visible'
      | 'native_call_pipeline'
      | 'os_presented_ticket'
      | 'notifications_paused'
      | 'unsupported_or_invalid_payload';
  }>;

  notification_display_failed: Readonly<{
    notificationId: string | null;
    notificationType: string | null;
    category: 'chat' | 'sos' | 'reminder' | 'ticket';
    fcmMessageId: string | null;
    deliveryContext: 'foreground' | 'background';
    hasNotificationPayload: boolean;
    fcmSentTime: number | null;
    error: unknown;
  }>;

  notification_handler_failed: Readonly<{
    notificationId: string | null;
    notificationType: string | null;
    category: 'chat' | 'sos' | 'reminder' | 'control' | 'call' | 'prefetch' | 'ticket' | 'unknown';
    fcmMessageId: string | null;
    deliveryContext: 'foreground' | 'background';
    hasNotificationPayload: boolean;
    fcmSentTime: number | null;
    error: unknown;
  }>;

  mmkv_handoff_last_op: Readonly<{
    caller: string;
    op: 'get' | 'set' | 'remove' | 'getAllKeys';
    appState: 'active' | 'inactive' | 'background' | 'unknown';
    runtime: 'main' | 'headless' | 'unknown';
    ageMs: number;
    keyHash: string;
  }>;
};

export type AppLogEventMap = DefineLogEventMap<Readonly<AppLogEvents & ZeroLogEvents>>;
