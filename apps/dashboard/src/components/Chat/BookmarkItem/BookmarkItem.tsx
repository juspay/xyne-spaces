import { ReactElement, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { useChannel } from '../../../hooks/useChannels';
import { Check, Clock, X } from 'lucide-react';
import { BookmarkEntityType } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import Tooltip from '../../ui/Tooltip/Tooltip';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import {
  BOOKMARK_REMINDER_MENU_OPTIONS,
  REMINDER_TIME_OPTIONS,
  calculateCustomReminderTime,
  calculateReminderTime,
  createReminderMessagePreview,
  formatReminderDueIn,
  formatDateWithTime,
  getReminderFromMetadata,
  removeReminderMetadata,
  upsertReminderMetadataWithContext,
} from '../utils/bookmarkUtils';
import type { ReminderMenuOption, ReminderTimeOption } from '../utils/bookmarkUtils';
import { mutators } from '../../../zero/mutators';
import { useUser } from '../../../hooks/useUsers';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { toast } from 'sonner';

const REMINDER_TRACK_NAME_BY_OPTION: Record<ReminderMenuOption, string> = {
  '20mins': 'Reminder_Bookmark_20_Mins',
  '1hour': 'Reminder_Bookmark_1_Hour',
  '3hours': 'Reminder_Bookmark_3_Hours',
  tomorrow: 'Reminder_Bookmark_Tomorrow',
  nextWeek: 'Reminder_Bookmark_Next_Week',
  custom: 'Open_Custom_Bookmark_Reminder',
};

export interface BookmarkItemProps {
  entityId: string;
  entityType: BookmarkEntityType;
  bookmarkMetadata: unknown;
  channelId?: string; // Optional: if provided, filter to only show messages from this channel
  showChannelName?: boolean; // Optional: show channel/DM name
  enableReminder?: boolean; // Optional: enable reminder functionality (default: false)
  isMobile?: boolean; // Optional: whether rendering on mobile device
  showActions?: boolean; // Optional: show hover actions toolbar (default: true)
  nofocus?: boolean; // Optional: append ?nofocus=1 to navigation URL
  onMarkedDone?: () => void;
}

export const BookmarkItem = ({
  entityId,
  entityType,
  bookmarkMetadata,
  channelId,
  showChannelName = false,
  enableReminder = false,
  isMobile = false,
  showActions = true,
  nofocus = false,
  onMarkedDone,
}: BookmarkItemProps): ReactElement | null => {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const zero = useZero();
  const [isHovered, setIsHovered] = useState(false);
  const [isReminderDropdownOpen, setIsReminderDropdownOpen] = useState(false);
  const [hideActionsUntilMouseLeave, setHideActionsUntilMouseLeave] = useState(false);
  const [isCustomReminderModalOpen, setIsCustomReminderModalOpen] = useState(false);
  const [customReminderDate, setCustomReminderDate] = useState<Date | null>(new Date());
  const [customReminderTime, setCustomReminderTime] = useState<ReminderTimeOption>('09:00');

  // Fetch the message data - ALWAYS call hooks unconditionally
  const [message] = useCachedQuery(queries.getMessageForActivityV2({ messageId: entityId }));
  const channel = useChannel(message?.conversation?.channelId || '');
  const sender = useUser(message?.senderId ?? '');

  // NOW we can have conditional returns after all hooks are called
  // Currently only supporting MESSAGE type
  if (entityType !== BookmarkEntityType.MESSAGE) {
    return null;
  }

  if (!message) {
    return null;
  }

  // If channelId is provided, only show messages from this channel
  if (channelId && channel?.id !== channelId) {
    return null;
  }

  const messageChannelId = channel?.id;
  const conversationId = message.conversationId;
  const initialMessageId = message.conversation?.initialMessageId;

  // If this message is NOT the initial message of its conversation, it's a thread reply
  const isThreadReply = initialMessageId !== message.messageId;

  // If it's a thread reply, navigate to the thread view (channelId/conversationId)
  // Otherwise, navigate to the channel view with conversation highlighted
  // Use baseRoute to determine context: /chat/bookmarks -> /chat/bookmarks/:channelId, else /chat/dir/:channelId
  const nofocusParam = nofocus ? '?nofocus=1' : '';
  const messageLink =
    messageChannelId && conversationId
      ? isThreadReply
        ? `${baseRoute}/${messageChannelId}/${conversationId}${nofocusParam}#origin=${conversationId}&messageId=${message.messageId}`
        : `${baseRoute}/${messageChannelId}${nofocusParam}#origin=${conversationId}&messageId=${message.messageId}`
      : '#';

  const handleClick = (e: React.MouseEvent): void => {
    e.preventDefault();
    if (messageLink !== '#') {
      void navigate(messageLink, { state: { fromBookmarks: true } });
    }
  };

  const activeReminder = getReminderFromMetadata(bookmarkMetadata);
  const reminderAt = activeReminder?.remindAt;

  const handleRemoveBookmark = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onMarkedDone?.();
    void zero.mutate(
      mutators.bookmark.remove({
        entityId,
        entityType,
        timestamp: Date.now(),
        markAsDone: true,
      }),
    );
  };

  const handleReminderClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
  };

  const applyReminderAt = (remindAt: Date): void => {
    const reminderContext = {
      messagePreview: createReminderMessagePreview(message.content),
      conversationId: message.conversationId,
      initialMessageId: message.conversation?.initialMessageId,
      ...(channel?.id && { channelId: channel.id }),
      ...(channel?.name && { channelName: channel.name }),
      ...(channel?.scopeType && { channelScopeType: String(channel.scopeType) }),
      ...(sender?.name && { senderName: sender.name }),
    };

    void zero.mutate(
      mutators.bookmark.updateMetadata({
        entityId,
        entityType,
        metadata: upsertReminderMetadataWithContext(
          bookmarkMetadata,
          remindAt.toISOString(),
          reminderContext,
        ),
        timestamp: Date.now(),
      }),
    );
  };

  const handleReminderOption = (
    e: React.MouseEvent,
    option: ReminderMenuOption | 'remove',
  ): void => {
    e.stopPropagation();
    setHideActionsUntilMouseLeave(true);
    setIsHovered(false);
    setIsReminderDropdownOpen(false);

    if (!enableReminder) {
      return;
    }

    if (option === 'remove') {
      void zero.mutate(
        mutators.bookmark.updateMetadata({
          entityId,
          entityType,
          metadata: removeReminderMetadata(bookmarkMetadata),
          timestamp: Date.now(),
        }),
      );
      return;
    }

    if (option === 'custom') {
      setIsCustomReminderModalOpen(true);
      return;
    }

    const remindAt = calculateReminderTime(option);
    if (!remindAt) return;
    applyReminderAt(remindAt);
  };

  const handleSaveCustomReminder = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!customReminderDate) {
      return;
    }

    const remindAt = calculateCustomReminderTime(customReminderDate, customReminderTime);
    if (remindAt.getTime() <= Date.now()) {
      toast.error('Please choose a future time for reminder');
      return;
    }
    applyReminderAt(remindAt);
    setIsCustomReminderModalOpen(false);
  };

  const reminderDatePickerId = `bookmark-reminder-date-${entityId}`;
  const reminderTimeSelectId = `bookmark-reminder-time-${entityId}`;
  const reminderDueInLabel = reminderAt ? formatReminderDueIn(reminderAt) : null;
  const isReminderOverdue = reminderDueInLabel === 'Overdue';
  const reminderActionLabel = reminderAt ? 'Edit reminder' : 'Set reminder';
  const isDirectMessageChannel =
    String(channel?.scopeType) === 'DM' || String(channel?.scopeType) === 'GROUP_DM';
  const isActionToolbarVisible =
    showActions &&
    !isMobile &&
    !hideActionsUntilMouseLeave &&
    (isHovered || isReminderDropdownOpen);

  return (
    <div
      onClick={handleClick}
      data-testid={`bookmark-item-${entityId}`}
      data-track-category='CHAT_BOOKMARK'
      data-track-name='Open_Bookmark'
      data-track-metadata={JSON.stringify({ entityId, entityType })}
      onKeyDown={(e): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
      onMouseEnter={(): void => setIsHovered(true)}
      onMouseLeave={(): void => {
        setIsHovered(false);
        setHideActionsUntilMouseLeave(false);
      }}
      className='relative block p-4 hover:bg-accent transition-colors duration-150 cursor-pointer border-b border-border'
      role='button'
      tabIndex={0}
    >
      {/* Reminder badge - shown in bottom right when reminder is active */}
      {reminderDueInLabel && !showChannelName && !isActionToolbarVisible && (
        <div className='absolute bottom-2 right-2 z-10'>
          <span
            className={
              isReminderOverdue
                ? 'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-red-600 text-white dark:bg-red-500'
                : 'text-xs font-medium text-red-600 dark:text-red-300'
            }
          >
            {reminderDueInLabel}
          </span>
        </div>
      )}

      {/* Action Toolbar - shown on hover, hidden on mobile */}
      {isActionToolbarVisible && (
        <div className='absolute top-2 right-2 z-10 flex items-center gap-1 bg-card border border-border rounded-md shadow-sm p-1'>
          <Tooltip content='Mark as done'>
            <Button
              variant='ghost'
              type='button'
              onClick={handleRemoveBookmark}
              className='p-1.5 rounded hover:bg-accent transition-colors duration-150'
              aria-label='Mark as done'
              data-testid='bookmark-mark-as-done-btn'
              trackId='mark_bookmark_done'
              data-track-category='CHAT_BOOKMARK'
              data-track-name='Mark_Bookmark_Done'
              data-track-metadata={JSON.stringify({ entityId })}
            >
              <Check size={16} className='text-muted-foreground' strokeWidth={1.33} />
            </Button>
          </Tooltip>
          <Tooltip content={reminderActionLabel}>
            <div>
              <DropdownMenu open={isReminderDropdownOpen} onOpenChange={setIsReminderDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    onClick={handleReminderClick}
                    className='p-1.5 rounded hover:bg-accent transition-colors duration-150'
                    aria-label={reminderActionLabel}
                    data-track-category='CHAT_BOOKMARK'
                    data-track-name='Open_Reminder_Menu'
                    data-track-metadata={JSON.stringify({ entityId })}
                  >
                    <Clock size={16} className='text-foreground' strokeWidth={1.33} />
                  </button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align='end' side='bottom' className='w-[200px]'>
                  {BOOKMARK_REMINDER_MENU_OPTIONS.map(option => (
                    <DropdownMenuItem
                      key={option.option}
                      onClick={(e): void => {
                        handleReminderOption(e, option.option);
                      }}
                      data-track-category='CHAT_BOOKMARK'
                      data-track-name={REMINDER_TRACK_NAME_BY_OPTION[option.option]}
                      data-track-metadata={JSON.stringify({ entityId })}
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                  {reminderDueInLabel && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e): void => {
                          handleReminderOption(e, 'remove');
                        }}
                        data-track-category='CHAT_BOOKMARK'
                        data-track-name='Remove_Bookmark_Reminder'
                        data-track-metadata={JSON.stringify({ entityId })}
                      >
                        Remove reminder
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Tooltip>
        </div>
      )}

      <Dialog
        open={isCustomReminderModalOpen}
        onOpenChange={setIsCustomReminderModalOpen}
        title='Reminder'
        description='Set a reminder for this bookmarked message'
      >
        <div className='p-6 space-y-4'>
          <div className='flex items-center justify-between'>
            <h3 className='text-lg font-semibold text-foreground'>Reminder</h3>
            <button
              type='button'
              className='rounded-sm opacity-70 transition-opacity hover:opacity-100'
              onClick={() => setIsCustomReminderModalOpen(false)}
              data-track-category='CHAT_BOOKMARK'
              data-track-name='Close_Custom_Reminder_Modal'
              data-track-metadata={JSON.stringify({ entityId })}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </button>
          </div>
          <div className='space-y-2'>
            <label htmlFor={reminderDatePickerId} className='text-sm font-medium text-foreground'>
              When
            </label>
            <DatePicker
              id={reminderDatePickerId}
              selectedDate={customReminderDate}
              onSelect={setCustomReminderDate}
              placeholder='Select date'
              minDate={new Date(new Date().setHours(0, 0, 0, 0))}
              inputClassName='w-full !h-9'
              showClearButton={false}
            />
          </div>

          <div className='space-y-2'>
            <label htmlFor={reminderTimeSelectId} className='text-sm font-medium text-foreground'>
              Time
            </label>
            <Select
              value={customReminderTime}
              onValueChange={value => setCustomReminderTime(value)}
            >
              <SelectTrigger id={reminderTimeSelectId} className='w-full'>
                <SelectValue placeholder='Select time' />
              </SelectTrigger>
              <SelectContent showScrollButtons={false}>
                {REMINDER_TIME_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='outline'
              onClick={(e): void => {
                e.stopPropagation();
                setIsCustomReminderModalOpen(false);
              }}
              data-track-category='CHAT_BOOKMARK'
              data-track-name='OPEN_CUSTOM_REMINDER'
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveCustomReminder}
              trackId='save_bookmark_reminder'
              data-track-category='CHAT_BOOKMARK'
              data-track-name='SAVE_CUSTOM_REMINDER'
              disabled={!customReminderDate}
            >
              Save
            </Button>
          </div>
        </div>
      </Dialog>

      <div className={showChannelName ? 'space-y-2' : 'flex gap-3'}>
        {/* Channel/DM Name with Time - First Line (only if showChannelName is true) */}
        {showChannelName && (
          <div className='flex items-center justify-between gap-2'>
            <div className='flex items-center gap-1.5 min-w-0'>
              {reminderDueInLabel && (
                <>
                  <span
                    className={
                      isReminderOverdue
                        ? 'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-red-600 text-white dark:bg-red-500 flex-shrink-0'
                        : 'text-xs font-medium text-red-600 dark:text-red-300 flex-shrink-0'
                    }
                  >
                    {reminderDueInLabel}
                  </span>
                  <span className='text-xs text-muted-foreground flex-shrink-0'>&bull;</span>
                </>
              )}
              <span
                className={`truncate font-inter ${
                  isDirectMessageChannel
                    ? 'text-[13px] font-medium text-muted-foreground leading-normal'
                    : 'text-sm text-muted-foreground'
                }`}
              >
                {isDirectMessageChannel
                  ? 'Direct Message'
                  : `#${channel?.name || 'Unknown Channel'}`}
              </span>
            </div>
          </div>
        )}

        {/* Avatar */}
        {!showChannelName && (
          <div className='flex-shrink-0'>
            <Avatar userId={message.senderId || ''} size='md' />
          </div>
        )}

        {/* Content */}
        <div className='flex-1 min-w-0'>
          {showChannelName && (
            <div className='flex gap-3'>
              {/* Avatar */}
              <div className='flex-shrink-0'>
                <Avatar userId={message.senderId || ''} size='md' />
              </div>

              {/* User name and message */}
              <div className='flex-1 min-w-0'>
                {/* User name */}
                <div className='text-[13.5px] font-semibold text-foreground leading-[100%] truncate mb-1 font-inter'>
                  {sender?.name || 'Unknown User'}
                </div>

                {/* Message preview */}
                <div className='text-sm text-muted-foreground whitespace-normal break-all'>
                  <RenderMessageWithHTML message={message.content} />
                </div>
              </div>
            </div>
          )}

          {!showChannelName && (
            <>
              {/* Header */}
              <div className='flex items-baseline justify-between gap-2 mb-1'>
                <span className='text-sm font-semibold text-foreground truncate'>
                  {sender?.name || 'Unknown User'}
                </span>
                <span className='text-xs text-muted-foreground flex-shrink-0 ml-auto'>
                  {formatDateWithTime(message.createdAt)}
                </span>
              </div>

              {/* Message preview */}
              <div className='text-sm text-muted-foreground line-clamp-2'>
                <RenderMessageWithHTML message={message.content} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
