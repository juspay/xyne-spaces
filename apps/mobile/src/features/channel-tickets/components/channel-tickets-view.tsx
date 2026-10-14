import { memo, type ReactElement } from 'react';
import { View } from 'react-native';

import { CHANNEL_TICKETS_TABLE_INSET } from '../constants';
import type {
  ChannelTicketRow,
  ChannelTicketsFilterDrawerItem,
  ChannelTicketsFilterKind,
  ChannelTicketsLookups,
  ChannelTicketsPalette,
} from '../types';
import { ChannelTicketsFilterDrawer } from './channel-tickets-filter-drawer';
import { ChannelTicketsHeader } from './channel-tickets-header';
import { ChannelTicketsSearchBar } from './channel-tickets-search-bar';
import { ChannelTicketsTable } from './channel-tickets-table';

export type ChannelTicketsViewProps = {
  channelName: string;
  rows: ChannelTicketRow[];
  isEmpty: boolean;
  isInitialLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  hasActiveFilters: boolean;
  drawerOpen: boolean;
  drawerItems: readonly ChannelTicketsFilterDrawerItem[];
  /** Search mode: the bar shows under the header and `rows` are the search results. */
  isSearchOpen: boolean;
  searchQuery: string;
  isSearching: boolean;
  searchErrorMessage: string | null;
  palette: ChannelTicketsPalette;
  lookups: ChannelTicketsLookups;
  topInset: number;
  bottomInset: number;
  onBack: () => void;
  onOpenSearch: () => void;
  onSearchQueryChange: (query: string) => void;
  onCloseSearch: () => void;
  onOpenFilters: () => void;
  onDrawerOpenChange: (open: boolean) => void;
  onDrawerSelect: (kind: ChannelTicketsFilterKind) => void;
  onClearFilters: () => void;
  onLoadMore: () => void;
  onPressTicket: (ticket: ChannelTicketRow) => void;
};

/**
 * The whole screen as a pure view: header, optional search bar, inset table
 * card and the Filters drawer. Every value is a prop, every action a callback,
 * so it renders in tests with no router, theme, safe-area or data provider. The
 * container (`channel-tickets-screen.tsx`) owns the hooks and the value-picker
 * overlays.
 */
export const ChannelTicketsView = memo(function ChannelTicketsView({
  channelName,
  rows,
  isEmpty,
  isInitialLoading,
  hasMore,
  isLoadingMore,
  hasActiveFilters,
  drawerOpen,
  drawerItems,
  isSearchOpen,
  searchQuery,
  isSearching,
  searchErrorMessage,
  palette,
  lookups,
  topInset,
  bottomInset,
  onBack,
  onOpenSearch,
  onSearchQueryChange,
  onCloseSearch,
  onOpenFilters,
  onDrawerOpenChange,
  onDrawerSelect,
  onClearFilters,
  onLoadMore,
  onPressTicket,
}: ChannelTicketsViewProps): ReactElement {
  return (
    <View className='flex-1 bg-settings-bg' testID='channel-tickets-view'>
      <ChannelTicketsHeader
        channelName={channelName}
        hasActiveFilters={hasActiveFilters}
        isSearchOpen={isSearchOpen}
        topInset={topInset}
        foregroundColor={palette.foreground}
        accentColor={palette.accent}
        onBack={onBack}
        onOpenSearch={onOpenSearch}
        onOpenFilters={onOpenFilters}
      />

      {isSearchOpen ? (
        <ChannelTicketsSearchBar
          query={searchQuery}
          placeholder={`Search tickets in ${channelName}`}
          isSearching={isSearching}
          errorMessage={searchErrorMessage}
          palette={palette}
          onChangeQuery={onSearchQueryChange}
          onClose={onCloseSearch}
        />
      ) : null}

      {/* Breathing room under the header, plus an even inset around the table card. */}
      <View className='flex-1' style={{ padding: CHANNEL_TICKETS_TABLE_INSET }}>
        <ChannelTicketsTable
          rows={rows}
          isEmpty={isEmpty}
          isInitialLoading={isInitialLoading}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          hasActiveFilters={hasActiveFilters || (isSearchOpen && searchQuery.trim().length > 0)}
          palette={palette}
          lookups={lookups}
          bottomInset={bottomInset}
          onLoadMore={onLoadMore}
          onPressTicket={onPressTicket}
        />
      </View>

      <ChannelTicketsFilterDrawer
        isOpen={drawerOpen}
        items={drawerItems}
        hasActiveFilters={hasActiveFilters}
        palette={palette}
        bottomInset={bottomInset}
        onOpenChange={onDrawerOpenChange}
        onSelect={onDrawerSelect}
        onClearAll={onClearFilters}
      />
    </View>
  );
});
