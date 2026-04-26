import { useCallback, useEffect, useMemo, useState } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import {
  getThreadTrackingSnapshot,
  setThreadLastRead,
  setThreadScroll,
} from '../machines/stateMachine';

interface UseThreadReadTrackingReturn {
  lastReadAt: number | null;
  updateLastReadAt: () => void;
  firstUnreadIndex: number | null;
  savedScrollPosition: number | null;
  saveScrollPosition: (scrollTop: number) => void;
}

interface UseThreadReadTrackingOptions {
  disableScrollTracking?: boolean;
}

export const useThreadReadTracking = (
  conversationId: string,
  threadMessages: QueryResultType<typeof queries.conversationMessagesV2>,
  options?: UseThreadReadTrackingOptions,
): UseThreadReadTrackingReturn => {
  const disableScrollTracking = options?.disableScrollTracking ?? false;
  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const [savedScrollPosition, setSavedScrollPosition] = useState<number | null>(null);

  useEffect(() => {
    const tracking = getThreadTrackingSnapshot(conversationId);
    setLastReadAt(tracking?.lastReadAt ?? null);
    setSavedScrollPosition(disableScrollTracking ? null : (tracking?.scrollTop ?? null));

    // Mark thread as visited — but don't update lastReadAt state yet.
    // firstUnreadIndex should be computed from the PREVIOUS lastReadAt (the stored value),
    // not from "now". The state will be updated when the user scrolls to bottom or
    // auto-scrolls, via updateLastReadAt().
    setThreadLastRead(conversationId, Date.now());
  }, [conversationId, disableScrollTracking]);

  const updateLastReadAt = useCallback(() => {
    const now = Date.now();
    setThreadLastRead(conversationId, now);
    setLastReadAt(now);
  }, [conversationId]);

  const saveScrollPosition = useCallback(
    (scrollTop: number) => {
      if (disableScrollTracking) {
        return;
      }
      setThreadScroll(conversationId, scrollTop);
      setSavedScrollPosition(scrollTop);
    },
    [conversationId, disableScrollTracking],
  );

  const firstUnreadIndex = useMemo(() => {
    if (lastReadAt === null || threadMessages.length === 0) {
      return null;
    }

    const index = threadMessages.findIndex(
      message => new Date(message.createdAt).getTime() > lastReadAt,
    );

    return index === -1 ? null : index;
  }, [threadMessages, lastReadAt]);

  return {
    lastReadAt,
    updateLastReadAt,
    firstUnreadIndex,
    savedScrollPosition,
    saveScrollPosition,
  };
};
