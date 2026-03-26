import React, { useMemo, useState } from 'react';
import { Popover } from '../../ui/Popover';
import EmojiPicker, { EmojiStyle } from 'emoji-picker-react';
import {
  MessageCircleMore,
  SmilePlus,
  Ticket,
  Bookmark,
  BookmarkMinus,
  Forward,
  MoreVertical,
  Trash2,
  Link,
  Copy,
  Headphones,
  Pin,
  CornerUpLeft,
  SquareAsterisk,
} from 'lucide-react';
import { EditMessageIcon } from '../../../assets/icons';
import { UnpinIcon } from '../../../assets/icons/UnpinIcon';
import { XyneAIStar } from '../../icons/xyne-ai';
import { useReactions } from '../../../hooks/useReaction';
import { useAuth } from '../../../hooks/useAuth';
import { useCanCreateTicket } from '../../../hooks/usePermissions';
import { parseReactionsMd } from '@xyne/shared';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import Button from '../../ui/Button';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';
import { ConversationSubscription } from '../ConversationSubscription';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';

interface HoverActionsToolbarProps {
  isVisible: boolean;
  messageId: string;
  conversationId?: string;
  conversation?: ConversationWithTicket;
  initialMessageId?: string;
  showEditAction?: boolean;
  reactionsMd?: string | null;
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
  onDropdownOpenChange?: (isOpen: boolean) => void;
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
  conversation,
  initialMessageId,
  showEditAction = false,
  reactionsMd,
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
  onDropdownOpenChange,
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const { data: customEmojis } = useCustomEmojis();
  const reactionsData = useMemo(() => parseReactionsMd(reactionsMd), [reactionsMd]);

  const handleEmojiOpenChange = (open: boolean): void => {
    setEmojiOpen(open);
    onEmojiPickerOpenChange?.(open);
  };

  const handleDropdownOpenChange = (open: boolean): void => {
    setIsDropdownOpen(open);
    onDropdownOpenChange?.(open);
  };

  // Check if there are any overflow actions to show in dropdown
  const hasOverflowActions =
    onSendToChannel ||
    onCopyLink ||
    onCopyMessage ||
    onPinMessage ||
    onMarkAsUnread ||
    showEditAction ||
    onBookmark ||
    onForwardMessage ||
    (onReplyInThread && conversationId);

  // Keep toolbar visible if dropdown is open, even if parent says to hide
  if (!isVisible && !isDropdownOpen) return null;

  return (
    <div
      key={`hover-actions-toolbar-${messageId}`}
      className='absolute -top-7 right-4 z-50 p-1 flex items-center gap-1 rounded-lg border border-border bg-popover shadow-md'
    >
      {/* Emojis */}
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
              const hasReacted = !!user && (reactionsData[emojiName] || []).includes(user.id);

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

      {/* Create Subticket */}
      {onCreateSubTicket && canCreateTicket && (
        <Tooltip content='Create subticket' side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onCreateSubTicket}
            title='Create subticket'
            data-testid='hover-action-create-subticket'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='CREATE_SUBTICKET_FROM_MESSAGE'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <SquareAsterisk className='w-4 h-4' />
          </Button>
        </Tooltip>
      )}

      {/* Start Call */}
      {onInitiateCall && messageId === initialMessageId && (
        <Tooltip content={isCallDisabled ? 'Call in progress' : 'Start call'} side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onInitiateCall}
            disabled={isCallDisabled}
            title={isCallDisabled ? 'Call in progress' : 'Start call'}
            data-testid='hover-action-initiate-call'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='INITIATE_CALL'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <Headphones className='w-4 h-4' />
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
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='ASK_AI'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <XyneAIStar size={16} />
          </Button>
        </Tooltip>
      )}

      {/* More Actions Dropdown */}
      {hasOverflowActions && (
        <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              className='size-7 text-muted-foreground'
              title='More actions'
              data-testid='hover-action-more'
            >
              <MoreVertical className='w-4 h-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' side='bottom' className='w-[280px]'>
            {/* Compute which sections have visible items */}
            {(() => {
              const hasEditSection = (showEditAction && onEditMessage) || onSendToChannel;
              const hasSubscriptionSection =
                (onReplyInThread && conversationId) || onMarkAsUnread || onBookmark || onPinMessage;
              const hasCopySection = onCopyLink || onCopyMessage || onForwardMessage;
              const hasDelete = showEditAction && onDeleteMessage;

              return (
                <>
                  {/* Edit Message */}
                  {showEditAction && onEditMessage && (
                    <DropdownMenuItem
                      onClick={onEditMessage}
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='EDIT_MESSAGE'
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        <EditMessageIcon className='w-4 h-4' />
                      </span>
                      Edit
                    </DropdownMenuItem>
                  )}

                  {/* Send to Channel */}
                  {onSendToChannel && (
                    <DropdownMenuItem
                      onClick={onSendToChannel}
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='SEND_TO_CHANNEL'
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        <CornerUpLeft className='w-4 h-4' />
                      </span>
                      Send to channel
                    </DropdownMenuItem>
                  )}

                  {/* Separator after Edit section */}
                  {hasEditSection && hasSubscriptionSection && <DropdownMenuSeparator />}

                  {/* Conversation Subscription */}
                  {isDropdownOpen && onReplyInThread && conversationId && (
                    <DropdownMenuItem asChild>
                      <ConversationSubscription
                        conversationId={conversationId}
                        {...(conversation && { conversation })}
                        variant='dropdown'
                        className='w-full'
                        menuOpen={isDropdownOpen}
                      />
                    </DropdownMenuItem>
                  )}

                  {/* Mark as Unread */}
                  {onMarkAsUnread && (
                    <DropdownMenuItem
                      onClick={onMarkAsUnread}
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='MARK_AS_UNREAD'
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        <div className='w-2.5 h-2.5 rounded-full border-2 border-current' />
                      </span>
                      Mark as unread
                    </DropdownMenuItem>
                  )}

                  {/* Bookmark */}
                  {onBookmark && (
                    <DropdownMenuItem
                      onClick={onBookmark}
                      data-testid={
                        isBookmarked ? 'hover-action-remove-bookmark' : 'hover-action-add-bookmark'
                      }
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='TOGGLE_BOOKMARK'
                      data-track-metadata={JSON.stringify({ isBookmarked, messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        {isBookmarked ? (
                          <BookmarkMinus className='w-4 h-4' />
                        ) : (
                          <Bookmark className='w-4 h-4' />
                        )}
                      </span>
                      {isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
                    </DropdownMenuItem>
                  )}

                  {/* Pin Message */}
                  {onPinMessage && (
                    <DropdownMenuItem
                      onClick={onPinMessage}
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='TOGGLE_PIN_MESSAGE'
                      data-track-metadata={JSON.stringify({ isPinned, messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        {isPinned ? <UnpinIcon className='w-4 h-4' /> : <Pin className='w-4 h-4' />}
                      </span>
                      {isPinned ? 'Unpin message' : 'Pin message'}
                    </DropdownMenuItem>
                  )}

                  {/* Separator before Copy actions */}
                  {hasSubscriptionSection && hasCopySection && <DropdownMenuSeparator />}

                  {/* Copy Link */}
                  {onCopyLink && (
                    <DropdownMenuItem
                      onClick={onCopyLink}
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='COPY_LINK'
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        <Link className='w-4 h-4' />
                      </span>
                      Copy link
                    </DropdownMenuItem>
                  )}

                  {/* Copy Message */}
                  {onCopyMessage && (
                    <DropdownMenuItem
                      onClick={onCopyMessage}
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='COPY_MESSAGE'
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        <Copy className='w-4 h-4' />
                      </span>
                      Copy message
                    </DropdownMenuItem>
                  )}

                  {/* Forward Message */}
                  {onForwardMessage && (
                    <DropdownMenuItem
                      onClick={onForwardMessage}
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='FORWARD_MESSAGE'
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        <Forward className='w-4 h-4' />
                      </span>
                      Forward message
                    </DropdownMenuItem>
                  )}

                  {/* Separator before Delete */}
                  {(hasCopySection || hasSubscriptionSection || hasEditSection) && hasDelete && (
                    <DropdownMenuSeparator />
                  )}

                  {/* Delete */}
                  {showEditAction && onDeleteMessage && (
                    <DropdownMenuItem
                      onClick={onDeleteMessage}
                      className='text-red-600 focus:text-red-600'
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='DELETE_MESSAGE'
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center'>
                        <Trash2 className='w-4 h-4' />
                      </span>
                      Delete
                    </DropdownMenuItem>
                  )}
                </>
              );
            })()}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
