import { useEffect, useMemo, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { TICKET_ROUTE } from '@/src/notifications/config';

import { firstParam } from '../intent/openIntentSchema';
import { recordFromSearchParams } from './searchParams';
import { useOpenIntent } from './useOpenIntent';
import { useRememberLastOpenChannel } from './useRememberLastOpenChannel';
import { useResolveLocation } from './useResolveLocation';

/**
 * Parse + resolve. Ticket redirect happens from the resolved surface before
 * the conversation mounts — never after rows are painted.
 */
export const useThreadSurfaceGate = (): {
  parsed: ReturnType<typeof useOpenIntent>;
  location: ReturnType<typeof useResolveLocation>;
  channelId: string;
  threadId: string;
  isTranscript: boolean;
  isResolverHost: boolean;
} => {
  const router = useRouter();
  const params = useLocalSearchParams();
  const raw = useMemo(() => recordFromSearchParams(params), [params]);
  const parsed = useOpenIntent(raw);
  const location = useResolveLocation(parsed.ok ? parsed.value : null);
  const channelId = firstParam(params['channelId']);
  const threadId = firstParam(params['threadId']);
  const isTranscript = firstParam(params['isTranscript']) === 'true';
  const isResolverHost = firstParam(params['resolving']) === '1';
  const redirected = useRef<string | null>(null);
  const messageId = firstParam(params['messageId']);
  const from = firstParam(params['from']);
  const source = firstParam(params['source'] || params['from']);
  const createdAt = firstParam(params['createdAt']);
  const ticketId =
    location?.ok && location.value.surface.kind === 'ticket-thread'
      ? location.value.surface.ticketId
      : null;
  const openKey = `${channelId}:${threadId}:${messageId}:${ticketId ?? ''}`;
  useRememberLastOpenChannel(channelId);

  useEffect(() => {
    if (isResolverHost || !ticketId || redirected.current === openKey) {
      return;
    }
    redirected.current = openKey;
    const jumpFromReplies = from === 'channel_thread';
    router.replace({
      pathname: TICKET_ROUTE,
      params: {
        ticketId,
        selectedTab: 'thread',
        channelId,
        threadId,
        ...(messageId && !jumpFromReplies ? { messageId } : {}),
        ...(from ? { from } : {}),
        ...(source ? { source } : {}),
        ...(createdAt && Number(createdAt) > 0 ? { createdAt } : {}),
      },
    });
  }, [
    channelId,
    createdAt,
    from,
    isResolverHost,
    messageId,
    openKey,
    router,
    source,
    threadId,
    ticketId,
  ]);

  return { parsed, location, channelId, threadId, isTranscript, isResolverHost };
};
