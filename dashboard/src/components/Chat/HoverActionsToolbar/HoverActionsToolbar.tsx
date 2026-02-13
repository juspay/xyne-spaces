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
} from 'lucide-react';
import { EditMessageIcon } from '../../../assets/icons';
import { UnpinIcon } from '../../../assets/icons/UnpinIcon';
import { useReactions } from '../../../hooks/useReaction';
import { useAuth } from '../../../hooks/useAuth';
import { useCanCreateTicket } from '../../../hooks/usePermissions';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import Button from '../../ui/Button';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';

type ReactionWithUser = QueryResultType<
  typeof queries.conversationMessages
>[number]['reactions'][number];

interface HoverActionsToolbarProps {
  isVisible: boolean;
  messageId: string;
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
  isBookmarked?: boolean;
  isPinned?: boolean;
  onMarkAsUnread?: () => void;
}

export const HoverActionsToolbar: React.FC<HoverActionsToolbarProps> = ({
  isVisible,
  messageId,
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
  isBookmarked = false,
  isPinned = false,
  onMarkAsUnread,
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
      className='absolute -top-7 right-4 z-50 p-1 flex items-center gap-1 rounded-lg border border-[var(--gray-300,#E4E6E7)] bg-[var(--gray-50,#FFF)] shadow-md'
    >
      {/* Reactions - CONDITIONAL CHECK ADDED HERE */}
      {onEmojiPickerOpenChange && (
        <Popover
          key={`emoji-picker-${messageId}`}
          trigger={
            <Button
              variant='ghost'
              className='size-7 text-[rgba(120,129,135,1)]'
              title='Add reaction'
            >
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
          className='z-50 bg-white rounded-lg shadow-md p-0'
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
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={e => onReplyInThread(e)}
            title='Reply in thread'
            data-testid='hover-action-reply-in-thread'
          >
            <MessageCircleMore className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}

      {onSendToChannel && (
        <Tooltip content='Send to channel' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={onSendToChannel}
            title='Send to channel'
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
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={onCreateTicket}
            title='Create ticket'
            data-testid='hover-action-create-ticket'
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
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={onCreateSubTicket}
            title='Create subticket'
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
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={onCopyLink}
            title='Copy link'
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
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={onCopyMessage}
            title='Copy message'
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
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={onForwardMessage}
            title='Forward message'
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
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={onPinMessage}
          >
            {isPinned ? <UnpinIcon className='w-4 h-4' /> : <Pin className='w-4 h-4' />}
          </Button>
        </Tooltip>
      )}

      {/* Bookmark */}
      {onBookmark && (
        <Tooltip content={isBookmarked ? 'Remove bookmark' : 'Add Bookmark'} side='top'>
          <Button
            variant='ghost'
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={onBookmark}
            title={isBookmarked ? 'Remove bookmark' : 'Add Bookmark'}
          >
            {isBookmarked ? (
              <BookmarkMinus className='w-4 h-4' />
            ) : (
              <Bookmark className='w-4 h-4' />
            )}
          </Button>
        </Tooltip>
      )}

      {/* Mark as Unread */}
      {onMarkAsUnread && (
        <Tooltip content='Mark as Unread' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={onMarkAsUnread}
            title='Mark as Unread'
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
            className='size-7 text-[rgba(120,129,135,1)]'
            onClick={onEditMessage}
            title='Edit in Chat'
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
          >
            <Trash2 className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}
    </div>
  );
};
