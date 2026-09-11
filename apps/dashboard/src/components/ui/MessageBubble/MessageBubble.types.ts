import {
  Message,
  MessageAttachment,
  MessageTranslation,
  Reaction,
  ReactionCount,
  ChannelScopeType,
  Conversation,
  ConversationParticipant,
  type ConversationAnchorType,
} from '@xyne/shared';
import { AttachmentRef } from '../../../machines/attachmentViewerMachine';

export type MessageNudgeCountRow = {
  id: string;
  nudgeCount: number;
};

// A message rebuilt from conversation.initial_message_md (see
// conversationMessageHelpers.ts) only carries targetLang/translatedText/feedback — the
// JSON snapshot doesn't store the other MessageTranslation columns. Only these fields
// are ever read for rendering, so the type reflects what's actually always available.
export type MessageTranslationRow = Pick<
  MessageTranslation,
  'targetLang' | 'translatedText' | 'feedback'
>;

export type MessageWithOptionalNudgeCounts = Message & {
  attachments?: readonly MessageAttachment[];
  reactions?: readonly Reaction[];
  reactionCounts?: readonly ReactionCount[];
  nudgeCounts?: readonly MessageNudgeCountRow[];
  translations?: readonly MessageTranslationRow[];
};

export interface ThreadInfo {
  preview: string;
  conversationId: string;
  channelId?: string;
  anchorType?: ConversationAnchorType;
}

// Conversation type extended with related fields used in the component tree
export interface ConversationWithTicket extends Conversation {
  parentMessage?:
    | {
        content: string;
        conversationId: string;
      }
    | undefined;
  participants?: readonly ConversationParticipant[] | ConversationParticipant | undefined;
  initialMessage?:
    | {
        metadata?: unknown;
        [key: string]: unknown;
      }
    | undefined;
  initialMessageAttachments?: readonly MessageAttachment[] | undefined;
  initialMessageNudgeCounts?: readonly MessageNudgeCountRow[] | undefined;
  ticket?:
    | {
        attachments?: readonly MessageAttachment[] | undefined;
        [key: string]: unknown;
      }
    | undefined;
}

export interface MessageBubbleProps {
  message: MessageWithOptionalNudgeCounts;
  onUserClick?: (userId: string) => void;
  renderActions?: (message: Message) => React.ReactNode;
  showAvatar?: boolean | undefined;
  isPinned?: boolean | undefined;
  isBookmarked?: boolean | undefined;
  isReminderSet?: boolean | undefined;
  reminderDueInLabel?: string | undefined;
  variant?: 'default' | 'pinned';
  isHighlighted?: boolean | undefined;
  channelId?: string;
  conversation?: ConversationWithTicket;
  context?: 'channel' | 'thread';
  contentOnly?: boolean;
  /** Render URLs/links as inert plain text (activity sidebar previews). */
  disableLinks?: boolean;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  threadInfo?: ThreadInfo;
  channelScopeType?: ChannelScopeType | undefined;
  isFirstInThread?: boolean;
  allThreadAttachments?: AttachmentRef[];
  workflowNumber?: number | undefined;
  showLinkPreview?: boolean;
  searchItemView?: boolean;
  afterTextContent?: React.ReactNode;
  /** Rendered on the sender/timestamp line, after the timestamp. */
  headerContent?: React.ReactNode;
  /**
   * Slack model, all owned by ChatBubble (which also holds the hover-toolbar
   * Translate handler): `translationActivated` gates whether the footer renders at
   * all — false until the toolbar button is clicked once, for old and new messages
   * alike. `showTranslated` is which text is currently displayed once activated,
   * flipped by the footer's own See original/See translation link.
   */
  showTranslated?: boolean;
  translationActivated?: boolean;
  onToggleTranslation?: () => void;
}
