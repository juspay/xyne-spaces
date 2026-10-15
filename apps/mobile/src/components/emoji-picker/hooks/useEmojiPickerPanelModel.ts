import type { BottomSheetFlatListMethods } from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ViewToken } from 'react-native';

import { useCustomEmojis } from '@/src/hooks/useCustomEmojis';
import { prefetchMtlsEmojiUris } from '@/src/hooks/useMtlsEmoji';

import { CUSTOM_CATEGORY_ID, EMOJI_CATEGORIES, FREQUENT_CATEGORY_ID } from '../emoji-picker.data';
import { EMOJI_PICKER_SEARCH_DEBOUNCE_MS } from '../emoji-picker.constants';
import {
  buildBrowseListItems,
  buildPickerItemLayouts,
  buildSearchListItems,
} from '../emoji-picker.list-builders';
import type {
  EmojiCategoryBarItem,
  EmojiPickerItemLayout,
  EmojiPickerSelection,
  PickerListItem,
} from '../emoji-picker.types';
import { useEmojiPickerFrequentEmojis } from './useEmojiPickerFrequentEmojis';

/** Warm just the first visible custom row after the sheet finishes opening. */
const CUSTOM_EMOJI_PREFETCH_COUNT = 8;
const CUSTOM_EMOJI_PREFETCH_DELAY_MS = 350;

type UseEmojiPickerPanelModelParams = {
  onSelect: (selection: EmojiPickerSelection) => void;
  showCustomTab?: boolean;
  listRef: RefObject<BottomSheetFlatListMethods | null>;
};

type UseEmojiPickerPanelModelResult = {
  search: string;
  setSearch: (value: string) => void;
  isSearching: boolean;
  listItems: PickerListItem[];
  itemLayouts: EmojiPickerItemLayout[];
  categoryBarItems: EmojiCategoryBarItem[];
  activeCategoryId: string;
  handleSelect: (selection: EmojiPickerSelection) => void;
  handleCategoryPress: (categoryId: string) => void;
  onViewableItemsChanged: (info: { viewableItems: ViewToken[] }) => void;
};

/**
 * Unicode is always available immediately. Custom emoji are appended to the
 * same list once metadata arrives, so a slow `/emojis` response never removes
 * the active virtualized list or blocks scrolling.
 *
 * Deliberately ONE list, never swapped for a different one: an earlier
 * version routed "normal" vs "custom" through two lists behind a tab
 * selector, which crashed/hung the app. Navigation stays within this one list
 * and only changes its scroll position.
 */
export function useEmojiPickerPanelModel({
  onSelect,
  showCustomTab = true,
  listRef,
}: UseEmojiPickerPanelModelParams): UseEmojiPickerPanelModelResult {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState('');
  const isSearching = debouncedSearch.length > 0;

  const { frequentEmojis, recordFrequentEmoji } = useEmojiPickerFrequentEmojis();

  // Metadata only (names/ids) — cheap, and already warmed up by
  // `input-composer-emoji-picker.tsx` while the composer is on screen, so
  // this is typically a cache hit by the time the sheet opens. Per-emoji
  // *images* are resolved lazily per visible cell (see `useMtlsEmoji`), so
  // fetching this list eagerly does not cost any image work up front.
  const {
    data: customEmojis,
    isLoading: customEmojisLoading,
    error: customEmojisError,
  } = useCustomEmojis({
    enabled: showCustomTab,
  });

  // Start warming the first couple of rows of custom-emoji images as soon
  // as their metadata is available — while the user is still looking at
  // standard emoji — so jumping to Custom feels instant instead of showing
  // placeholders. Fire-and-forget; goes through the same concurrency-capped
  // queue as on-demand cell loads, so it can't starve them.
  const hasPrefetchedRef = useRef(false);
  useEffect(() => {
    if (!showCustomTab || hasPrefetchedRef.current || customEmojis.length === 0) return;

    const timeout = setTimeout(() => {
      hasPrefetchedRef.current = true;
      void prefetchMtlsEmojiUris(
        customEmojis.slice(0, CUSTOM_EMOJI_PREFETCH_COUNT).map(emoji => emoji.id),
      );
    }, CUSTOM_EMOJI_PREFETCH_DELAY_MS);

    return (): void => clearTimeout(timeout);
  }, [showCustomTab, customEmojis]);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
    }, EMOJI_PICKER_SEARCH_DEBOUNCE_MS);
    return (): void => {
      clearTimeout(id);
    };
  }, [search]);

  const handleSelect = useCallback(
    (selection: EmojiPickerSelection): void => {
      if (selection.type === 'emoji') {
        recordFrequentEmoji(selection.value);
      }
      onSelect(selection);
    },
    [onSelect, recordFrequentEmoji],
  );

  const browseListData = useMemo(
    () => buildBrowseListItems(frequentEmojis, customEmojis, showCustomTab),
    [frequentEmojis, customEmojis, showCustomTab],
  );

  const searchListItems = useMemo(
    () => buildSearchListItems(debouncedSearch, customEmojis, showCustomTab),
    [debouncedSearch, customEmojis, showCustomTab],
  );

  const listItems = isSearching ? searchListItems : browseListData.items;
  const itemLayouts = useMemo(() => buildPickerItemLayouts(listItems), [listItems]);
  const categoryOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    for (const [categoryId, index] of Object.entries(browseListData.categoryIndices)) {
      const offset = itemLayouts[index]?.offset;
      if (offset !== undefined) offsets[categoryId] = offset;
    }
    return offsets;
  }, [browseListData.categoryIndices, itemLayouts]);

  const categoryBarItems = useMemo((): EmojiCategoryBarItem[] => {
    if (isSearching) return [];

    const categoryIds = [...browseListData.categoryIds];
    const hasCustomSection = categoryIds.includes(CUSTOM_CATEGORY_ID);
    const customIsLoadingWithoutCache =
      showCustomTab && customEmojisLoading && customEmojis.length === 0 && !customEmojisError;

    if (customIsLoadingWithoutCache && !hasCustomSection) {
      const frequentIndex = categoryIds.indexOf(FREQUENT_CATEGORY_ID);
      categoryIds.splice(frequentIndex === -1 ? 0 : frequentIndex + 1, 0, CUSTOM_CATEGORY_ID);
    }

    return categoryIds.map(categoryId => {
      if (categoryId === CUSTOM_CATEGORY_ID) {
        return {
          id: CUSTOM_CATEGORY_ID,
          icon: '',
          useXyneIcon: true,
          disabled: customIsLoadingWithoutCache,
          loading: customIsLoadingWithoutCache,
        };
      }
      if (categoryId === FREQUENT_CATEGORY_ID) return { id: FREQUENT_CATEGORY_ID, icon: '🕒' };

      const category = EMOJI_CATEGORIES.find(item => item.id === categoryId);
      return { id: categoryId, icon: category?.icon ?? '🙂' };
    });
  }, [
    browseListData.categoryIds,
    customEmojis.length,
    customEmojisError,
    customEmojisLoading,
    isSearching,
    showCustomTab,
  ]);

  useEffect(() => {
    if (isSearching || categoryBarItems.length === 0) return;
    const activeItem = categoryBarItems.find(item => item.id === activeCategoryId);
    if (activeItem && !activeItem.disabled) return;
    const firstAvailableItem = categoryBarItems.find(item => !item.disabled);
    if (firstAvailableItem) setActiveCategoryId(firstAvailableItem.id);
  }, [activeCategoryId, categoryBarItems, isSearching]);

  const handleCategoryPress = useCallback(
    (categoryId: string): void => {
      const offset = categoryOffsets[categoryId];
      if (offset === undefined) return;
      setActiveCategoryId(categoryId);
      listRef.current?.scrollToOffset?.({ offset, animated: false });
    },
    [categoryOffsets, listRef],
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (isSearching) return;

      const visibleHeader = viewableItems
        .filter(token => token.isViewable && token.item?.kind === 'header')
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];

      const categoryId = visibleHeader?.item?.categoryId;
      if (typeof categoryId !== 'string') return;

      if (categoryId === CUSTOM_CATEGORY_ID) {
        setActiveCategoryId(CUSTOM_CATEGORY_ID);
        return;
      }
      setActiveCategoryId(categoryId);
    },
    [isSearching],
  );

  return {
    search,
    setSearch,
    isSearching,
    listItems,
    itemLayouts,
    categoryBarItems,
    activeCategoryId,
    handleSelect,
    handleCategoryPress,
    onViewableItemsChanged,
  };
}
