import { BottomSheetFlatList, type BottomSheetFlatListMethods } from '@gorhom/bottom-sheet';
import { memo, useCallback, useMemo, useRef, type ReactElement, type RefObject } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from 'react-native';

import {
  EMOJI_PICKER_ROW_HEIGHT,
  EMOJI_PICKER_VIEWABILITY_CONFIG,
} from '../emoji-picker.constants';
import type {
  EmojiPickerItemLayout,
  EmojiPickerSelection,
  PickerListItem,
} from '../emoji-picker.types';
import { EmojiPickerCustomEmojiRow } from './emoji-picker-custom-emoji-row';
import { EmojiPickerEmojiRow } from './emoji-picker-emoji-row';
import { EmojiPickerListEmpty } from './emoji-picker-list-empty';
import { EmojiPickerSectionHeader } from './emoji-picker-section-header';
import { logEmojiPickerDiagnostic } from '../emoji-picker-diagnostics';

type EmojiPickerListProps = {
  listRef: RefObject<BottomSheetFlatListMethods | null>;
  items: PickerListItem[];
  itemLayouts: EmojiPickerItemLayout[];
  isSearching: boolean;
  traceId: string;
  onSelect: (selection: EmojiPickerSelection) => void;
  onViewableItemsChanged: (info: { viewableItems: ViewToken[] }) => void;
};

const EmojiPickerList = memo(function EmojiPickerList({
  listRef,
  items,
  itemLayouts,
  isSearching,
  traceId,
  onSelect,
  onViewableItemsChanged,
}: EmojiPickerListProps): ReactElement {
  const scrollStartedRef = useRef(false);
  const renderItem = useCallback(
    ({ item }: { item: PickerListItem }) => {
      if (item.kind === 'header') {
        return <EmojiPickerSectionHeader label={item.label} />;
      }
      if (item.kind === 'emoji-row') {
        return <EmojiPickerEmojiRow row={item.row} onSelect={onSelect} />;
      }
      return <EmojiPickerCustomEmojiRow row={item.row} onSelect={onSelect} />;
    },
    [onSelect],
  );

  const keyExtractor = useCallback((item: PickerListItem) => item.id, []);
  const getItemLayout = useCallback(
    (_: ArrayLike<PickerListItem> | null | undefined, index: number) =>
      itemLayouts[index] ?? { index, length: EMOJI_PICKER_ROW_HEIGHT, offset: 8 },
    [itemLayouts],
  );

  const contentContainerStyle = useMemo(
    () => ({
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 8,
    }),
    [],
  );

  const listEmpty = isSearching ? <EmojiPickerListEmpty /> : null;
  const handleScrollBeginDrag = useCallback((): void => {
    scrollStartedRef.current = true;
    logEmojiPickerDiagnostic(traceId, 'list_scroll_begin', { itemCount: items.length });
  }, [items.length, traceId]);
  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      logEmojiPickerDiagnostic(traceId, 'list_scroll_end', {
        offsetY: Math.round(event.nativeEvent.contentOffset.y),
        receivedScrollMovement: scrollStartedRef.current,
      });
    },
    [traceId],
  );
  const handleContentSizeChange = useCallback(
    (width: number, height: number): void => {
      logEmojiPickerDiagnostic(traceId, 'list_content_size', {
        width: Math.round(width),
        height: Math.round(height),
        itemCount: items.length,
      });
    },
    [items.length, traceId],
  );
  return (
    <BottomSheetFlatList
      ref={listRef}
      data={items}
      keyExtractor={keyExtractor}
      getItemLayout={getItemLayout}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={3}
      // Android defaults this on. Clipping unmaps GIF bitmaps while HWUI is
      // still decoding them (SIGSEGV MAPERR on RenderThread).
      removeClippedSubviews={false}
      style={{ flex: 1, minHeight: 0 }}
      keyboardShouldPersistTaps='handled'
      keyboardDismissMode='on-drag'
      showsVerticalScrollIndicator={false}
      onScrollBeginDrag={handleScrollBeginDrag}
      onMomentumScrollEnd={handleMomentumScrollEnd}
      onContentSizeChange={handleContentSizeChange}
      contentContainerStyle={contentContainerStyle}
      renderItem={renderItem}
      ListEmptyComponent={listEmpty}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={EMOJI_PICKER_VIEWABILITY_CONFIG}
    />
  );
});

EmojiPickerList.displayName = 'EmojiPickerList';

export { EmojiPickerList };
