import React, { useState, useEffect } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { Check, ChevronDown, ChevronLeft, SmilePlus, X } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import {
  DEFAULT_STATUS_EMOJI,
  EXPIRY_OPTIONS,
  calculateExpiryTime,
} from '../../../utils/statusUtils';
import { v4 as uuidv4 } from 'uuid';
import { useSelf } from '../../../hooks/useUsers';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';
import { useTheme } from '../../../hooks/useTheme';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import { EmojiClickData } from 'emoji-picker-react';
import { usePlatform } from '../../../hooks/usePlatform';

// Hardcoded status suggestions
const STATUS_SUGGESTIONS = [
  { emoji: '📅', text: 'In a meeting', expiry: '1hour' },
  { emoji: '🚌', text: 'Commuting', expiry: '30min' },
  { emoji: '🤒', text: 'Out Sick', expiry: 'today' },
  { emoji: '🌴', text: 'Vacationing', expiry: 'dont-clear' },
  { emoji: '🏡', text: 'Working remotely', expiry: 'today' },
];

const RECENT_STATUSES_KEY = 'xyne_recent_statuses';

const getStartOfToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

interface RecentStatus {
  emoji: string;
  text: string;
  expiry: string;
}

const getRecentStatuses = (): RecentStatus[] => {
  try {
    const stored = localStorage.getItem(RECENT_STATUSES_KEY);
    return stored ? (JSON.parse(stored) as RecentStatus[]) : [];
  } catch {
    return [];
  }
};

const saveRecentStatus = (emoji: string, text: string, expiry: string): void => {
  try {
    const recent = getRecentStatuses();
    // Remove duplicate if exists
    const filtered = recent.filter(s => !(s.emoji === emoji && s.text === text));
    // Add new status at the beginning
    const updated = [{ emoji, text, expiry }, ...filtered].slice(0, 3); // Keep only 3
    localStorage.setItem(RECENT_STATUSES_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
};

type ViewType = 'default' | 'status-suggestions' | 'status-edit';

export interface SelectedStatusData {
  emoji?: string;
  text?: string;
  expiry?: string;
}

interface StatusViewProps {
  setView: (view: ViewType, data?: SelectedStatusData) => void;
}

interface StatusEditViewProps extends StatusViewProps {
  initialData?: SelectedStatusData;
}

// Status Suggestions View - Shows when user hasn't started typing
export const StatusSuggestionsView: React.FC<StatusViewProps> = ({ setView }) => {
  const [statusText, setStatusText] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState<string | undefined>(undefined);
  const { data: customEmojis } = useCustomEmojis();
  const { theme } = useTheme();
  const emojiPickerTheme = theme === 'midnight' ? Theme.DARK : Theme.LIGHT;
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [recentStatuses, setRecentStatuses] = useState<RecentStatus[]>([]);
  const { isMobile } = usePlatform();

  // Load recent statuses on mount
  useEffect(() => {
    setRecentStatuses(getRecentStatuses());
  }, []);

  const handleEmojiSelect = (emojiData: EmojiClickData): void => {
    let emojiValue: string;
    if (emojiData.isCustom) {
      const emojiId = emojiData.emoji;
      const name = emojiData.names[0] || emojiId;
      emojiValue = `custom:${emojiId}:${name}`;
    } else {
      emojiValue = emojiData.emoji;
    }
    setSelectedEmoji(emojiValue);
    setEmojiPickerOpen(false);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const newText = e.target.value;
    setStatusText(newText);

    // Auto-set default emoji if text exists but user hasn't selected an emoji
    const emojiToUse = newText.trim() && !selectedEmoji ? DEFAULT_STATUS_EMOJI : selectedEmoji;
    if (newText.trim() && !selectedEmoji) {
      setSelectedEmoji(emojiToUse);
    }

    // When user starts typing, switch to edit view with current data
    if (newText.trim() || selectedEmoji) {
      const data: SelectedStatusData = {
        text: newText,
        expiry: 'today',
      };
      if (emojiToUse) {
        data.emoji = emojiToUse;
      }
      setView('status-edit', data);
    }
  };

  const handleSuggestionClick = (emoji: string, text: string, expiry: string): void => {
    // Switch to edit view with pre-filled values
    setView('status-edit', { emoji, text, expiry });
  };

  return (
    <div className='space-y-4 p-6'>
      <div className='flex gap-2 items-center'>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => setView('default')}
          data-track-category='STATUS'
          data-track-name='BACK_TO_STATUS_DEFAULT'
          className='size-7 p-0 text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted'
        >
          <ChevronLeft className='size-4' />
        </Button>
        <h2 className='text-lg font-semibold'>Set a status</h2>
      </div>

      {/* Input field */}
      <div className='relative'>
        <Popover.Root open={emojiPickerOpen} modal={true} onOpenChange={setEmojiPickerOpen}>
          <Popover.Trigger asChild>
            <button className='absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground'>
              {selectedEmoji ? (
                <span className='text-lg'>{renderEmoji(selectedEmoji)}</span>
              ) : (
                <SmilePlus className='size-4' />
              )}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side='bottom'
              align='start'
              sideOffset={5}
              className='z-50 bg-background rounded-lg shadow-lg'
            >
              <div className='overflow-hidden rounded-lg'>
                <EmojiPicker
                  emojiStyle={EmojiStyle.NATIVE}
                  style={{
                    ['--epr-emoji-size' as string]: '22px',
                    ['--epr-emoji-gap' as string]: '4px',
                  }}
                  onEmojiClick={handleEmojiSelect}
                  width={320}
                  height={400}
                  theme={emojiPickerTheme}
                  lazyLoadEmojis={true}
                  searchPlaceHolder='Search emoji...'
                  previewConfig={{ showPreview: true }}
                  customEmojis={customEmojis || []}
                />
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <Input
          type='text'
          value={statusText}
          onChange={handleTextChange}
          placeholder='Update your status'
          className='w-full pl-10 text-foreground'
          maxLength={100}
          autoFocus={!isMobile}
        />
      </div>

      {/* Recent statuses */}
      {recentStatuses.length > 0 && (
        <div className='space-y-2'>
          <p className='text-sm font-medium text-foreground'>Recent</p>
          <div className='space-y-0.5'>
            {recentStatuses.map((status, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(status.emoji, status.text, status.expiry)}
                className='w-full flex items-center gap-3 px-2 py-0.5 rounded-md hover:bg-muted transition-colors text-left'
                data-track-category='STATUS'
                data-track-name='SelectRecentStatus'
                data-track-metadata={JSON.stringify({ emoji: status.emoji, text: status.text })}
              >
                <span className='text-lg'>{renderEmoji(status.emoji)}</span>
                <span className='text-sm text-foreground'>{status.text}</span>
                <span className='text-xs text-muted-foreground'>-</span>
                <span className='text-xs text-muted-foreground'>
                  {EXPIRY_OPTIONS.find(opt => opt.value === status.expiry)?.label || status.expiry}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      {recentStatuses.length > 0 && <div className='border-t border-border' />}

      {/* Hardcoded suggestions */}
      <div className='space-y-2'>
        <p className='text-sm font-medium text-foreground'>For Juspay</p>
        <div className='space-y-0.5'>
          {STATUS_SUGGESTIONS.map((suggestion, index) => (
            <button
              key={index}
              onClick={() =>
                handleSuggestionClick(suggestion.emoji, suggestion.text, suggestion.expiry)
              }
              className='w-full flex items-center gap-3 px-2 py-0.5 rounded-md hover:bg-muted transition-colors text-left'
              data-track-category='STATUS'
              data-track-name='SelectStatusSuggestion'
              data-track-metadata={JSON.stringify({
                emoji: suggestion.emoji,
                text: suggestion.text,
              })}
            >
              <span className='text-lg'>{renderEmoji(suggestion.emoji)}</span>
              <span className='text-sm text-foreground'>{suggestion.text}</span>
              <span className='text-xs text-muted-foreground'>-</span>
              <span className='text-xs text-muted-foreground'>
                {EXPIRY_OPTIONS.find(opt => opt.value === suggestion.expiry)?.label ||
                  suggestion.expiry}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// Status Edit View - Shows when user is editing status
export const StatusEditView: React.FC<StatusEditViewProps> = ({ setView, initialData }) => {
  const zero = useZero();
  const user = useSelf();
  const [statusText, setStatusText] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState<string | undefined>(undefined);
  const { data: customEmojis } = useCustomEmojis();
  const { theme } = useTheme();
  const emojiPickerTheme = theme === 'midnight' ? Theme.DARK : Theme.LIGHT;
  const [isEmojiAutoAssigned, setIsEmojiAutoAssigned] = useState(false);
  const [expiryOption, setExpiryOption] = useState('today');
  const [customDate, setCustomDate] = useState<Date | undefined>(new Date());
  const [customTime, setCustomTime] = useState('23:59');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const { isMobile } = usePlatform();

  // Initialize with initialData (from suggestions) or current status
  useEffect(() => {
    // Priority: initialData > current user status
    if (initialData?.emoji || initialData?.text || initialData?.expiry) {
      setStatusText(initialData.text || '');
      setSelectedEmoji(initialData.emoji || undefined);
      setExpiryOption(initialData.expiry || 'today');
      setIsEmojiAutoAssigned(false);
    } else {
      if (user?.statusEmoji || user?.statusContent) {
        setStatusText(user.statusContent || '');
        setSelectedEmoji(user.statusEmoji || undefined);
        setIsEmojiAutoAssigned(false);
      }
    }
  }, [initialData, user]);

  // Show date picker when custom option is selected
  useEffect(() => {
    setShowDatePicker(expiryOption === 'custom');
    if (expiryOption === 'custom' && !customDate) {
      setCustomDate(new Date());
    }
  }, [expiryOption, customDate]);

  const handleEmojiSelect = (emojiData: EmojiClickData): void => {
    let emojiValue: string;
    if (emojiData.isCustom) {
      const emojiId = emojiData.emoji;
      const name = emojiData.names[0] || emojiId;
      emojiValue = `custom:${emojiId}:${name}`;
    } else {
      emojiValue = emojiData.emoji;
    }
    setSelectedEmoji(emojiValue);
    setIsEmojiAutoAssigned(false);
    setEmojiPickerOpen(false);
  };

  const handleSave = (): void => {
    const statusTextTrimmed = statusText.trim();

    // If both emoji and content are empty, clear the status completely
    if (!selectedEmoji && !statusTextTrimmed) {
      zero.mutate(
        mutators.userPresence.upsert({
          statusEmoji: null,
          statusContent: null,
          statusExpiryAt: null,
          timestamp: Date.now(),
          presenceId: uuidv4(),
        }),
      );
      setView('default');
      return;
    }

    // Combine custom date and time
    let customDateTime: Date | undefined;
    if (expiryOption === 'custom' && customDate) {
      customDateTime = new Date(customDate);
      const [hoursStr, minutesStr] = customTime.split(':');
      const hours = parseInt(hoursStr || '', 10);
      const minutes = parseInt(minutesStr || '', 10);

      customDateTime.setHours(isNaN(hours) ? 23 : hours, isNaN(minutes) ? 59 : minutes, 0, 0);
    }

    const expiryAt = calculateExpiryTime(expiryOption, customDateTime);

    const updateParams: {
      statusEmoji?: string | null;
      statusContent?: string | null;
      statusExpiryAt?: number | null;
    } = {
      statusExpiryAt: expiryAt,
    };

    if (selectedEmoji) {
      updateParams.statusEmoji = selectedEmoji;
    } else {
      updateParams.statusEmoji = null;
    }

    if (statusTextTrimmed) {
      updateParams.statusContent = statusTextTrimmed;
    } else {
      updateParams.statusContent = null;
    }

    if (selectedEmoji) {
      saveRecentStatus(selectedEmoji, statusTextTrimmed || '', expiryOption);
    }

    zero.mutate(
      mutators.userPresence.upsert({
        ...updateParams,
        timestamp: Date.now(),
        presenceId: uuidv4(),
      }),
    );
    setView('default');
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const newText = e.target.value;
    setStatusText(newText);

    // Auto-set default emoji if text exists but user hasn't selected an emoji
    if (newText.trim() && !selectedEmoji) {
      setSelectedEmoji(DEFAULT_STATUS_EMOJI);
      setIsEmojiAutoAssigned(true);
    }

    // If user clears all text and emoji was auto-assigned, clear the emoji too
    if (!newText.trim() && isEmojiAutoAssigned) {
      setSelectedEmoji(undefined);
      setIsEmojiAutoAssigned(false);
    }

    // Go back to suggestions if both are empty
    if (!newText.trim() && !selectedEmoji) {
      setView('status-suggestions');
    }
  };

  const handleClearStatus = (): void => {
    setStatusText('');
    setSelectedEmoji(undefined);
    setIsEmojiAutoAssigned(false);
    setView('status-suggestions');
  };

  const isEditingMode = statusText.trim() !== '' || selectedEmoji !== null;

  return (
    <div className='space-y-4 p-6'>
      <div className='flex items-center justify-between'>
        <h2 className='text-lg font-semibold'>Set a status</h2>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => setView('default')}
          data-track-category='STATUS'
          data-track-name='BACK_TO_STATUS_DEFAULT'
          className='size-7 p-0 text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted'
        >
          <X className='size-4' />
        </Button>
      </div>

      <div className='relative flex items-center gap-2 px-3 py-2 rounded-lg border border-input bg-background'>
        <Popover.Root open={emojiPickerOpen} modal={true} onOpenChange={setEmojiPickerOpen}>
          <Popover.Trigger asChild>
            <button
              className='flex-shrink-0 text-muted-foreground hover:text-muted-foreground'
              data-track-category='STATUS'
              data-track-name='OpenEmojiPicker'
            >
              {selectedEmoji ? (
                <span className='text-lg'>{renderEmoji(selectedEmoji)}</span>
              ) : (
                <SmilePlus className='size-5' />
              )}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side='bottom'
              align='start'
              sideOffset={5}
              className='z-50 bg-background rounded-lg shadow-lg'
            >
              <div className='overflow-hidden rounded-lg'>
                <EmojiPicker
                  emojiStyle={EmojiStyle.NATIVE}
                  style={{
                    ['--epr-emoji-size' as string]: '22px',
                    ['--epr-emoji-gap' as string]: '4px',
                  }}
                  onEmojiClick={handleEmojiSelect}
                  width={320}
                  height={400}
                  theme={emojiPickerTheme}
                  lazyLoadEmojis={true}
                  searchPlaceHolder='Search emoji...'
                  previewConfig={{ showPreview: true }}
                  customEmojis={customEmojis || []}
                />
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <input
          type='text'
          value={statusText}
          onChange={handleTextChange}
          placeholder='Update your status'
          className='flex-1 bg-transparent border-none outline-none text-sm text-foreground'
          maxLength={100}
          data-track-category='STATUS'
          data-track-name='EditStatusText'
          autoFocus={!isMobile}
        />

        {isEditingMode && (
          <button
            onClick={handleClearStatus}
            className='flex-shrink-0 text-muted-foreground hover:text-muted-foreground'
            data-track-category='STATUS'
            data-track-name='ClearStatus'
          >
            <X className='size-4' />
          </button>
        )}
      </div>

      {/* Remove status after dropdown */}
      <div className='space-y-2'>
        <span className='text-sm font-medium text-foreground'>Remove status after</span>
        <Select.Root value={expiryOption} onValueChange={setExpiryOption}>
          <Select.Trigger
            className='w-full flex items-center justify-between px-3 py-2 rounded-lg border border-input text-foreground hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring'
            data-track-category='STATUS'
            data-track-name='SelectExpiryOption'
          >
            <Select.Value />
            <Select.Icon>
              <ChevronDown className='size-4' />
            </Select.Icon>
          </Select.Trigger>

          <Select.Portal>
            <Select.Content className='bg-background rounded-lg border border-border shadow-lg overflow-hidden z-50'>
              <Select.Viewport className='p-1'>
                {EXPIRY_OPTIONS.map(option => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    className='relative flex items-center px-3 py-2 rounded-md text-sm text-foreground cursor-pointer hover:bg-muted outline-none select-none data-[highlighted]:bg-muted'
                  >
                    <Select.ItemText>{option.label}</Select.ItemText>
                    <Select.ItemIndicator className='absolute right-2'>
                      <Check className='size-4' />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      {/* Custom Date/Time Picker */}
      {showDatePicker && (
        <div className='flex items-center gap-2'>
          <DatePicker
            selectedDate={customDate ?? null}
            onSelect={date => setCustomDate(date ?? undefined)}
            minDate={getStartOfToday()}
            showClearButton={false}
            placeholder='Select date'
            inputClassName='h-9 flex-1 w-full'
            contentClassName='z-[100]'
          />

          <div className='px-3 py-2 border border-input rounded-lg bg-background'>
            <Input
              id='status-time-picker'
              type='time'
              value={customTime}
              onChange={e => setCustomTime(e.target.value)}
              className='w-24 border-none p-0 focus:ring-0'
            />
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className='flex gap-3 pt-2'>
        <Button
          variant='ghost'
          onClick={() => setView('default')}
          data-track-category='STATUS'
          data-track-name='CANCEL_SET_STATUS'
          className='text-foreground hover:bg-muted'
        >
          Cancel
        </Button>
        <Button
          onClick={() => {
            void handleSave();
          }}
          data-track-category='STATUS'
          data-track-name='SAVE_STATUS'
          disabled={!selectedEmoji && !statusText.trim()}
          className='ml-auto px-6 text-white disabled:opacity-50 disabled:cursor-not-allowed'
          style={{ backgroundColor: '#6276BE' }}
        >
          Save
        </Button>
      </div>
    </div>
  );
};
