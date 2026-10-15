import { memo, type ReactElement } from 'react';
import { View } from 'react-native';

import type { ChatMessageRow, ChatRow } from '../model/chatRow.types';
import { rowsAreEqual } from '../model/rowEquals';
import { rowSurface } from '../model/rowType';
import { CallMessageRow } from './CallMessageRow';
import { DateRow } from './DateRow';
import { MessageRow } from './MessageRow';
import { SystemMessageRow } from './SystemMessageRow';
import { ThreadReplyDivider } from './ThreadReplyDivider';
import { UnreadDividerRow } from './UnreadDividerRow';

type ChatListRowProps = {
  row: ChatRow;
  threadReplyCount?: number;
  hideReplyChrome?: boolean;
  onPress: (row: ChatMessageRow) => void;
  onLongPress: (row: ChatMessageRow) => void;
  onAvatarPress: (row: ChatMessageRow) => void;
  onReactionsPress: (row: ChatMessageRow) => void;
  onToggleExpand: (conversationId: string) => void;
};

function ChatListRowView({
  row,
  threadReplyCount = 0,
  hideReplyChrome = false,
  onPress,
  onLongPress,
  onAvatarPress,
  onReactionsPress,
  onToggleExpand,
}: ChatListRowProps): ReactElement {
  if (row.type === 'date') {
    return <DateRow row={row} />;
  }
  if (row.type === 'unread-divider') {
    return <UnreadDividerRow />;
  }
  const surface = rowSurface(row);
  // v2 `chat-message-list-row`: every message sits in `px-4 py-1` so bubbles
  // do not kiss the screen edge and every row surface keeps the same vertical
  // rhythm. Date / unread chrome keep their own insets.
  if (surface === 'call') {
    return (
      <View className='px-4 py-1'>
        <CallMessageRow row={row} />
      </View>
    );
  }
  if (surface === 'system') {
    return (
      <View className='px-4 py-1'>
        <SystemMessageRow row={row} />
      </View>
    );
  }
  const replyCount =
    row.type === 'message' ? Math.max(threadReplyCount, row.model.threadReplyCount) : 0;
  return (
    <View className='px-4 py-1'>
      <MessageRow
        row={row}
        hideReplyChrome={hideReplyChrome}
        onPress={onPress}
        onLongPress={onLongPress}
        onAvatarPress={onAvatarPress}
        onReactionsPress={onReactionsPress}
        onToggleExpand={onToggleExpand}
      />
      {replyCount > 0 ? <ThreadReplyDivider count={replyCount} /> : null}
    </View>
  );
}

export const ChatListRow = memo(ChatListRowView, (previous, next): boolean => {
  return (
    rowsAreEqual(previous.row, next.row) &&
    previous.threadReplyCount === next.threadReplyCount &&
    previous.hideReplyChrome === next.hideReplyChrome &&
    previous.onPress === next.onPress &&
    previous.onLongPress === next.onLongPress &&
    previous.onAvatarPress === next.onAvatarPress &&
    previous.onReactionsPress === next.onReactionsPress &&
    previous.onToggleExpand === next.onToggleExpand
  );
});
