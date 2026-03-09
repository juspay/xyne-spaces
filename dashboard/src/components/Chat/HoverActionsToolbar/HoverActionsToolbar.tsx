import React, { useState } from 'react';
import { Popover } from '../../ui/Popover';
import EmojiPicker, { EmojiStyle } from 'emoji-picker-react';
import {
  Trash2,
  CornerUpLeft,
  MessageCircleMore,
  SmilePlus,
  Link,
  Ticket,
  Pin,
  Bookmark,
  BookmarkMinus,
  SquareAsterisk,
  Forward,
  Copy,
  Headphones,
} from 'lucide-react';
import { EditMessageIcon } from '../../../assets/icons';
import { UnpinIcon } from '../../../assets/icons/UnpinIcon';
import { XyneAIStar } from '../../icons/xyne-ai';
import { useReactions } from '../../../hooks/useReaction';
import { useAuth } from '../../../hooks/useAuth';
import { useCanCreateTicket } from '../../../hooks/usePermissions';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import Button from '../../ui/Button';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';
import { ConversationSubscription } from '../ConversationSubscription';

type ReactionWithUser = QueryResultType<
  typeof queries.conversationMessages
>[number]['reactions'][number];

interface HoverActionsToolbarProps {
  isVisible: boolean;
  messageId: string;
  conversationId?: string;
  initialMessageId?: string;
  showEditAction?: boolean;
  reactions?: readonly ReactionWithUser[];
  onReplyInThread?: (e?: React.MouseEvent) => void;
  onCreateTicket?: () => void;
  onCreateSubTicket?: () => void;
  onEditMessage?: () => void;
  onDeleteMessage?: () => void;
  onPinMessage?: () => void;
  onCopyLink?: () => void;
  onCopyMessage?: () => void;
  onSendToChannel?: () => void;
  onForwardMessage?: () => void;
  onEmojiPickerOpenChange?: (isOpen: boolean) => void;
  onBookmark?: () => void;
  onAskAI?: () => void;
  isBookmarked?: boolean;
  isPinned?: boolean;
  onMarkAsUnread?: () => void;
  onInitiateCall?: () => void;
  isCallDisabled?: boolean;
}

export const HoverActionsToolbar: React.FC<HoverActionsToolbarProps> = ({
  isVisible,
  messageId,
  conversationId,
  initialMessageId,
  showEditAction = false,
  reactions = [],
  onReplyInThread,
  onCreateTicket,
  onCreateSubTicket,
  onEditMessage,
  onDeleteMessage,
  onPinMessage,
  onCopyLink,
  onCopyMessage,
  onSendToChannel,
  onForwardMessage,
  onEmojiPickerOpenChange,
  onBookmark,
  onAskAI,
  isBookmarked = false,
  isPinned = false,
  onMarkAsUnread,
  onInitiateCall,
  isCallDisabled = false,
}) => {
  const { toggleReaction } = useReactions();
  const { user } = useAuth();
  const canCreateTicket = useCanCreateTicket();
  const [emojiOpen, setEmojiOpen] = useState(false);

  const { data: customEmojis } = useCustomEmojis();

  const handleEmojiOpenChange = (open: boolean): void => {
    setEmojiOpen(open);
    onEmojiPickerOpenChange?.(open);
  };

  if (!isVisible) return null;

  return (
    <div
      key={`hover-actions-toolbar-${messageId}`}
      className='absolute -top-7 right-4 z-50 p-1 flex items-center gap-1 rounded-lg border border-border bg-popover shadow-md'
    >
      {/* Reactions - CONDITIONAL CHECK ADDED HERE */}
      {onEmojiPickerOpenChange && (
        <Popover
          key={`emoji-picker-${messageId}`}
          trigger={
            <Button variant='ghost' className='size-7 text-muted-foreground' title='Add reaction'>
              <SmilePlus className='w-4 h-4' />
            </Button>
          }
          open={emojiOpen}
          onOpenChange={handleEmojiOpenChange}
          modal={true}
          side='bottom'
          align='end'
          sideOffset={8}
          collisionPadding={16}
          avoidCollisions={true}
          className='z-50 bg-popover rounded-lg shadow-md p-0'
        >
          <EmojiPicker
            style={{ width: '320px' }}
            emojiStyle={EmojiStyle.NATIVE}
            onEmojiClick={emoji => {
              // For custom emojis, store the emojiId with a prefix
              const emojiName = emoji.isCustom
                ? `custom:${emoji.emoji}:${emoji.names[0] || 'custom'}`
                : emoji.emoji;
              // Check if the user has already reacted with this emoji
              const hasReacted =
                !!user && reactions.some(r => r.emojiName === emojiName && r.userId === user.id);

              toggleReaction({
                messageId,
                emoji: emojiName,
                hasReacted,
              });
              handleEmojiOpenChange(false);
            }}
            customEmojis={customEmojis || []}
          />
        </Popover>
      )}

      {/* Reply */}
      {onReplyInThread && (
        <Tooltip content='Reply in thread' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={e => onReplyInThread(e)}
            title='Reply in thread'
            data-testid='hover-action-reply-in-thread'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='REPLY_IN_THREAD'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <MessageCircleMore className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}

      {/* Initiate Call */}
      {onInitiateCall && messageId === initialMessageId && (
        <Tooltip content={isCallDisabled ? 'Call already in progress' : 'Start call'} side='top'>
          <span className='inline-flex cursor-pointer'>
            <Button
              variant='ghost'
              className='size-7 text-muted-foreground'
              onClick={onInitiateCall}
              disabled={isCallDisabled}
              title={isCallDisabled ? 'Call already in progress' : 'Start call'}
              data-testid='hover-action-initiate-call'
            >
              <Headphones className='w-4 h-4' />
            </Button>
          </span>
        </Tooltip>
      )}

      {onSendToChannel && (
        <Tooltip content='Send to channel' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onSendToChannel}
            title='Send to channel'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='SEND_TO_CHANNEL'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <CornerUpLeft className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}

      {/* Create Ticket */}
      {onCreateTicket && canCreateTicket && (
        <Tooltip content='Create ticket' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onCreateTicket}
            title='Create ticket'
            data-testid='hover-action-create-ticket'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='CREATE_TICKET_FROM_MESSAGE'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <Ticket className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}

      {/* Create SubTicket */}
      {onCreateSubTicket && canCreateTicket && (
        <Tooltip content='Create subticket' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onCreateSubTicket}
            title='Create subticket'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='CREATE_SUBTICKET_FROM_MESSAGE'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <SquareAsterisk className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}

      {/* Copy Link */}
      {onCopyLink && (
        <Tooltip content='Copy link' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onCopyLink}
            title='Copy link'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='COPY_LINK'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <Link className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}

      {/* Copy Message */}
      {onCopyMessage && (
        <Tooltip content='Copy message' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onCopyMessage}
            title='Copy message'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='COPY_MESSAGE'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <Copy className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}

      {/* Forward Message */}
      {onForwardMessage && (
        <Tooltip content='Forward message' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onForwardMessage}
            title='Forward message'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='FORWARD_MESSAGE'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <Forward className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}

      {/* Pin Message */}
      {onPinMessage && (
        <Tooltip content={isPinned ? 'Unpin message' : 'Pin message'} side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onPinMessage}
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='TOGGLE_PIN_MESSAGE'
            data-track-metadata={JSON.stringify({ isPinned, messageId })}
          >
            {isPinned ? <UnpinIcon className='w-4 h-4' /> : <Pin className='w-4 h-4' />}
          </Button>
        </Tooltip>
      )}

      {/* Ask AI */}
      {onAskAI && (
        <Tooltip content='Ask AI' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onAskAI}
            title='Ask AI'
            data-testid='hover-action-ask-ai'
          >
            <XyneAIStar size={16} />
          </Button>
        </Tooltip>
      )}

      {/* Bookmark */}
      {onBookmark && (
        <Tooltip content={isBookmarked ? 'Remove bookmark' : 'Add Bookmark'} side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onBookmark}
            title={isBookmarked ? 'Remove bookmark' : 'Add Bookmark'}
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='TOGGLE_BOOKMARK'
            data-track-metadata={JSON.stringify({ isBookmarked, messageId })}
          >
            {isBookmarked ? (
              <BookmarkMinus className='w-4 h-4' />
            ) : (
              <Bookmark className='w-4 h-4' />
            )}
          </Button>
        </Tooltip>
      )}

      {/* Subscribe/Unsubscribe to Conversation */}
      {onReplyInThread && conversationId && (
        <Tooltip content='Toggle notification subscription' side='top'>
          <ConversationSubscription
            conversationId={conversationId}
            variant='icon-only'
            className='size-7 flex items-center justify-center text-muted-foreground hover:bg-accent rounded transition-colors'
          />
        </Tooltip>
      )}

      {/* Mark as Unread */}
      {onMarkAsUnread && (
        <Tooltip content='Mark as Unread' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onMarkAsUnread}
            title='Mark as Unread'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='MARK_AS_UNREAD'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <div className='relative flex items-center justify-center w-4 h-4'>
              <div className='w-2.5 h-2.5 rounded-full border-2 border-current' />
            </div>
          </Button>
        </Tooltip>
      )}

      {/* Edit in Chat */}
      {showEditAction && onEditMessage && (
        <Tooltip content='Edit in Chat' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onEditMessage}
            title='Edit in Chat'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='EDIT_MESSAGE'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <EditMessageIcon className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}

      {/* Delete */}
      {showEditAction && onDeleteMessage && (
        <Tooltip content='Delete' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-red-600 dark:text-red-400'
            onClick={onDeleteMessage}
            title='Delete'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='DELETE_MESSAGE'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <Trash2 className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}
    </div>
  );
};
