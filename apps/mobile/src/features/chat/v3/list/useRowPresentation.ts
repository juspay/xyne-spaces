import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isActiveBookmark } from '@/src/features/bookmarks/bookmark-utils';
import { useUserBookmarks } from '@/src/hooks/useUserBookmarks';
import { applyRowPresentation } from '../model/applyRowPresentation';
import type { ChatRow } from '../model/chatRow.types';
import {
  EMPTY_ENTRANCE,
  ENTRANCE_FLUSH_MS,
  flushEntrance,
  messageIdsFromRows,
  seedEntrance,
  trackEntrance,
  type EntranceState,
} from '../model/entrance';
import { reminderLabelByMessageId } from '../model/reminder';

const EMPTY_IDS: ReadonlySet<string> = new Set();

export const useRowPresentation = (
  rows: readonly ChatRow[],
  dataKey: string,
  highlightedConversationId: string | null,
): {
  presentedRows: readonly ChatRow[];
  onToggleExpand: (conversationId: string) => void;
} => {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(EMPTY_IDS);
  const [entrance, setEntrance] = useState<EntranceState>(EMPTY_ENTRANCE);
  const dataKeyRef = useRef(dataKey);
  const messageIds = useMemo(() => messageIdsFromRows(rows), [rows]);

  const dataKeyChanged = dataKeyRef.current !== dataKey;
  const expandedForPresentation = dataKeyChanged ? EMPTY_IDS : expandedIds;
  const entranceForPresentation = useMemo(() => {
    if (dataKeyChanged || (!entrance.revealed && messageIds.length > 0)) {
      return messageIds.length > 0 ? seedEntrance(messageIds) : EMPTY_ENTRANCE;
    }
    return entrance.revealed ? trackEntrance(entrance, messageIds) : entrance;
  }, [dataKeyChanged, entrance, messageIds]);

  // Presentation state is synchronised after commit. The pure value above is
  // used for the current render, so a data-key change does not flash stale
  // expansion/entrance state and React never receives a render-phase update.
  useEffect(() => {
    if (dataKeyChanged) {
      dataKeyRef.current = dataKey;
      setExpandedIds(previous => (previous.size === 0 ? previous : EMPTY_IDS));
    }
    setEntrance(previous => {
      const next = dataKeyChanged
        ? messageIds.length > 0
          ? seedEntrance(messageIds)
          : EMPTY_ENTRANCE
        : previous.revealed
          ? trackEntrance(previous, messageIds)
          : messageIds.length > 0
            ? seedEntrance(messageIds)
            : previous;
      return next === previous ? previous : next;
    });
  }, [dataKey, dataKeyChanged, messageIds]);

  useEffect(() => {
    if (entrance.pending.size === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setEntrance(current => flushEntrance(current));
    }, ENTRANCE_FLUSH_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [entrance.pending]);

  const { bookmarks } = useUserBookmarks();
  const reminderByMessageId = useMemo(
    () => reminderLabelByMessageId(bookmarks?.filter(isActiveBookmark)),
    [bookmarks],
  );

  const presentedRows = useMemo(
    () =>
      applyRowPresentation(rows, {
        expandedIds: expandedForPresentation,
        highlightedConversationId,
        enteringIds: entranceForPresentation.pending,
        reminderByMessageId,
      }),
    [
      rows,
      expandedForPresentation,
      highlightedConversationId,
      entranceForPresentation.pending,
      reminderByMessageId,
    ],
  );

  const onToggleExpand = useCallback((conversationId: string): void => {
    setExpandedIds(previous => {
      const next = new Set(previous);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  }, []);

  return { presentedRows, onToggleExpand };
};
