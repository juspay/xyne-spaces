import { Dimensions } from 'react-native';

import type { ChatRowRenderers } from '@/src/features/chat/v2/components/chat/chat-renderers';

import { DateRow, ReplyDivider, UnreadDivider } from './components/row-dividers';
import { ConversationMessageRow } from './components/message-row';
import { ConversationThreadMessageRow } from './components/thread-message-row';
import { DIVIDER_HEIGHT } from './constants';
import { estimateFlatMessageHeight, flatCharsPerLine } from './model/row-estimate';

export const CONVERSATION_RENDERERS: ChatRowRenderers = {
  MessageRow: ConversationMessageRow,
  ThreadMessageRow: ConversationThreadMessageRow,
  UnreadDivider,
  DateRow,
  ReplyDivider,
  dateRowHeight: DIVIDER_HEIGHT,
  unreadDividerHeight: DIVIDER_HEIGHT,
  estimateMessageHeight: (row, previous) =>
    estimateFlatMessageHeight(row, flatCharsPerLine(Dimensions.get('window').width), previous),
};
