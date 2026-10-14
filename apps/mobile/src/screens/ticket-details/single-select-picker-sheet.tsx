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
import { Pressable, Text, TextInput, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Check, Search } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { InputV2 } from '@/src/components/ui/input-v2';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

import { TicketMetaPickerSheet } from './ticket-meta-picker-sheet';

const ROW_HEIGHT = 56;

export type SingleSelectOption<T extends string = string> = {
  value: T;
  label: string;
};

type SingleSelectPickerSheetProps<T extends string> = {
  isOpen: boolean;
  title?: string;
  options: readonly SingleSelectOption<T>[];
  selectedValue: T | null;
  onClose: () => void;
  onSelect: (value: T) => void;
  /** Optional leading content per row (e.g. priority icon, board color). */
  renderLeading?: (option: SingleSelectOption<T>) => ReactNode;
  /** Shows a search field and filters options by label. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shown when there are no options (or no search matches). */
  emptyLabel?: string;
  /** Cap rendered options after search/filter. Omit to show all. */
  maxVisibleOptions?: number;
};

type SingleSelectRowProps<T extends string> = {
  option: SingleSelectOption<T>;
  isSelected: boolean;
  leading: ReactNode;
  onPress: (value: T) => void;
};

function SingleSelectRowComponent<T extends string>({
  option,
  isSelected,
  leading,
  onPress,
}: SingleSelectRowProps<T>): ReactElement {
  const { accentBg } = useBubbleAccent();

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={option.label}
      onPress={() => onPress(option.value)}
      style={{ height: ROW_HEIGHT }}
      className='flex-row items-center gap-3.5 px-5 active:opacity-70'
    >
      {leading ? <View className='size-6 items-center justify-center'>{leading}</View> : null}
      <Text className='min-w-0 flex-1 text-[16px] font-normal text-foreground' numberOfLines={1}>
        {option.label}
      </Text>
      {isSelected ? <Check size={18} color={accentBg} strokeWidth={2.5} /> : null}
    </Pressable>
  );
}

const SingleSelectRow = memo(SingleSelectRowComponent) as typeof SingleSelectRowComponent;

/**
 * Reusable single-select drawer for ticket meta fields (priority, board, custom
 * SINGLE_SELECT, etc.). Generic over option value so call sites stay type-safe.
 */
export function SingleSelectPickerSheet<T extends string>({
  isOpen,
  title = 'Select',
  options = [],
  selectedValue,
  onClose,
  onSelect,
  renderLeading,
  searchable = false,
  searchPlaceholder = 'Search',
  emptyLabel = 'No options found',
  maxVisibleOptions,
}: SingleSelectPickerSheetProps<T>): ReactElement {
  const inputRef = useRef<TextInput>(null);
  const muted = useCSSVariable('--color-muted') as string;
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) {
      inputRef.current?.blur();
      setQuery('');
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const searchLower = searchable ? query.trim().toLowerCase() : '';
    let list: readonly SingleSelectOption<T>[] = options;
    if (searchLower) {
      list = options.filter(option => option.label.toLowerCase().includes(searchLower));
    }
    if (maxVisibleOptions !== undefined && maxVisibleOptions >= 0) {
      return list.slice(0, maxVisibleOptions);
    }
    return list;
  }, [options, query, searchable, maxVisibleOptions]);

  const handleSelect = useCallback(
    (value: T, dismiss: () => void) => {
      void haptics.selection();
      onSelect(value);
      dismiss();
    },
    [onSelect],
  );

  const emptyMessage =
    options.length === 0
      ? emptyLabel
      : searchable && query.trim()
        ? `No matching ${title.toLowerCase()}`
        : emptyLabel;

  return (
    <TicketMetaPickerSheet isOpen={isOpen} title={title} onClose={onClose}>
      {({ dismiss }) => (
        <View className='min-h-0 flex-1'>
          {searchable ? (
            <View className='px-4 pb-2'>
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
              />
            </View>
          ) : null}

          <BottomSheetFlatList
            data={filteredOptions as SingleSelectOption<T>[]}
            keyExtractor={(item: SingleSelectOption<T>) => item.value}
            renderItem={({ item }: { item: SingleSelectOption<T> }) => (
              <SingleSelectRow
                option={item}
                isSelected={item.value === selectedValue}
                leading={renderLeading?.(item) ?? null}
                onPress={value => handleSelect(value, dismiss)}
              />
            )}
            keyboardShouldPersistTaps='handled'
            keyboardDismissMode={searchable ? 'on-drag' : 'none'}
            contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}
            ListEmptyComponent={
              <View className='flex-1 items-center justify-center px-6 pt-10'>
                <Text className='text-center text-[15px] text-secondary-foreground'>
                  {emptyMessage}
                </Text>
              </View>
            }
          />
        </View>
      )}
    </TicketMetaPickerSheet>
  );
}
