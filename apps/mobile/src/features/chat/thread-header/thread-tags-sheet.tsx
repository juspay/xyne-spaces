import { applyThreadTagEdits } from './thread-tag-edits';
import { useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useQuery as useRemoteQuery } from '@tanstack/react-query';
import {
  normalizeThreadTypeName,
  parseAppliedTags,
  visibleTags,
  type ThreadTypeEntry,
} from '@xyne/shared';

import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { InputV2 } from '@/src/components/ui/input-v2';
import { useAuth } from '@/src/contexts/AuthContext';
import { FilterSheetHeader } from '@/src/features/global-search/components/filters/filter-sheet-header';
import {
  useMountWhileOpen,
  type SheetMountProps,
} from '@/src/features/global-search/hooks/use-mount-while-open';
import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { apiGet } from '@/src/services/apiClient';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

function ThreadTagsBody({
  channelId,
  threadId,
  canEdit: canEditThread,
  ...sheetProps
}: SheetMountProps & { channelId: string; threadId: string; canEdit: boolean }): ReactElement {
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const zero = useZero();
  const { user } = useAuth();
  const [conversation, details] = useQuery(
    queries.getConversationById({ conversationId: threadId }),
  );
  const vocabulary = useRemoteQuery({
    queryKey: ['thread-type-vocabulary', user?.workspaceId],
    queryFn: async () =>
      (await apiGet<{ entries: ThreadTypeEntry[] }>('/thread-type-vocabulary')).entries,
    staleTime: 15 * 60 * 1000,
  });
  const [search, setSearch] = useState('');
  // Store edits, not a snapshot: unrelated tags arriving while the sheet is open survive Save.
  const [edits, setEdits] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const applied = visibleTags(parseAppliedTags(conversation?.threadType)).map(tag => tag.name);
  const selected = new Set(applyThreadTagEdits(applied, edits));
  const entries = vocabulary.data ?? [];
  const knownNames = new Set(entries.map(entry => entry.name));
  const customNames = [...new Set([...applied, ...Object.keys(edits)])].filter(
    name => !knownNames.has(name),
  );
  const rows = [
    ...entries.map(entry => ({ name: entry.name, label: entry.label, summary: entry.summary })),
    ...customNames.map(name => ({ name, label: name, summary: undefined })),
  ];
  const proposed = normalizeThreadTypeName(search).slice(0, 40);
  const canCreate =
    proposed.length > 0 && !rows.some(row => normalizeThreadTypeName(row.name) === proposed);
  const canEdit =
    canEditThread && conversation?.channelId === channelId && details.type === 'complete';
  const save = async (): Promise<void> => {
    if (!canEdit || savingRef.current) return;
    if (!Object.keys(edits).length) {
      sheetRef.current?.dismiss();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await awaitMutation(
        zero.mutate(
          mutators.threadTag.setTypes({
            conversationId: threadId,
            types: [...selected],
            timestamp: Date.now(),
          }),
        ),
      );
      sheetRef.current?.dismiss();
    } catch (error) {
      Alert.alert(
        'Could not update thread tags',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <AppBottomSheet ref={sheetRef} {...sheetProps} mode='fullscreen' keyboardBehavior='extend'>
      <FilterSheetHeader
        title='Thread tags'
        onCancel={() => sheetRef.current?.dismiss()}
        {...(canEdit && !saving
          ? {
              onApply: (): void => {
                void save();
              },
              applyLabel: 'Save',
            }
          : {})}
      />
      <View className='flex-1 px-4 pt-3'>
        <InputV2
          value={search}
          onChangeText={setSearch}
          variant='bottomsheet'
          placeholder='Search or add a tag'
          maxLength={40}
          autoCapitalize='none'
          autoCorrect={false}
        />
        <Text className='py-3 text-bottomsheet-text-muted'>{selected.size} selected</Text>
        {saving || details.type !== 'complete' || vocabulary.isPending ? (
          <ActivityIndicator accessibilityLabel='Loading tags' />
        ) : null}
        {vocabulary.isError ? (
          <Pressable
            onPress={() => void vocabulary.refetch()}
            accessibilityRole='button'
            className='py-3'
          >
            <Text className='text-bottomsheet-container-foreground'>
              Could not load workspace tags. Tap to retry.
            </Text>
          </Pressable>
        ) : null}
        {!canEdit && details.type === 'complete' ? (
          <Text className='text-bottomsheet-text-muted'>Tags cannot be edited in this thread.</Text>
        ) : null}
        <BottomSheetScrollView keyboardShouldPersistTaps='handled'>
          {rows
            .filter(row =>
              `${row.label} ${row.name}`.toLowerCase().includes(search.trim().toLowerCase()),
            )
            .map(row => (
              <Pressable
                key={row.name}
                accessibilityRole='checkbox'
                accessibilityState={{
                  checked: selected.has(row.name),
                  disabled: !canEdit || saving,
                }}
                disabled={!canEdit || saving}
                onPress={() =>
                  setEdits(current => ({ ...current, [row.name]: !selected.has(row.name) }))
                }
                className='flex-row items-center gap-3 py-3'
              >
                <Text className='text-bottomsheet-container-foreground'>
                  {selected.has(row.name) ? '✓' : '○'}
                </Text>
                <View className='flex-1'>
                  <Text className='text-base text-bottomsheet-container-foreground'>
                    {row.label}
                  </Text>
                  {row.summary ? (
                    <Text className='text-sm text-bottomsheet-text-muted'>{row.summary}</Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          {canCreate && !vocabulary.isPending && !vocabulary.isError ? (
            <Pressable
              accessibilityRole='button'
              disabled={!canEdit || saving}
              onPress={() => {
                setEdits(current => ({ ...current, [proposed]: true }));
                setSearch('');
              }}
              className='py-3'
            >
              <Text className='text-base text-bottomsheet-container-foreground'>
                Add {proposed}
              </Text>
              <Text className='text-sm text-bottomsheet-text-muted'>
                New tags are submitted for workspace review.
              </Text>
            </Pressable>
          ) : null}
          {!rows.length && !vocabulary.isPending && !vocabulary.isError ? (
            <Text className='text-bottomsheet-text-muted'>
              No tags yet. Type a name to add one.
            </Text>
          ) : null}
        </BottomSheetScrollView>
      </View>
    </AppBottomSheet>
  );
}

export function ThreadTagsSheet({
  isOpen,
  onClose,
  canEdit,
  channelId,
  threadId,
}: {
  canEdit: boolean;
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  threadId: string;
}): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  return shouldRender ? (
    <ThreadTagsBody
      canEdit={canEdit}
      key={threadId}
      {...sheetProps}
      channelId={channelId}
      threadId={threadId}
    />
  ) : null;
}
