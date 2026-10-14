import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Archive, EllipsisVertical, ListFilter, Mail, Trash2 } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { SearchIcon } from '@/src/components/icons';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import { HeaderBackButton, HeaderIconButton } from '@/src/components/ui/header-icon-button';

type TicketsListHeaderProps = {
  channelName: string;
  isSelecting: boolean;
  selectedCount: number;
  hasActiveFilters: boolean;
  selectionProgress: SharedValue<number>;
  searchProgress: SharedValue<number>;
  onBack: () => void;
  onOpenSearch: () => void;
  onOpenFilters: () => void;
  onExitSelection: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onToggleRead?: () => void;
  onMore?: () => void;
};

export const TicketsListHeader = memo(function TicketsListHeader({
  channelName,
  isSelecting,
  selectedCount,
  hasActiveFilters,
  selectionProgress,
  searchProgress,
  onBack,
  onOpenSearch,
  onOpenFilters,
  onExitSelection,
  onArchive,
  onDelete,
  onToggleRead,
  onMore,
}: TicketsListHeaderProps) {
  const { topSafeHeight, headerHeight } = useHeaderHeight();
  const foreground = useCSSVariable('--color-foreground') as string;
  const { accentBg } = useBubbleAccent();

  const normalStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(selectionProgress.value, [0, 1], [1, 0]) *
      interpolate(searchProgress.value, [0, 0.35], [1, 0], 'clamp'),
  }));

  const selectionStyle = useAnimatedStyle(() => ({
    opacity: selectionProgress.value,
  }));

  const chromeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(searchProgress.value, [0, 0.35], [1, 0], 'clamp'),
  }));

  return (
    <Animated.View
      pointerEvents='box-none'
      style={[{ paddingTop: topSafeHeight, zIndex: 40 }, chromeStyle]}
      className='absolute left-0 right-0 bg-neutral-100 dark:bg-tabs-screen'
    >
      <View style={{ height: headerHeight }} className='justify-center px-3'>
        {/* Normal chrome */}
        <Animated.View
          pointerEvents={isSelecting ? 'none' : 'auto'}
          style={normalStyle}
          className='absolute inset-x-3 inset-y-0 flex-row items-center gap-3'
        >
          <HeaderBackButton
            liquidGlass
            accessibilityLabel='Go back'
            onPress={onBack}
            iconColor={foreground}
          />

          <Text
            className='min-w-0 flex-1 pr-2 text-[17px] font-semibold text-foreground leading-none'
            numberOfLines={1}
            ellipsizeMode='tail'
          >
            {channelName}
          </Text>

          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Search tickets'
            hitSlop={8}
            onPress={onOpenSearch}
            className='size-10 shrink-0 items-center justify-center'
          >
            <SearchIcon size={22} color={foreground} />
          </Pressable>

          <View>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={hasActiveFilters ? 'Filters (active)' : 'Filters'}
              hitSlop={8}
              onPress={onOpenFilters}
              className='size-10 shrink-0 items-center justify-center'
            >
              <ListFilter size={22} color={hasActiveFilters ? accentBg : foreground} />
            </Pressable>
            {hasActiveFilters ? (
              <View
                pointerEvents='none'
                className='absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-neutral-100 dark:border-tabs-screen'
                style={{ backgroundColor: accentBg }}
              />
            ) : null}
          </View>
        </Animated.View>

        {/* Selection chrome */}
        <Animated.View
          pointerEvents={isSelecting ? 'auto' : 'none'}
          style={selectionStyle}
          className='absolute inset-x-3 inset-y-0 flex-row items-center'
        >
          <HeaderBackButton
            liquidGlass
            onPress={onExitSelection}
            iconColor={foreground}
            accessibilityLabel='Exit selection'
          />

          <Text className='ml-1 min-w-8 text-[18px] font-semibold text-foreground'>
            {selectedCount}
          </Text>

          <View className='flex-1' />

          <HeaderIconButton liquidGlass accessibilityLabel='Archive' onPress={() => onArchive?.()}>
            <Archive size={20} color={foreground} />
          </HeaderIconButton>
          <HeaderIconButton liquidGlass accessibilityLabel='Delete' onPress={() => onDelete?.()}>
            <Trash2 size={20} color={foreground} />
          </HeaderIconButton>
          <HeaderIconButton
            liquidGlass
            accessibilityLabel='Mark unread'
            onPress={() => onToggleRead?.()}
          >
            <Mail size={20} color={foreground} />
          </HeaderIconButton>
          <HeaderIconButton liquidGlass accessibilityLabel='More' onPress={() => onMore?.()}>
            <EllipsisVertical size={20} color={foreground} />
          </HeaderIconButton>
        </Animated.View>
      </View>
    </Animated.View>
  );
});
