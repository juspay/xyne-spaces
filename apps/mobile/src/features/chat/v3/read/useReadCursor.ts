import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import {
  canMarkChannelAsViewed,
  findZeroDraftForComposer,
} from '@/src/components/input-composer/utils/drafts';
import { getZeroDraftFlushContent } from '@/src/components/input-composer/utils/flushComposerDraft';
import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

import { advanceReadCursor, flushDecision, type ReadCursor, type VisibleRow } from './readCursor';

const deferredByChannel = new Map<string, { timestamp: number; conversationId: string }>();

const VIEWING_DEBOUNCE_MS = 1_000;

type CursorState = { cursor: ReadCursor };

const reduceCursor = (
  state: CursorState,
  action: { type: 'advance'; row: VisibleRow | null; atEnd: boolean },
): CursorState => {
  const cursor = advanceReadCursor(state.cursor, action.row, action.atEnd);
  return cursor === state.cursor ? state : { cursor };
};

/**
 * Never-dropped channel read cursor. Leave, background, and tail-viewing flushes.
 */
export const useReadCursor = (
  channelId: string,
): {
  onBeforeMarkUnread: () => void;
  onMarkUnreadFailure: () => void;
  noteVisible: (row: VisibleRow | null, atEnd: boolean) => void;
} => {
  const zero = useZero();
  const [zeroDrafts] = useQuery(queries.userDrafts());
  const [status] = useQuery(queries.getChannelUserStatus({ channelId: channelId || '' }), {
    enabled: Boolean(channelId),
  });
  const [{ cursor }, dispatch] = useReducer(reduceCursor, { cursor: null });
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const draftRef = useRef('');
  const statusKnownRef = useRef(false);
  const skipRef = useRef(false);
  const viewingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  draftRef.current =
    findZeroDraftForComposer(zeroDrafts ?? [], channelId, undefined)?.content ?? '';
  statusKnownRef.current = canMarkChannelAsViewed(status);

  const flush = useCallback(
    (reason: 'leave' | 'background' | 'viewing'): void => {
      if (!channelId) {
        return;
      }
      const decision = flushDecision(
        reason,
        cursorRef.current,
        statusKnownRef.current,
        skipRef.current,
        Date.now(),
      );
      if (decision.kind === 'skip') {
        return;
      }
      if (decision.kind === 'defer') {
        deferredByChannel.set(channelId, {
          timestamp: Date.now(),
          conversationId: cursorRef.current?.conversationId ?? '',
        });
        return;
      }
      deferredByChannel.delete(channelId);
      zero.mutate(
        mutators.channel.markChannelAsViewed({
          channelId,
          timestamp: decision.timestamp,
          ...(decision.conversationId ? { conversationId: decision.conversationId } : {}),
          draftMessageId: uuidv4(),
          draftMessage: getZeroDraftFlushContent(channelId, draftRef.current),
        }),
      );
    },
    [channelId, zero],
  );

  const onBeforeMarkUnread = useCallback((): void => {
    skipRef.current = true;
  }, []);
  const onMarkUnreadFailure = useCallback((): void => {
    skipRef.current = false;
  }, []);

  const noteVisible = useCallback(
    (row: VisibleRow | null, atEnd: boolean): void => {
      cursorRef.current = advanceReadCursor(cursorRef.current, row, atEnd);
      dispatch({ type: 'advance', row, atEnd });
      if (!atEnd || !row) {
        return;
      }
      if (viewingTimer.current) {
        clearTimeout(viewingTimer.current);
      }
      viewingTimer.current = setTimeout((): void => {
        flush('viewing');
      }, VIEWING_DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => {
    if (!channelId || !statusKnownRef.current) {
      return;
    }
    const deferred = deferredByChannel.get(channelId);
    if (!deferred) {
      return;
    }
    deferredByChannel.delete(channelId);
    if (skipRef.current) {
      return;
    }
    zero.mutate(
      mutators.channel.markChannelAsViewed({
        channelId,
        timestamp: Math.max(deferred.timestamp, Date.now()),
        ...(deferred.conversationId ? { conversationId: deferred.conversationId } : {}),
        draftMessageId: uuidv4(),
        draftMessage: getZeroDraftFlushContent(channelId, draftRef.current),
      }),
    );
  }, [channelId, status, zero]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    const onAppState = (next: AppStateStatus): void => {
      if (next === 'background' || next === 'inactive') {
        flushRef.current('background');
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return (): void => sub.remove();
  }, []);

  useEffect(() => {
    if (!channelId) {
      return;
    }
    return (): void => {
      if (viewingTimer.current) {
        clearTimeout(viewingTimer.current);
      }
      if (skipRef.current) {
        skipRef.current = false;
        return;
      }
      flushRef.current('leave');
    };
  }, [channelId]);

  return { onBeforeMarkUnread, onMarkUnreadFailure, noteVisible };
};
