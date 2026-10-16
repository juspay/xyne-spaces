import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
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
import { useConversationHeaderData } from '@/src/hooks/useConversationHeaderData';
import { useZero } from '@/src/hooks/useZero';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';
import {
  buildThreadContextMessage,
  contextItemFromResult,
  type ThreadContextItem,
} from './thread-context';

type Category = 'channels' | 'people' | 'messages' | 'tickets' | 'files';
const categories: Category[] = ['channels', 'people', 'messages', 'tickets', 'files'];
function ContextBody({
  channelId,
  threadId,
  ...sheet
}: SheetMountProps & { channelId: string; threadId: string }): ReactElement {
  const ref = useRef<AppBottomSheetRef>(null);
  const zero = useZero();
  const { channel, canUseMemberActions } = useConversationHeaderData(channelId, { enabled: false });
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
  const channels = useChannelsSearch(query);
  const people = usePeopleSearch(query);
  const remote = useSearchResults(
    tab === 'channels' || tab === 'people'
      ? null
      : buildSearchRequest({
          tab,
          query: debounced,
          chips: [],
          onlyMyChannels: false,
          scope: null,
        }),
  );
  const local = tab === 'channels' ? channels : people;
  const rows =
    tab === 'channels' || tab === 'people'
      ? local.flatMap(item => {
          const value = contextItemFromResult({
            id: item.id,
            type: tab === 'channels' ? 'channel' : 'user',
            title: item.title,
            subtitle: '',
            metadata: {},
            relevanceScore: 0,
          });
          return value ? [value] : [];
        })
      : remote.data.flatMap(result => {
          const value = contextItemFromResult(result);
          return value ? [value] : [];
        });
  const canSend = !!channel && !channel.isArchived && canUseMemberActions && !!threadId;
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
      <View className='flex-1 px-4 pt-3'>
        <InputV2
          variant='bottomsheet'
          value={query}
          onChangeText={setQuery}
          placeholder='Search context'
          autoCapitalize='none'
        />
        <View className='flex-row flex-wrap gap-3 py-3'>
          {categories.map(category => (
            <Pressable
              key={category}
              accessibilityRole='tab'
              accessibilityState={{ selected: tab === category }}
              onPress={() => setTab(category)}
            >
              <Text
                className={
                  tab === category
                    ? 'font-bold text-bottomsheet-container-foreground'
                    : 'text-bottomsheet-text-muted'
                }
              >
                {category}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text className='text-bottomsheet-text-muted'>{selected.length} selected</Text>
        <View className='flex-row flex-wrap gap-2 py-2'>
          {selected.map(item => (
            <Pressable
              key={item.id}
              disabled={sending}
              accessibilityLabel={`Remove ${item.title}`}
              onPress={() => setSelected(current => current.filter(value => value.id !== item.id))}
            >
              <Text className='text-bottomsheet-container-foreground'>{item.title} ×</Text>
            </Pressable>
          ))}
        </View>
        {sending || remote.status === 'loading' ? <ActivityIndicator /> : null}
        {remote.status === 'error' ? (
          <Pressable onPress={remote.retry}>
            <Text className='text-bottomsheet-container-foreground'>
              Search failed. Tap to retry.
            </Text>
          </Pressable>
        ) : null}
        <BottomSheetScrollView keyboardShouldPersistTaps='handled'>
          {rows.map(item => {
            const checked = selected.some(value => value.id === item.id);
            return (
              <Pressable
                key={item.id}
                accessibilityRole='checkbox'
                accessibilityState={{ checked }}
                disabled={sending}
                className='py-3'
                onPress={() =>
                  setSelected(current =>
                    checked ? current.filter(value => value.id !== item.id) : [...current, item],
                  )
                }
              >
                <Text className='text-base text-bottomsheet-container-foreground'>
                  {checked ? '✓ ' : ''}
                  {item.title}
                </Text>
              </Pressable>
            );
          })}
          {!rows.length && remote.status !== 'loading' ? (
            <Text className='py-3 text-bottomsheet-text-muted'>
              {query ? 'No results' : 'Type to search'}
            </Text>
          ) : null}
        </BottomSheetScrollView>
      </View>
    </AppBottomSheet>
  );
}
export function ThreadContextSheet({
  isOpen,
  onClose,
  ...ids
}: {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  threadId: string;
}): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  return shouldRender ? <ContextBody key={ids.threadId} {...sheetProps} {...ids} /> : null;
}
