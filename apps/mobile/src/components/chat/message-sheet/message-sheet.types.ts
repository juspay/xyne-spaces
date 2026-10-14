import type { MessageForRender } from '@/src/components/chat/message/message.types';
import type { Conversation } from '@xyne/shared';

export type MessageSheetContext = {
  /** The channel ID where the message is displayed */
  channelId: string;
  /** Current user ID */
  currentUserId: string;
  /** Whether this is in a thread context */
  isThreadContext?: boolean;
  /** Whether this is the first message in a thread */
  isFirstInThread?: boolean;
  /** Channel scope type (DEFAULT, DM, etc.) */
  channelScopeType?: string;
  /** Whether the conversation is pinned */
  isPinned?: boolean;
  /** Whether there's an active call in the conversation */
  hasActiveCall?: boolean;
  /** The conversation object if available */
  conversation?: Conversation;
};

export type MessageSheetTarget = MessageForRender & {
  context?: MessageSheetContext;
};

export type MessageSheetActionId =
  | 'react'
  | 'copy'
  | 'reply-thread'
  | 'reply'
  | 'forward'
  | 'bookmark'
  | 'copy-link'
  | 'create-ticket'
  | 'ask-ai'
  | 'pin'
  | 'mark-unread'
  | 'delete'
  | 'edit'
  | (string & {});

export type MessageSheetAction = {
  id: MessageSheetActionId;
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  /** Omit or return true to show */
  isVisible?: (message: MessageSheetTarget) => boolean;
  onPress: (message: MessageSheetTarget, close: () => void) => void | Promise<void>;
};
