import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { BookmarkEntityType } from '@xyne/shared';
import { useMemo, useState, type ReactElement } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useUserBookmarks } from '@/src/hooks/useUserBookmarks';
import { useZero } from '@/src/hooks/useZero';
import { haptics } from '@/src/utils/haptics';
import {
  CUSTOM_REMINDER_DEFAULT_DELAY_MS,
  REMINDER_PRESETS,
  buildReminderMessagePreview,
  isFutureReminder,
  mergeDatePart,
  mergeTimePart,
  type ReminderMetadataContext,
} from '../model/reminder';
import type { MessageActionsTarget } from './MessageActionsHost';
import { applyReminder } from './onReminder';

export type ReminderOptionsHostProps = {
  target: MessageActionsTarget | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const initialCustomTime = (): Date => {
  const date = new Date(Date.now() + CUSTOM_REMINDER_DEFAULT_DELAY_MS);
  date.setSeconds(0, 0);
  return date;
};

export function ReminderOptionsHost({
  target,
  isOpen,
  onOpenChange,
}: ReminderOptionsHostProps): ReactElement | null {
  const zero = useZero();
  const { getBookmarkByEntity } = useUserBookmarks({ enabled: isOpen });
  const [custom, setCustom] = useState<Date>(initialCustomTime);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const model = target?.row.model;
  const context = useMemo((): ReminderMetadataContext | null => {
    if (!target || !model?.messageId) {
      return null;
    }
    return {
      messagePreview: buildReminderMessagePreview(target.html, target.attachments.length > 0),
      conversationId: model.conversationId,
      initialMessageId: model.messageId,
      channelId: model.channelId,
      ...(target.threadId ? { threadId: target.threadId } : {}),
      senderName: model.sender.displayName,
    };
  }, [model, target]);

  if (!target || !model?.messageId || !context) {
    return null;
  }
  const messageId = model.messageId;

  const save = (remindAtMs: number): void => {
    if (!isFutureReminder(remindAtMs, Date.now())) {
      Alert.alert('Choose a future time', 'Reminder time should be later than now.');
      return;
    }
    applyReminder(
      { zero, createId: uuidv4, now: Date.now },
      {
        messageId,
        remindAtMs,
        existing: getBookmarkByEntity(messageId, BookmarkEntityType.MESSAGE) ?? null,
        context,
      },
    );
    void haptics.success();
    onOpenChange(false);
  };

  const onPicker = (event: DateTimePickerEvent, selected?: Date): void => {
    if (Platform.OS === 'android') {
      setPicker(null);
    }
    if (event.type !== 'set' || !selected || !picker) {
      return;
    }
    setCustom(current =>
      picker === 'date' ? mergeDatePart(current, selected) : mergeTimePart(current, selected),
    );
  };

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      mode='dynamic'
      backdropOpacity={0.42}
    >
      <BottomSheetScrollView>
        <View className='gap-2 px-4 pb-6 pt-1'>
          <Text className='pb-1 text-base font-semibold text-foreground'>Remind me</Text>
          {REMINDER_PRESETS.map(preset => (
            <Pressable
              key={preset.id}
              accessibilityRole='button'
              accessibilityLabel={preset.label}
              className='rounded-xl bg-accent px-4 py-3'
              onPress={(): void => save(preset.getTime())}
            >
              <Text className='text-base text-foreground'>{preset.label}</Text>
            </Pressable>
          ))}
          <Text className='pt-2 text-sm font-medium text-muted'>Custom</Text>
          <View className='flex-row gap-2'>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Pick date'
              className='flex-1 rounded-xl bg-accent px-4 py-3'
              onPress={(): void => setPicker('date')}
            >
              <Text className='text-center text-foreground'>
                {custom.toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  weekday: 'short',
                })}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Pick time'
              className='flex-1 rounded-xl bg-accent px-4 py-3'
              onPress={(): void => setPicker('time')}
            >
              <Text className='text-center text-foreground'>
                {custom.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Set custom reminder'
            className='rounded-xl bg-brand px-4 py-3'
            onPress={(): void => save(custom.getTime())}
          >
            <Text className='text-center font-semibold text-brand-foreground'>Set reminder</Text>
          </Pressable>
          {picker ? (
            <DateTimePicker
              value={custom}
              mode={picker}
              onChange={onPicker}
              minimumDate={new Date()}
            />
          ) : null}
        </View>
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}
