import { QueryResultType } from '@rocicorp/zero';
import {
  Message,
  User,
  ChannelScopeType,
  Conversation,
  ConversationParticipant,
} from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { AttachmentRef } from '../../../machines/attachmentViewerMachine';

export interface ThreadInfo {
  preview: string;
  conversationId: string;
}

// Conversation type extended with related fields used in the component tree
export interface ConversationWithTicket extends Conversation {
  parentMessage?:
    | {
        content: string;
        conversationId: string;
      }
    | undefined;
  participants?: readonly ConversationParticipant[] | undefined;
  initialMessage?:
    | {
        metadata?: unknown;
        [key: string]: unknown;
      }
    | undefined;
}

export interface MessageBubbleProps {
  isHovered?: boolean;
  message: QueryResultType<typeof queries.conversationMessagesV2>[number];
  onUserClick?: (user: User) => void;
  renderActions?: (message: Message) => React.ReactNode;
  showAvatar?: boolean | undefined;
  isPinned?: boolean | undefined;
  isBookmarked?: boolean | undefined;
  variant?: 'default' | 'pinned';
  isHighlighted?: boolean | undefined;
  channelId?: string;
  conversation?: ConversationWithTicket;
  context?: 'channel' | 'thread';
  contentOnly?: boolean;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  threadInfo?: ThreadInfo;
  channelScopeType?: ChannelScopeType | undefined;
  isFirstInThread?: boolean;
  allThreadAttachments?: AttachmentRef[];
  workflowNumber?: number | undefined;
}
