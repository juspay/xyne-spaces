import { useCallback, useMemo, type ReactElement } from 'react';

import type { OpenSurface } from '../intent/openIntent.types';
import type { ChatRow } from '../model/chatRow.types';
import { threadReplyChrome } from '../model/threadReplyChrome';
import { ChatListRow } from '../rows/ChatListRow';
import type { RowEventKind } from './conversationList.types';

type ConversationListRenderItemOptions = {
  surface: OpenSurface;
  rows: readonly ChatRow[];
  onRowEvent: (kind: RowEventKind, row: Extract<ChatRow, { type: 'message' }>) => void;
  onToggleExpand: (conversationId: string) => void;
};

type RenderItem = ({ item }: { item: ChatRow }) => ReactElement;

/** Keeps row-event adaptation and thread reply chrome out of the list controller. */
export const useConversationListRenderItem = ({
  surface,
  rows,
  onRowEvent,
  onToggleExpand,
}: ConversationListRenderItemOptions): RenderItem => {
  const isThread = surface.kind !== 'channel';
  const replyChrome = useMemo(() => threadReplyChrome(rows, isThread), [isThread, rows]);

  return useCallback(
    ({ item }: { item: ChatRow }): ReactElement => (
      <ChatListRow
        row={item}
        threadReplyCount={replyChrome.rootId === item.id ? replyChrome.count : 0}
        hideReplyChrome={isThread}
        onPress={(row): void => onRowEvent('press', row)}
        onLongPress={(row): void => onRowEvent('longPress', row)}
        onAvatarPress={(row): void => onRowEvent('avatar', row)}
        onReactionsPress={(row): void => onRowEvent('reactions', row)}
        onToggleExpand={onToggleExpand}
      />
    ),
    [isThread, onRowEvent, onToggleExpand, replyChrome],
  );
};
