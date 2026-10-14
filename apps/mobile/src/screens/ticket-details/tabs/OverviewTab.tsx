import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { CopyableValue } from '@/src/components/ui/copyable-value';
import { cn } from '@/src/utils/cn';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import type { MetaRow } from '../types';

type OverviewTabProps = {
  boardName: string;
  ticketShortId: string;
  title: string;
  statusDotClass: string;
  statusLabel: string;
  assigneeName: string;
  assigneeId?: string;
  dueDateShort: string;
  description: string;
  metaRows: MetaRow[];
  onSaveTitle: (title: string) => void;
  onSaveDescription: (description: string) => void;
  /** Extra top inset when embedded under absolute chrome (xyne-desk). */
  contentPaddingTop?: number;
};

export function OverviewTab({
  boardName,
  ticketShortId,
  title,
  statusDotClass,
  statusLabel,
  assigneeName,
  assigneeId,
  dueDateShort,
  description,
  metaRows,
  onSaveTitle,
  onSaveDescription,
  contentPaddingTop = 0,
}: OverviewTabProps): ReactElement {
  const insets = useSafeAreaInsets();
  const { accentText: actionPrimaryColor } = useBubbleAccent();
  const dueDateTextColor =
    (useCSSVariable('--color-ticket-overview-due-text') as string) || '#c2410c';
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [titleValue, setTitleValue] = useState(title);
  const [descriptionValue, setDescriptionValue] = useState(description);

  useEffect(() => {
    if (!editingTitle) {
      setTitleValue(title);
    }
  }, [title, editingTitle]);

  useEffect(() => {
    if (!editingDescription) {
      setDescriptionValue(description);
    }
  }, [description, editingDescription]);

  const commitTitle = (): void => {
    onSaveTitle(titleValue);
    setEditingTitle(false);
  };

  const commitDescription = (): void => {
    onSaveDescription(descriptionValue);
    setEditingDescription(false);
  };

  return (
    <ScrollView
      className='flex-1'
      contentContainerStyle={{
        paddingTop: contentPaddingTop,
        paddingBottom: Math.max(insets.bottom, 16),
      }}
    >
      <View className='px-4 py-4 gap-3 border-b border-ticket-overview-divider'>
        <View className='flex-row items-center gap-3'>
          <View className='px-2 py-1 rounded-full bg-ticket-overview-board-bg'>
            <Text className='text-xs font-semibold text-ticket-overview-board-text'>
              {boardName}
            </Text>
          </View>
          <CopyableValue
            value={ticketShortId}
            disabled={ticketShortId === '—'}
            textClassName='text-xs font-medium text-ticket-overview-id-text'
            copyAccessibilityLabel='Copy ticket ID'
          />
        </View>

        {editingTitle ? (
          <View className='gap-2'>
            <TextInput
              value={titleValue}
              onChangeText={setTitleValue}
              className='text-lg font-semibold text-ticket-overview-title-text leading-6 border border-ticket-overview-divider rounded-lg px-3 py-2'
            />
            <View className='flex-row justify-end gap-2'>
              <Pressable
                onPress={() => {
                  setTitleValue(title);
                  setEditingTitle(false);
                }}
                className='px-3 py-1.5 rounded-full border border-ticket-overview-divider'
              >
                <Text className='text-xs font-medium text-ticket-overview-meta-text'>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={commitTitle}
                className='px-3 py-1.5 rounded-full'
                style={{ backgroundColor: actionPrimaryColor }}
              >
                <Text className='text-xs font-semibold text-white'>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setEditingTitle(true)}>
            <Text className='text-lg font-semibold text-ticket-overview-title-text leading-6'>
              {title}
            </Text>
          </Pressable>
        )}

        <View className='flex-row items-center gap-2 pt-4 border-t border-ticket-overview-divider'>
          <View className='flex-row items-center gap-1.5'>
            <View className={cn('h-2 w-2 rounded-full', statusDotClass)} />
            <Text className='text-sm font-medium text-ticket-overview-meta-text'>
              {statusLabel}
            </Text>
          </View>
          <Text className='text-ticket-overview-id-text'>·</Text>
          <View className='flex-row items-center gap-1.5'>
            <Avatar userIds={assigneeId ? [assigneeId] : []} size={20} />
            <Text className='text-sm font-medium text-ticket-overview-meta-text'>
              {assigneeName}
            </Text>
          </View>
          <Text className='text-ticket-overview-id-text'>·</Text>
          <Text className='text-sm font-medium' style={{ color: dueDateTextColor }}>
            Due {dueDateShort}
          </Text>
        </View>
      </View>

      <View className='px-4 py-4 gap-3 border-b border-ticket-overview-divider'>
        <Text className='text-sm font-bold uppercase tracking-wider text-secondary-foreground'>
          DESCRIPTION
        </Text>
        {editingDescription ? (
          <View className='gap-2'>
            <TextInput
              value={descriptionValue}
              onChangeText={setDescriptionValue}
              multiline
              textAlignVertical='top'
              className='text-base font-medium text-foreground border border-ticket-overview-divider rounded-lg px-3 py-2 min-h-[96px]'
            />
            <View className='flex-row justify-end gap-2'>
              <Pressable
                onPress={() => {
                  setDescriptionValue(description);
                  setEditingDescription(false);
                }}
                className='px-3 py-1.5 rounded-full border border-ticket-overview-divider'
              >
                <Text className='text-xs font-medium text-ticket-overview-meta-text'>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={commitDescription}
                className='px-3 py-1.5 rounded-full'
                style={{ backgroundColor: actionPrimaryColor }}
              >
                <Text className='text-xs font-semibold text-white'>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setEditingDescription(true)}>
            <Text className='text-base font-medium text-foreground'>{description}</Text>
          </Pressable>
        )}
      </View>

      <View className='px-4 py-3'>
        {metaRows.map(row => (
          <View key={row.key} className='border-b border-ticket-overview-divider py-3'>
            <View className='flex-row items-center'>
              <View className='w-7 items-start'>{row.icon}</View>
              <Text className='w-24 text-[14px] font-medium text-ticket-meta-left-text'>
                {row.label}
              </Text>
              {row.value}
            </View>
            {row.footer ? <View className='mt-2 pl-[7.75rem]'>{row.footer}</View> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
