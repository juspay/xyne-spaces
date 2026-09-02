import React, { useState, useEffect } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import EmojiPicker, { EmojiStyle, Theme, EmojiClickData } from 'emoji-picker-react';
import { Check, ChevronDown, SmilePlus, X } from 'lucide-react';
import { Dialog } from '../ui/Dialog/Dialog';
import { Button } from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import { DatePicker } from '../ui/DatePicker/DatePicker';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { DEFAULT_STATUS_EMOJI, EXPIRY_OPTIONS, calculateExpiryTime } from '../../utils/statusUtils';
import { v4 as uuidv4 } from 'uuid';
import { useCustomEmojis } from '../../hooks/useCustomEmojis';
import { useTheme } from '../../hooks/useTheme';
import { renderEmoji } from '../../utils/customEmojiUtils';
import { usePlatform } from '../../hooks/usePlatform';

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

interface UpdateStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentStatus?: {
    emoji: string;
    content: string;
    expiryAt: number | null;
  } | null;
}

export const UpdateStatusModal: React.FC<UpdateStatusModalProps> = ({
  isOpen,
  onClose,
  currentStatus,
}) => {
  const zero = useZero();
  const { data: customEmojis } = useCustomEmojis();
  const { theme } = useTheme();
  const emojiPickerTheme = theme === 'midnight' ? Theme.DARK : Theme.LIGHT;
  const [statusText, setStatusText] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState<string | undefined>(undefined);
  const [isEmojiAutoAssigned, setIsEmojiAutoAssigned] = useState(false);
  const [expiryOption, setExpiryOption] = useState('today');
  const [customDate, setCustomDate] = useState<Date | undefined>(new Date());
  const [customTime, setCustomTime] = useState('23:59');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [hasExistingStatus, setHasExistingStatus] = useState(false);
  const [recentStatuses, setRecentStatuses] = useState<RecentStatus[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  // Show suggestions when statusText is empty AND no emoji is selected
  const showSuggestions = statusText.trim() === '' && !selectedEmoji;

  // Determine if we're in editing mode
  const isEditingMode = statusText.trim() !== '' || selectedEmoji !== null || hasExistingStatus;

  // Load recent statuses on mount
  useEffect(() => {
    if (isOpen) {
      setRecentStatuses(getRecentStatuses());
    }
  }, [isOpen]);

  // Initialize with current status if exists
  useEffect(() => {
    if (currentStatus) {
      setStatusText(currentStatus.content || '');
      setSelectedEmoji(currentStatus.emoji);
      setIsEmojiAutoAssigned(false);
      setHasExistingStatus(true);
    } else {
      setStatusText('');
      setSelectedEmoji(undefined);
      setIsEmojiAutoAssigned(false);
      setHasExistingStatus(false);
      setExpiryOption('today');
      setCustomDate(new Date());
    }
  }, [currentStatus, isOpen]);

  // Maintain focus on input when view changes
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [showSuggestions]);

  // Show date picker when custom option is selected
  useEffect(() => {
    setShowDatePicker(expiryOption === 'custom');
    // Set default date to today when switching to custom option
    if (expiryOption === 'custom' && !customDate) {
      setCustomDate(new Date());
    }
  }, [expiryOption, customDate]);

  const handleEmojiSelect = (emojiData: EmojiClickData): void => {
    // For custom emojis, store as custom:{emojiId}:{name} format
    // For native emojis, store the emoji character directly
    let emojiValue: string;
    if (emojiData.isCustom) {
      // Custom emoji: emojiData.emoji contains the ID, names[0] contains the name
      const emojiId = emojiData.emoji;
      const name = emojiData.names[0] || emojiId;
      emojiValue = `custom:${emojiId}:${name}`;
    } else {
      // Native emoji: use the emoji character
      emojiValue = emojiData.emoji;
    }
    setSelectedEmoji(emojiValue);
    setIsEmojiAutoAssigned(false); // User manually selected emoji
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
      onClose();
      return;
    }

    // Otherwise, update the status with the provided values
    // Combine custom date and time
    let customDateTime: Date | undefined;
    if (expiryOption === 'custom' && customDate) {
      customDateTime = new Date(customDate);
      const [hoursStr, minutesStr] = customTime.split(':');
      const hours = parseInt(hoursStr || '', 10);
      const minutes = parseInt(minutesStr || '', 10);

      // Default to 23:59 if parsing fails (e.g., for empty input)
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
    onClose();
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
  };

  const handleClearStatus = (): void => {
    // Mutate to clear the status completely
    zero.mutate(
      mutators.userPresence.upsert({
        statusEmoji: null,
        statusContent: null,
        statusExpiryAt: null,
        timestamp: Date.now(),
        presenceId: uuidv4(),
      }),
    );

    setStatusText('');
    setSelectedEmoji(undefined);
    setIsEmojiAutoAssigned(false);
    setHasExistingStatus(false);
  };

  const handleSuggestionClick = (emoji: string, text: string, expiry: string): void => {
    setSelectedEmoji(emoji);
    setStatusText(text);
    setExpiryOption(expiry);
    setIsEmojiAutoAssigned(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose} className='max-w-lg rounded-2xl'>
      <div className='p-6 space-y-4'>
        <div className='flex items-center justify-between'>
          <h2 className='text-lg text-foreground font-semibold' data-testid='update-status-title'>
            Set a status
          </h2>
          <Button
            variant='ghost'
            size='sm'
            onClick={onClose}
            className='size-7 p-0 text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted'
            data-track-category='Update_User_Status_Modal'
            data-track-name='Close_Status_Modal'
          >
            <X className='size-4' />
          </Button>
        </div>

        {/* Show suggestions view or editing view */}
        {showSuggestions ? (
          <div className='space-y-4'>
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
                        customEmojis={customEmojis || []}
                        previewConfig={{ showPreview: true }}
                      />
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              <Input
                ref={inputRef}
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
                      onClick={() =>
                        handleSuggestionClick(status.emoji, status.text, status.expiry)
                      }
                      className='w-full flex items-center gap-3 px-2 py-0.5 rounded-md hover:bg-muted transition-colors text-left'
                      data-track-category='Update_User_Status_Modal'
                      data-track-name='Select_Recent_Status'
                      data-track-metadata={JSON.stringify({
                        statusText: status.text,
                        expiry: status.expiry,
                      })}
                    >
                      <span className='text-lg'>{renderEmoji(status.emoji)}</span>
                      <span className='text-sm text-foreground'>{status.text}</span>
                      <span className='text-xs text-muted-foreground'>-</span>
                      <span className='text-xs text-muted-foreground'>
                        {EXPIRY_OPTIONS.find(opt => opt.value === status.expiry)?.label ||
                          status.expiry}
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
                    data-track-category='Update_User_Status_Modal'
                    data-track-name='Select_Status_Suggestion'
                    data-track-metadata={JSON.stringify({
                      statusText: suggestion.text,
                      expiry: suggestion.expiry,
                    })}
                    data-testid='status-suggestion'
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
        ) : (
          <div className='space-y-4'>
            {/* Input field with status */}
            <div className='relative flex items-center gap-2 px-3 py-2 rounded-lg border border-input bg-background'>
              <Popover.Root open={emojiPickerOpen} modal={true} onOpenChange={setEmojiPickerOpen}>
                <Popover.Trigger asChild>
                  <button className='flex-shrink-0 text-muted-foreground hover:text-muted-foreground'>
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
                        customEmojis={customEmojis || []}
                        previewConfig={{ showPreview: true }}
                      />
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              <input
                ref={inputRef}
                type='text'
                value={statusText}
                onChange={handleTextChange}
                placeholder='Update your status'
                className='flex-1 bg-transparent border-none outline-none text-sm text-foreground'
                maxLength={100}
                data-track-event='blur'
                data-track-category='Update_User_Status_Modal'
                data-track-name='Status_Text_Input'
                autoFocus={!isMobile}
              />

              {isEditingMode && (
                <Button
                  variant='ghost'
                  onClick={handleClearStatus}
                  trackId='clear_user_status'
                  className='h-auto p-0 flex-shrink-0 flex items-center gap-1 text-muted-foreground hover:text-muted-foreground hover:bg-transparent'
                  data-track-category='Update_User_Status_Modal'
                  data-track-name='Clear_Status_In_Modal'
                >
                  <span className='text-xs opacity-60'>(Clear status)</span>
                  <X className='size-4' />
                </Button>
              )}
            </div>

            {/* Remove status after dropdown */}
            <div className='space-y-2'>
              <span className='text-sm font-medium text-foreground'>Remove status after</span>
              <Select.Root value={expiryOption} onValueChange={setExpiryOption}>
                <Select.Trigger className='w-full flex items-center justify-between px-3 py-2 rounded-lg border border-input text-foreground hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring'>
                  <Select.Value />
                  <Select.Icon>
                    <ChevronDown className='size-4' />
                  </Select.Icon>
                </Select.Trigger>

                <Select.Portal>
                  <Select.Content
                    position='popper'
                    sideOffset={4}
                    className='bg-background rounded-lg border border-border shadow-lg overflow-hidden z-50 w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)]'
                  >
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
                onClick={onClose}
                className='text-foreground hover:bg-muted'
                data-track-category='Update_User_Status_Modal'
                data-track-name='Cancel_Status_Update'
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  void handleSave();
                }}
                trackId='save_user_status'
                disabled={!selectedEmoji && !statusText.trim()}
                className='ml-auto px-6 bg-action-primary text-action-primary-foreground hover:bg-action-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
                data-track-category='Update_User_Status_Modal'
                data-track-name='Save_Status'
                data-track-metadata={JSON.stringify({ statusText, expiryOption })}
                data-testid='update-status-save-btn'
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
};
