import React, { useState } from 'react';
import { Drawer } from '../../ui/Drawer/Drawer';
import EmojiPicker, { EmojiStyle } from 'emoji-picker-react';
import { Popover } from '../../ui/Popover';
import {
  Trash2,
  CornerUpLeft,
  FileText,
  MessageCircleMore,
  SmilePlus,
  Link,
  Ticket,
  Pin,
  Bookmark,
  BookmarkMinus,
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
import { emojiActor } from '../../../machines/emojiMachine';
import { useSelector } from '@xstate/react';

type ReactionWithUser = QueryResultType<
  typeof queries.conversationMessages
>[number]['reactions'][number];

export interface MessageActionsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  showEditAction?: boolean;
  reactions?: readonly ReactionWithUser[];
  onReplyInThread?: (e?: React.MouseEvent) => void;
  onCreateTicket?: () => void;
  onEditMessage?: () => void;
  onDeleteMessage?: () => void;
  onPinMessage?: () => void;
  onCopyLink?: () => void;
  onCopyMessage?: () => void;
  onSendToChannel?: () => void;
  onForwardMessage?: () => void;
  onEditInCanvas?: () => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
  isPinned?: boolean;
}

export const MessageActionsDrawer: React.FC<MessageActionsDrawerProps> = ({
  open,
  onOpenChange,
  messageId,
  showEditAction = false,
  reactions = [],
  onReplyInThread,
  onCreateTicket,
  onEditMessage,
  onDeleteMessage,
  onPinMessage,
  onCopyLink,
  onCopyMessage,
  onSendToChannel,
  onForwardMessage,
  onEditInCanvas,
  onBookmark,
  isBookmarked = false,
  isPinned = false,
}) => {
  const { toggleReaction } = useReactions();
  const { user } = useAuth();
  const canCreateTicket = useCanCreateTicket();
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Get custom emojis from XState
  const customEmojis = useSelector(emojiActor, state => state.context.customEmojis);

  const handleActionClick = (action: () => void): void => {
    action();
    onOpenChange(false); // Close drawer after action
  };

  const handleEmojiSelect = (emoji: {
    emoji: string;
    isCustom: boolean;
    emojiId?: string;
    imageUrl?: string;
    names?: string[];
  }): void => {
    // For custom emojis, store the emojiId with a prefix
    const emojiName = emoji.isCustom
      ? `custom:${emoji.emoji}:${emoji.names?.[0] || 'custom'}`
      : emoji.emoji;
    const hasReacted =
      !!user && reactions.some(r => r.emojiName === emojiName && r.userId === user.id);

    toggleReaction({
      messageId,
      emoji: emojiName,
      hasReacted,
    });
    setEmojiOpen(false);
    onOpenChange(false); // Close drawer after adding reaction
  };

  // Action button component for consistency
  const ActionButton: React.FC<{
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    variant?: 'default' | 'destructive';
  }> = ({ icon, label, onClick, variant = 'default' }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors rounded-lg ${
        variant === 'destructive'
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10'
          : 'text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      <span className='flex-shrink-0 w-5 h-5 flex items-center justify-center'>{icon}</span>
      <span className='text-sm font-medium'>{label}</span>
    </button>
  );

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title='Message Actions'
      description='Choose an action for this message'
    >
      <div className='px-2 py-4 space-y-1'>
        {/* Add Reaction - Opens emoji picker in popover */}
        <Popover
          trigger={
            <button className='w-full flex items-center gap-3 px-4 py-3 text-left transition-colors rounded-lg text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'>
              <span className='flex-shrink-0 w-5 h-5 flex items-center justify-center'>
                <SmilePlus className='w-5 h-5' />
              </span>
              <span className='text-sm font-medium'>Add Reaction</span>
            </button>
          }
          open={emojiOpen}
          onOpenChange={setEmojiOpen}
          modal={true}
          side='top'
          align='center'
          sideOffset={8}
          collisionPadding={16}
          avoidCollisions={true}
          className='z-50 bg-white rounded-lg shadow-md p-0'
        >
          <EmojiPicker
            style={{ width: '320px' }}
            emojiStyle={EmojiStyle.NATIVE}
            onEmojiClick={emoji => {
              handleEmojiSelect({
                emoji: emoji.emoji,
                isCustom: emoji.isCustom,
                imageUrl: emoji.imageUrl,
                names: emoji.names,
              });
            }}
            customEmojis={customEmojis}
          />
        </Popover>

        {/* Reply in Thread */}
        {onReplyInThread && (
          <ActionButton
            icon={<MessageCircleMore className='w-5 h-5' />}
            label='Reply in Thread'
            onClick={() => handleActionClick(onReplyInThread)}
          />
        )}

        {/* Send to Channel */}
        {onSendToChannel && (
          <ActionButton
            icon={<CornerUpLeft className='w-5 h-5' />}
            label='Send to Channel'
            onClick={() => handleActionClick(onSendToChannel)}
          />
        )}

        {/* Create Ticket */}
        {onCreateTicket && canCreateTicket && (
          <ActionButton
            icon={<Ticket className='w-5 h-5' />}
            label='Create Ticket'
            onClick={() => handleActionClick(onCreateTicket)}
          />
        )}

        {/* Copy Link */}
        {onCopyLink && (
          <ActionButton
            icon={<Link className='w-5 h-5' />}
            label='Copy Link'
            onClick={() => handleActionClick(onCopyLink)}
          />
        )}

        {/* Copy Message */}
        {onCopyMessage && (
          <ActionButton
            icon={<Copy className='w-5 h-5' />}
            label='Copy Message'
            onClick={() => handleActionClick(onCopyMessage)}
          />
        )}

        {/* Forward Message */}
        {onForwardMessage && (
          <ActionButton
            icon={<Forward className='w-5 h-5' />}
            label='Forward Message'
            onClick={() => handleActionClick(onForwardMessage)}
          />
        )}

        {/* Pin/Unpin Message */}
        {onPinMessage && (
          <ActionButton
            icon={isPinned ? <UnpinIcon className='w-5 h-5' /> : <Pin className='w-5 h-5' />}
            label={isPinned ? 'Unpin Message' : 'Pin Message'}
            onClick={() => handleActionClick(onPinMessage)}
          />
        )}

        {/* Bookmark */}
        {onBookmark && (
          <ActionButton
            icon={
              isBookmarked ? (
                <BookmarkMinus className='w-5 h-5' />
              ) : (
                <Bookmark className='w-5 h-5' />
              )
            }
            label={isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
            onClick={() => handleActionClick(onBookmark)}
          />
        )}

        {/* Divider before edit actions */}
        {showEditAction && (onEditMessage || onEditInCanvas || onDeleteMessage) && (
          <div className='py-2'>
            <div className='border-t border-gray-200 dark:border-gray-700' />
          </div>
        )}

        {/* Edit in Chat */}
        {showEditAction && onEditMessage && (
          <ActionButton
            icon={<EditMessageIcon className='w-5 h-5' />}
            label='Edit in Chat'
            onClick={() => handleActionClick(onEditMessage)}
          />
        )}

        {/* Edit in Canvas */}
        {showEditAction && onEditInCanvas && (
          <ActionButton
            icon={<FileText className='w-5 h-5' />}
            label='Edit in Canvas'
            onClick={() => handleActionClick(onEditInCanvas)}
          />
        )}

        {/* Delete */}
        {showEditAction && onDeleteMessage && (
          <ActionButton
            icon={<Trash2 className='w-5 h-5' />}
            label='Delete Message'
            onClick={() => handleActionClick(onDeleteMessage)}
            variant='destructive'
          />
        )}
      </div>
    </Drawer>
  );
};

export default MessageActionsDrawer;
