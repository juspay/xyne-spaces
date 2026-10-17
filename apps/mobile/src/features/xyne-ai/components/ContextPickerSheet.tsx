import { useEffect, useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import {
  BookOpen,
  FileText,
  Folder,
  Hash,
  MessageCircle,
  Mic,
  Paperclip,
  Ticket,
  type LucideIcon,
} from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { ChatFilterTabs, type ChatFilterTabOption } from '@/src/components/chat/chat-filter-tabs';
import Avatar from '@/src/components/ui/avatar';
import { FilterMultiSelectSheet } from '@/src/features/global-search/components/filters/filter-multi-select-sheet';
import { FilterOptionRow } from '@/src/features/global-search/components/filters/filter-option-row';
import {
  useChannelsSearch,
  usePeopleSearch,
} from '@/src/features/global-search/hooks/use-directory-search';
import {
  useMountWhileOpen,
  type SheetMountProps,
} from '@/src/features/global-search/hooks/use-mount-while-open';
import {
  useSearchResults,
  type SearchResults,
} from '@/src/features/global-search/hooks/use-search-results';
import { SEARCH_COMMIT_WAIT_MS } from '@/src/features/global-search/utils/debounced-commit';
import { buildSearchRequest } from '@/src/features/global-search/utils/search-request';
import type { GlobalSearchTab } from '@/src/features/global-search/utils/search-tabs';
import type { DisplaySearchResult } from '@/src/types/search';

import type { AttachedContextItem } from '../api/xyneAIRequest';
import {
  channelPick,
  personPick,
  pickFromResult,
  pickKey,
  togglePick,
} from '../model/contextPicks';

type PickerTab = 'all' | 'people' | 'messages' | 'channels' | 'files' | 'canvas' | 'tickets';
type Source = Exclude<PickerTab, 'all'>;

const TABS: ChatFilterTabOption<PickerTab>[] = [
  { value: 'all', label: 'All' },
  { value: 'people', label: 'People' },
  { value: 'messages', label: 'Messages' },
  { value: 'channels', label: 'Channels' },
  { value: 'files', label: 'Files' },
  { value: 'canvas', label: 'Canvas' },
  { value: 'tickets', label: 'Tickets' },
];

const ALL_SOURCES: Source[] = ['people', 'messages', 'channels', 'files', 'canvas', 'tickets'];
const ALL_TAB_ROWS_PER_SOURCE = 5;

export const ICONS: Partial<Record<string, LucideIcon>> = {
  collection: BookOpen,
  folder: Folder,
  file: FileText,
  channel: Hash,
  message: MessageCircle,
  ticket: Ticket,
  canvas: FileText,
  call: Mic,
  attachment: Paperclip,
};

interface PickRow {
  pick: AttachedContextItem;
  subtitle?: string | undefined;
}

const isCanvas = (result: DisplaySearchResult): boolean =>
  result.searchContext?.subApp?.toUpperCase() === 'CANVAS';

function resultRows(results: readonly DisplaySearchResult[]): PickRow[] {
  return results.flatMap(result => {
    const pick = pickFromResult(result);
    return pick ? [{ pick, subtitle: result.subtitle }] : [];
  });
}

const useRemoteResults = (tab: GlobalSearchTab, isEnabled: boolean, query: string): SearchResults =>
  useSearchResults(
    isEnabled
      ? buildSearchRequest({ tab, query, chips: [], onlyMyChannels: false, scope: null })
      : null,
  );

export const Leading = ({ pick }: { pick: AttachedContextItem }): ReactElement => {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const Icon = ICONS[pick.type];
  if (!Icon) return <Avatar userIds={[pick.id]} size={36} />;
  return (
    <View className='size-9 items-center justify-center rounded-full bg-foreground/5'>
      <Icon size={18} color={muted} />
    </View>
  );
};

function ContextPickerBody({
  isOpen,
  onOpenChange,
  onDismiss,
  selected,
  onApply,
}: SheetMountProps & {
  selected: AttachedContextItem[];
  onApply: (picks: AttachedContextItem[]) => void;
}): ReactElement {
  const [tab, setTab] = useState<PickerTab>('all');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [draft, setDraft] = useState(selected);

  useEffect(() => {
    const timer = setTimeout(() => setSearched(query), SEARCH_COMMIT_WAIT_MS);
    return (): void => clearTimeout(timer);
  }, [query]);

  const sources = tab === 'all' ? ALL_SOURCES : [tab];
  const people = usePeopleSearch(query);
  const channels = useChannelsSearch(query);
  const messages = useRemoteResults('messages', sources.includes('messages'), searched);
  const files = useRemoteResults(
    'files',
    sources.includes('files') || sources.includes('canvas'),
    searched,
  );
  const tickets = useRemoteResults('tickets', sources.includes('tickets'), searched);

  const bySource: Record<Source, PickRow[]> = {
    people: people.map(({ id, title, subtitle }) => ({ pick: personPick(id, title), subtitle })),
    channels: channels.map(({ id, title }) => ({ pick: channelPick(id, title) })),
    messages: resultRows(messages.data),
    files: resultRows(files.data.filter(result => !isCanvas(result))),
    canvas: resultRows(files.data.filter(isCanvas)),
    tickets: resultRows(tickets.data),
  };
  const rows = sources.flatMap(source =>
    tab === 'all' ? bySource[source].slice(0, ALL_TAB_ROWS_PER_SOURCE) : bySource[source],
  );

  const selectedKeys = new Set(draft.map(pickKey));
  const isLoading = [messages, files, tickets].some(({ status }) => status === 'loading');

  return (
    <FilterMultiSelectSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      title='Add context'
      applyLabel='Done'
      searchPlaceholder='Search people, messages, files'
      query={query}
      onQueryChange={setQuery}
      selectionCount={draft.length}
      onApply={(): void => onApply(draft)}
      onClear={(): void => onApply([])}
    >
      <Text className='pb-2 text-[13px] text-bottomsheet-text-muted'>Pick as many as you need</Text>
      <ChatFilterTabs
        scrollable
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
        keyboardShouldPersistTaps='always'
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 0, paddingVertical: 4 }}
      />
      {rows.length === 0 ? (
        <Text className='py-8 text-center text-bottomsheet-text-muted'>
          {isLoading ? 'Searching…' : query.trim() ? 'No results' : 'Type to search'}
        </Text>
      ) : (
        <BottomSheetFlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={({ pick }) => pickKey(pick)}
          extraData={draft}
          renderItem={({ item }) => (
            <FilterOptionRow
              leading={<Leading pick={item.pick} />}
              title={item.pick.title}
              {...(item.subtitle ? { subtitle: item.subtitle } : {})}
              query={query}
              isSelected={selectedKeys.has(pickKey(item.pick))}
              onPress={(): void => setDraft(current => togglePick(current, item.pick))}
            />
          )}
          keyboardShouldPersistTaps='handled'
          keyboardDismissMode='on-drag'
          showsVerticalScrollIndicator={false}
        />
      )}
    </FilterMultiSelectSheet>
  );
}

export function ContextPickerSheet({
  isOpen,
  onClose,
  selected,
  onApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  selected: AttachedContextItem[];
  onApply: (picks: AttachedContextItem[]) => void;
}): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  return shouldRender ? (
    <ContextPickerBody {...sheetProps} selected={selected} onApply={onApply} />
  ) : null;
}
