import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMessages } from '@xyne/shared/messages';

import { ChatThread } from '@/src/features/chat/v2/components/chat/chat-thread';
import { isThreadTargetCached } from '@/src/features/chat/v2/components/chat/chat-thread-helpers';
import { readConversationTicketId } from '@/src/features/chat/navigation/threadTicketSurface';
import { TICKET_ROUTE } from '@/src/notifications/config';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';
import { useReportNotificationPhase } from '@/src/observability/logging/hooks/notification/useReportNotificationPhase';

/** Entry points whose surface is not known until the target conversation is read. */
const EXTERNAL_ENTRY_POINTS = new Set(['notification', 'deeplink', 'activity']);

const ChatThreadScreen = (): ReactElement => {
  useReportNotificationPhase('chat_visible');
  const router = useRouter();
  const {
    channelId,
    threadId,
    messageId,
    from,
    openStartedAtMs,
    chatOpenAttemptId,
    notificationOpenKind,
    isTranscript,
    resolving,
  } = useLocalSearchParams<{
    channelId: string;
    threadId: string;
    messageId?: string;
    from?: string;
    openStartedAtMs?: string;
    chatOpenAttemptId?: string;
    notificationOpenKind?: string;
    isTranscript?: string;
    resolving?: string;
  }>();
  const isResolverHost = resolving === '1';
  const parsedOpenStartedAtMs = Number(openStartedAtMs);
  const telemetryNotificationOpenKind =
    notificationOpenKind === 'cold_start' || notificationOpenKind === 'resume'
      ? notificationOpenKind
      : undefined;

  const resolvedChannelId = channelId ?? '';
  const resolvedThreadId = threadId ?? '';
  const threadRef = useMemo(
    () => ({
      kind: 'thread' as const,
      channelId: resolvedChannelId,
      conversationId: resolvedThreadId,
      isMember: true,
    }),
    [resolvedChannelId, resolvedThreadId],
  );

  // The local snapshot is synchronous when notification/activity prefetch has
  // already run. The live query is the authoritative fallback when it has not.
  const cachedConversation = useMessages(threadRef, { enabled: false });
  const [liveConversation, liveDetails] = useQuery(
    queries.threadConversationV2({
      conversationId: resolvedThreadId,
      channelId: resolvedChannelId,
      isMember: true,
    }),
    { enabled: Boolean(resolvedChannelId && resolvedThreadId) },
  );
  const ticketId =
    (liveConversation ? readConversationTicketId(liveConversation) : null) ??
    readConversationTicketId(cachedConversation);
  const hasResolvedThreadTarget =
    isThreadTargetCached(cachedConversation?.messages ?? [], messageId) ||
    isThreadTargetCached(liveConversation?.messages ?? [], messageId);
  const hasCachedThreadMessages = (cachedConversation?.messages.length ?? 0) > 0;
  const hasLiveThreadMessages = (liveConversation?.messages.length ?? 0) > 0;
  const hasResolvedThreadSurface = messageId
    ? hasResolvedThreadTarget || hasCachedThreadMessages || hasLiveThreadMessages
    : cachedConversation !== null || liveConversation !== null || liveDetails.type === 'complete';
  // A previously visited thread can paint its cached window immediately. The
  // thread list still keeps exact placement pending until the target arrives.
  const isSurfaceResolved =
    !resolvedThreadId || hasResolvedThreadSurface || liveDetails.type === 'error';
  const isReplyTargetLoading =
    from === 'channel_thread' &&
    !!resolvedThreadId &&
    !!messageId &&
    !hasResolvedThreadTarget &&
    liveDetails.type !== 'complete' &&
    liveDetails.type !== 'error';
  const shouldWaitForSurface =
    (EXTERNAL_ENTRY_POINTS.has(from ?? '') && !isSurfaceResolved && !!resolvedThreadId) ||
    isReplyTargetLoading;
  const isResolverSurfacePending =
    isResolverHost && !hasResolvedThreadSurface && liveDetails.type !== 'error';
  // Hold the chat skeleton for a ticket only until the thread is known. If
  // messages are already cached, keep them visible while we replace to ticket.
  const isSurfacePending =
    isResolverSurfacePending ||
    shouldWaitForSurface ||
    (Boolean(ticketId) && !hasResolvedThreadSurface);
  const openKey = `${resolvedChannelId}:${resolvedThreadId}:${messageId ?? ''}`;
  const redirectedOpenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isResolverHost || !ticketId || redirectedOpenKeyRef.current === openKey) return;
    redirectedOpenKeyRef.current = openKey;
    router.replace({
      pathname: TICKET_ROUTE,
      params: {
        ticketId,
        selectedTab: 'thread',
        channelId: resolvedChannelId,
        threadId: resolvedThreadId,
        ...(messageId ? { messageId } : {}),
        ...(from ? { from } : {}),
        ...(openStartedAtMs ? { openStartedAtMs } : {}),
        ...(chatOpenAttemptId ? { chatOpenAttemptId } : {}),
      },
    });
  }, [
    from,
    messageId,
    openKey,
    openStartedAtMs,
    chatOpenAttemptId,
    resolvedChannelId,
    resolvedThreadId,
    router,
    isResolverHost,
    ticketId,
  ]);

  return (
    <ChatThread
      channelId={resolvedChannelId}
      threadId={resolvedThreadId}
      composerInsetMode='screen'
      isTranscript={isTranscript === 'true'}
      isSurfacePending={isSurfacePending}
      {...(messageId ? { messageId } : {})}
      {...(from ? { from } : {})}
      openStartedAtMs={Number.isFinite(parsedOpenStartedAtMs) ? parsedOpenStartedAtMs : null}
      chatOpenAttemptId={chatOpenAttemptId}
      {...(telemetryNotificationOpenKind
        ? { notificationOpenKind: telemetryNotificationOpenKind }
        : {})}
    />
  );
};

export default ChatThreadScreen;
