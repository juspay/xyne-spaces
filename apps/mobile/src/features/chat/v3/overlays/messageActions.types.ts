import type { ChatInputEditingMessage } from '@/src/components/input-composer/input-composer.types';
import type { ChatMessageRow } from '../model/chatRow.types';
import type { AttachmentInput } from '../model/conversationInput';
export type MessageActionsTarget = {
  row: ChatMessageRow;
  html: string;
  attachments: readonly AttachmentInput[];
  reactionsMd: string | null;
  threadId?: string;
};

export type MessageActionsHostProps = {
  target: MessageActionsTarget | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isThread: boolean;
  currentUserId: string | undefined;
  isChannelArchived: boolean;
  isFirstInThread: boolean;
  hasTicket: boolean;
  repliesEnabled?: boolean;
  onEditInChat?: (payload: ChatInputEditingMessage) => void;
  onForward?: () => void;
  onRemind?: () => void;
  onMoreReactions?: () => void;
  onBeforeMarkUnread?: () => void;
  onMarkUnreadFailure?: () => void;
};
