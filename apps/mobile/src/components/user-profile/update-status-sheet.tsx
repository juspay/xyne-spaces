import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardController } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Calendar, Check, Clock, SmilePlus, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { v4 as uuidv4 } from 'uuid';

import { BottomSheet } from '@/src/components/ui/bottom-sheet';
import { EmojiPickerBottomSheet, type EmojiPickerSelection } from '@/src/components/emoji-picker';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { useClearOwnStatus } from '@/src/hooks/useClearOwnStatus';
import { useZero } from '@/src/hooks/useZero';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import { Event, logger } from '@/src/utils/logger';
import {
  formatDate,
  formatTime,
  initialCustomTime,
  mergeDatePart,
  mergeTimePart,
  type PickerMode,
} from '@/src/utils/timeSelection';
import { showMessageToast } from '@/src/utils/toast';
import { mutators } from '@/src/zero/mutators';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';

import {
  calculateExpiryTime,
  DEFAULT_EXPIRY_OPTION,
  deriveExpiryOption,
  EXPIRY_OPTIONS,
  normalizeExpiryOption,
  type ExpiryOption,
} from './status-expiry';

const RECENT_STATUSES_KEY = 'lotus_recent_statuses';
const DEFAULT_STATUS_EMOJI = '💬';

/** Scale applied to the status sheet chrome while the emoji picker is open (iOS-style stack). */
const STATUS_SHEET_STACK_SCALE = 0.94;
const STATUS_SHEET_STACK_ANIM_MS = 280;

const STATUS_SUGGESTIONS = [
  { emoji: '📅', text: 'In a meeting', expiry: '1hour' as const },
  { emoji: '🚌', text: 'Commuting', expiry: '30min' as const },
  { emoji: '🤒', text: 'Out Sick', expiry: 'today' as const },
  { emoji: '🌴', text: 'Vacationing', expiry: 'dont-clear' as const },
  { emoji: '🏡', text: 'Working remotely', expiry: 'today' as const },
] as const;

type RecentStatus = {
  emoji: string;
  text: string;
  expiry: ExpiryOption;
};

type CurrentStatus = {
  emoji: string | null;
  content: string | null;
  expiryAt?: number | null | undefined;
};

type ComposerBaseline = {
  text: string;
  emoji: string | null;
  expiry: ExpiryOption;
  customExpiryAtMs: number;
};

type UpdateStatusSheetProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentStatus: CurrentStatus | null;
  presentation?: 'sheet' | 'page';
  onBack?: (() => void) | undefined;
};

async function loadRecentStatuses(): Promise<RecentStatus[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_STATUSES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): RecentStatus[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { emoji, text, expiry } = entry as Record<string, unknown>;
      if (typeof emoji !== 'string' || typeof text !== 'string') return [];
      return [{ emoji, text, expiry: normalizeExpiryOption(expiry) }];
    });
  } catch {
    return [];
  }
}

async function saveRecentStatus(emoji: string, text: string, expiry: ExpiryOption): Promise<void> {
  try {
    const recent = await loadRecentStatuses();
    const deduped = recent.filter(item => !(item.emoji === emoji && item.text === text));
    const next = [{ emoji, text, expiry }, ...deduped].slice(0, 4);
    await AsyncStorage.setItem(RECENT_STATUSES_KEY, JSON.stringify(next));
  } catch {
    /* cache best-effort */
  }
}

// --- Presentational fragments (keeps the modal body readable) ---

type SheetChromeProps = {
  title: string;
  handleSave: () => void;
  disabled: boolean;
  presentation?: 'sheet' | 'page';
  onBack?: (() => void) | undefined;
};

function StatusSheetHeader({
  title,
  handleSave,
  disabled,
  presentation = 'sheet',
  onBack,
}: SheetChromeProps): ReactElement {
  const foreground = useCSSVariable('--color-foreground') as string;

  // Both presentations render their own Save button; share one haptic wrapper
  // so saving feels identical in the sheet and the full-page variant.
  const handleSaveWithHaptic = (): void => {
    void haptics.success();
    handleSave();
  };

  if (presentation === 'page') {
    return (
      <View className='min-h-14 flex-row items-center gap-2 border-b border-settings-row-divider px-2'>
        <HeaderBackButton liquidGlass onPress={() => onBack?.()} iconColor={foreground} />
        <Text
          className='min-w-0 flex-1 text-[20px] font-semibold text-foreground'
          numberOfLines={1}
        >
          {title}
        </Text>
        <Pressable
          onPress={handleSaveWithHaptic}
          accessibilityRole='button'
          accessibilityLabel='Save status'
          disabled={disabled}
          className={`rounded-full px-3 py-2 ${disabled ? 'opacity-40' : 'active:opacity-60'}`}
        >
          <Text className='text-sm font-semibold text-foreground'>Save</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className='mb-4 mt-1 flex-row items-center justify-between'>
      <Text className='text-xl font-semibold text-foreground'>{title}</Text>
      <Pressable
        onPress={handleSaveWithHaptic}
        className={`rounded-full p-1 ${disabled ? 'opacity-40' : ''}`}
        accessibilityRole='button'
        disabled={disabled}
      >
        <Text className='text-sm font-semibold text-foreground'>Save</Text>
      </Pressable>
    </View>
  );
}

type StatusComposerRowProps = {
  foreground: string;
  statusText: string;
  selectedEmoji: string | null;
  onChangeText: (t: string) => void;
  onOpenEmojiPicker: () => void;
  onClear: () => void;
  showClear: boolean;
};

function StatusComposerRow({
  foreground,
  statusText,
  selectedEmoji,
  onChangeText,
  onOpenEmojiPicker,
  onClear,
  showClear,
}: StatusComposerRowProps): ReactElement {
  return (
    <View className='mb-4 flex-row items-center rounded-xl border border-border bg-card px-3'>
      <Pressable
        onPress={() => {
          void haptics.buttonTap();
          onOpenEmojiPicker();
        }}
        className='mr-2 h-9 w-9 items-center justify-center rounded-full'
        accessibilityRole='button'
        accessibilityLabel='Choose status emoji'
      >
        {selectedEmoji ? (
          <ReactionEmojiDisplay emojiName={selectedEmoji} />
        ) : (
          <SmilePlus size={18} color={foreground} />
        )}
      </Pressable>
      <TextInput
        className='flex-1 py-3 text-base text-foreground'
        placeholder='Update your status'
        placeholderTextColor={foreground + '80'}
        value={statusText}
        onChangeText={onChangeText}
        maxLength={100}
      />
      {showClear ? (
        <Pressable
          onPress={() => {
            void haptics.buttonTap();
            onClear();
          }}
          className='ml-2 rounded-full p-1'
          accessibilityRole='button'
        >
          <X size={16} color={foreground} />
        </Pressable>
      ) : null}
    </View>
  );
}

type SuggestionListsProps = {
  recentStatuses: RecentStatus[];
  onPickStatus: (emoji: string, text: string, expiry: ExpiryOption) => void;
};

function StatusSuggestionLists({
  recentStatuses,
  onPickStatus,
}: SuggestionListsProps): ReactElement {
  return (
    <View className='gap-3'>
      {recentStatuses.length > 0 ? (
        <View>
          <Text className='mb-2 text-sm font-semibold text-foreground'>Recent</Text>
          <View className='gap-1'>
            {recentStatuses.map((status, index) => (
              <Pressable
                key={`${status.emoji}-${status.text}-${index}`}
                className='flex-row items-center gap-2 rounded-lg px-2 py-2 active:bg-muted'
                onPress={() => {
                  void haptics.selection();
                  onPickStatus(status.emoji, status.text, status.expiry);
                }}
              >
                <ReactionEmojiDisplay emojiName={status.emoji} />
                <Text className='text-sm text-foreground'>{status.text || 'No text'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View>
        <Text className='mb-2 text-sm font-semibold text-foreground'>For Juspay</Text>
        <View className='gap-1'>
          {STATUS_SUGGESTIONS.map(suggestion => (
            <Pressable
              key={suggestion.text}
              className='flex-row items-center gap-2 rounded-lg px-2 py-2 active:bg-muted'
              onPress={() => {
                void haptics.selection();
                onPickStatus(suggestion.emoji, suggestion.text, suggestion.expiry);
              }}
            >
              <Text className='text-lg'>{suggestion.emoji}</Text>
              <Text className='text-sm text-foreground'>{suggestion.text}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

type ExpiryFieldProps = {
  icon: ReactElement;
  label: string;
  value: string;
  isActive: boolean;
  hasTopBorder: boolean;
  onPress: () => void;
};

function ExpiryField({
  icon,
  label,
  value,
  isActive,
  hasTopBorder,
  onPress,
}: ExpiryFieldProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 px-4 py-4 active:bg-accent',
        isActive ? 'bg-accent' : '',
        hasTopBorder ? 'border-t border-border' : '',
      )}
    >
      {icon}
      <Text className='flex-1 text-[15px] text-foreground/70'>{label}</Text>
      <Text className='text-[16px] font-medium text-foreground'>{value}</Text>
    </Pressable>
  );
}

type ExpiryPickerProps = {
  expiryOption: ExpiryOption;
  onChange: (value: ExpiryOption) => void;
  customExpiryAt: Date;
  pickerMode: PickerMode;
  onPickerModeChange: (mode: PickerMode) => void;
  onCustomChange: (event: DateTimePickerEvent, selectedDate?: Date) => void;
};

function StatusExpiryPicker({
  expiryOption,
  onChange,
  customExpiryAt,
  pickerMode,
  onPickerModeChange,
  onCustomChange,
}: ExpiryPickerProps): ReactElement {
  const { accentSoft, accentText } = useBubbleAccent();
  const borderColor = useCSSVariable('--color-border') as string;
  const cardColor = useCSSVariable('--color-card') as string;
  const foreground = useCSSVariable('--color-foreground') as string;

  // Never hand DateTimePicker a past value while minimumDate is now — iOS silently snaps
  // to the minimum and the displayed value desyncs from state.
  const pickerValue = customExpiryAt.getTime() > Date.now() ? customExpiryAt : initialCustomTime();

  const togglePicker = (mode: Exclude<PickerMode, null>): void => {
    void haptics.buttonTap();
    void KeyboardController.dismiss();
    onPickerModeChange(pickerMode === mode ? null : mode);
  };

  return (
    <View>
      <Text className='mb-2 text-sm font-semibold text-foreground'>Remove status after</Text>
      <View className='mb-5 flex-row flex-wrap gap-2'>
        {EXPIRY_OPTIONS.map(option => (
          <Pressable
            key={option.value}
            onPress={() => {
              if (option.value !== expiryOption) void haptics.selection();
              onChange(option.value);
            }}
            accessibilityRole='button'
            accessibilityState={{ selected: expiryOption === option.value }}
            className='rounded-full border px-3 py-1.5'
            style={
              expiryOption === option.value
                ? { borderColor: accentText, backgroundColor: accentSoft }
                : { borderColor: borderColor, backgroundColor: cardColor }
            }
          >
            <Text className='text-sm text-foreground'>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {expiryOption === 'custom' ? (
        <View className='mb-5'>
          <View className='overflow-hidden rounded-2xl border' style={{ borderColor }}>
            <ExpiryField
              icon={<Calendar size={18} color={foreground} />}
              label='Date'
              value={formatDate(customExpiryAt)}
              isActive={pickerMode === 'date'}
              hasTopBorder={false}
              onPress={() => togglePicker('date')}
            />
            <ExpiryField
              icon={<Clock size={18} color={foreground} />}
              label='Time'
              value={formatTime(customExpiryAt)}
              isActive={pickerMode === 'time'}
              hasTopBorder
              onPress={() => togglePicker('time')}
            />
          </View>

          {pickerMode ? (
            <View className='mt-3 overflow-hidden rounded-2xl bg-card'>
              <DateTimePicker
                value={pickerValue}
                mode={pickerMode}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                {...(pickerMode === 'date' ? { minimumDate: new Date() } : {})}
                onChange={onCustomChange}
                {...(accentText ? { accentColor: accentText } : {})}
              />
              {Platform.OS === 'ios' ? (
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel='Done selecting status expiry'
                  onPress={() => {
                    void haptics.buttonTap();
                    onPickerModeChange(null);
                  }}
                  className='items-center border-t border-foreground/10 py-3 active:opacity-70'
                >
                  <View className='flex-row items-center gap-1.5'>
                    <Check size={16} color={foreground} strokeWidth={2.5} />
                    <Text className='text-[15px] font-medium text-foreground'>Done</Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// --- Root modal ---

const UpdateStatusSheet = ({
  isOpen,
  onOpenChange,
  currentStatus,
  presentation = 'sheet',
  onBack,
}: UpdateStatusSheetProps): ReactElement => {
  const zero = useZero();
  const clearOwnStatus = useClearOwnStatus();
  const foreground = useCSSVariable('--color-foreground') as string;

  const [statusText, setStatusText] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);
  const [expiryOption, setExpiryOption] = useState<ExpiryOption>(DEFAULT_EXPIRY_OPTION);
  const [customExpiryAt, setCustomExpiryAt] = useState<Date>(() => initialCustomTime());
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [recentStatuses, setRecentStatuses] = useState<RecentStatus[]>([]);
  const [isEmojiAutoAssigned, setIsEmojiAutoAssigned] = useState(false);
  const [composerBaseline, setComposerBaseline] = useState<ComposerBaseline>({
    text: '',
    emoji: null,
    expiry: DEFAULT_EXPIRY_OPTION,
    customExpiryAtMs: 0,
  });
  const wasOpenRef = useRef(false);

  const statusSheetStackScale = useSharedValue(1);
  const statusSheetStackTranslateY = useSharedValue(0);

  useEffect(() => {
    if (!isOpen) {
      setEmojiPickerOpen(false);
      statusSheetStackScale.value = 1;
      statusSheetStackTranslateY.value = 0;
      return;
    }
    statusSheetStackScale.value = withTiming(emojiPickerOpen ? STATUS_SHEET_STACK_SCALE : 1, {
      duration: STATUS_SHEET_STACK_ANIM_MS,
    });
    statusSheetStackTranslateY.value = withTiming(emojiPickerOpen ? 32 : 0, {
      duration: STATUS_SHEET_STACK_ANIM_MS,
    });
  }, [isOpen, emojiPickerOpen, statusSheetStackScale, statusSheetStackTranslateY]);

  useEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!justOpened) return;

    // Seed the option and the custom instant from the saved status so reopening the sheet
    // and editing only the text can't silently rewrite an existing expiry.
    const hasStatus = Boolean(currentStatus?.emoji || currentStatus?.content);
    const derived = hasStatus
      ? deriveExpiryOption(currentStatus?.expiryAt)
      : { option: DEFAULT_EXPIRY_OPTION, customExpiryAt: null };
    // One call, shared by both the state and the baseline, so a millisecond boundary
    // between two calls can't spuriously enable Save on a freshly-opened sheet.
    const seededCustom = derived.customExpiryAt ?? initialCustomTime();

    const baseline: ComposerBaseline = {
      text: currentStatus?.content ?? '',
      emoji: currentStatus?.emoji ?? null,
      expiry: derived.option,
      customExpiryAtMs: seededCustom.getTime(),
    };
    setComposerBaseline(baseline);
    setStatusText(baseline.text);
    setSelectedEmoji(baseline.emoji);
    setExpiryOption(baseline.expiry);
    setCustomExpiryAt(seededCustom);
    setPickerMode(null);
    setIsEmojiAutoAssigned(false);
    void loadRecentStatuses().then(setRecentStatuses);
  }, [isOpen, currentStatus]);

  const hasComposerChanges = useMemo(
    () =>
      statusText.trim() !== composerBaseline.text.trim() ||
      selectedEmoji !== composerBaseline.emoji ||
      expiryOption !== composerBaseline.expiry ||
      (expiryOption === 'custom' && customExpiryAt.getTime() !== composerBaseline.customExpiryAtMs),
    [composerBaseline, customExpiryAt, expiryOption, selectedEmoji, statusText],
  );

  const showSuggestions = useMemo(
    () => statusText.trim().length === 0 && !selectedEmoji,
    [statusText, selectedEmoji],
  );

  const handleTextChange = (text: string): void => {
    setStatusText(text);
    if (text.trim().length > 0 && !selectedEmoji) {
      setSelectedEmoji(DEFAULT_STATUS_EMOJI);
      setIsEmojiAutoAssigned(true);
    }
    if (text.trim().length === 0 && isEmojiAutoAssigned) {
      setSelectedEmoji(null);
      setIsEmojiAutoAssigned(false);
    }
  };

  const handleSelectEmoji = (selection: EmojiPickerSelection): void => {
    setSelectedEmoji(selection.value);
    setIsEmojiAutoAssigned(false);
  };

  const handleExpiryChange = useCallback((value: ExpiryOption): void => {
    if (value === 'custom') {
      setCustomExpiryAt(current =>
        current.getTime() > Date.now() ? current : initialCustomTime(),
      );
    } else {
      setPickerMode(null);
    }
    setExpiryOption(value);
  }, []);

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date): void => {
      // Android renders a modal dialog: clearing the mode is what dismisses it, and it has
      // to happen before the 'set' guard so cancelling still closes it.
      if (Platform.OS === 'android') {
        setPickerMode(null);
      }
      if (event.type !== 'set' || !selectedDate || !pickerMode) return;

      setCustomExpiryAt(current =>
        pickerMode === 'date'
          ? mergeDatePart(current, selectedDate)
          : mergeTimePart(current, selectedDate),
      );
    },
    [pickerMode],
  );

  const clearStatus = useCallback(
    ({ closeSheet = false }: { closeSheet?: boolean } = {}): void => {
      try {
        clearOwnStatus();
        if (closeSheet) {
          onOpenChange(false);
        }
      } catch (err) {
        logger.error(Event.ZERO_MUTATION_ERROR, {
          context: 'UpdateStatusSheet',
          action: 'clear_status',
          error: err,
        });
      }
    },
    [clearOwnStatus, onOpenChange],
  );

  const handleSave = async (): Promise<void> => {
    if (!hasComposerChanges) return;

    void KeyboardController.dismiss();

    const trimmedText = statusText.trim();
    try {
      if (!trimmedText && !selectedEmoji) {
        clearStatus({ closeSheet: true });
        return;
      }

      const emoji = selectedEmoji;
      const expiryAt = calculateExpiryTime(expiryOption, customExpiryAt);

      // Nothing rejects a past expiry downstream — it would save and then be filtered out
      // at the next render, so the status would simply never appear.
      if (expiryAt !== null && expiryAt <= Date.now()) {
        void haptics.warning();
        Alert.alert('Choose a future time', 'Status expiry should be later than now.');
        return;
      }

      zero.mutate(
        mutators.userPresence.upsert({
          statusEmoji: emoji,
          statusContent: trimmedText.length > 0 ? trimmedText : null,
          statusExpiryAt: expiryAt,
          timestamp: Date.now(),
          presenceId: uuidv4(),
        }),
      );
      showMessageToast('Status updated', 'success');
      if (emoji) {
        await saveRecentStatus(emoji, trimmedText, expiryOption);
      }

      onOpenChange(false);
    } catch (err) {
      logger.error(Event.ZERO_MUTATION_ERROR, {
        context: 'UpdateStatusSheet',
        action: 'save_status',
        error: err,
      });
    }
  };

  const pickPreset = useCallback((emoji: string, text: string, expiry: ExpiryOption) => {
    setSelectedEmoji(emoji);
    setStatusText(text);
    setExpiryOption(expiry);
    // A recent status only remembers that it was custom, not when — the stored instant would
    // be in the past by now. Re-seed so the user sees an editable future date instead.
    if (expiry === 'custom') {
      setCustomExpiryAt(initialCustomTime());
    }
    setPickerMode(null);
    setIsEmojiAutoAssigned(false);
  }, []);

  const clearComposer = useCallback(() => {
    setStatusText('');
    setSelectedEmoji(null);
    setIsEmojiAutoAssigned(false);
    setExpiryOption(DEFAULT_EXPIRY_OPTION);
    setCustomExpiryAt(initialCustomTime());
    setPickerMode(null);
  }, []);

  const stackedStatusSheetWrapperStyle = useAnimatedStyle(() => {
    const s = statusSheetStackScale.value;
    const translateY = statusSheetStackTranslateY.value;
    return {
      flex: 1,
      justifyContent: 'flex-end',
      pointerEvents: 'box-none',
      transform: [{ scale: s }, { translateY }],
    };
  });

  const editorBody = (
    <>
      <StatusComposerRow
        foreground={foreground}
        statusText={statusText}
        selectedEmoji={selectedEmoji}
        onChangeText={handleTextChange}
        onOpenEmojiPicker={() => setEmojiPickerOpen(true)}
        onClear={clearComposer}
        showClear={statusText.length > 0 || selectedEmoji !== null}
      />

      {showSuggestions ? (
        <StatusSuggestionLists recentStatuses={recentStatuses} onPickStatus={pickPreset} />
      ) : (
        <StatusExpiryPicker
          expiryOption={expiryOption}
          onChange={handleExpiryChange}
          customExpiryAt={customExpiryAt}
          pickerMode={pickerMode}
          onPickerModeChange={setPickerMode}
          onCustomChange={handlePickerChange}
        />
      )}
    </>
  );

  if (presentation === 'page') {
    return (
      <View className='flex-1'>
        <StatusSheetHeader
          title='Set status'
          handleSave={() => {
            void handleSave();
          }}
          disabled={!hasComposerChanges}
          presentation='page'
          onBack={onBack}
        />
        <KeyboardAwareScrollView
          bottomOffset={24}
          keyboardShouldPersistTaps='handled'
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, paddingTop: 20 }}
        >
          {editorBody}
        </KeyboardAwareScrollView>
        <EmojiPickerBottomSheet
          isOpen={emojiPickerOpen}
          onOpenChange={setEmojiPickerOpen}
          onSelect={handleSelectEmoji}
        />
      </View>
    );
  }

  return (
    <>
      <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
        <BottomSheet.Portal>
          <BottomSheet.Overlay className='bg-black/45' />
          <Animated.View style={stackedStatusSheetWrapperStyle}>
            <BottomSheet.Content
              snapPoints={['80%']}
              index={0}
              enableDynamicSizing={false}
              enablePanDownToClose
              backgroundClassName='bg-card'
              handleIndicatorClassName='bg-foreground/35 w-[50px] h-1.5 rounded-full'
              contentContainerClassName='flex-1'
              keyboardBehavior='interactive'
              keyboardBlurBehavior='restore'
            >
              <BottomSheetScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, paddingTop: 8 }}
                keyboardShouldPersistTaps='handled'
              >
                <StatusSheetHeader
                  title='Set a status'
                  handleSave={() => {
                    void handleSave();
                  }}
                  disabled={!hasComposerChanges}
                />

                {editorBody}
              </BottomSheetScrollView>
            </BottomSheet.Content>
          </Animated.View>
        </BottomSheet.Portal>
      </BottomSheet>

      <EmojiPickerBottomSheet
        isOpen={emojiPickerOpen}
        onOpenChange={setEmojiPickerOpen}
        onSelect={handleSelectEmoji}
      />
    </>
  );
};

UpdateStatusSheet.displayName = 'UpdateStatusSheet';

export { UpdateStatusSheet };
