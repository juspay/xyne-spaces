import { getChannelSnapshot, getThreadSnapshot } from '@xyne/shared/messages';
import { useEffect, useRef, useState } from 'react';

import { getCachedThreadTicketId } from '@/src/features/chat/navigation/threadTicketSurface';
import { useZero } from '@/src/hooks/useZero';
import { queries } from '@/src/zero/queries';

import type { OpenIntent, Result } from '../intent/openIntent.types';
import { resolveLocation } from '../intent/resolveLocation';
import type { ResolvedLocation } from '../intent/resolvedLocation';
import type { OpenFailure } from '../types/openFailure';

const snapshotRowsFor = (intent: OpenIntent): unknown[] => {
  if (intent.surface.kind === 'channel') {
    return getChannelSnapshot({
      kind: 'channel',
      channelId: intent.surface.channelId,
      isMember: true,
    });
  }
  const snapshot = getThreadSnapshot({
    kind: 'thread',
    channelId: intent.surface.channelId,
    conversationId: intent.surface.threadId,
    isMember: true,
  });
  if (!snapshot || typeof snapshot !== 'object') {
    return [];
  }
  const messages = (snapshot as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages : [];
};

/**
 * One resolve per `intentKey`. Live channel-status ticks must not re-run this
 * or landing remounts on a new dataKey.
 */
export const useResolveLocation = (
  intent: OpenIntent | null,
): Result<ResolvedLocation, OpenFailure> | null => {
  const zero = useZero();
  const intentRef = useRef(intent);
  intentRef.current = intent;
  const [resolved, setResolved] = useState<Result<ResolvedLocation, OpenFailure> | null>(null);
  const intentKey = intent?.intentKey ?? '';

  useEffect(() => {
    const current = intentRef.current;
    if (!current) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    setResolved(null);
    void resolveLocation(current, {
      snapshotRows: snapshotRowsFor(current),
      readCachedTicketId: getCachedThreadTicketId,
      runMessage: (messageId: string) =>
        zero.run(queries.getMessageForActivityV2({ messageId }), { type: 'complete' }),
      runConversation: (conversationId: string) =>
        zero.run(queries.getConversationById({ conversationId }), { type: 'complete' }),
      readChannelStatus: () => null,
    }).then(result => {
      if (cancelled) {
        return;
      }
      if (!result.ok && result.error.reason === 'timeout') {
        return;
      }
      setResolved(result);
    });
    return (): void => {
      cancelled = true;
    };
  }, [intentKey, zero]);

  return resolved;
};
