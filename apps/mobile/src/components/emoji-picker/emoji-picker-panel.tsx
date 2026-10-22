import type { BottomSheetFlatListMethods } from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { EmojiPickerCategoryBar } from './atoms/emoji-picker-category-bar';
import { EmojiPickerList } from './atoms/emoji-picker-list';
import { EmojiPickerSearch } from './atoms/emoji-picker-search';
import { logEmojiPickerDiagnostic } from './emoji-picker-diagnostics';
import { useEmojiPickerPanelModel } from './hooks/useEmojiPickerPanelModel';
import type { EmojiPickerSelection } from './emoji-picker.types';

type EmojiPickerPanelProps = {
  onSelect: (selection: EmojiPickerSelection) => void;
  className?: string;
  height?: number;
  showCustomTab?: boolean;
  isOpen: boolean;
  traceId: string;
};

const EmojiPickerPanel = ({
  onSelect,
  className,
  height,
  showCustomTab = true,
  isOpen,
  traceId,
}: EmojiPickerPanelProps): ReactElement => {
  const listRef = useRef<BottomSheetFlatListMethods>(null);
  const lastLayoutHeightRef = useRef<number | null>(null);
  const foreground = useCSSVariable('--color-foreground') as string;

  const {
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
  } = useEmojiPickerPanelModel({
    onSelect,
    showCustomTab,
    listRef,
  });

  const showCategoryBar = !isSearching && categoryBarItems.length > 0;

  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const height = Math.round(event.nativeEvent.layout.height);
      if (lastLayoutHeightRef.current === height) return;
      lastLayoutHeightRef.current = height;
      logEmojiPickerDiagnostic(traceId, 'panel_layout', { height });
    },
    [traceId],
  );

  useEffect(() => {
    logEmojiPickerDiagnostic(traceId, 'picker_model_updated', {
      isOpen,
      isSearching,
      listItemCount: listItems.length,
      categoryCount: categoryBarItems.length,
      activeCategoryId,
      hasCustomCategory: categoryBarItems.some(item => item.id === 'custom'),
      customCategoryDisabled:
        categoryBarItems.find(item => item.id === 'custom')?.disabled ?? false,
    });
  }, [activeCategoryId, categoryBarItems, isOpen, isSearching, listItems.length, traceId]);

  return (
    <View
      {...(className !== undefined ? { className } : {})}
      style={height !== undefined ? { height } : { flex: 1, minHeight: 0 }}
      onLayout={handleLayout}
    >
      <EmojiPickerSearch value={search} onChangeText={setSearch} foreground={foreground} />

      <EmojiPickerList
        listRef={listRef}
        items={listItems}
        itemLayouts={itemLayouts}
        isSearching={isSearching}
        traceId={traceId}
        onSelect={handleSelect}
        onViewableItemsChanged={onViewableItemsChanged}
      />

      {showCategoryBar ? (
        <EmojiPickerCategoryBar
          items={categoryBarItems}
          traceId={traceId}
          activeCategoryId={activeCategoryId}
          onSelectCategory={handleCategoryPress}
        />
      ) : null}
    </View>
  );
};

EmojiPickerPanel.displayName = 'EmojiPickerPanel';

export { EmojiPickerPanel };
