import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Check, Plus, Search, X } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { GlassButton } from '@/src/components/ui/glass-button';
import { InputV2 } from '@/src/components/ui/input-v2';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

import { TicketMetaPickerSheet } from './ticket-meta-picker-sheet';

const ROW_PADDING_Y = 12;

export type MultiSelectOption = {
  value: string;
  label: string;
  /** Optional secondary line (e.g. email / description). */
  subtitle?: string;
};

type MultiSelectPickerSheetProps = {
  isOpen: boolean;
  title?: string;
  options: readonly MultiSelectOption[];
  selectedValues: readonly string[];
  onClose: () => void;
  /**
   * Commit the draft selection (called from Done).
   * May be async — the sheet stays open until the promise settles successfully.
   */
  onConfirm: (selectedValues: string[]) => void | Promise<void>;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** Horizontal selected chips under the search field (DM create style). Default true. */
  showSelectedChips?: boolean;
  /** Allow creating a new option from the current search query (draft only until Done). */
  allowCreate?: boolean;
  /** Optional leading content per list row. */
  renderLeading?: (option: MultiSelectOption) => ReactNode;
  /** Optional custom selected chip. Defaults to a text pill with X. */
  renderSelectedChip?: (option: MultiSelectOption, onRemove: () => void) => ReactNode;
};

type ListRow = { kind: 'create'; label: string } | { kind: 'option'; option: MultiSelectOption };

const ActionBar = memo(function ActionBar({
  title,
  onCancel,
  onDone,
}: {
  title: string;
  onCancel: () => void;
  onDone: () => void;
}): ReactElement {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const { accentBg, accentFg } = useBubbleAccent();
  const primaryTextColor = useCSSVariable('--color-primary-bg') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const headerColor = useCSSVariable('--color-bottomsheet-text-header') as string;

  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.actionBarRow, { borderBottomColor: borderColor }]}>
        <GlassButton onPress={onCancel} size={44} height={44} borderRadius={30} isDark={isDark}>
          <X size={24} strokeWidth={2.2} color={foregroundColor} />
        </GlassButton>
        <Text className='text-base font-semibold text-foreground'>{title}</Text>
        <GlassButton
          onPress={onDone}
          size={44}
          height={44}
          borderRadius={30}
          isDark={isDark}
          fillColor={accentBg}
        >
          <Check size={22} color={primaryTextColor} strokeWidth={2.5} />
        </GlassButton>
      </View>
    );
  }

  return (
    <View className='flex-row items-center justify-between' style={{ paddingHorizontal: 14 }}>
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        className='rounded-full p-3 bg-bottomsheet-container-bg'
      >
        <X size={22} color={headerColor} />
      </Pressable>
      <Text className='text-lg font-semibold text-bottomsheet-text-header'>{title}</Text>
      <Pressable
        onPress={onDone}
        className='items-center justify-center rounded-full p-3 active:opacity-70'
        style={{ backgroundColor: accentBg }}
      >
        <Check size={22} color={accentFg} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
});

const OptionRow = memo(function OptionRow({
  option,
  isSelected,
  leading,
  onPress,
}: {
  option: MultiSelectOption;
  isSelected: boolean;
  leading: ReactNode;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole='checkbox'
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={option.label}
      onPress={onPress}
      className='flex-row items-center px-3 py-3 active:bg-secondary/50'
      style={{ paddingVertical: ROW_PADDING_Y }}
    >
      {leading ? <View className='mr-3'>{leading}</View> : null}
      <View className='min-w-0 flex-1'>
        <Text
          className='text-base font-medium text-bottomsheet-container-foreground'
          numberOfLines={1}
        >
          {option.label}
        </Text>
        {option.subtitle ? (
          <Text
            className='mt-0.5 text-xs text-bottomsheet-container-text-secondary'
            numberOfLines={1}
          >
            {option.subtitle}
          </Text>
        ) : null}
      </View>
      <View
        className={cn(
          'size-4.5 items-center justify-center rounded-xs border',
          isSelected ? 'border-[#335E40] bg-[#335E40]' : 'border-gray-300 bg-transparent',
        )}
      >
        {isSelected ? <Check size={14} color='white' strokeWidth={1.6} /> : null}
      </View>
    </Pressable>
  );
});

const CreateRow = memo(function CreateRow({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}): ReactElement {
  const { accentBg } = useBubbleAccent();

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Create ${label}`}
      onPress={onPress}
      className='flex-row items-center gap-3 px-3 py-3 active:bg-secondary/50'
    >
      <Plus size={18} color={accentBg} strokeWidth={2.25} />
      <Text className='min-w-0 flex-1 text-base font-medium text-bottomsheet-container-foreground'>
        Create “{label}”
      </Text>
    </Pressable>
  );
});

const DefaultSelectedChip = memo(function DefaultSelectedChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}): ReactElement {
  const containerBg = useCSSVariable('--color-bottomsheet-container-bg') as string;
  const headerColor = useCSSVariable('--color-bottomsheet-text-header') as string;

  return (
    <Pressable
      onPress={onRemove}
      accessibilityRole='button'
      accessibilityLabel={`Remove ${label}`}
      className='relative max-w-36 flex-row items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5'
    >
      <Text className='text-xs font-medium text-bottomsheet-text-header' numberOfLines={1}>
        {label}
      </Text>
      <View
        className='rounded-full p-0.5'
        style={{ backgroundColor: headerColor, borderWidth: 2, borderColor: containerBg }}
      >
        <X size={10} color={containerBg} />
      </View>
    </Pressable>
  );
});

/**
 * Reusable multi-select drawer styled like Create DM:
 * action bar (X / title / ✓), search, selected chips, checkbox list.
 * Draft selection only; Zero/parent mutations run from Done via `onConfirm`.
 */
export function MultiSelectPickerSheet({
  isOpen,
  title = 'Select',
  options,
  selectedValues,
  onClose,
  onConfirm,
  searchable = true,
  searchPlaceholder = 'Search',
  emptyLabel = 'No options found',
  showSelectedChips = true,
  allowCreate = false,
  renderLeading,
  renderSelectedChip,
}: MultiSelectPickerSheetProps): ReactElement {
  const inputRef = useRef<TextInput>(null);
  const muted = useCSSVariable('--color-muted') as string;
  const [query, setQuery] = useState('');
  const [draftValues, setDraftValues] = useState<string[]>(() => [...selectedValues]);
  const [isConfirming, setIsConfirming] = useState(false);

  const draftSet = useMemo(() => new Set(draftValues), [draftValues]);

  const optionsByValue = useMemo(() => {
    const map = new Map<string, MultiSelectOption>();
    for (const option of options) map.set(option.value, option);
    return map;
  }, [options]);

  const selectedOptions = useMemo(() => {
    const list: MultiSelectOption[] = [];
    for (const value of draftValues) {
      const option = optionsByValue.get(value);
      if (option) {
        list.push(option);
      } else {
        // Draft-created values (or labels not in the project list yet).
        list.push({ value, label: value });
      }
    }
    return list;
  }, [draftValues, optionsByValue]);

  const listOptions = useMemo(() => {
    const byValue = new Map(optionsByValue);
    for (const value of draftValues) {
      if (!byValue.has(value)) byValue.set(value, { value, label: value });
    }
    return Array.from(byValue.values());
  }, [draftValues, optionsByValue]);

  const filteredOptions = useMemo(() => {
    const searchLower = searchable ? query.trim().toLowerCase() : '';
    const base = !searchLower
      ? listOptions
      : listOptions.filter(
          option =>
            option.label.toLowerCase().includes(searchLower) ||
            (option.subtitle?.toLowerCase().includes(searchLower) ?? false),
        );

    return [...base].sort((a, b) => {
      const aSel = draftSet.has(a.value) ? 1 : 0;
      const bSel = draftSet.has(b.value) ? 1 : 0;
      if (bSel !== aSel) return bSel - aSel;
      return 0;
    });
  }, [draftSet, listOptions, query, searchable]);

  const trimmedQuery = query.trim();
  const showCreate =
    allowCreate &&
    trimmedQuery.length > 0 &&
    !listOptions.some(option => option.label.toLowerCase() === trimmedQuery.toLowerCase()) &&
    !draftValues.some(value => value.toLowerCase() === trimmedQuery.toLowerCase());

  const listData = useMemo((): ListRow[] => {
    const rows: ListRow[] = filteredOptions.map(option => ({ kind: 'option', option }));
    if (showCreate) rows.unshift({ kind: 'create', label: trimmedQuery });
    return rows;
  }, [filteredOptions, showCreate, trimmedQuery]);

  useEffect(() => {
    if (!isOpen) {
      inputRef.current?.blur();
      setQuery('');
      setIsConfirming(false);
      return;
    }
    setDraftValues([...selectedValues]);
  }, [isOpen, selectedValues]);

  const handleToggle = useCallback((value: string) => {
    void haptics.selection();
    setDraftValues(current =>
      current.includes(value) ? current.filter(item => item !== value) : [...current, value],
    );
  }, []);

  const handleCreate = useCallback(() => {
    if (!trimmedQuery) return;
    void haptics.selection();
    setDraftValues(current =>
      current.some(value => value.toLowerCase() === trimmedQuery.toLowerCase())
        ? current
        : [...current, trimmedQuery],
    );
    setQuery('');
  }, [trimmedQuery]);

  const handleDone = useCallback(
    (dismiss: () => void) => {
      if (isConfirming) return;
      void haptics.selection();
      setIsConfirming(true);
      void (async () => {
        try {
          await Promise.resolve(onConfirm(draftValues));
          dismiss();
        } catch {
          // Parent surfaces the error (toast). Keep the sheet open so the user can retry.
        } finally {
          setIsConfirming(false);
        }
      })();
    },
    [draftValues, isConfirming, onConfirm],
  );

  const emptyMessage =
    options.length === 0 && !trimmedQuery
      ? emptyLabel
      : trimmedQuery
        ? `No matching ${title.toLowerCase()}`
        : emptyLabel;

  return (
    <TicketMetaPickerSheet
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      renderHeader={({ dismiss }) => (
        <ActionBar title={title} onCancel={dismiss} onDone={() => handleDone(dismiss)} />
      )}
    >
      {() => (
        <View className='mt-4 min-h-0 flex-1 px-4'>
          {searchable ? (
            <InputV2
              inputRef={inputRef}
              value={query}
              onChangeText={setQuery}
              variant='bottomsheet'
              placeholder={searchPlaceholder}
              placeholderTextColor={muted}
              autoCorrect={false}
              autoCapitalize='none'
              returnKeyType='search'
              leftIcon={<Search size={18} color={muted} />}
              clearIconColor={muted}
              inputClassName='font-medium'
            />
          ) : null}

          {showSelectedChips && selectedOptions.length > 0 ? (
            <View className='mt-2 rounded-xl bg-bottomsheet-container-bg'>
              <ScrollView
                horizontal
                contentContainerStyle={{ padding: 12, gap: 12 }}
                keyboardShouldPersistTaps='handled'
                showsHorizontalScrollIndicator={false}
              >
                {selectedOptions.map(option =>
                  renderSelectedChip ? (
                    <View key={option.value}>
                      {renderSelectedChip(option, () => handleToggle(option.value))}
                    </View>
                  ) : (
                    <DefaultSelectedChip
                      key={option.value}
                      label={option.label}
                      onRemove={() => handleToggle(option.value)}
                    />
                  ),
                )}
              </ScrollView>
            </View>
          ) : null}

          <View className='mt-2 min-h-0 flex-1 rounded-[10px]' style={{ minHeight: 0 }}>
            <BottomSheetFlatList
              style={{ flex: 1 }}
              data={listData}
              keyExtractor={(item: ListRow) =>
                item.kind === 'create' ? '__create__' : item.option.value
              }
              renderItem={({ item }: { item: ListRow }) => {
                if (item.kind === 'create') {
                  return <CreateRow label={item.label} onPress={handleCreate} />;
                }
                return (
                  <OptionRow
                    option={item.option}
                    isSelected={draftSet.has(item.option.value)}
                    leading={renderLeading?.(item.option) ?? null}
                    onPress={() => handleToggle(item.option.value)}
                  />
                );
              }}
              keyboardShouldPersistTaps='handled'
              keyboardDismissMode={searchable ? 'on-drag' : 'none'}
              extraData={draftValues}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1, paddingBottom: 8 }}
              ListEmptyComponent={
                <View className='flex-1 items-center justify-center px-6 pt-10'>
                  <Text className='text-center text-[15px] text-bottomsheet-text-header'>
                    {emptyMessage}
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      )}
    </TicketMetaPickerSheet>
  );
}

const styles = StyleSheet.create({
  actionBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 0,
  },
});
