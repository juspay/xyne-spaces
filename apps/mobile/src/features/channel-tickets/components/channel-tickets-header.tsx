import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { ListFilter, Search } from 'lucide-react-native';

import { HeaderBackButton, HeaderIconButton } from '@/src/components/ui/header-icon-button';

import { CHANNEL_TICKETS_HEADER_HEIGHT } from '../constants';

export type ChannelTicketsHeaderProps = {
  channelName: string;
  hasActiveFilters: boolean;
  /** Search mode on: the search button reads as active. */
  isSearchOpen: boolean;
  /** Safe-area top inset, passed in so the view stays free of layout hooks. */
  topInset: number;
  foregroundColor: string;
  accentColor: string;
  onBack: () => void;
  onOpenSearch: () => void;
  onOpenFilters: () => void;
};

/**
 * Pure header: back + title on the left; Search and Filters buttons on the
 * right. A small accent dot on Filters says "some filter is applied".
 */
export const ChannelTicketsHeader = memo(function ChannelTicketsHeader({
  channelName,
  hasActiveFilters,
  isSearchOpen,
  topInset,
  foregroundColor,
  accentColor,
  onBack,
  onOpenSearch,
  onOpenFilters,
}: ChannelTicketsHeaderProps): ReactElement {
  return (
    <View
      className='flex-row items-center gap-2 px-2'
      style={{ paddingTop: topInset, height: topInset + CHANNEL_TICKETS_HEADER_HEIGHT }}
    >
      <HeaderBackButton liquidGlass onPress={onBack} />
      <View className='min-w-0 flex-1'>
        <Text className='text-lg font-semibold text-foreground' numberOfLines={1}>
          Tickets
        </Text>
        <Text className='text-xs text-secondary-foreground' numberOfLines={1}>
          {channelName}
        </Text>
      </View>
      <HeaderIconButton
        liquidGlass
        accessibilityLabel={isSearchOpen ? 'Search (active)' : 'Search'}
        onPress={onOpenSearch}
      >
        <Search size={20} color={isSearchOpen ? accentColor : foregroundColor} />
      </HeaderIconButton>
      <View>
        <HeaderIconButton
          liquidGlass
          accessibilityLabel={hasActiveFilters ? 'Filters (active)' : 'Filters'}
          onPress={onOpenFilters}
        >
          <ListFilter size={20} color={hasActiveFilters ? accentColor : foregroundColor} />
        </HeaderIconButton>
        {hasActiveFilters ? (
          <View
            pointerEvents='none'
            testID='channel-tickets-filters-active-dot'
            className='absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-settings-bg'
            style={{ backgroundColor: accentColor }}
          />
        ) : null}
      </View>
    </View>
  );
});
