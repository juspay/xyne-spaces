import { FilterOptionRow } from '@/src/features/global-search/components/filters/filter-option-row';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { Search, Hash, UserRound, MessageSquare, Ticket, FileText } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { MessageType } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { InputV2 } from '@/src/components/ui/input-v2';
import { FilterSheetHeader } from '@/src/features/global-search/components/filters/filter-sheet-header';
import {
  useMountWhileOpen,
  type SheetMountProps,
} from '@/src/features/global-search/hooks/use-mount-while-open';
import {
  useChannelsSearch,
  usePeopleSearch,
} from '@/src/features/global-search/hooks/use-directory-search';
import { useSearchResults } from '@/src/features/global-search/hooks/use-search-results';
import { buildSearchRequest } from '@/src/features/global-search/utils/search-request';
import { useZero } from '@/src/hooks/useZero';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';
import {
  buildThreadContextMessage,
  contextItemFromResult,
  type ThreadContextItem,
} from './thread-context';

type Category = 'channels' | 'people' | 'messages' | 'tickets' | 'files';
const categoryLabels: Record<Category, string> = {
  channels: 'Channels',
  people: 'People',
  messages: 'Messages',
  tickets: 'Tickets',
  files: 'Files',
};
const categories: Category[] = ['channels', 'people', 'messages', 'tickets', 'files'];
function ContextBody({
  canEdit,
  threadId,
  ...sheet
}: SheetMountProps & { threadId: string; canEdit: boolean }): ReactElement {
  const { accentText } = useBubbleAccent();
  const ref = useRef<AppBottomSheetRef>(null);
  const zero = useZero();
  const [tab, setTab] = useState<Category>('channels');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<ThreadContextItem[]>([]);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return (): void => clearTimeout(timer);
  }, [query]);
  const channels = useChannelsSearch(tab === 'channels' ? query : null);
  const people = usePeopleSearch(tab === 'people' ? query : null);
  const remote = useSearchResults(
    tab === 'channels' || tab === 'people'
      ? null
      : buildSearchRequest({
          tab,
          query: debounced,
          chips: [],
          onlyMyChannels: false,
          includeBotMessages: false,
          exactMatch: false,
          scope: null,
        }),
  );
  const local = tab === 'channels' ? channels : people;
  const rows = useMemo(
    () =>
      tab === 'channels' || tab === 'people'
        ? local.flatMap(item => {
            const value = contextItemFromResult({
              id: item.id,
              type: tab === 'channels' ? 'channel' : 'user',
              title: tab === 'people' ? (item.name ?? item.title) : item.title,
              subtitle: '',
              metadata: {},
              relevanceScore: 0,
            });
            return value ? [value] : [];
          })
        : remote.data.flatMap(result => {
            const value = contextItemFromResult(result);
            return value ? [value] : [];
          }),
    [tab, local, remote.data],
  );
  const canSend = canEdit && !!threadId;
  const send = async (): Promise<void> => {
    if (!canSend || !selected.length || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    try {
      await awaitMutation(
        zero.mutate(
          mutators.messages.send({
            conversationId: threadId,
            content: buildThreadContextMessage(selected),
            type: MessageType.USER,
            showInChannel: false,
            timestamp: Date.now(),
            messageId: uuidv4(),
            attachmentIds: [],
          }),
        ),
      );
      ref.current?.dismiss();
    } catch (error) {
      Alert.alert(
        'Could not add context',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  return (
    <AppBottomSheet ref={ref} {...sheet} mode='fullscreen' keyboardBehavior='extend'>
      <FilterSheetHeader
        title='Add context'
        onCancel={() => ref.current?.dismiss()}
        {...(canSend && selected.length && !sending
          ? {
              applyLabel: 'Add',
              onApply: (): void => {
                void send();
              },
            }
          : {})}
      />
      <View className='flex-1 px-4 pt-3' style={{ minHeight: 0 }}>
        <InputV2
          variant='bottomsheet'
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${categoryLabels[tab].toLowerCase()}`}
          leftIcon={<Search size={18} color={accentText} />}
          autoCorrect={false}
          autoCapitalize='none'
        />
        <View className='flex-row flex-wrap gap-2 py-3'>
          {categories.map(category => (
            <Pressable
              key={categoryLabels[category]}
              className='rounded-full border border-foreground/10 px-3 py-2'
              style={tab === category ? { borderColor: accentText } : undefined}
              accessibilityRole='tab'
              accessibilityState={{ selected: tab === category }}
              onPress={() => setTab(category)}
            >
              <Text
                style={tab === category ? { color: accentText } : undefined}
                className={
                  tab === category
                    ? 'font-bold text-bottomsheet-container-foreground'
                    : 'text-bottomsheet-text-muted'
                }
              >
                {categoryLabels[category]}
              </Text>
            </Pressable>
          ))}
        </View>
        <View className='flex-row items-center justify-between pb-2'>
          <Text className='text-sm text-bottomsheet-text-muted'>
            {selected.length} selected across all categories
          </Text>
          {selected.length ? (
            <Pressable
              disabled={sending}
              onPress={() => setSelected([])}
              accessibilityRole='button'
              hitSlop={8}
            >
              <Text style={{ color: accentText }}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        {selected.length ? (
          <View style={{ height: 42 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps='handled'
              contentContainerStyle={{ gap: 8 }}
            >
              {selected.map(item => (
                <Pressable
                  key={item.id}
                  disabled={sending}
                  accessibilityRole='button'
                  accessibilityLabel={`Remove ${item.title}`}
                  onPress={() =>
                    setSelected(current => current.filter(value => value.id !== item.id))
                  }
                  className='mb-2 max-w-52 rounded-full bg-foreground/5 px-3 py-2'
                >
                  <Text numberOfLines={1} className='text-sm text-bottomsheet-container-foreground'>
                    {item.title} ×
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {sending || remote.status === 'loading' ? <ActivityIndicator /> : null}
        {remote.status === 'error' ? (
          <Pressable onPress={remote.retry}>
            <Text className='text-bottomsheet-container-foreground'>
              Search failed. Tap to retry.
            </Text>
          </Pressable>
        ) : null}
        <BottomSheetFlatList
          style={{ flex: 1, minHeight: 0 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps='handled'
          keyboardDismissMode='on-drag'
          data={rows}
          keyExtractor={item => item.id}
          extraData={selected}
          renderItem={({ item }) => {
            const checked = selected.some(value => value.id === item.id);
            const Icon =
              item.type === 'channel'
                ? Hash
                : item.type === 'user'
                  ? UserRound
                  : item.type === 'ticket'
                    ? Ticket
                    : item.type === 'attachment'
                      ? FileText
                      : MessageSquare;
            return (
              <FilterOptionRow
                leading={
                  <View className='size-9 items-center justify-center rounded-xl bg-foreground/5'>
                    <Icon size={18} color={accentText} />
                  </View>
                }
                title={item.title}
                query={query}
                isSelected={checked}
                onPress={() => {
                  if (sending) return;
                  setSelected(current =>
                    checked ? current.filter(value => value.id !== item.id) : [...current, item],
                  );
                }}
              />
            );
          }}
          ListEmptyComponent={
            remote.status !== 'loading' ? (
              <Text className='py-8 text-center text-bottomsheet-text-muted'>
                {query ? 'No results found' : 'Type to search for context'}
              </Text>
            ) : null
          }
        />
      </View>
    </AppBottomSheet>
  );
}
export function ThreadContextSheet({
  isOpen,
  onClose,
  ...ids
}: {
  canEdit: boolean;
  isOpen: boolean;
  onClose: () => void;
  threadId: string;
}): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  return shouldRender ? <ContextBody key={ids.threadId} {...sheetProps} {...ids} /> : null;
}
