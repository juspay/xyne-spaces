import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { AlarmClock, Calendar, Check, Clock, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Alert, Keyboard, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { v4 as uuidv4 } from 'uuid';
import { haptics } from '@/src/utils/haptics';
import { BookmarkEntityType } from '@xyne/shared';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useUserBookmarks } from '@/src/hooks/useUserBookmarks';
import { useUser } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { cn } from '@/src/utils/cn';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import type { MessageActionsTarget } from './message-actions-target';
import {
  buildReminderMessagePreview,
  upsertReminderMetadataWithContext,
  type ReminderMetadataContext,
} from './message-reminder-utils';
import {
  CUSTOM_REMINDER_DEFAULT_DELAY_MS,
  REMINDER_PRESETS,
  type ReminderPreset,
} from './message-reminder-config';
import { HeaderBackButton, HeaderIconButton } from '@/src/components/ui/header-icon-button';

type MessageReminderOptionsSheetProps = {
  target: MessageActionsTarget | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId?: string | undefined;
};

type PickerMode = 'date' | 'time' | null;
type ReminderView = 'presets' | 'custom';

function initialCustomTime(): Date {
  const date = new Date(Date.now() + CUSTOM_REMINDER_DEFAULT_DELAY_MS);
  date.setSeconds(0, 0);
  return date;
}

function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
  });
}

function formatTime(value: Date): string {
  return value.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

const mergeDatePart = (current: Date, selected: Date): Date => {
  const next = new Date(current);
  next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  return next;
};

const mergeTimePart = (current: Date, selected: Date): Date => {
  const next = new Date(current);
  next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  return next;
};

export function MessageReminderOptionsSheet({
  target,
  isOpen,
  onOpenChange,
  currentUserId,
}: MessageReminderOptionsSheetProps): ReactElement {
  const zero = useZero();
  const { accentBg, accentFg } = useBubbleAccent();
  const insets = useSafeAreaInsets();
  const foreground = useCSSVariable('--color-foreground') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const border = useCSSVariable('--color-border') as string;
  const { getBookmarkByEntity } = useUserBookmarks({ enabled: isOpen });
  const sender = useUser(target?.message.senderId ?? '');

  const [view, setView] = useState<ReminderView>('presets');
  const [customDateTime, setCustomDateTime] = useState<Date>(() => initialCustomTime());
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);

  useEffect(() => {
    if (!isOpen) {
      setView('presets');
      setPickerMode(null);
      return;
    }
    setCustomDateTime(initialCustomTime());
  }, [isOpen]);

  const reminderContext = useMemo<ReminderMetadataContext | null>(() => {
    const message = target?.message;
    if (!target || !message) return null;

    const senderName =
      sender?.displayName ??
      sender?.name ??
      sender?.email ??
      (message.senderId === currentUserId ? 'You' : undefined);

    return {
      messagePreview: buildReminderMessagePreview(
        message.content,
        (message.attachments ?? []).length > 0 || !!message.hasAttachment,
      ),
      conversationId: target.conversationId,
      initialMessageId: message.messageId,
      channelId: target.channelId,
      ...(target.threadId ? { threadId: target.threadId } : {}),
      ...(target.channelName ? { channelName: target.channelName } : {}),
      ...(target.channelScopeType ? { channelScopeType: target.channelScopeType } : {}),
      ...(senderName ? { senderName } : {}),
    };
  }, [currentUserId, sender?.displayName, sender?.email, sender?.name, target]);

  const close = useCallback(() => {
    Keyboard.dismiss();
    setPickerMode(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const applyReminderAt = useCallback(
    (remindAtMs: number) => {
      const messageId = target?.message.messageId;
      if (!messageId || !reminderContext) return;

      const existingBookmark = getBookmarkByEntity(messageId, BookmarkEntityType.MESSAGE);
      const activeBookmark =
        existingBookmark && !existingBookmark.isDeleted && !existingBookmark.isCompleted
          ? existingBookmark
          : null;
      const metadata = upsertReminderMetadataWithContext(
        existingBookmark?.metadata,
        remindAtMs,
        reminderContext,
      );

      try {
        if (activeBookmark) {
          void zero.mutate(
            mutators.bookmark.updateMetadata({
              entityId: messageId,
              entityType: BookmarkEntityType.MESSAGE,
              metadata,
              timestamp: Date.now(),
            }),
          );
        } else {
          void zero.mutate(
            mutators.bookmark.add({
              entityId: messageId,
              entityType: BookmarkEntityType.MESSAGE,
              bookmarkId: uuidv4(),
              timestamp: Date.now(),
              metadata,
            }),
          );
        }
        void haptics.success();
        close();
      } catch {
        Alert.alert('Reminder failed', 'Please try again.');
      }
    },
    [close, getBookmarkByEntity, reminderContext, target?.message.messageId, zero],
  );

  const handlePresetPress = useCallback(
    (preset: ReminderPreset) => {
      applyReminderAt(preset.getTime());
    },
    [applyReminderAt],
  );

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === 'android') {
        setPickerMode(null);
      }
      if (event.type !== 'set' || !selectedDate || !pickerMode) return;

      setCustomDateTime(current =>
        pickerMode === 'date'
          ? mergeDatePart(current, selectedDate)
          : mergeTimePart(current, selectedDate),
      );
    },
    [pickerMode],
  );

  const handleApplyCustom = useCallback(() => {
    const remindAtMs = customDateTime.getTime();
    if (remindAtMs <= Date.now()) {
      Alert.alert('Choose a future time', 'Reminder time should be later than now.');
      return;
    }
    applyReminderAt(remindAtMs);
  }, [applyReminderAt, customDateTime]);

  const title = view === 'custom' ? 'Custom reminder' : 'Remind me';
  const pickerValue = customDateTime > new Date() ? customDateTime : initialCustomTime();

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={close}
      mode='dynamic'
      backdropOpacity={0.42}
      keyboardBehavior='extend'
    >
      <BottomSheetScrollView
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}
      >
        <View className='px-4 pb-2 pt-1'>
          <View className='mb-2 flex-row items-center'>
            {view === 'custom' ? (
              <View className='mr-1'>
                <HeaderBackButton
                  liquidGlass
                  accessibilityLabel='Back to reminder presets'
                  iconColor={foreground}
                  onPress={() => {
                    setPickerMode(null);
                    setView('presets');
                  }}
                />
              </View>
            ) : (
              <View className='mr-1 size-10 items-center justify-center'>
                <AlarmClock size={21} color={foreground} />
              </View>
            )}

            <Text className='flex-1 text-[18px] font-semibold text-foreground'>{title}</Text>
            <HeaderIconButton
              liquidGlass
              accessibilityLabel='Close reminder options'
              onPress={close}
            >
              <X size={20} color={foreground} />
            </HeaderIconButton>
          </View>

          {view === 'presets' ? (
            <View className='overflow-hidden rounded-2xl border' style={{ borderColor: border }}>
              {REMINDER_PRESETS.map((preset, index) => (
                <Pressable
                  key={preset.id}
                  accessibilityRole='button'
                  accessibilityLabel={preset.label}
                  onPress={() => handlePresetPress(preset)}
                  className={cn(
                    'flex-row items-center gap-3 px-4 py-4 active:bg-accent',
                    index > 0 ? 'border-t border-border' : '',
                  )}
                >
                  <Clock size={18} color={foreground} />
                  <Text className='flex-1 text-[16px] text-foreground'>{preset.label}</Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Custom reminder'
                onPress={() => setView('custom')}
                className='flex-row items-center gap-3 border-t border-border px-4 py-4 active:bg-accent'
              >
                <Calendar size={18} color={foreground} />
                <Text className='flex-1 text-[16px] text-foreground'>Custom...</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <View className='overflow-hidden rounded-2xl border' style={{ borderColor: border }}>
                <CustomField
                  icon={<Calendar size={18} color={foreground} />}
                  label='Date'
                  value={formatDate(customDateTime)}
                  isActive={pickerMode === 'date'}
                  onPress={() => setPickerMode(current => (current === 'date' ? null : 'date'))}
                />
                <CustomField
                  icon={<Clock size={18} color={foreground} />}
                  label='Time'
                  value={formatTime(customDateTime)}
                  isActive={pickerMode === 'time'}
                  onPress={() => setPickerMode(current => (current === 'time' ? null : 'time'))}
                />
              </View>

              {pickerMode ? (
                <View className='mt-3 overflow-hidden rounded-2xl bg-card'>
                  <DateTimePicker
                    value={pickerValue}
                    mode={pickerMode}
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    {...(pickerMode === 'date' ? { minimumDate: new Date() } : {})}
                    onChange={handlePickerChange}
                    {...(brand ? { accentColor: brand } : {})}
                  />
                  {Platform.OS === 'ios' ? (
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel='Done selecting reminder time'
                      onPress={() => setPickerMode(null)}
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

              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Apply custom reminder'
                onPress={handleApplyCustom}
                className='mt-4 h-12 items-center justify-center rounded-xl active:opacity-80'
                style={{ backgroundColor: accentBg }}
              >
                <Text className='text-[16px] font-semibold' style={{ color: accentFg }}>
                  Apply
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}

type CustomFieldProps = {
  icon: ReactElement;
  label: string;
  value: string;
  isActive: boolean;
  onPress: () => void;
};

function CustomField({ icon, label, value, isActive, onPress }: CustomFieldProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 px-4 py-4 active:bg-accent',
        isActive ? 'bg-accent' : '',
        label === 'Time' ? 'border-t border-border' : '',
      )}
    >
      {icon}
      <Text className='flex-1 text-[15px] text-foreground/70'>{label}</Text>
      <Text className='text-[16px] font-medium text-foreground'>{value}</Text>
    </Pressable>
  );
}
