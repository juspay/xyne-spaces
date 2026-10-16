import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BottomSheetFlatList, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { ChevronDown, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useUserGroups } from '@/src/hooks/useUserGroups';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';
import { queries } from '@/src/zero/queries';
import { useMountWhileOpen, type SheetMountProps } from '../../hooks/use-mount-while-open';
import type { SearchFilterChip } from '../../types';
import {
  clearStructuredDraft,
  DATE_MODES,
  DATE_RANGE_OPTIONS,
  dateModeFor,
  describeDateBounds,
  parseCommaList,
  PRIORITY_OPTIONS,
  type DateMode,
  type FilterEntity,
  type SearchResultsFilters,
  type StructuredSearchFilters,
} from '../../utils/filter-model';
import {
  countActiveFilters,
  entitiesToFromChips,
  entitiesToInChips,
  modalDocTypeForTab,
  modalFieldEntries,
  type ModalFilterEntry,
} from '../../utils/filter-registry';
import {
  DEFAULT_RANK_PROFILE,
  DEFAULT_SORT_BY,
  getRankProfileOptions,
  rankLabel,
  SORT_OPTIONS,
  type SortBy,
} from '../../utils/rank-sort';
import type { GlobalSearchTab } from '../../utils/search-tabs';
import { DateModeSheet } from './date-mode-sheet';
import { FilterMultiSelectSheet, selectionFirst } from './filter-multi-select-sheet';
import { FilterOptionRow } from './filter-option-row';
import { FilterSheetHeader } from './filter-sheet-header';
import { FromFilterSheet } from './from-filter-sheet';
import { InFilterSheet } from './in-filter-sheet';
import { OptionPickerSheet } from './option-picker-sheet';

type NestedPicker =
  | { kind: 'from' }
  | { kind: 'in' }
  | { kind: 'with' }
  | { kind: 'assignee' }
  | { kind: 'mentionUsers' }
  | { kind: 'mentionChannels' }
  | { kind: 'mentionGroups' }
  | { kind: 'boards' }
  | null;

type FiltersSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  tab: GlobalSearchTab;
  applied: SearchResultsFilters;
  onApply: (next: {
    structured: StructuredSearchFilters;
    chips: readonly SearchFilterChip[];
    onlyMyChannels: boolean;
    sortBy: SortBy;
    rankProfile: string;
  }) => void;
};

function entitiesToChips(entities: readonly FilterEntity[]): SearchFilterChip[] {
  return entitiesToFromChips(entities);
}

function chipsToEntities(chips: readonly SearchFilterChip[]): FilterEntity[] {
  return chips.map(chip => ({ id: chip.id, label: chip.label }));
}

/**
 * Dashboard FiltersModal equivalent: draft on open, Apply commits, dismiss discards.
 * Bot / Exact stay on the bar; Sort / Rank / From / In / Only my channels are edited here.
 */
export function FiltersSheet({
  isOpen,
  onClose,
  tab,
  applied,
  onApply,
}: FiltersSheetProps): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  if (!shouldRender) return null;

  return <FiltersSheetBody {...sheetProps} tab={tab} applied={applied} onApply={onApply} />;
}

function FiltersSheetBody({
  isOpen,
  onOpenChange,
  onDismiss,
  tab,
  applied,
  onApply,
}: SheetMountProps & Pick<FiltersSheetProps, 'tab' | 'applied' | 'onApply'>): ReactElement {
  const [draft, setDraft] = useState<SearchResultsFilters>(applied);
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [dateMode, setDateMode] = useState<DateMode | ''>('');
  const [pendingDateMode, setPendingDateMode] = useState<DateMode | null>(null);
  const [picker, setPicker] = useState<NestedPicker>(null);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [rankOpen, setRankOpen] = useState(false);

  const { accentText } = useBubbleAccent();
  const muted = useCSSVariable('--color-bottomsheet-text-muted') as string;
  const fieldText = useCSSVariable('--color-bottomsheet-container-foreground') as string;
  const border = useCSSVariable('--color-border') as string;
  const inputBg = useCSSVariable('--color-input') as string;

  useEffect(() => {
    if (!isOpen) return;
    setDraft(applied);
    setTextDrafts({});
    setDateMode(dateModeFor(applied));
    setPendingDateMode(null);
    setPicker(null);
    setPriorityOpen(false);
    setRankOpen(false);
  }, [applied, isOpen]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !isOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Nested pickers / date first — don't dismiss the whole Filters sheet.
      if (pendingDateMode) {
        setPendingDateMode(null);
        return true;
      }
      if (picker) {
        setPicker(null);
        return true;
      }
      if (priorityOpen) {
        setPriorityOpen(false);
        return true;
      }
      if (rankOpen) {
        setRankOpen(false);
        return true;
      }
      onOpenChange(false);
      return true;
    });
    return (): void => sub.remove();
  }, [isOpen, onOpenChange, pendingDateMode, picker, priorityOpen, rankOpen]);

  const fieldEntries = useMemo(() => modalFieldEntries(modalDocTypeForTab(tab)), [tab]);
  const rankOptions = useMemo(() => getRankProfileOptions(tab), [tab]);
  const draftCount = countActiveFilters(draft);

  const carried = useMemo(() => {
    const items: { key: string; label: string; clear: Partial<SearchResultsFilters> }[] = [];
    for (const email of draft.fromEmails) {
      items.push({
        key: `fromEmail-${email}`,
        label: `from: ${email}`,
        clear: { fromEmails: draft.fromEmails.filter(value => value !== email) },
      });
    }
    for (const email of draft.toEmails) {
      items.push({
        key: `toEmail-${email}`,
        label: `to: ${email}`,
        clear: { toEmails: draft.toEmails.filter(value => value !== email) },
      });
    }
    for (const status of draft.statuses) {
      items.push({
        key: `status-${status}`,
        label: `status: ${status}`,
        clear: { statuses: draft.statuses.filter(value => value !== status) },
      });
    }
    return items;
  }, [draft.fromEmails, draft.statuses, draft.toEmails]);

  const patch = useCallback((next: Partial<SearchResultsFilters>) => {
    setDraft(prev => ({ ...prev, ...next }));
  }, []);

  const structuredFromDraft = useCallback(
    (source: SearchResultsFilters): StructuredSearchFilters => ({
      withUsers: source.withUsers,
      mentionUsers: source.mentionUsers,
      mentionChannels: source.mentionChannels,
      mentionGroups: source.mentionGroups,
      assignees: source.assignees,
      boards: source.boards,
      priority: source.priority,
      statuses: source.statuses,
      tags: source.tags,
      entities: source.entities,
      fromEmails: source.fromEmails,
      toEmails: source.toEmails,
      dateRange: source.dateRange,
      after: source.after,
      before: source.before,
      showArchived: source.showArchived,
    }),
    [],
  );

  const commitTextFields = useCallback(
    (source: SearchResultsFilters): SearchResultsFilters => {
      let next = source;
      for (const entry of fieldEntries) {
        if (entry.control?.kind !== 'text') continue;
        const raw = textDrafts[entry.id];
        if (raw === undefined) continue;
        const list = parseCommaList(raw);
        if (entry.control.field === 'tags') next = { ...next, tags: list };
        if (entry.control.field === 'entities') next = { ...next, entities: list };
      }
      return next;
    },
    [fieldEntries, textDrafts],
  );

  const applyAndClose = useCallback(() => {
    void haptics.buttonTap();
    const committed = commitTextFields(draft);
    Keyboard.dismiss();
    onApply({
      structured: structuredFromDraft(committed),
      chips: [
        ...entitiesToFromChips(committed.fromUsers),
        ...entitiesToInChips(committed.inChannels),
      ],
      // @Ch lives on the bar — do not overwrite a live toggle from a stale draft.
      onlyMyChannels: applied.onlyMyChannels,
      sortBy: committed.sortBy,
      rankProfile: committed.rankProfile,
    });
    onOpenChange(false);
  }, [applied.onlyMyChannels, commitTextFields, draft, onApply, onOpenChange, structuredFromDraft]);

  const clearFilters = useCallback(() => {
    void haptics.buttonTap();
    // Clear every counted modal field (including Sort / Rank). Bar mode pills
    // (@Ch / Bot / Exact) stay on the search bar and are not part of this draft.
    setDraft(prev => ({
      ...prev,
      ...clearStructuredDraft(),
      fromUsers: [],
      inChannels: [],
      sortBy: DEFAULT_SORT_BY,
      rankProfile: DEFAULT_RANK_PROFILE,
    }));
    setTextDrafts({});
    setDateMode('');
  }, []);

  const summaryLabel = (entities: readonly FilterEntity[], empty: string): string => {
    if (entities.length === 0) return empty;
    if (entities.length === 1) return entities[0]?.label ?? empty;
    return `${entities[0]?.label ?? ''} +${entities.length - 1}`;
  };

  const fieldLabel = (label: string): ReactElement => (
    <Text className='mb-1.5 text-[13px] font-medium text-bottomsheet-text-header'>{label}</Text>
  );

  const renderPeopleRow = (
    label: string,
    entities: readonly FilterEntity[],
    empty: string,
    onPress: () => void,
  ): ReactElement => (
    <View className='mb-4'>
      {fieldLabel(label)}
      <Pressable
        onPress={() => {
          void haptics.buttonTap();
          Keyboard.dismiss();
          onPress();
        }}
        className='flex-row items-center justify-between rounded-xl border px-3 py-3'
        style={{ borderColor: border, backgroundColor: inputBg }}
      >
        <Text
          className='flex-1 text-[15px]'
          style={{ color: entities.length > 0 ? fieldText : muted }}
          numberOfLines={1}
        >
          {summaryLabel(entities, empty)}
        </Text>
        <ChevronDown size={16} color={muted} />
      </Pressable>
    </View>
  );

  const renderControl = (entry: ModalFilterEntry): ReactElement | null => {
    const control = entry.control;
    if (!control) return null;

    switch (control.kind) {
      case 'people': {
        const entities =
          control.field === 'fromUsers'
            ? draft.fromUsers
            : control.field === 'withUsers'
              ? draft.withUsers
              : draft.assignees;
        const open =
          control.field === 'fromUsers'
            ? (): void => setPicker({ kind: 'from' })
            : control.field === 'withUsers'
              ? (): void => setPicker({ kind: 'with' })
              : (): void => setPicker({ kind: 'assignee' });
        return renderPeopleRow(entry.label, entities, control.placeholder, open);
      }
      case 'channels':
        return renderPeopleRow(entry.label, draft.inChannels, control.placeholder, () =>
          setPicker({ kind: 'in' }),
        );
      case 'mentions':
        return (
          <View className='mb-4'>
            {fieldLabel(entry.label)}
            <Text className='mb-2 text-[13px]' style={{ color: muted }}>
              {control.placeholder}
            </Text>
            {renderPeopleRow('People', draft.mentionUsers, 'Add people', () =>
              setPicker({ kind: 'mentionUsers' }),
            )}
            {renderPeopleRow('Channels', draft.mentionChannels, 'Add channels', () =>
              setPicker({ kind: 'mentionChannels' }),
            )}
            {renderPeopleRow('Groups', draft.mentionGroups, 'Add groups', () =>
              setPicker({ kind: 'mentionGroups' }),
            )}
          </View>
        );
      case 'boards':
        return renderPeopleRow(entry.label, draft.boards, control.placeholder, () =>
          setPicker({ kind: 'boards' }),
        );
      case 'sort':
        // Inline chips — a nested sheet for 3 options left a stuck touch-blocker
        // when dynamic sizing failed to measure short content.
        return (
          <View className='mb-4'>
            {fieldLabel(entry.label)}
            <View className='flex-row flex-wrap gap-2'>
              {SORT_OPTIONS.map(option => {
                const selected = draft.sortBy === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      void haptics.buttonTap();
                      patch({ sortBy: option.value });
                    }}
                    className='rounded-full border px-3 py-1.5'
                    style={{
                      borderColor: selected ? accentText : border,
                      backgroundColor: selected ? `${accentText}22` : inputBg,
                    }}
                  >
                    <Text className='text-[13px]' style={{ color: selected ? accentText : muted }}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      case 'rank':
        return (
          <View className='mb-4'>
            {fieldLabel(entry.label)}
            <Pressable
              onPress={() => {
                void haptics.buttonTap();
                setRankOpen(true);
              }}
              className='flex-row items-center justify-between rounded-xl border px-3 py-3'
              style={{ borderColor: border, backgroundColor: inputBg }}
            >
              <Text className='text-[15px]' style={{ color: fieldText }}>
                {rankLabel(tab, draft.rankProfile)}
              </Text>
              <ChevronDown size={16} color={muted} />
            </Pressable>
          </View>
        );
      case 'enumSingle':
        return (
          <View className='mb-4'>
            {fieldLabel(entry.label)}
            <Pressable
              onPress={() => {
                void haptics.buttonTap();
                setPriorityOpen(true);
              }}
              className='flex-row items-center justify-between rounded-xl border px-3 py-3'
              style={{ borderColor: border, backgroundColor: inputBg }}
            >
              <Text className='text-[15px]' style={{ color: draft.priority ? fieldText : muted }}>
                {PRIORITY_OPTIONS.find(opt => opt.value === draft.priority)?.label ??
                  control.anyLabel}
              </Text>
              <ChevronDown size={16} color={muted} />
            </Pressable>
          </View>
        );
      case 'text':
        return (
          <View className='mb-4'>
            {fieldLabel(entry.label)}
            <TextInput
              value={
                textDrafts[entry.id] ??
                (control.field === 'tags' ? draft.tags : draft.entities).join(', ')
              }
              onChangeText={text => setTextDrafts(prev => ({ ...prev, [entry.id]: text }))}
              placeholder={control.placeholder}
              placeholderTextColor={muted}
              className='rounded-xl border px-3 py-3 text-[15px]'
              style={{ borderColor: border, backgroundColor: inputBg, color: fieldText }}
              autoCapitalize='none'
              autoCorrect={false}
            />
          </View>
        );
      case 'date':
        return (
          <View className='mb-4'>
            {fieldLabel(entry.label)}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {[...DATE_RANGE_OPTIONS, ...DATE_MODES].map(option => {
                const selected =
                  option.value === dateMode ||
                  (!dateMode && option.value === draft.dateRange) ||
                  (option.value === '' &&
                    !dateMode &&
                    !draft.dateRange &&
                    !draft.after &&
                    !draft.before);
                return (
                  <Pressable
                    key={option.value || 'any'}
                    onPress={() => {
                      void haptics.buttonTap();
                      const asMode = DATE_MODES.find(item => item.value === option.value)?.value;
                      if (asMode) {
                        setPendingDateMode(asMode);
                        return;
                      }
                      setDateMode('');
                      patch({ dateRange: option.value, after: '', before: '' });
                    }}
                    className='rounded-full border px-3 py-1.5'
                    style={{
                      borderColor: selected ? accentText : border,
                      backgroundColor: selected ? `${accentText}22` : inputBg,
                    }}
                  >
                    <Text className='text-[13px]' style={{ color: selected ? accentText : muted }}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {draft.after || draft.before ? (
              <Pressable
                onPress={() => setPendingDateMode(dateModeFor(draft) || '__range__')}
                className='mt-2 rounded-xl border px-3 py-3'
                style={{ borderColor: border, backgroundColor: inputBg }}
              >
                <Text className='text-[15px]' style={{ color: fieldText }}>
                  {describeDateBounds(draft.after, draft.before)}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      case 'checkbox': {
        const field = control.field;
        return (
          <View className='mb-4 flex-row items-center justify-between py-1'>
            <Text className='text-[15px]' style={{ color: fieldText }}>
              {entry.label}
            </Text>
            <Switch
              value={draft[field]}
              onValueChange={value => {
                void (value ? haptics.toggleOn() : haptics.toggleOff());
                patch({ [field]: value });
              }}
            />
          </View>
        );
      }
      default:
        return null;
    }
  };

  return (
    <>
      <AppBottomSheet
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        onDismiss={onDismiss}
        mode='fullscreen'
        keyboardBehavior='extend'
        backdropOpacity={0.4}
      >
        <FilterSheetHeader
          title='Filter by'
          onCancel={() => {
            void haptics.buttonTap();
            onOpenChange(false);
          }}
          onApply={applyAndClose}
        />
        <BottomSheetScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 }}
          keyboardShouldPersistTaps='handled'
        >
          {fieldEntries.map(entry => (
            <View key={entry.id}>{renderControl(entry)}</View>
          ))}

          {carried.length > 0 ? (
            <View className='mb-4'>
              <Text className='mb-1.5 text-[13px] font-medium text-bottomsheet-text-header'>
                From your search
              </Text>
              <View className='flex-row flex-wrap gap-2'>
                {carried.map(token => (
                  <Pressable
                    key={token.key}
                    onPress={() => {
                      void haptics.buttonTap();
                      patch(token.clear);
                    }}
                    className='flex-row items-center gap-1 rounded-full border px-2.5 py-1'
                    style={{ borderColor: border }}
                  >
                    <Text
                      className='max-w-[160px] text-[12px] text-bottomsheet-container-foreground'
                      numberOfLines={1}
                    >
                      {token.label}
                    </Text>
                    <X size={12} color={muted} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View className='mt-2 flex-row justify-end gap-2'>
            <Pressable
              disabled={draftCount === 0}
              onPress={clearFilters}
              className='rounded-lg border px-3 py-2'
              style={{ borderColor: border, opacity: draftCount === 0 ? 0.4 : 1 }}
            >
              <Text className='text-[13px] font-medium text-bottomsheet-container-foreground'>
                {draftCount > 0 ? `Clear filters (${draftCount})` : 'Clear filters'}
              </Text>
            </Pressable>
            <Pressable
              onPress={applyAndClose}
              className='rounded-lg px-3 py-2'
              style={{ backgroundColor: accentText }}
            >
              <Text className='text-[13px] font-medium text-white'>Search</Text>
            </Pressable>
          </View>
        </BottomSheetScrollView>
      </AppBottomSheet>

      <FromFilterSheet
        isOpen={
          picker?.kind === 'from' ||
          picker?.kind === 'with' ||
          picker?.kind === 'assignee' ||
          picker?.kind === 'mentionUsers'
        }
        onClose={() => setPicker(null)}
        selected={entitiesToChips(
          picker?.kind === 'with'
            ? draft.withUsers
            : picker?.kind === 'assignee'
              ? draft.assignees
              : picker?.kind === 'mentionUsers'
                ? draft.mentionUsers
                : draft.fromUsers,
        )}
        title={
          picker?.kind === 'with'
            ? 'With'
            : picker?.kind === 'assignee'
              ? 'Assignee'
              : picker?.kind === 'mentionUsers'
                ? 'Mentions'
                : 'From'
        }
        onApply={chips => {
          const entities = chipsToEntities(chips);
          if (picker?.kind === 'with') patch({ withUsers: entities });
          else if (picker?.kind === 'assignee') patch({ assignees: entities });
          else if (picker?.kind === 'mentionUsers') patch({ mentionUsers: entities });
          else patch({ fromUsers: entities });
          setPicker(null);
        }}
      />

      <InFilterSheet
        isOpen={picker?.kind === 'in' || picker?.kind === 'mentionChannels'}
        onClose={() => setPicker(null)}
        selected={entitiesToInChips(
          picker?.kind === 'mentionChannels' ? draft.mentionChannels : draft.inChannels,
        )}
        excludeDMs={picker?.kind === 'mentionChannels'}
        title={picker?.kind === 'mentionChannels' ? 'Mention channels' : 'In'}
        onApply={chips => {
          const entities = chipsToEntities(chips);
          if (picker?.kind === 'mentionChannels') patch({ mentionChannels: entities });
          else patch({ inChannels: entities });
          setPicker(null);
        }}
      />

      <MentionGroupsSheet
        isOpen={picker?.kind === 'mentionGroups'}
        onClose={() => setPicker(null)}
        selected={draft.mentionGroups}
        onApply={entities => {
          patch({ mentionGroups: entities });
          setPicker(null);
        }}
      />

      <BoardsFilterSheet
        isOpen={picker?.kind === 'boards'}
        onClose={() => setPicker(null)}
        selected={draft.boards}
        onApply={entities => {
          patch({ boards: entities });
          setPicker(null);
        }}
      />

      <PrioritySheet
        isOpen={priorityOpen}
        onClose={() => setPriorityOpen(false)}
        value={draft.priority}
        onPick={value => {
          patch({ priority: value });
          setPriorityOpen(false);
        }}
      />

      <OptionPickerSheet
        isOpen={rankOpen}
        onClose={() => setRankOpen(false)}
        title='Rank'
        options={rankOptions}
        value={draft.rankProfile}
        onPick={value => {
          patch({ rankProfile: value });
          setRankOpen(false);
        }}
      />

      <DateModeSheet
        mode={pendingDateMode}
        initial={{ after: draft.after, before: draft.before }}
        onCancel={() => setPendingDateMode(null)}
        onSave={next => {
          setDateMode(pendingDateMode ?? '');
          patch({ ...next, dateRange: '' });
          setPendingDateMode(null);
        }}
      />
    </>
  );
}

function PrioritySheet({
  isOpen,
  onClose,
  value,
  onPick,
}: {
  isOpen: boolean;
  onClose: () => void;
  value: string;
  onPick: (value: string) => void;
}): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  if (!shouldRender) return null;

  const options = [{ value: '', label: 'Any priority' }, ...PRIORITY_OPTIONS];

  return (
    <AppBottomSheet {...sheetProps} mode='dynamic' backdropOpacity={0.4}>
      <FilterSheetHeader title='Priority' onCancel={onClose} />
      <View className='px-2 pb-4'>
        {options.map(option => (
          <FilterOptionRow
            key={option.value || 'any'}
            title={option.label}
            query=''
            isSelected={value === option.value}
            onPress={() => {
              void haptics.buttonTap();
              onPick(option.value);
            }}
          />
        ))}
      </View>
    </AppBottomSheet>
  );
}

function MentionGroupsSheet({
  isOpen,
  onClose,
  selected,
  onApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  selected: readonly FilterEntity[];
  onApply: (entities: FilterEntity[]) => void;
}): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  if (!shouldRender) return null;

  return <MentionGroupsSheetBody {...sheetProps} selected={selected} onApply={onApply} />;
}

function BoardsFilterSheet({
  isOpen,
  onClose,
  selected,
  onApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  selected: readonly FilterEntity[];
  onApply: (entities: FilterEntity[]) => void;
}): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  if (!shouldRender) return null;

  return <BoardsFilterSheetBody {...sheetProps} selected={selected} onApply={onApply} />;
}

function MentionGroupsSheetBody({
  isOpen,
  onOpenChange,
  onDismiss,
  selected,
  onApply,
}: SheetMountProps & {
  selected: readonly FilterEntity[];
  onApply: (entities: FilterEntity[]) => void;
}): ReactElement {
  const groups = useUserGroups();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<FilterEntity[]>(() => [...selected]);
  const draftIds = useMemo(() => new Set(draft.map(item => item.id)), [draft]);

  const rows = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const filtered = trimmed
      ? groups.filter(group => group.name.toLowerCase().includes(trimmed))
      : groups;
    const asEntities = filtered.map(group => ({ id: group.id, label: group.name }));
    if (trimmed) return asEntities;
    const listed = new Set(asEntities.map(item => item.id));
    const missing = draft.filter(item => !listed.has(item.id));
    return selectionFirst(asEntities, draftIds, missing);
  }, [draft, draftIds, groups, query]);

  return (
    <FilterMultiSelectSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      title='Mention groups'
      searchPlaceholder='Search groups'
      query={query}
      onQueryChange={setQuery}
      selectionCount={draft.length}
      onApply={() => onApply(draft)}
      onClear={() => onApply([])}
    >
      <BottomSheetFlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps='handled'
        renderItem={({ item }) => (
          <FilterOptionRow
            title={item.label}
            query={query}
            isSelected={draftIds.has(item.id)}
            onPress={() => {
              setDraft(prev =>
                prev.some(entry => entry.id === item.id)
                  ? prev.filter(entry => entry.id !== item.id)
                  : [...prev, item],
              );
            }}
          />
        )}
      />
    </FilterMultiSelectSheet>
  );
}

function BoardsFilterSheetBody({
  isOpen,
  onOpenChange,
  onDismiss,
  selected,
  onApply,
}: SheetMountProps & {
  selected: readonly FilterEntity[];
  onApply: (entities: FilterEntity[]) => void;
}): ReactElement {
  const [boards] = useCachedQuery(queries.getAllBoardsList());
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<FilterEntity[]>(() => [...selected]);
  const draftIds = useMemo(() => new Set(draft.map(item => item.id)), [draft]);

  const rows = useMemo(() => {
    const asEntities = (boards ?? [])
      .map(board => {
        const id = board.id;
        const label = (board.name ?? '').trim();
        if (!id || !label) return null;
        return { id, label };
      })
      .filter((item): item is FilterEntity => item !== null);
    const trimmed = query.trim().toLowerCase();
    const filtered = trimmed
      ? asEntities.filter(item => item.label.toLowerCase().includes(trimmed))
      : asEntities;
    if (trimmed) return filtered;
    const listed = new Set(filtered.map(item => item.id));
    const missing = draft.filter(item => !listed.has(item.id));
    return selectionFirst(filtered, draftIds, missing);
  }, [boards, draft, draftIds, query]);

  return (
    <FilterMultiSelectSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      title='Board'
      searchPlaceholder='Search boards'
      query={query}
      onQueryChange={setQuery}
      selectionCount={draft.length}
      onApply={() => onApply(draft)}
      onClear={() => onApply([])}
    >
      <BottomSheetFlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps='handled'
        renderItem={({ item }) => (
          <FilterOptionRow
            title={item.label}
            query={query}
            isSelected={draftIds.has(item.id)}
            onPress={() => {
              setDraft(prev =>
                prev.some(entry => entry.id === item.id)
                  ? prev.filter(entry => entry.id !== item.id)
                  : [...prev, item],
              );
            }}
          />
        )}
      />
    </FilterMultiSelectSheet>
  );
}
