import { Dimensions } from 'react-native';

import { formatDatePill } from '@/src/components/chat/date-pill';
import type { ChatRowRenderers } from '@/src/features/chat/v2/components/chat/chat-renderers';

import { DateRow, FloatingDate, ReplyDivider, UnreadDivider } from './components/row-dividers';
import { ConversationMessageRow } from './components/message-row';
import { ConversationThreadMessageRow } from './components/thread-message-row';
import { RoomEmpty } from './components/room-empty';
import { RoomNotice } from './components/room-notice';
import { RoomSkeleton } from './components/room-skeleton';
import { DIVIDER_HEIGHT } from './constants';
import { estimateFlatMessageHeight, flatTextLayout } from './model/row-estimate';

export const CONVERSATION_RENDERERS: ChatRowRenderers = {
  MessageRow: ConversationMessageRow,
  ThreadMessageRow: ConversationThreadMessageRow,
  UnreadDivider,
  DateRow,
  FloatingDate,
  ReplyDivider,
  // The thread reads its dates the way the room does; the header leads straight into the root message.
  formatThreadDate: formatDatePill,
  showThreadRootDate: false,
  dateRowHeight: DIVIDER_HEIGHT,
  unreadDividerHeight: DIVIDER_HEIGHT,
  estimateMessageHeight: (row, previous) =>
    estimateFlatMessageHeight(row, flatTextLayout(Dimensions.get('window').width), previous),
  Skeleton: RoomSkeleton,
  ListNotice: RoomNotice,
  ListEmpty: RoomEmpty,
};
