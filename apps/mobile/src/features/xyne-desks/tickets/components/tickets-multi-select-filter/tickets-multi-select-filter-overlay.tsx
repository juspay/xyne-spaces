import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { LegendList } from '@legendapp/list/react-native';
import { Check, X } from 'lucide-react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { cn } from '@/src/utils/cn';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import {
  TICKETS_MULTI_SELECT_FILTER_DEFAULT_LIMIT,
  TICKETS_MULTI_SELECT_FILTER_SEARCH_LIMIT,
} from '../../constants';

const ROW_HEIGHT = 56;
const FOOTER_ACTIONS_HEIGHT = 52;

export type TicketsMultiSelectFilterOption = {
  id: string;
  label: string;
  subtitle?: string;
};

type TicketsMultiSelectFilterOverlayProps = {
  progress: SharedValue<number>;
  isOpen: boolean;
  title: string;
  searchPlaceholder: string;
  emptyLabel: string;
  /** Currently applied ids (synced into draft when overlay opens). */
  selectedIds: readonly string[];
  options: readonly TicketsMultiSelectFilterOption[];
  onClose: () => void;
  /** Persist draft selection (Save) or empty list (Clear), then parent closes. */
  onApply: (ids: string[]) => void;
  /** Default multi. Use single when the query accepts one id (Label). */
  selectionMode?: 'single' | 'multi';
  defaultLimit?: number;
  searchLimit?: number;
};

type OptionRowProps = {
  option: TicketsMultiSelectFilterOption;
  isSelected: boolean;
  selectionMode: 'single' | 'multi';
  onToggle: (id: string) => void;
};

const OptionRow = memo(function OptionRow({
  option,
  isSelected,
  selectionMode,
  onToggle,
}: OptionRowProps) {
  const { accentBg, accentFg } = useBubbleAccent();
  const checkColor = accentFg;

  return (
    <Pressable
      accessibilityRole={selectionMode === 'single' ? 'radio' : 'checkbox'}
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={option.label}
      onPress={() => onToggle(option.id)}
      style={{ height: ROW_HEIGHT }}
      className='flex-row items-center gap-3.5 px-4 active:opacity-70'
    >
      <View className='min-w-0 flex-1 justify-center'>
        <Text className='text-[16px] font-normal text-foreground' numberOfLines={1}>
          {option.label}
        </Text>
        {option.subtitle ? (
          <Text className='mt-0.5 text-[13px] text-foreground/40' numberOfLines={1}>
            {option.subtitle}
          </Text>
        ) : null}
      </View>
      <View
        className={cn(
          'size-5 items-center justify-center rounded-full border-2',
          isSelected ? '' : 'border-foreground/30 bg-transparent',
        )}
        style={isSelected ? { borderColor: accentBg, backgroundColor: accentBg } : undefined}
      >
        {isSelected ? <Check size={12} color={checkColor} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
});

function buildCandidates(
  options: readonly TicketsMultiSelectFilterOption[],
  selectedIds: readonly string[],
  searchTerm: string,
  defaultLimit: number,
  searchLimit: number,
): TicketsMultiSelectFilterOption[] {
  const selectedSet = new Set(selectedIds);
  const searchLower = searchTerm.toLowerCase().trim();
  const byId = new Map(options.map(o => [o.id, o]));

  let list: TicketsMultiSelectFilterOption[];

  if (searchLower) {
    list = options.filter(
      o =>
        o.label.toLowerCase().includes(searchLower) ||
        o.subtitle?.toLowerCase().includes(searchLower),
    );
  } else {
    const seen = new Set<string>();
    list = [];

    for (const id of selectedIds) {
      if (seen.has(id)) continue;
      const option = byId.get(id);
      if (option) {
        seen.add(id);
        list.push(option);
      }
    }

    let added = 0;
    for (const option of options) {
      if (seen.has(option.id)) continue;
      seen.add(option.id);
      list.push(option);
      added += 1;
      if (added >= defaultLimit) break;
    }
  }

  return list
    .sort((a, b) => {
      const aSel = selectedSet.has(a.id) ? 1 : 0;
      const bSel = selectedSet.has(b.id) ? 1 : 0;
      if (bSel !== aSel) return bSel - aSel;
      return a.label.localeCompare(b.label);
    })
    .slice(0, searchLimit);
}

/**
 * Full-screen multi-select filter overlay — same Gmail picker layout as Assignee.
 * Draft until Save / Clear. Used by Stages, AI Category, and User Groups.
 */
export const TicketsMultiSelectFilterOverlay = memo(function TicketsMultiSelectFilterOverlay({
  progress,
  isOpen,
  title,
  searchPlaceholder,
  emptyLabel,
  selectedIds,
  options,
  onClose,
  onApply,
  selectionMode = 'multi',
  defaultLimit = TICKETS_MULTI_SELECT_FILTER_DEFAULT_LIMIT,
  searchLimit = TICKETS_MULTI_SELECT_FILTER_SEARCH_LIMIT,
}: TicketsMultiSelectFilterOverlayProps) {
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const { topSafeHeight, headerHeight } = useHeaderHeight();
  const { accentBg: saveBg, accentFg: saveFg } = useBubbleAccent();
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-muted') as string;

  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [draftIds, setDraftIds] = useState<string[]>(() => [...selectedIds]);

  const footerBottomPad = Math.max(insets.bottom, 10);
  const listBottomPad = FOOTER_ACTIONS_HEIGHT + footerBottomPad + 12;

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!isOpen) {
      inputRef.current?.blur();
      return;
    }
    setDraftIds([...selectedIds]);
    setQuery('');
    setSearchTerm('');
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [isOpen, selectedIds]);

  const candidates = useMemo(
    () => buildCandidates(options, draftIds, searchTerm, defaultLimit, searchLimit),
    [options, draftIds, searchTerm, defaultLimit, searchLimit],
  );

  const draftSet = useMemo(() => new Set(draftIds), [draftIds]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(progress.value, [0, 1], [18, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const handleToggle = useCallback(
    (id: string) => {
      setDraftIds(prev =>
        selectionMode === 'single'
          ? prev.includes(id)
            ? []
            : [id]
          : prev.includes(id)
            ? prev.filter(x => x !== id)
            : [...prev, id],
      );
    },
    [selectionMode],
  );

  const handleSave = useCallback(() => {
    Keyboard.dismiss();
    onApply(draftIds);
  }, [draftIds, onApply]);

  const handleClear = useCallback(() => {
    Keyboard.dismiss();
    onApply([]);
  }, [onApply]);

  const renderItem = useCallback(
    ({ item }: { item: TicketsMultiSelectFilterOption }) => (
      <OptionRow
        option={item}
        isSelected={draftSet.has(item.id)}
        selectionMode={selectionMode}
        onToggle={handleToggle}
      />
    ),
    [draftSet, handleToggle, selectionMode],
  );

  const keyExtractor = useCallback((item: TicketsMultiSelectFilterOption) => item.id, []);
  const getFixedItemSize = useCallback(() => ROW_HEIGHT, []);

  const listEmpty = (
    <View className='items-center px-6 py-16'>
      <Text className='text-[15px] text-foreground/60'>
        {query.trim() ? 'No matches found' : emptyLabel}
      </Text>
    </View>
  );

  const canClear = draftIds.length > 0 || selectedIds.length > 0;
  const canSave = draftIds.length > 0;

  return (
    <Animated.View
      pointerEvents={isOpen ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { zIndex: 70 }, rootStyle]}
      className='bg-neutral-100 dark:bg-tabs-screen'
    >
      <View style={{ paddingTop: topSafeHeight }}>
        <View style={{ height: headerHeight }} className='flex-row items-center px-1'>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={`Close ${title} filter`}
            hitSlop={8}
            onPress={handleClose}
            className='size-11 items-center justify-center'
          >
            <X size={22} color={foreground} strokeWidth={2} />
          </Pressable>
          <Text className='text-[20px] font-normal text-foreground'>{title}</Text>
          {selectedIds.length > 0 ? (
            <View className='ml-2 flex-row items-center gap-2'>
              <Text className='text-[15px] font-medium text-foreground'>
                • {selectedIds.length} selected
              </Text>
            </View>
          ) : null}
        </View>

        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          placeholderTextColor={muted}
          className='px-4 pb-3 pt-1 text-[16px] text-foreground'
          autoCorrect={false}
          autoCapitalize='none'
          returnKeyType='search'
          clearButtonMode='while-editing'
        />
        <View className='mx-4 h-px bg-foreground/12' />
      </View>

      <LegendList
        data={candidates}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        recycleItems
        getFixedItemSize={getFixedItemSize}
        estimatedItemSize={ROW_HEIGHT}
        ListEmptyComponent={listEmpty}
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        extraData={draftSet}
        style={styles.list}
        contentContainerStyle={
          candidates.length === 0
            ? styles.emptyContent
            : { paddingTop: 8, paddingBottom: listBottomPad }
        }
        className='bg-neutral-100 dark:bg-tabs-screen'
      />

      <KeyboardStickyView
        offset={{ closed: 0, opened: insets.bottom - 2 }}
        style={styles.stickyFooter}
      >
        <View
          style={{ paddingBottom: footerBottomPad }}
          className='flex-row gap-3 bg-neutral-100 px-4 pt-2 dark:bg-tabs-screen'
        >
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={`Clear ${title} filter`}
            disabled={!canClear}
            onPress={handleClear}
            className={cn(
              'flex-1 items-center justify-center rounded-full border border-foreground/20 py-3 active:opacity-70',
              !canClear && 'opacity-40',
            )}
          >
            <Text className='text-[15px] font-medium text-foreground'>Clear</Text>
          </Pressable>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={`Save ${title} filter`}
            accessibilityState={{ disabled: !canSave }}
            disabled={!canSave}
            onPress={handleSave}
            className={cn(
              'flex-1 items-center justify-center rounded-full py-3 active:opacity-80',
              !canSave && 'opacity-40',
            )}
            style={{ backgroundColor: saveBg }}
          >
            <Text className='text-[15px] font-medium' style={{ color: saveFg }}>
              Save
            </Text>
          </Pressable>
        </View>
      </KeyboardStickyView>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  emptyContent: {
    flexGrow: 1,
  },
  stickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
