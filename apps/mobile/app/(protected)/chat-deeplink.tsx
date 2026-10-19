import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getChannelSnapshot, getThreadSnapshot, subscribeMessages } from '@xyne/shared/messages';

import {
  buildChatOpenRoute,
  commitResolvedChatOpen,
  createChatOpenIntent,
  type ChatLinkSource,
} from '@/src/features/chat/navigation/chatOpenIntent';
import {
  resolveChatLinkFromCache,
  resolveChatLinkDeduped,
  type ChatLinkResolverDependencies,
  type ResolvedChatLocation,
} from '@/src/features/chat/navigation/resolveChatLink';
import { useZero } from '@/src/hooks/useZero';
import { queries } from '@/src/zero/queries';
import { isChatV3Enabled } from '@/src/features/chat/v3/flag';
import ChatChannelScreenV2 from '@/src/features/chat/v2/screens/ChatChannelScreen';
import ChatThreadScreenV2 from '@/src/features/chat/v2/screens/ChatThreadScreen';
import ChatChannelScreenV3 from '@/src/features/chat/v3/screens/ChatChannelScreen';
import ChatThreadScreenV3 from '@/src/features/chat/v3/screens/ChatThreadScreen';

// The destination screen stays mounted for the whole lookup. While `resolving`
// is set the list holds its missing-anchor and load-error surfaces; release
// that hold after this window so a dead connection surfaces the list's own
// retry instead of an indefinite placeholder. The lookup itself keeps running
// and still anchors the open channel when its cursor arrives later.
const CHAT_DEEPLINK_LIST_HOLD_TIMEOUT_MS = 15_000;

// A server-complete read can reject while a cold Zero client is reconnecting.
// Retry once before handing the screen back to the list's own policies.
const CHAT_DEEPLINK_RETRY_DELAY_MS = 1_000;

const resolveSource = (source: string | undefined, from: string | undefined): ChatLinkSource => {
  if (
    source === 'notification' ||
    source === 'activity' ||
    source === 'deeplink' ||
    source === 'search' ||
    source === 'forward' ||
    source === 'call'
  ) {
    return source;
  }
  return from === 'notification' ? 'notification' : 'deeplink';
};

const getResolvedLocationKey = (location: ResolvedChatLocation, openKey: string): string =>
  [
    openKey,
    location.destination,
    location.channelId,
    location.threadId ?? '',
    location.conversationId,
    location.messageId ?? '',
    location.ticketId ?? '',
  ].join('|');

function ChatDeeplinkV3(): ReactElement {
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();
  return threadId ? <ChatThreadScreenV3 /> : <ChatChannelScreenV3 />;
}

export default function ChatDeeplinkScreen(): ReactElement {
  const useV3 = useRef(isChatV3Enabled()).current;
  if (useV3) {
    return <ChatDeeplinkV3 />;
  }
  return <ChatDeeplinkV2 />;
}

function ChatDeeplinkV2(): ReactElement {
  const ChatChannelScreen = ChatChannelScreenV2;
  const ChatThreadScreen = ChatThreadScreenV2;
  const router = useRouter();
  const zero = useZero();
  const committedLocationKeyRef = useRef<string | null>(null);
  const {
    channelId,
    threadId,
    messageId,
    conversationId,
    createdAt,
    surface,
    scopeType,
    openStartedAtMs,
    chatOpenAttemptId,
    from,
    source,
  } = useLocalSearchParams<{
    channelId: string;
    threadId?: string;
    messageId?: string;
    conversationId?: string;
    createdAt?: string;
    surface?: string;
    scopeType?: string;
    openStartedAtMs?: string;
    chatOpenAttemptId?: string;
    from?: string;
    source?: string;
  }>();
  const openStartedAtMsRef = useRef(
    Number.isFinite(Number(openStartedAtMs)) ? Number(openStartedAtMs) : Date.now(),
  );
  // Keep the original lookup identity stable while the resolver fills in a
  // thread id. The in-place handoff must not reset its committed guard when
  // that derived route param changes.
  const resolverInputKey = [
    channelId,
    messageId ?? '',
    surface ?? '',
    scopeType ?? '',
    openStartedAtMsRef.current,
    chatOpenAttemptId ?? '',
    from ?? '',
    source ?? '',
  ].join('|');
  const resolvedInPlaceRef = useRef(false);
  const commitLocation = useCallback(
    (location: ResolvedChatLocation): void => {
      const openKey = chatOpenAttemptId ?? String(openStartedAtMsRef.current);
      const locationKey = getResolvedLocationKey(location, openKey);
      if (committedLocationKeyRef.current === locationKey) return;
      committedLocationKeyRef.current = locationKey;

      if (location.destination !== 'ticketThread') {
        resolvedInPlaceRef.current = true;
        router.setParams({
          channelId: location.channelId,
          threadId: location.destination === 'thread' ? location.threadId : undefined,
          conversationId: location.destination === 'main' ? location.conversationId : undefined,
          messageId: location.messageId,
          createdAt: String(location.createdAt),
          origin: undefined,
          landing: 'exact',
          source: location.source,
          from: location.source,
          surface: location.surface,
          scopeType: location.scopeType,
          resolving: undefined,
          openStartedAtMs: String(openStartedAtMsRef.current),
          chatOpenAttemptId,
        });
        return;
      }

      commitResolvedChatOpen(router, location, {
        openStartedAtMs: openStartedAtMsRef.current,
        ...(chatOpenAttemptId ? { chatOpenAttemptId } : {}),
      });
    },
    [chatOpenAttemptId, router],
  );
  const intent = useMemo(
    () =>
      createChatOpenIntent(
        {
          channelId,
          ...(threadId ? { threadId } : {}),
          ...(messageId ? { messageId } : {}),
          ...(conversationId ? { origin: conversationId } : {}),
          ...(Number.isFinite(Number(createdAt)) ? { createdAt: Number(createdAt) } : {}),
          ...(surface === 'channels' || surface === 'dms' ? { surface } : {}),
          ...(scopeType ? { scopeType } : {}),
          openStartedAtMs: openStartedAtMsRef.current,
        },
        resolveSource(source, from),
      ),
    [channelId, conversationId, createdAt, from, messageId, scopeType, source, surface, threadId],
  );
  // A notification thread tap already carries its final thread identity and
  // must stay on the thread screen; a cached ticket relation must not redirect
  // it, so it never consults the cache or the resolver.
  const hasStableNotificationThread =
    intent?.kind === 'link' && intent.source === 'notification' && !!intent.hint.threadId;
  const threadCacheRef = useMemo(() => {
    if (!intent || intent.kind !== 'link' || intent.source !== 'deeplink') return null;
    const conversationId = intent.hint.threadId ?? intent.hint.conversationId;
    if (!conversationId) return null;
    return {
      kind: 'thread' as const,
      channelId: intent.hint.channelId,
      conversationId,
      isMember: true,
    };
  }, [intent]);
  const channelCacheRef = useMemo(() => {
    if (!intent || intent.kind !== 'link' || intent.source !== 'deeplink') return null;
    const conversationId = intent.hint.threadId ?? intent.hint.conversationId;
    if (!conversationId) return null;
    return {
      kind: 'channel' as const,
      channelId: intent.hint.channelId,
      isMember: true,
    };
  }, [intent]);
  const [, setCacheRevision] = useState(0);

  useEffect(() => {
    const unsubscribers: Array<() => void> = [];
    if (threadCacheRef) {
      unsubscribers.push(
        subscribeMessages(threadCacheRef, () => setCacheRevision(revision => revision + 1)),
      );
    }
    if (channelCacheRef) {
      unsubscribers.push(
        subscribeMessages(channelCacheRef, () => setCacheRevision(revision => revision + 1)),
      );
    }
    return (): void => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [channelCacheRef, threadCacheRef]);

  const cachedThreadConversation = threadCacheRef ? getThreadSnapshot(threadCacheRef) : null;
  const cachedConversationId =
    intent?.kind === 'link' ? (intent.hint.threadId ?? intent.hint.conversationId) : undefined;
  const cachedChannelConversation =
    channelCacheRef && cachedConversationId
      ? (getChannelSnapshot(channelCacheRef).find(
          conversation => conversation.conversationId === cachedConversationId,
        ) ?? null)
      : null;

  const cachedLocation = useMemo(
    () =>
      intent?.kind === 'link'
        ? resolveChatLinkFromCache(intent, cachedThreadConversation, cachedChannelConversation)
        : null,
    [cachedChannelConversation, cachedThreadConversation, intent],
  );

  useLayoutEffect(() => {
    committedLocationKeyRef.current = null;
    resolvedInPlaceRef.current = false;
  }, [resolverInputKey]);

  useEffect(() => {
    if (!cachedLocation) return;
    commitLocation(cachedLocation);
  }, [cachedLocation, commitLocation]);

  useEffect(() => {
    if (!intent || intent.kind !== 'direct') return;
    router.replace(buildChatOpenRoute(intent, chatOpenAttemptId));
  }, [chatOpenAttemptId, intent, router]);

  useEffect(() => {
    if (!intent || intent.kind !== 'link') return;
    if (cachedLocation || resolvedInPlaceRef.current || hasStableNotificationThread) return;

    let cancelled = false;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const dependencies: ChatLinkResolverDependencies = {
      getMessage: (messageId: string) =>
        zero.run(queries.getMessageForActivityV2({ messageId }), { type: 'complete' as const }),
      getConversation: (conversationId: string) =>
        zero.run(queries.getConversationById({ conversationId }), { type: 'complete' as const }),
    };
    // The channel or thread stays mounted with whatever it can paint. Only the
    // list's pending hold is released; nothing here replaces the screen.
    const releaseListHold = (): void => {
      router.setParams({ resolving: undefined });
    };
    const holdTimeoutId = setTimeout(() => {
      if (!cancelled) releaseListHold();
    }, CHAT_DEEPLINK_LIST_HOLD_TIMEOUT_MS);

    const run = (): void => {
      void resolveChatLinkDeduped(zero, intent, dependencies, { force: attempt > 0 }).then(
        result => {
          if (cancelled) return;
          if (result.status === 'ok') {
            commitLocation(result.location);
            return;
          }
          if (result.status === 'not_found') {
            // A completed lookup that cannot place the message hands the open
            // to the list, which shows its own unavailable notice over any
            // content it already has.
            releaseListHold();
            return;
          }
          if (attempt > 0) {
            releaseListHold();
            return;
          }
          attempt += 1;
          retryTimeoutId = setTimeout(run, CHAT_DEEPLINK_RETRY_DELAY_MS);
        },
      );
    };
    run();

    return (): void => {
      cancelled = true;
      clearTimeout(holdTimeoutId);
      if (retryTimeoutId !== null) clearTimeout(retryTimeoutId);
    };
  }, [cachedLocation, commitLocation, hasStableNotificationThread, intent, router, zero]);

  if (!intent) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text>This message is unavailable.</Text>
      </View>
    );
  }

  // Keep the resolver route on the same production shell that will own the
  // destination. This prevents a generic resolver skeleton from being swapped
  // for a second channel/thread skeleton when the lookup completes.
  return threadId ? <ChatThreadScreen /> : <ChatChannelScreen />;
}
