import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Lock } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { useInTargetsSearch } from '../../hooks/use-directory-search';
import type { SearchFilterChip, SearchInTargetItem } from '../../types';
import { inChip } from '../../utils/filter-chip';
import { FilterMultiSelectSheet, selectionFirst } from './filter-multi-select-sheet';
import { FilterOptionRow } from './filter-option-row';

import { useMountWhileOpen, type SheetMountProps } from '../../hooks/use-mount-while-open';

type ListRow =
  | { kind: 'header'; id: string; title: string }
  | { kind: 'target'; id: string; item: SearchInTargetItem };

/** Channels get a glyph badge; DMs get their participants' avatars. */
function TargetLeading({
  item,
  mutedColor,
}: {
  item: SearchInTargetItem;
  mutedColor: string;
}): ReactElement {
  const isPrivate = item.visibility === 'PRIVATE' || item.visibility === 'private';

  if (item.kind === 'dm' && item.avatarUserIds && item.avatarUserIds.length > 0) {
    return <Avatar userIds={item.avatarUserIds} size={36} />;
  }

  return (
    <View className='size-9 items-center justify-center rounded-full bg-bottomsheet-container-bg'>
      {isPrivate ? (
        <Lock size={15} color={mutedColor} />
      ) : (
        <Text className='text-base font-semibold text-bottomsheet-text-muted'>#</Text>
      )}
    </View>
  );
}

type InFilterSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  selected: readonly SearchFilterChip[];
  /** Receives the whole selection; empty clears the filter. */
  onApply: (chips: readonly SearchFilterChip[]) => void;
};

export function InFilterSheet({
  isOpen,
  onClose,
  selected,
  onApply,
}: InFilterSheetProps): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  if (!shouldRender) return null;

  return <InFilterSheetBody {...sheetProps} selected={selected} onApply={onApply} />;
}

function InFilterSheetBody({
  isOpen,
  onOpenChange,
  onDismiss,
  selected,
  onApply,
}: SheetMountProps & Pick<InFilterSheetProps, 'selected' | 'onApply'>): ReactElement {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<SearchFilterChip[]>(() => [...selected]);
  const draftIds = useMemo(() => new Set(draft.map(chip => chip.id)), [draft]);
  const mutedColor = useCSSVariable('--color-bottomsheet-text-muted') as string;

  // Both channels and DMs — the `in:#` / `in:@` narrowing modes belong to the
  // inline operator typeahead, and this sheet always lists everything.
  const targets = useInTargetsSearch(query);

  const rows = useMemo((): ListRow[] => {
    const hasQuery = query.trim().length > 0;

    let ordered: readonly SearchInTargetItem[] = targets;
    if (!hasQuery) {
      const listed = new Set(targets.map(target => target.id));
      const missing: SearchInTargetItem[] = draft
        .filter(chip => !listed.has(chip.id))
        .map(chip => ({
          id: chip.id,
          title: chip.label,
          kind: chip.targetKind ?? 'channel',
          ...(chip.visibility ? { visibility: chip.visibility } : {}),
        }));
      ordered = selectionFirst(targets, draftIds, missing);
    }

    const channels = ordered.filter(target => target.kind === 'channel');
    const dms = ordered.filter(target => target.kind === 'dm');
    const next: ListRow[] = [];

    if (channels.length > 0) {
      next.push({ kind: 'header', id: 'header-channels', title: 'Channels' });
      for (const item of channels) next.push({ kind: 'target', id: `channel-${item.id}`, item });
    }

    if (dms.length > 0) {
      next.push({ kind: 'header', id: 'header-dms', title: 'Direct messages' });
      for (const item of dms) next.push({ kind: 'target', id: `dm-${item.id}`, item });
    }

    return next;
  }, [draft, draftIds, query, targets]);

  const toggle = useCallback((target: SearchInTargetItem) => {
    setDraft(prev =>
      prev.some(chip => chip.id === target.id)
        ? prev.filter(chip => chip.id !== target.id)
        : [...prev, inChip(target)],
    );
  }, []);

  const handleApply = useCallback(() => onApply(draft), [draft, onApply]);
  const handleClear = useCallback(() => onApply([]), [onApply]);

  const renderItem = useCallback(
    ({ item }: { item: ListRow }) =>
      item.kind === 'header' ? (
        <Text className='px-1 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-bottomsheet-text-muted'>
          {item.title}
        </Text>
      ) : (
        <FilterOptionRow
          leading={<TargetLeading item={item.item} mutedColor={mutedColor} />}
          title={item.item.title}
          query={query}
          isSelected={draftIds.has(item.item.id)}
          onPress={() => toggle(item.item)}
        />
      ),
    [draftIds, mutedColor, query, toggle],
  );

  return (
    <FilterMultiSelectSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      title='In'
      searchPlaceholder='Search channels and DMs'
      query={query}
      onQueryChange={setQuery}
      selectionCount={draft.length}
      onApply={handleApply}
      onClear={handleClear}
    >
      {rows.length === 0 ? (
        <View className='py-8'>
          <Text className='text-center text-bottomsheet-text-muted'>
            {query.trim() ? 'No matching conversations' : 'No conversations to show'}
          </Text>
        </View>
      ) : (
        // See the note in from-filter-sheet: a bare list inside a gorhom sheet
        // never registers as the sheet's scrollable, so the pan gesture eats
        // every drag. Capped at 40 targets plus two headers.
        <BottomSheetFlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={row => row.id}
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
