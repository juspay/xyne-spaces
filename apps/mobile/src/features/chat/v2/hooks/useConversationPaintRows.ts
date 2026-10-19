import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ChannelScopeType, User } from '@xyne/shared';

import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';
import {
  buildChatPaintRowsIncremental,
  type IncrementalChatPaintRowsState,
} from '@/src/features/chat/v2/paint/buildChatPaintRows';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import type { Conversation } from '@/src/machines/queryCacheMachine';
import {
  dedupeAndSortChatConversations,
  getDuplicateChatConversationIds,
} from '@/src/features/chat/v2/components/chat/chat-list-policy';

const EMPTY_PAINT_ROWS: ChatPaintRow[] = [];

type UseConversationPaintRowsArgs = {
  channelId: string;
  cycleKey: string;
  conversations: Conversation[];
  currentUser?: User | undefined;
  channelType?: ChannelScopeType | undefined;
};

type UseConversationPaintRowsResult = {
  paintRows: ChatPaintRow[];
  conversationsById: ReadonlyMap<string, ConversationItem>;
};

/**
 * Projects data-owned conversation rows into lightweight list rows.
 *
 * This hook never queries or changes message data. It only preserves the incremental
 * projection and the O(1) source lookup used by rendered rows.
 */
export const useConversationPaintRows = ({
  channelId,
  cycleKey,
  conversations,
  currentUser,
  channelType,
}: UseConversationPaintRowsArgs): UseConversationPaintRowsResult => {
  const paintStateRef = useRef<{
    cycleKey: string;
    state: IncrementalChatPaintRowsState | null;
  }>({ cycleKey, state: null });

  const duplicateConversationIds = useMemo(
    () => getDuplicateChatConversationIds(conversations),
    [conversations],
  );
  const normalizedConversations = useMemo(
    () => dedupeAndSortChatConversations(conversations),
    [conversations],
  );
  const conversationsByIdRef = useRef<Map<string, ConversationItem>>(new Map());

  useEffect(() => {
    if (!__DEV__ || duplicateConversationIds.length === 0) return;
    // eslint-disable-next-line no-console
    console.error('[ChatList] duplicate conversation rows dropped before paint', {
      conversationIds: duplicateConversationIds,
    });
  }, [duplicateConversationIds]);

  const nextPaintState = useMemo<IncrementalChatPaintRowsState | null>(() => {
    const previousState =
      paintStateRef.current.cycleKey === cycleKey ? paintStateRef.current.state : null;

    if (normalizedConversations.length === 0) {
      return null;
    }

    return buildChatPaintRowsIncremental({
      channelId,
      channelType,
      conversations: normalizedConversations,
      currentUser,
      previousState,
    });
  }, [channelId, channelType, currentUser, cycleKey, normalizedConversations]);

  useLayoutEffect(() => {
    paintStateRef.current = { cycleKey, state: nextPaintState };
  }, [cycleKey, nextPaintState]);

  const conversationsById = useMemo(() => {
    const previous = conversationsByIdRef.current;
    if (
      previous.size === normalizedConversations.length &&
      normalizedConversations.every(
        conversation => previous.get(conversation.conversationId) === conversation,
      )
    ) {
      return previous;
    }

    const byId = new Map<string, ConversationItem>();
    for (const conversation of normalizedConversations) {
      byId.set(conversation.conversationId, conversation);
    }
    conversationsByIdRef.current = byId;
    return byId;
  }, [normalizedConversations]);

  return {
    // The data hook owns cache/live continuity, so an empty data array is authoritative.
    // Retaining projected rows here would keep deleted messages visible.
    paintRows: nextPaintState?.rows ?? EMPTY_PAINT_ROWS,
    conversationsById,
  };
};
