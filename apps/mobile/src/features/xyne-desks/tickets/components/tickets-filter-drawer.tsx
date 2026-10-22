import { memo, useCallback, useMemo, useRef, type ReactElement } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';
import {
  Calendar,
  ChevronRight,
  FilePenLine,
  GitBranch,
  Layers,
  SignalHigh,
  Sparkles,
  Tag,
  Tags,
  UserCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { Switch } from '@/src/components/ui/switch';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

import type { TicketsFilterDrawerItem, TicketsFilterKind } from '../types';

export type TicketsFilterDrawerToggleKind = 'myTickets' | 'hasAiDraft' | 'hasSubTickets';

export type TicketsFilterDrawerProps = {
  isOpen: boolean;
  items: readonly TicketsFilterDrawerItem[];
  hasActiveFilters: boolean;
  onOpenChange: (open: boolean) => void;
  /** Row tap: parent closes the drawer and opens that filter's picker. */
  onSelect: (item: TicketsFilterDrawerItem) => void;
  /** Toggle rows: flip without closing the drawer. */
  onToggle: (kind: TicketsFilterDrawerToggleKind, next: boolean) => void;
  onClearAll: () => void;
};

export const TICKETS_FILTER_DRAWER_ROW_HEIGHT = 64;
/** Drag handle + "Filters" title row + list bottom padding. */
export const TICKETS_FILTER_DRAWER_CHROME_HEIGHT = 96;

export function ticketsFilterDrawerHeight(rowCount: number, bottomInset: number): number {
  return (
    TICKETS_FILTER_DRAWER_CHROME_HEIGHT +
    rowCount * TICKETS_FILTER_DRAWER_ROW_HEIGHT +
    Math.max(bottomInset, 8)
  );
}

const ICON_BY_KIND: Record<TicketsFilterKind, LucideIcon> = {
  myTickets: UserCheck,
  assignee: UserRound,
  priority: SignalHigh,
  stages: Layers,
  hasAiDraft: FilePenLine,
  hasSubTickets: GitBranch,
  aiCategory: Sparkles,
  aiTags: Tags,
  userGroups: Users,
  createdBy: UserRound,
  label: Tag,
  dynamicField: Layers,
  lastUpdated: Calendar,
  date: Calendar,
};

type FilterRowProps = {
  item: TicketsFilterDrawerItem;
  accent: string;
  sheetLabel: string;
  sheetMuted: string;
  sheetIcon: string;
  divider: string;
  showDivider: boolean;
  onPress: (item: TicketsFilterDrawerItem) => void;
  onToggle: (kind: TicketsFilterDrawerToggleKind, next: boolean) => void;
};

const FilterRow = memo(function FilterRow({
  item,
  accent,
  sheetLabel,
  sheetMuted,
  sheetIcon,
  divider,
  showDivider,
  onPress,
  onToggle,
}: FilterRowProps): ReactElement {
  const Icon = ICON_BY_KIND[item.kind];
  const isToggle = item.variant === 'toggle';

  return (
    <View style={{ height: TICKETS_FILTER_DRAWER_ROW_HEIGHT }}>
      {isToggle ? (
        <View className='flex-1 flex-row items-center gap-3 px-5'>
          <View className='h-8 w-8 items-center justify-center'>
            <Icon size={20} color={item.isActive ? accent : sheetIcon} strokeWidth={2} />
          </View>
          <View className='min-w-0 flex-1'>
            <Text className='text-[16px]' style={{ color: sheetLabel }} numberOfLines={1}>
              {item.label}
            </Text>
            <Text
              className='mt-0.5 text-[13px]'
              style={{ color: item.isActive ? accent : sheetMuted }}
              numberOfLines={1}
            >
              {item.isActive ? item.value : 'Off'}
            </Text>
          </View>
          <Switch
            isSelected={item.isActive}
            onSelectedChange={(next): void => {
              void haptics.buttonTap();
              onToggle(item.kind as TicketsFilterDrawerToggleKind, next);
            }}
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={item.isActive ? `${item.label}: ${item.value}` : item.label}
          onPress={() => onPress(item)}
          onPressIn={(): void => {
            void haptics.buttonTap();
          }}
          className='flex-1 flex-row items-center gap-3 px-5 active:opacity-70'
        >
          <View className='h-8 w-8 items-center justify-center'>
            <Icon size={20} color={item.isActive ? accent : sheetIcon} strokeWidth={2} />
          </View>
          <View className='min-w-0 flex-1'>
            <Text className='text-[16px]' style={{ color: sheetLabel }} numberOfLines={1}>
              {item.label}
            </Text>
            <Text
              className='mt-0.5 text-[13px]'
              style={{ color: item.isActive ? accent : sheetMuted }}
              numberOfLines={1}
            >
              {item.isActive ? item.value : 'Any'}
            </Text>
          </View>
          <ChevronRight size={18} color={sheetMuted} strokeWidth={2.25} />
        </Pressable>
      )}
      {showDivider ? (
        <View className='h-px' style={{ marginLeft: 64, backgroundColor: divider }} />
      ) : null}
    </View>
  );
});

/**
 * Desk tickets Filters sheet: lists each filter with its current value.
 * Tapping a nav row hands off to that filter's picker; toggles flip in-place.
 */
export const TicketsFilterDrawer = memo(function TicketsFilterDrawer({
  isOpen,
  items,
  hasActiveFilters,
  onOpenChange,
  onSelect,
  onToggle,
  onClearAll,
}: TicketsFilterDrawerProps): ReactElement {
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { accentText } = useBubbleAccent();
  const sheetHeader = useCSSVariable('--color-bottomsheet-text-header') as string;
  const sheetLabel = useCSSVariable('--color-bottomsheet-container-foreground') as string;
  const sheetMuted = useCSSVariable('--color-bottomsheet-text-muted') as string;
  const sheetIcon = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const divider = useCSSVariable('--color-settings-row-divider') as string;

  const bottomPadding = Math.max(insets.bottom, 8);
  const contentHeight = ticketsFilterDrawerHeight(items.length, insets.bottom);
  const maxHeight = Math.round(windowHeight * 0.85);
  const snapPoints = useMemo(
    () => [Math.min(contentHeight, maxHeight)],
    [contentHeight, maxHeight],
  );
  const needsScroll = contentHeight > maxHeight;

  const handleClearAll = useCallback(() => {
    void haptics.buttonTap();
    onClearAll();
    sheetRef.current?.dismiss();
  }, [onClearAll]);

  const rows = (
    <View className='pb-4'>
      {items.map((item, index) => (
        <FilterRow
          key={item.kind === 'dynamicField' ? `dynamicField:${item.fieldId}` : item.kind}
          item={item}
          accent={accentText}
          sheetLabel={sheetLabel}
          sheetMuted={sheetMuted}
          sheetIcon={sheetIcon}
          divider={divider}
          showDivider={index < items.length - 1}
          onPress={onSelect}
          onToggle={onToggle}
        />
      ))}
    </View>
  );

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      mode='snap'
      snapPoints={snapPoints}
      backdropOpacity={0.4}
    >
      <BottomSheetView style={{ paddingBottom: bottomPadding, maxHeight }}>
        <View className='h-11 flex-row items-center justify-between px-5'>
          <Text className='text-[17px] font-semibold' style={{ color: sheetHeader }}>
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
              <Text className='text-[14px] font-medium' style={{ color: accentText }}>
                Clear all
              </Text>
            </Pressable>
          ) : null}
        </View>

        {needsScroll ? (
          <BottomSheetScrollView
            style={{ maxHeight: maxHeight - TICKETS_FILTER_DRAWER_CHROME_HEIGHT }}
          >
            {rows}
          </BottomSheetScrollView>
        ) : (
          rows
        )}
      </BottomSheetView>
    </AppBottomSheet>
  );
});
