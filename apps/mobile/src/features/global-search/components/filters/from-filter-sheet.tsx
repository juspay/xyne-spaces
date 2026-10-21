import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';

import Avatar from '@/src/components/ui/avatar';
import { usePeopleSearch } from '../../hooks/use-directory-search';
import type { SearchFilterChip, SearchPersonItem } from '../../types';
import { fromChip } from '../../utils/filter-chip';
import { FilterMultiSelectSheet, selectionFirst } from './filter-multi-select-sheet';
import { FilterOptionRow } from './filter-option-row';

import { useMountWhileOpen, type SheetMountProps } from '../../hooks/use-mount-while-open';

type FromFilterSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Chips currently applied — the draft's starting point. */
  selected: readonly SearchFilterChip[];
  /** "From" normally, "With" on the Calls tab. */
  title: string;
  /** Receives the whole selection; empty clears the filter. */
  onApply: (chips: readonly SearchFilterChip[]) => void;
};

export function FromFilterSheet({
  isOpen,
  onClose,
  selected,
  title,
  onApply,
}: FromFilterSheetProps): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  if (!shouldRender) return null;

  return (
    <FromFilterSheetBody {...sheetProps} selected={selected} title={title} onApply={onApply} />
  );
}

function FromFilterSheetBody({
  isOpen,
  onOpenChange,
  onDismiss,
  selected,
  title,
  onApply,
}: SheetMountProps & Pick<FromFilterSheetProps, 'selected' | 'title' | 'onApply'>): ReactElement {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<SearchFilterChip[]>(() => [...selected]);
  const draftIds = useMemo(() => new Set(draft.map(chip => chip.id)), [draft]);

  // Live query, not debounced — it is an on-device search over the synced directory.
  const people = usePeopleSearch(query);

  /**
   * With an empty query the hook returns a bare first-25 slice, so a selected
   * person can easily fall outside it and become impossible to deselect. Hoist
   * the current draft to the top instead.
   */
  const rows = useMemo((): readonly SearchPersonItem[] => {
    if (query.trim()) return people;
    const listed = new Set(people.map(person => person.id));
    const missing = draft
      .filter(chip => !listed.has(chip.id))
      .map(chip => ({ id: chip.id, title: chip.label }));
    return selectionFirst(people, draftIds, missing);
  }, [draft, draftIds, people, query]);

  const toggle = useCallback((person: SearchPersonItem) => {
    setDraft(prev =>
      prev.some(chip => chip.id === person.id)
        ? prev.filter(chip => chip.id !== person.id)
        : [...prev, fromChip(person)],
    );
  }, []);

  const handleApply = useCallback(() => onApply(draft), [draft, onApply]);
  const handleClear = useCallback(() => onApply([]), [onApply]);

  const renderItem = useCallback(
    ({ item }: { item: SearchPersonItem }) => (
      <FilterOptionRow
        leading={<Avatar userIds={[item.id]} size={36} />}
        title={item.title}
        {...(item.subtitle ? { subtitle: item.subtitle } : {})}
        query={query}
        isSelected={draftIds.has(item.id)}
        onPress={() => toggle(item)}
      />
    ),
    [draftIds, query, toggle],
  );

  return (
    <FilterMultiSelectSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      title={title}
      searchPlaceholder='Search people'
      query={query}
      onQueryChange={setQuery}
      selectionCount={draft.length}
      onApply={handleApply}
      onClear={handleClear}
    >
      {rows.length === 0 ? (
        <View className='py-8'>
          <Text className='text-center text-bottomsheet-text-muted'>
            {query.trim() ? 'No matching people' : 'No people to show'}
          </Text>
        </View>
      ) : (
        // Must be a gorhom scrollable, not a bare LegendList. The sheet wraps its
        // content in a pan gesture and decides drag-vs-scroll from the offset a
        // *registered* scrollable reports; an unregistered list never registers,
        // so every drag pans the sheet and the rows never move. The list is
        // capped at 25 rows, so virtualization buys nothing here anyway.
        <BottomSheetFlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={person => person.id}
          renderItem={renderItem}
          extraData={draftIds}
          keyboardShouldPersistTaps='handled'
          keyboardDismissMode='on-drag'
          showsVerticalScrollIndicator={false}
        />
      )}
    </FilterMultiSelectSheet>
  );
}
