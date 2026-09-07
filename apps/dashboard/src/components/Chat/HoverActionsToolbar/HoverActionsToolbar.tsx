import React, { useMemo, useState } from 'react';
import { Popover } from '../../ui/Popover';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import {
  MessageCircleMore,
  SmilePlus,
  Ticket,
  Bookmark,
  Forward,
  MoreVertical,
  Trash2,
  Link,
  Copy,
  Headphones,
  Mic,
  Pin,
  CornerUpLeft,
  SquareAsterisk,
  Clock3,
  ChevronRight,
  Zap,
  Tag as TagIcon,
} from 'lucide-react';
import { EditMessageIcon } from '../../../assets/icons';
import { UnpinIcon } from '../../../assets/icons/UnpinIcon';
import { XyneAIStar } from '../../icons/xyne-ai';
import { useReactions } from '../../../hooks/useReaction';
import { useAuth } from '../../../hooks/useAuth';
import { useCanCreateTicket } from '../../../hooks/usePermissions';
import { parseReactionsMd } from '@xyne/shared';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { ShortcutHint } from '../../ui/ShortcutHint';
import Button from '../../ui/Button';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';
import { useTheme } from '../../../hooks/useTheme';
import { ConversationSubscription } from '../ConversationSubscription';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { ThreadTagMenuItems } from '../../tags/ThreadTagMenuItems';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import { MESSAGE_REMINDER_MENU_OPTIONS, type ReminderMenuOption } from '../utils/bookmarkUtils';
import type { AppShortcutWithApp } from '../../../services/Apps/appsService';

const REMINDER_TRACK_NAME_BY_OPTION: Record<ReminderMenuOption, string> = {
  '20mins': 'REMINDER_20_MINS',
  '1hour': 'REMINDER_1_HOUR',
  '3hours': 'REMINDER_3_HOURS',
  tomorrow: 'REMINDER_TOMORROW',
  nextWeek: 'REMINDER_NEXT_WEEK',
  custom: 'REMINDER_CUSTOM',
};

export interface HoverActionsToolbarProps {
  isVisible: boolean;
  messageId: string;
  conversationId?: string;
  conversation?: ConversationWithTicket;
  initialMessageId?: string;
  showEditAction?: boolean;
  reactionsMd?: string | null;
  onReplyInThread?: (e?: React.MouseEvent) => void;
  /**
   * Whether this message's conversation can be subscribed to for notifications.
   * Conversation-level capability, decoupled from onReplyInThread so the toggle
   * is available in the per-message menu both in the channel list and inside the
   * thread view (thread replies carry the thread's conversationId).
   */
  canSubscribe?: boolean;
  onCreateTicket?: () => void;
  onCreateSubTicket?: () => void;
  onEditMessage?: () => void;
  onDeleteMessage?: () => void;
  onPinMessage?: () => void;
  onCopyLink?: () => void;
  /** Thread-type tags for this message's conversation. Absent = no tag menu. */
  threadTags?: { applied: string[]; onToggle: (name: string) => void };
  onCopyMessage?: () => void;
  onSendToChannel?: () => void;
  onForwardMessage?: () => void;
  onEmojiPickerOpenChange?: (isOpen: boolean) => void;
  onDropdownOpenChange?: (isOpen: boolean) => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
  onRemindMeOption?: (option: ReminderMenuOption) => void;
  onAskAI?: () => void;
  isPinned?: boolean;
  onMarkAsUnread?: () => void;
  onInitiateCall?: () => void;
  isCallDisabled?: boolean;
  /** Starts a headless ("take notes") recording anchored to this thread. */
  onStartRecording?: () => void;
  isRecordingDisabled?: boolean;
  isChannelArchived?: boolean;
  /** MESSAGE shortcuts for this channel — shown in the More Actions dropdown */
  messageShortcuts?: AppShortcutWithApp[];
  /** Called when user selects a message shortcut */
  onRunShortcut?: (shortcut: AppShortcutWithApp) => void;
  /** Called when user clicks “Show all shortcuts” */
  onShowAllShortcuts?: () => void;
  /**
   * Vertical placement relative to the hovered row. Defaults to 'above', which
   * lifts the bar clear of the row. Set from ChatBubble's registered actions;
   * only the thread parent passes 'below'.
   */
  placement?: 'above' | 'below';
  /**
   * The message's current acts (stringified JSON array, or null). Presence of this prop is
   * what renders the tag button — set only when the message is taggable, mirroring how the
   * other optional actions gate themselves.
   */
  /**
   * Reports the tag popover's open state so the shared overlay can pin itself open.
   * Without it, moving the pointer up into the popover leaves the message row, the
   * toolbar hides, and the popover unmounts before anything can be clicked.
   */
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
  canSubscribe,
  onCreateTicket,
  onCreateSubTicket,
  onEditMessage,
  onDeleteMessage,
  onPinMessage,
  onCopyLink,
  threadTags,
  onCopyMessage,
  onSendToChannel,
  onForwardMessage,
  onEmojiPickerOpenChange,
  onDropdownOpenChange,
  onBookmark,
  isBookmarked = false,
  onRemindMeOption,
  onAskAI,
  isPinned = false,
  onMarkAsUnread,
  onInitiateCall,
  isCallDisabled = false,
  onStartRecording,
  isRecordingDisabled = false,
  isChannelArchived = false,
  messageShortcuts,
  onRunShortcut,
  onShowAllShortcuts,
  placement = 'above',
}) => {
  const { toggleReaction } = useReactions();
  const { user } = useAuth();
  const canCreateTicket = useCanCreateTicket();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const { data: customEmojis } = useCustomEmojis();
  const { theme } = useTheme();
  const emojiPickerTheme = theme === 'midnight' ? Theme.DARK : Theme.LIGHT;
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
    threadTags ||
    onSendToChannel ||
    onCopyLink ||
    onCopyMessage ||
    onPinMessage ||
    onMarkAsUnread ||
    showEditAction ||
    onBookmark ||
    onRemindMeOption ||
    onForwardMessage ||
    (messageShortcuts && messageShortcuts.length > 0) ||
    (onReplyInThread && conversationId);

  // Keep toolbar visible if dropdown is open, even if parent says to hide
  if (!isVisible && !isDropdownOpen) return null;

  return (
    <div
      key={`hover-actions-toolbar-${messageId}`}
      className={`absolute ${placement === 'below' ? 'top-1' : '-top-7'} right-4 z-50 p-1 flex items-center gap-1 rounded-lg border border-border bg-popover shadow-md`}
    >
      {/* Emojis */}
      {onEmojiPickerOpenChange && (
        <Popover
          key={`emoji-picker-${messageId}`}
          trigger={
            <Button
              variant='ghost'
              className='size-7 text-muted-foreground'
              title='Add reaction'
              data-testid='hover-action-add-reaction'
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
          className='z-[60] bg-popover rounded-lg shadow-md p-0'
        >
          <EmojiPicker
            style={{
              width: '320px',
              ['--epr-emoji-size' as string]: '22px',
              ['--epr-emoji-gap' as string]: '4px',
            }}
            theme={emojiPickerTheme}
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
            previewConfig={{ showPreview: true }}
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
      {onCreateTicket && canCreateTicket && !isChannelArchived && (
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
      {onInitiateCall && messageId === initialMessageId && !isChannelArchived && (
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

      {/* Start Recording (Take Notes) */}
      {onStartRecording && messageId === initialMessageId && !isChannelArchived && (
        <Tooltip content={isRecordingDisabled ? 'Recording in progress' : 'Take notes'} side='top'>
          <Button
            variant='ghost'
            className='size-7 text-muted-foreground'
            onClick={onStartRecording}
            disabled={isRecordingDisabled}
            title={isRecordingDisabled ? 'Recording in progress' : 'Take notes'}
            data-testid='hover-action-start-recording'
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='START_RECORDING_FROM_MESSAGE'
            data-track-metadata={JSON.stringify({ messageId })}
          >
            <Mic className='w-4 h-4' />
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
          <DropdownMenuContent
            align='end'
            alignOffset={-5}
            side='bottom'
            sideOffset={7}
            className='w-[280px]'
          >
            {/* Compute which sections have visible items */}
            {(() => {
              const hasEditSection = (showEditAction && onEditMessage) || onSendToChannel;
              const hasSubscriptionSection =
                (canSubscribe && conversationId) ||
                onMarkAsUnread ||
                onBookmark ||
                onRemindMeOption ||
                onPinMessage;
              const hasCopySection = onCopyLink || onCopyMessage || onForwardMessage;
              const hasDelete = showEditAction && onDeleteMessage;

              return (
                <>
                  {/* Edit Message */}
                  {showEditAction && onEditMessage && !isChannelArchived && (
                    <DropdownMenuItem
                      onClick={onEditMessage}
                      data-testid='hover-action-edit-message'
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='EDIT_MESSAGE'
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        <EditMessageIcon className='w-4 h-4' />
                      </span>
                      Edit
                      <ShortcutHint shortcut='message.edit' className='ml-auto pl-6 text-xs' />
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
                  {isDropdownOpen && canSubscribe && conversationId && (
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
                      data-testid='hover-action-mark-unread'
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
                      data-track-name={isBookmarked ? 'REMOVE_BOOKMARK' : 'ADD_BOOKMARK'}
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        <Bookmark className='w-4 h-4' />
                      </span>
                      {isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
                      <ShortcutHint shortcut='message.bookmark' className='ml-auto pl-6 text-xs' />
                    </DropdownMenuItem>
                  )}

                  {/* Remind Me */}
                  {threadTags && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger
                        data-testid='hover-action-thread-tags'
                        data-track-category='HOVER_ACTIONS_TOOLBAR'
                        data-track-name='OPEN_THREAD_TAG_MENU'
                        data-track-metadata={JSON.stringify({ messageId })}
                      >
                        <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                          <TagIcon className='w-4 h-4' />
                        </span>
                        Thread tags
                        <ChevronRight className='w-4 h-4 ml-auto text-muted-foreground' />
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className='w-[220px]'>
                        <ThreadTagMenuItems
                          applied={threadTags.applied}
                          onToggle={threadTags.onToggle}
                        />
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}

                  {onRemindMeOption && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger
                        data-testid='hover-action-remind-me'
                        data-track-category='HOVER_ACTIONS_TOOLBAR'
                        data-track-name='OPEN_REMINDER_MENU'
                        data-track-metadata={JSON.stringify({ messageId })}
                      >
                        <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                          <Clock3 className='w-4 h-4' />
                        </span>
                        Remind me
                        <ChevronRight className='w-4 h-4 ml-auto text-muted-foreground' />
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className='w-[200px]'>
                        {MESSAGE_REMINDER_MENU_OPTIONS.map(option => (
                          <DropdownMenuItem
                            key={option.option}
                            onClick={(): void => onRemindMeOption(option.option)}
                            data-track-category='HOVER_ACTIONS_TOOLBAR'
                            data-track-name={REMINDER_TRACK_NAME_BY_OPTION[option.option]}
                            data-track-metadata={JSON.stringify({ messageId })}
                          >
                            {option.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}

                  {/* Pin Message */}
                  {onPinMessage && (
                    <DropdownMenuItem
                      onClick={onPinMessage}
                      data-testid={
                        isPinned ? 'hover-action-unpin-message' : 'hover-action-pin-message'
                      }
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='TOGGLE_PIN_MESSAGE'
                      data-track-metadata={JSON.stringify({ isPinned, messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        {isPinned ? <UnpinIcon className='w-4 h-4' /> : <Pin className='w-4 h-4' />}
                      </span>
                      {isPinned ? 'Unpin message' : 'Pin message'}
                      <ShortcutHint shortcut='message.pin' className='ml-auto pl-6 text-xs' />
                    </DropdownMenuItem>
                  )}

                  {/* Separator before Copy actions */}
                  {hasSubscriptionSection && hasCopySection && <DropdownMenuSeparator />}

                  {/* Copy Link */}
                  {onCopyLink && (
                    <DropdownMenuItem
                      onClick={onCopyLink}
                      data-testid='hover-action-copy-link'
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='COPY_LINK'
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                        <Link className='w-4 h-4' />
                      </span>
                      Copy link
                      <ShortcutHint shortcut='message.copyLink' className='ml-auto pl-6 text-xs' />
                    </DropdownMenuItem>
                  )}

                  {/* Copy Message */}
                  {onCopyMessage && (
                    <DropdownMenuItem
                      onClick={onCopyMessage}
                      data-testid='hover-action-copy-message'
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
                      data-testid='hover-action-forward-message'
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

                  {/* Message Shortcuts — Connect to apps */}
                  {messageShortcuts && messageShortcuts.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                            <Zap className='w-4 h-4' />
                          </span>
                          Connect to apps
                          <ChevronRight className='w-4 h-4 ml-auto text-muted-foreground' />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className='w-[240px]'>
                          {messageShortcuts.slice(0, 3).map(shortcut => (
                            <DropdownMenuItem
                              key={shortcut.commandName}
                              onClick={() => onRunShortcut?.(shortcut)}
                              data-track-category='HOVER_ACTIONS_TOOLBAR'
                              data-track-name='RUN_SHORTCUT'
                            >
                              <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                                <Zap className='w-3.5 h-3.5' />
                              </span>
                              <div className='flex-1 min-w-0'>
                                <p className='text-sm truncate'>{shortcut.commandName}</p>
                                <p className='text-xs text-muted-foreground truncate'>
                                  {shortcut.appName}
                                </p>
                              </div>
                            </DropdownMenuItem>
                          ))}
                          {messageShortcuts.length > 3 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={onShowAllShortcuts}
                                data-track-category='HOVER_ACTIONS_TOOLBAR'
                                data-track-name='SHOW_ALL_SHORTCUTS'
                              >
                                <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
                                  <Zap className='w-4 h-4' />
                                </span>
                                Show more shortcuts ({messageShortcuts.length - 3} more)
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </>
                  )}

                  {/* Delete */}
                  {showEditAction && onDeleteMessage && (
                    <DropdownMenuItem
                      onClick={onDeleteMessage}
                      className='text-destructive focus:text-destructive'
                      data-testid='hover-action-delete-message'
                      data-track-category='HOVER_ACTIONS_TOOLBAR'
                      data-track-name='DELETE_MESSAGE'
                      data-track-metadata={JSON.stringify({ messageId })}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center'>
                        <Trash2 className='w-4 h-4' />
                      </span>
                      Delete
                      <ShortcutHint shortcut='message.delete' className='ml-auto pl-6 text-xs' />
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
