import { memo, useCallback, useMemo, useRef, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import {
  ChevronRight,
  Kanban,
  Layers,
  SignalHigh,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';

import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { haptics } from '@/src/utils/haptics';

import type {
  ChannelTicketsFilterDrawerItem,
  ChannelTicketsFilterKind,
  ChannelTicketsPalette,
} from '../types';

export type ChannelTicketsFilterDrawerProps = {
  isOpen: boolean;
  items: readonly ChannelTicketsFilterDrawerItem[];
  hasActiveFilters: boolean;
  palette: ChannelTicketsPalette;
  /** Safe-area bottom inset, passed in so the view stays free of layout hooks. */
  bottomInset: number;
  onOpenChange: (open: boolean) => void;
  /** Row tap: the parent closes the drawer and opens that filter's value picker. */
  onSelect: (kind: ChannelTicketsFilterKind) => void;
  onClearAll: () => void;
};

/**
 * Sized from a snap point, never from measured content.
 *
 * `mode='dynamic'` makes gorhom derive its only snap point from the height that
 * `BottomSheetView` reports via onLayout. Plain children report nothing, so the
 * snap point stays at zero and the sheet never engages (no onChange, nothing
 * drawn). Even with `BottomSheetView`, the first measurement can lose the race
 * against `snapToIndex(0)` (see `category-filter-sheet.tsx`), which leaves the
 * portal's touch layer stuck over the screen. The row list here is fixed-height,
 * so the height is computed, not measured.
 */
export const DRAWER_ROW_HEIGHT = 64;
/** Drag handle + "Filters" title row + the list's bottom padding. */
export const DRAWER_CHROME_HEIGHT = 96;

/** Exposed for tests: the exact snap height for a given row count. */
export function channelTicketsDrawerHeight(rowCount: number, bottomInset: number): number {
  return DRAWER_CHROME_HEIGHT + rowCount * DRAWER_ROW_HEIGHT + Math.max(bottomInset, 8);
}

const ICON_BY_KIND: Record<ChannelTicketsFilterKind, LucideIcon> = {
  boards: Kanban,
  assignee: UserRound,
  priority: SignalHigh,
  stages: Layers,
};

type FilterRowProps = {
  item: ChannelTicketsFilterDrawerItem;
  palette: ChannelTicketsPalette;
  showDivider: boolean;
  onPress: (kind: ChannelTicketsFilterKind) => void;
};

const FilterRow = memo(function FilterRow({
  item,
  palette,
  showDivider,
  onPress,
}: FilterRowProps): ReactElement {
  const Icon = ICON_BY_KIND[item.kind];
  return (
    <View style={{ height: DRAWER_ROW_HEIGHT }}>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={item.isActive ? `${item.label}: ${item.value}` : item.label}
        testID={`channel-tickets-filter-row-${item.kind}`}
        onPress={() => onPress(item.kind)}
        onPressIn={(): void => {
          void haptics.buttonTap();
        }}
        className='flex-1 flex-row items-center gap-3 px-5 active:opacity-70'
      >
        <View className='h-8 w-8 items-center justify-center'>
          <Icon
            size={20}
            color={item.isActive ? palette.accent : palette.sheetIcon}
            strokeWidth={2}
          />
        </View>
        <View className='min-w-0 flex-1'>
          <Text className='text-[16px]' style={{ color: palette.sheetLabel }} numberOfLines={1}>
            {item.label}
          </Text>
          <Text
            className='mt-0.5 text-[13px]'
            style={{ color: item.isActive ? palette.accent : palette.sheetMuted }}
            numberOfLines={1}
          >
            {item.isActive ? item.value : 'Any'}
          </Text>
        </View>
        <ChevronRight size={18} color={palette.sheetMuted} strokeWidth={2.25} />
      </Pressable>
      {showDivider ? (
        <View className='h-px' style={{ marginLeft: 64, backgroundColor: palette.divider }} />
      ) : null}
    </View>
  );
});

/**
 * Pure drawer view: one sheet listing Boards / Assignee / Priority / Stages with
 * their current values. Tapping a row hands off to that filter's value picker.
 */
export const ChannelTicketsFilterDrawer = memo(function ChannelTicketsFilterDrawer({
  isOpen,
  items,
  hasActiveFilters,
  palette,
  bottomInset,
  onOpenChange,
  onSelect,
  onClearAll,
}: ChannelTicketsFilterDrawerProps): ReactElement {
  const sheetRef = useRef<AppBottomSheetRef>(null);

  const bottomPadding = Math.max(bottomInset, 8);
  const snapPoints = useMemo(
    () => [channelTicketsDrawerHeight(items.length, bottomInset)],
    [items.length, bottomInset],
  );

  const handleClearAll = useCallback(() => {
    void haptics.buttonTap();
    onClearAll();
    sheetRef.current?.dismiss();
  }, [onClearAll]);

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      mode='snap'
      snapPoints={snapPoints}
      backdropOpacity={0.4}
    >
      <BottomSheetView style={{ paddingBottom: bottomPadding }}>
        <View className='h-11 flex-row items-center justify-between px-5'>
          <Text className='text-[17px] font-semibold' style={{ color: palette.sheetHeader }}>
            Filters
          </Text>
          {hasActiveFilters ? (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Clear all filters'
              hitSlop={8}
              onPress={handleClearAll}
              className='active:opacity-60'
            >
              <Text className='text-[14px] font-medium' style={{ color: palette.accent }}>
                Clear all
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View className='pb-4'>
          {items.map((item, index) => (
            <FilterRow
              key={item.kind}
              item={item}
              palette={palette}
              showDivider={index < items.length - 1}
              onPress={onSelect}
            />
          ))}
        </View>
      </BottomSheetView>
    </AppBottomSheet>
  );
});
