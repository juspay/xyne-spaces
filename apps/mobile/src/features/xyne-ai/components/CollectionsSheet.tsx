import { useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { FilterMultiSelectSheet } from '@/src/features/global-search/components/filters/filter-multi-select-sheet';
import { FilterOptionRow } from '@/src/features/global-search/components/filters/filter-option-row';
import {
  useMountWhileOpen,
  type SheetMountProps,
} from '@/src/features/global-search/hooks/use-mount-while-open';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

import type { AttachedContextItem } from '../api/xyneAIRequest';
import { isCollectionPick, pickKey, togglePick } from '../model/contextPicks';
import { Leading } from './ContextPickerSheet';

const TTL = '10m';

function CollectionsBody({
  isOpen,
  onOpenChange,
  onDismiss,
  selected,
  onApply,
}: SheetMountProps & {
  selected: AttachedContextItem[];
  onApply: (picks: AttachedContextItem[]) => void;
}): ReactElement {
  const chevron = useCSSVariable('--color-settings-chevron') as string;
  const [query, setQuery] = useState('');
  const [path, setPath] = useState<AttachedContextItem[]>([]);
  const [draft, setDraft] = useState(selected);
  const root = path[0];
  const folder = path.at(-1);
  const needle = query.trim().toLowerCase();

  const [collections, collectionsStatus] = useCachedQuery(queries.scopedCollections({}), {
    enabled: !folder,
    ttl: TTL,
  });
  const [subfolders, subfoldersStatus] = useCachedQuery(
    queries.collectionSubfolders({ rootCollectionId: root?.id ?? '' }),
    { enabled: !!root, ttl: TTL },
  );
  const [items] = useCachedQuery(queries.collectionItems({ collectionId: folder?.id ?? '' }), {
    enabled: !!folder,
    ttl: TTL,
  });

  // A file's id is its CollectionItem row id; `fileId` only exists on real files, not folder rows.
  const rows: AttachedContextItem[] = folder
    ? [
        ...subfolders
          .filter(({ parentId }) => parentId === folder.id)
          .map(({ id, name }) => ({ type: 'folder', id, title: name })),
        ...items
          .filter(({ fileId }) => fileId)
          .map(({ id, name }) => ({ type: 'file', id, title: name })),
      ]
    : collections.map(({ id, name }) => ({ type: 'collection', id, title: name }));
  const visible = rows.filter(({ title }) => title.toLowerCase().includes(needle));
  const isLoading = (folder ? subfoldersStatus : collectionsStatus).type !== 'complete';

  const selectedKeys = new Set(draft.map(pickKey));
  const navigate = (next: AttachedContextItem[]): void => {
    setQuery('');
    setPath(next);
  };

  return (
    <FilterMultiSelectSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      title='Collections'
      applyLabel='Done'
      searchPlaceholder={folder ? `Search in ${folder.title}` : 'Search collections'}
      query={query}
      onQueryChange={setQuery}
      selectionCount={draft.filter(isCollectionPick).length}
      onApply={(): void => onApply(draft)}
      onClear={(): void => onApply(selected.filter(pick => !isCollectionPick(pick)))}
    >
      {folder ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Back'
          onPress={(): void => navigate(path.slice(0, -1))}
          className='flex-row items-center gap-1 py-2 active:opacity-60'
        >
          <ChevronLeft size={18} color={chevron} />
          <Text numberOfLines={1} className='shrink text-[13px] text-bottomsheet-text-muted'>
            {path.map(({ title }) => title).join(' / ')}
          </Text>
        </Pressable>
      ) : null}
      {visible.length === 0 ? (
        <Text className='py-8 text-center text-bottomsheet-text-muted'>
          {isLoading ? 'Loading…' : needle ? 'No results' : 'Nothing here'}
        </Text>
      ) : (
        <BottomSheetFlatList
          style={{ flex: 1 }}
          data={visible}
          keyExtractor={pickKey}
          extraData={draft}
          renderItem={({ item }) => (
            <View className='flex-row items-center'>
              <View className='min-w-0 flex-1'>
                <FilterOptionRow
                  leading={<Leading pick={item} />}
                  title={item.title}
                  query={query}
                  isSelected={selectedKeys.has(pickKey(item))}
                  onPress={(): void => setDraft(current => togglePick(current, item, root))}
                />
              </View>
              {item.type === 'file' ? null : (
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel={`Open ${item.title}`}
                  hitSlop={8}
                  onPress={(): void => navigate([...path, item])}
                  className='p-2 active:opacity-60'
                >
                  <ChevronRight size={20} color={chevron} />
                </Pressable>
              )}
            </View>
          )}
          keyboardShouldPersistTaps='handled'
          keyboardDismissMode='on-drag'
          showsVerticalScrollIndicator={false}
        />
      )}
    </FilterMultiSelectSheet>
  );
}

export function CollectionsSheet({
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
    <CollectionsBody {...sheetProps} selected={selected} onApply={onApply} />
  ) : null;
}
