import React, { useState, type ReactElement, type ReactNode } from 'react';
import { Popover } from '../../ui/Popover';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import {
  SmilePlus,
  Bookmark,
  MoreVertical,
  MoreHorizontal,
  Trash2,
  Clock3,
  ChevronRight,
  Zap,
  SlidersHorizontal,
  Tag as TagIcon,
} from 'lucide-react';
import { UnpinIcon } from '../../../assets/icons/UnpinIcon';
import { XyneAIStar } from '../../icons/xyne-ai';
import { useCanCreateTicket } from '../../../hooks/usePermissions';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { ShortcutHint } from '../../ui/ShortcutHint';
import Button from '../../ui/Button';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';
import { FrequentEmojiRow } from '../FrequentEmojis/FrequentEmojiRow';
import { InlineQuickReactions } from '../FrequentEmojis/InlineQuickReactions';
import { EMOJI_PICKER_CATEGORIES } from '../../../utils/emojiPickerCategories';
import { toEmojiToken } from '../../../utils/customEmojiUtils';
import { useApplyReaction } from '../../../hooks/useApplyReaction';
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
import { DragableSixDots } from '@xyne/icons';
import { messageActionsStore } from '../../../hooks/barItems';
import type { MessageBarDrag } from '../../../hooks/useMessageBarDrag';
import type { ShortcutId } from '../../../shortcuts';
import { cn } from '../../../utils/classNames';
import { MESSAGE_BAR_ICONS } from './messageBarActions';
import { isMessageBarActionId } from '../../../utils/messageBar';
import {
  BAR_SLOT_CLASS,
  BAR_SOCKET_CLASS,
  MESSAGE_MENU_COPY_IDS,
  MESSAGE_MENU_EDIT_IDS,
  MESSAGE_MENU_LEAD_IDS,
  type MessageBarActionId,
} from '../../../constants/messageBar';

const REMINDER_TRACK_NAME_BY_OPTION: Record<ReminderMenuOption, string> = {
  '20mins': 'REMINDER_20_MINS',
  '1hour': 'REMINDER_1_HOUR',
  '3hours': 'REMINDER_3_HOURS',
  tomorrow: 'REMINDER_TOMORROW',
  nextWeek: 'REMINDER_NEXT_WEEK',
  custom: 'REMINDER_CUSTOM',
};

interface ToolbarAction {
  label: string;
  menuLabel?: string;
  icon: ReactNode;
  menuIcon?: ReactNode;
  onSelect: (event: React.MouseEvent) => void;
  disabled?: boolean;
  pressed?: boolean;
  testId?: string;
  trackName: string;
  trackMetadata: string;
  shortcut?: ShortcutId;
}

export interface HoverActionsToolbarProps {
  isVisible: boolean;
  messageId: string;
  conversationId?: string;
  conversation?: ConversationWithTicket;
  initialMessageId?: string;
  showEditAction?: boolean;
  reactionsMd?: string | null;
  onReplyInThread?: (e?: React.MouseEvent) => void;
  showSubscription?: boolean;
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
   * 'bar', the default: the floating bar over a hovered row. 'footer': a card's own
   * footer — React and More in line, everything else inside More — for a discussion
   * card, where a bar over the text would crowd it.
   */
  layout?: 'bar' | 'footer';
  barDrag?: MessageBarDrag;
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
  showSubscription,
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
  layout = 'bar',
  barDrag,
}) => {
  // Shared identity for every action in this toolbar. `conversationId` is the
  // thread key — it joins to a channel server-side, and it is what lets message
  // actions roll up per thread instead of only per message.
  const actionTrackMetadata = JSON.stringify({
    messageId,
    ...(conversationId !== undefined && { conversationId }),
  });

  // In a card's footer only React and More are on show; the rest moves into More,
  // so nothing is lost but the card stays calm.
  const compact = layout === 'footer';
  const { applyReaction: toggleEmoji, hasReacted } = useApplyReaction(messageId, reactionsMd);
  const canCreateTicket = useCanCreateTicket();
  const storedIds = messageActionsStore.useItems();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const { data: customEmojis } = useCustomEmojis();
  const { theme } = useTheme();
  const emojiPickerTheme = theme === 'midnight' ? Theme.DARK : Theme.LIGHT;

  const handleEmojiOpenChange = (open: boolean): void => {
    // Only report a real transition: the inline strip reacts without ever opening the
    // popover, and an unconditional `false` tells the parent the picker just closed.
    if (open === emojiOpen) return;
    setEmojiOpen(open);
    onEmojiPickerOpenChange?.(open);
  };

  // One path for every emoji this toolbar can apply — the picker grid, the Frequently Used
  // row and the inline strip — so the toggle semantics and close behaviour cannot drift.
  const applyReaction = (emojiName: string): void => {
    toggleEmoji(emojiName);
    handleEmojiOpenChange(false);
  };

  const handleDropdownOpenChange = (open: boolean): void => {
    setIsDropdownOpen(open);
    onDropdownOpenChange?.(open);
  };

  // In the footer these live in More rather than on the bar.
  const showAskAI = !!onAskAI;
  const showCreateTicket = !!onCreateTicket && canCreateTicket && !isChannelArchived;
  const showCreateSubTicket = !!onCreateSubTicket && canCreateTicket;
  const showCall = !!onInitiateCall && messageId === initialMessageId && !isChannelArchived;
  const showRecording = !!onStartRecording && messageId === initialMessageId && !isChannelArchived;

  const actions: Partial<Record<MessageBarActionId, ToolbarAction>> = {};
  if (onReplyInThread) {
    actions.reply = {
      label: 'Reply in thread',
      ...(compact && { menuLabel: 'Open discussion' }),
      icon: MESSAGE_BAR_ICONS.reply,
      onSelect: e => onReplyInThread(e),
      testId: 'hover-action-reply-in-thread',
      trackName: 'REPLY_IN_THREAD',
      trackMetadata: actionTrackMetadata,
    };
  }
  if (showAskAI && onAskAI) {
    actions.askAI = {
      label: 'Ask AI',
      icon: MESSAGE_BAR_ICONS.askAI,
      menuIcon: <XyneAIStar size={14} />,
      onSelect: onAskAI,
      testId: 'hover-action-ask-ai',
      trackName: 'ASK_AI',
      trackMetadata: actionTrackMetadata,
    };
  }
  if (showCall && onInitiateCall) {
    actions.call = {
      label: isCallDisabled ? 'Call in progress' : 'Start call',
      icon: MESSAGE_BAR_ICONS.call,
      onSelect: onInitiateCall,
      disabled: isCallDisabled,
      testId: 'hover-action-initiate-call',
      trackName: 'INITIATE_CALL',
      trackMetadata: actionTrackMetadata,
    };
  }
  if (showRecording && onStartRecording) {
    actions.notes = {
      label: isRecordingDisabled ? 'Recording in progress' : 'Take notes',
      icon: MESSAGE_BAR_ICONS.notes,
      onSelect: onStartRecording,
      disabled: isRecordingDisabled,
      testId: 'hover-action-start-recording',
      trackName: 'START_RECORDING_FROM_MESSAGE',
      trackMetadata: actionTrackMetadata,
    };
  }
  if (showCreateTicket && onCreateTicket) {
    actions.createTicket = {
      label: 'Create ticket',
      icon: MESSAGE_BAR_ICONS.createTicket,
      onSelect: onCreateTicket,
      testId: 'hover-action-create-ticket',
      trackName: 'CREATE_TICKET_FROM_MESSAGE',
      trackMetadata: JSON.stringify({
        messageId,
        ...(conversationId !== undefined && { conversationId }),
        source: 'chat_message',
      }),
    };
  }
  if (showCreateSubTicket && onCreateSubTicket) {
    actions.createSubTicket = {
      label: 'Create subticket',
      icon: MESSAGE_BAR_ICONS.createSubTicket,
      onSelect: onCreateSubTicket,
      testId: 'hover-action-create-subticket',
      trackName: 'CREATE_SUBTICKET_FROM_MESSAGE',
      trackMetadata: actionTrackMetadata,
    };
  }
  if (showEditAction && onEditMessage && !isChannelArchived) {
    actions.edit = {
      label: 'Edit message',
      menuLabel: 'Edit',
      icon: MESSAGE_BAR_ICONS.edit,
      onSelect: onEditMessage,
      testId: 'hover-action-edit-message',
      trackName: 'EDIT_MESSAGE',
      trackMetadata: actionTrackMetadata,
      shortcut: 'message.edit',
    };
  }
  if (onSendToChannel) {
    actions.sendToChannel = {
      label: 'Send to channel',
      icon: MESSAGE_BAR_ICONS.sendToChannel,
      onSelect: onSendToChannel,
      trackName: 'SEND_TO_CHANNEL',
      trackMetadata: actionTrackMetadata,
    };
  }
  if (onMarkAsUnread) {
    actions.markUnread = {
      label: 'Mark as unread',
      icon: MESSAGE_BAR_ICONS.markUnread,
      onSelect: onMarkAsUnread,
      testId: 'hover-action-mark-unread',
      trackName: 'MARK_AS_UNREAD',
      trackMetadata: actionTrackMetadata,
    };
  }
  if (onBookmark) {
    actions.bookmark = {
      label: isBookmarked ? 'Remove bookmark' : 'Add bookmark',
      icon: <Bookmark className={cn('w-4 h-4', isBookmarked && 'fill-current')} />,
      menuIcon: MESSAGE_BAR_ICONS.bookmark,
      onSelect: onBookmark,
      pressed: isBookmarked,
      testId: isBookmarked ? 'hover-action-remove-bookmark' : 'hover-action-add-bookmark',
      trackName: isBookmarked ? 'REMOVE_BOOKMARK' : 'ADD_BOOKMARK',
      trackMetadata: actionTrackMetadata,
      shortcut: 'message.bookmark',
    };
  }
  if (onPinMessage) {
    actions.pin = {
      label: isPinned ? 'Unpin message' : 'Pin message',
      icon: isPinned ? <UnpinIcon className='w-4 h-4' /> : MESSAGE_BAR_ICONS.pin,
      onSelect: onPinMessage,
      pressed: isPinned,
      testId: isPinned ? 'hover-action-unpin-message' : 'hover-action-pin-message',
      trackName: 'TOGGLE_PIN_MESSAGE',
      trackMetadata: JSON.stringify({ isPinned, messageId }),
      shortcut: 'message.pin',
    };
  }
  if (onCopyLink) {
    actions.copyLink = {
      label: 'Copy link',
      icon: MESSAGE_BAR_ICONS.copyLink,
      onSelect: onCopyLink,
      testId: 'hover-action-copy-link',
      trackName: 'COPY_LINK',
      trackMetadata: actionTrackMetadata,
      shortcut: 'message.copyLink',
    };
  }
  if (onCopyMessage) {
    actions.copyMessage = {
      label: 'Copy message',
      icon: MESSAGE_BAR_ICONS.copyMessage,
      onSelect: onCopyMessage,
      testId: 'hover-action-copy-message',
      trackName: 'COPY_MESSAGE',
      trackMetadata: actionTrackMetadata,
    };
  }
  if (onForwardMessage) {
    actions.forward = {
      label: 'Forward message',
      icon: MESSAGE_BAR_ICONS.forward,
      onSelect: onForwardMessage,
      testId: 'hover-action-forward-message',
      trackName: 'FORWARD_MESSAGE',
      trackMetadata: actionTrackMetadata,
    };
  }

  const barIds = compact ? [] : storedIds.filter(isMessageBarActionId).filter(id => actions[id]);
  const onBar = new Set<MessageBarActionId>(barIds);
  const inMenu = (id: MessageBarActionId): boolean => actions[id] !== undefined && !onBar.has(id);
  const leadMenuIds = MESSAGE_MENU_LEAD_IDS.filter(inMenu);
  const editMenuIds = MESSAGE_MENU_EDIT_IDS.filter(inMenu);
  const copyMenuIds = MESSAGE_MENU_COPY_IDS.filter(inMenu);

  // Check if there are any overflow actions to show in dropdown
  const hasOverflowActions =
    leadMenuIds.length > 0 ||
    editMenuIds.length > 0 ||
    copyMenuIds.length > 0 ||
    inMenu('markUnread') ||
    inMenu('bookmark') ||
    inMenu('pin') ||
    threadTags ||
    onRemindMeOption ||
    (showEditAction && onDeleteMessage) ||
    (messageShortcuts && messageShortcuts.length > 0) ||
    (showSubscription && conversationId);

  // Keep toolbar visible if dropdown is open, even if parent says to hide
  if (!isVisible && !isDropdownOpen) return null;

  const renderBarAction = (id: MessageBarActionId): ReactElement | null => {
    const action = actions[id];
    if (!action) return null;
    return (
      <span
        key={id}
        data-bar-tile=''
        data-bar-id={id}
        data-bar-label={action.menuLabel ?? action.label}
        onPointerDown={barDrag ? event => barDrag.startBarPress(id, event) : undefined}
        className={cn('relative flex', isDropdownOpen && 'pointer-events-auto')}
      >
        <span data-bar-socket aria-hidden className={BAR_SOCKET_CLASS} />
        <Tooltip
          content={
            action.shortcut ? (
              <span className='flex items-center gap-2'>
                {action.label}
                <ShortcutHint shortcut={action.shortcut} />
              </span>
            ) : (
              action.label
            )
          }
          side='top'
        >
          <Button
            variant='ghost'
            className={cn('size-7 text-muted-foreground', action.pressed && 'text-foreground')}
            onClick={event => {
              action.onSelect(event);
              if (isDropdownOpen) handleDropdownOpenChange(false);
            }}
            disabled={action.disabled ?? false}
            title={action.label}
            aria-label={action.label}
            aria-pressed={action.pressed}
            data-bar-glyph=''
            data-testid={action.testId}
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name={action.trackName}
            data-track-metadata={action.trackMetadata}
          >
            {action.icon}
          </Button>
        </Tooltip>
      </span>
    );
  };

  const renderMenuAction = (id: MessageBarActionId): ReactElement | null => {
    const action = actions[id];
    if (!action) return null;
    if (onBar.has(id)) {
      return barDrag ? (
        <div key={id} data-bar-slot={id} aria-hidden className='relative h-0 overflow-hidden'>
          <span className={BAR_SLOT_CLASS} />
        </div>
      ) : null;
    }
    const label = action.menuLabel ?? action.label;
    return (
      <DropdownMenuItem
        key={id}
        onClick={action.onSelect}
        disabled={action.disabled ?? false}
        data-testid={action.testId}
        data-track-category='HOVER_ACTIONS_TOOLBAR'
        data-track-name={action.trackName}
        data-track-metadata={action.trackMetadata}
        data-bar-label={label}
        onPointerDown={barDrag ? event => barDrag.startMenuPress(id, event) : undefined}
        className={barDrag ? 'group/row' : undefined}
      >
        {barDrag && (
          <span data-bar-socket aria-hidden className={cn(BAR_SOCKET_CLASS, 'rounded-sm')} />
        )}
        <span
          data-bar-glyph=''
          className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'
        >
          {action.menuIcon ?? action.icon}
        </span>
        <span data-bar-text=''>{label}</span>
        {(action.shortcut || barDrag) && (
          <span className='ml-auto flex items-center gap-1.5 pl-6'>
            {action.shortcut && <ShortcutHint shortcut={action.shortcut} className='text-xs' />}
            {barDrag && (
              <DragableSixDots
                aria-hidden
                className='size-3.5 shrink-0 opacity-0 transition-opacity duration-150 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-data-[highlighted]/row:opacity-40'
              />
            )}
          </span>
        )}
      </DropdownMenuItem>
    );
  };

  const emojiPicker = onEmojiPickerOpenChange && (
    <Popover
      key={`emoji-picker-${messageId}`}
      trigger={
        <Button
          variant='ghost'
          className={
            compact
              ? 'h-7 gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted-foreground hover:text-foreground'
              : 'size-7 text-muted-foreground'
          }
          title='Add reaction'
          data-testid='hover-action-add-reaction'
        >
          <SmilePlus className={compact ? 'size-3.5' : 'w-4 h-4'} />
          {compact && 'React'}
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
      <div className='w-[320px]'>
        <FrequentEmojiRow onSelect={applyReaction} messageId={messageId} />
        <EmojiPicker
          style={{
            ['--epr-emoji-size' as string]: '22px',
            ['--epr-emoji-gap' as string]: '4px',
          }}
          categories={EMOJI_PICKER_CATEGORIES}
          theme={emojiPickerTheme}
          emojiStyle={EmojiStyle.NATIVE}
          onEmojiClick={emoji => applyReaction(toEmojiToken(emoji))}
          customEmojis={customEmojis || []}
          previewConfig={{ showPreview: true }}
        />
      </div>
    </Popover>
  );

  return (
    <div
      key={`hover-actions-toolbar-${messageId}`}
      ref={compact ? undefined : barDrag?.barRef}
      className={
        compact
          ? 'flex items-center gap-0.5'
          : 'absolute -top-7 right-4 z-50 p-1 flex max-w-[calc(100%-2rem)] flex-wrap items-center justify-end gap-1 rounded-lg border border-transparent'
      }
    >
      {!compact && (
        <span
          data-bar-chrome=''
          aria-hidden
          className='pointer-events-none absolute -inset-px -z-10 rounded-lg border border-border bg-popover shadow-md'
        />
      )}
      {!compact && barDrag && (
        <span
          data-bar-gap=''
          aria-hidden
          className='pointer-events-none absolute left-0 top-1 size-7 rounded-md border-[1.5px] border-dashed border-foreground/15 bg-foreground/[0.02] opacity-0'
        />
      )}

      {/* Emojis */}
      {compact
        ? emojiPicker
        : onEmojiPickerOpenChange && (
            <span data-bar-lead='' className='flex items-center gap-1'>
              {/* Frequently used emojis, one click each — then the full picker */}
              <InlineQuickReactions
                onSelect={applyReaction}
                hasReacted={hasReacted}
                messageId={messageId}
              />
              {emojiPicker}
            </span>
          )}

      {barIds.map(renderBarAction)}

      {/* More Actions Dropdown */}
      {hasOverflowActions && (
        <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              className={
                compact
                  ? 'size-7 rounded-md text-muted-foreground hover:text-foreground'
                  : 'size-7 text-muted-foreground data-[drop-target]:scale-110 data-[drop-target]:bg-accent data-[drop-target]:text-foreground'
              }
              title='More actions'
              aria-label='More actions'
              data-testid='hover-action-more'
              data-bar-more=''
            >
              {compact ? (
                <MoreHorizontal className='size-4' />
              ) : (
                <MoreVertical className='w-4 h-4' />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='end'
            alignOffset={-5}
            side='bottom'
            sideOffset={7}
            className='w-[280px]'
            onInteractOutside={event => {
              const { target } = event;
              if (!(target instanceof Element) || !target.closest('[data-bar-tile]')) return;
              const original = event.detail.originalEvent;
              const primaryPress =
                original instanceof PointerEvent
                  ? original.button === 0
                  : !target.matches(':focus-visible');
              if (primaryPress) event.preventDefault();
            }}
          >
            {/* Compute which sections have visible items */}
            {(() => {
              const hasEditSection = editMenuIds.length > 0;
              const hasSubscriptionSection =
                (showSubscription && conversationId) ||
                inMenu('markUnread') ||
                inMenu('bookmark') ||
                onRemindMeOption ||
                inMenu('pin');
              const hasCopySection = copyMenuIds.length > 0;
              const hasDelete = showEditAction && onDeleteMessage;

              return (
                <>
                  {/* The footer's moved actions, first, in the bar's order. */}
                  {MESSAGE_MENU_LEAD_IDS.map(renderMenuAction)}
                  {leadMenuIds.length > 0 &&
                    (hasEditSection || hasSubscriptionSection || hasCopySection || hasDelete) && (
                      <DropdownMenuSeparator />
                    )}
                  {MESSAGE_MENU_EDIT_IDS.map(renderMenuAction)}

                  {/* Separator after Edit section */}
                  {hasEditSection && hasSubscriptionSection && <DropdownMenuSeparator />}

                  {/* Conversation Subscription */}
                  {isDropdownOpen && showSubscription && conversationId && (
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

                  {renderMenuAction('markUnread')}
                  {renderMenuAction('bookmark')}

                  {/* Remind Me */}
                  {threadTags && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger
                        data-testid='hover-action-thread-tags'
                        data-track-category='HOVER_ACTIONS_TOOLBAR'
                        data-track-name='OPEN_THREAD_TAG_MENU'
                        data-track-metadata={actionTrackMetadata}
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
                        data-track-metadata={actionTrackMetadata}
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
                            data-track-metadata={actionTrackMetadata}
                          >
                            {option.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}

                  {renderMenuAction('pin')}

                  {/* Separator before Copy actions */}
                  {hasSubscriptionSection && hasCopySection && <DropdownMenuSeparator />}

                  {MESSAGE_MENU_COPY_IDS.map(renderMenuAction)}

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
                      data-track-metadata={actionTrackMetadata}
                    >
                      <span className='w-4 h-4 mr-2 flex items-center justify-center'>
                        <Trash2 className='w-4 h-4' />
                      </span>
                      Delete
                      <ShortcutHint shortcut='message.delete' className='ml-auto pl-6 text-xs' />
                    </DropdownMenuItem>
                  )}

                  {barDrag && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent('xyne-open-preferences', {
                              detail: { section: 'messageActions' },
                            }),
                          )
                        }
                        className='text-muted-foreground'
                        data-testid='hover-action-customize'
                        data-track-category='HOVER_ACTIONS_TOOLBAR'
                        data-track-name='CUSTOMIZE_ACTIONS'
                      >
                        <span className='w-4 h-4 mr-2 flex items-center justify-center'>
                          <SlidersHorizontal className='w-4 h-4' />
                        </span>
                        Customize actions
                      </DropdownMenuItem>
                    </>
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
