import { useLocalSearchParams, Stack } from 'expo-router';
import type { ReactElement } from 'react';

import { TicketDetailsScreen } from '@/src/screens/TicketDetailsScreen';

export default function TicketDetailsRoute(): ReactElement {
  const {
    ticketId,
    selectedTab,
    channelId,
    threadId,
    messageId,
    from,
    source,
    createdAt,
    openStartedAtMs,
    chatOpenAttemptId,
  } = useLocalSearchParams<{
    ticketId: string;
    selectedTab?: string;
    channelId?: string;
    threadId?: string;
    messageId?: string;
    from?: string;
    source?: string;
    createdAt?: string;
    openStartedAtMs?: string;
    chatOpenAttemptId?: string;
  }>();

  const resolvedSelectedTab =
    selectedTab === 'thread'
      ? 'thread'
      : selectedTab === 'overview' || selectedTab === 'details'
        ? 'overview'
        : undefined;
  const parsedOpenStartedAtMs = Number(openStartedAtMs);

  return (
    <>
      {/* Keep back gesture edge-only so mid-screen horizontal swipes can own tab paging. */}
      <Stack.Screen options={{ fullScreenGestureEnabled: false }} />
      <TicketDetailsScreen
        ticketId={ticketId ?? ''}
        {...(resolvedSelectedTab ? { selectedTab: resolvedSelectedTab } : {})}
        {...(channelId ? { fallbackChannelId: channelId } : {})}
        {...(threadId ? { fallbackThreadId: threadId } : {})}
        {...(messageId ? { targetMessageId: messageId } : {})}
        {...(from ? { from } : {})}
        {...(source ? { source } : {})}
        {...(createdAt ? { createdAt } : {})}
        {...(chatOpenAttemptId ? { chatOpenAttemptId } : {})}
        {...(Number.isFinite(parsedOpenStartedAtMs)
          ? { openStartedAtMs: parsedOpenStartedAtMs }
          : {})}
      />
    </>
  );
}
