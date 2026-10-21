import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { BackHandler } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useChannelById } from '@/src/hooks/useChannels';
import { TicketsAssigneeFilterOverlay } from '@/src/features/xyne-desks/tickets/components/tickets-assignee-filter';
import { TicketsMultiSelectFilterOverlay } from '@/src/features/xyne-desks/tickets/components/tickets-multi-select-filter';
import { TicketsPriorityFilterSheet } from '@/src/features/xyne-desks/tickets/components/tickets-priority-filter';

import {
  useChannelBoardFilterOptions,
  useChannelStageFilterOptions,
  useChannelTicketsData,
  useChannelTicketsFilters,
  useChannelTicketsLookups,
  useChannelTicketsPalette,
  useChannelTicketsPickers,
  useChannelTicketSearch,
} from '../hooks';
import type { ChannelTicketRow, ChannelTicketsFilterDrawerItem } from '../types';
import { ChannelTicketsView } from './channel-tickets-view';

/**
 * Container for the per-channel tickets table. Loaded lazily through `load.ts`;
 * nothing here is on the startup graph. Owns every hook (route, channel, data,
 * filters, palette, lookups, picker orchestration) and renders the pure
 * `ChannelTicketsView` plus the value-picker overlays.
 */
export default function ChannelTicketsScreen(): ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { channelId: channelIdParam } = useLocalSearchParams<{ channelId: string }>();
  const channelId = typeof channelIdParam === 'string' ? channelIdParam : '';

  const channel = useChannelById(channelId);
  const channelName = channel?.name?.trim() || 'Channel';
  const projectId = channel?.projectId ?? null;

  const { options: boardOptions, boardNameById } = useChannelBoardFilterOptions(projectId);
  const filtersState = useChannelTicketsFilters(boardNameById);
  const { filters, labels, hasActiveFilters } = filtersState;
  const stageOptions = useChannelStageFilterOptions(projectId, filters.boardIds);

  const data = useChannelTicketsData(channelId, filters);
  const palette = useChannelTicketsPalette();

  // Search mode: an inline bar under the header filters the same table in
  // place (local matches instantly, Vespa hits hydrated as they land).
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const search = useChannelTicketSearch(channelId, searchQuery, data.rows, isSearchOpen);
  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
  }, []);

  const showSearchRows = isSearchOpen && search.hasQuery;
  const visibleRows = showSearchRows ? search.rows : data.rows;
  const isInitialLoading = showSearchRows
    ? search.isSearching && search.rows.length === 0
    : data.isInitialLoading;
  const isEmpty = showSearchRows ? !search.isSearching && search.rows.length === 0 : data.isEmpty;
  const lookups = useChannelTicketsLookups(boardNameById);
  const pickers = useChannelTicketsPickers();

  const handleAssigneeApply = useCallback(
    (ids: string[]) => {
      filtersState.setAssigneeIds(ids);
      pickers.assigneeOverlay.close();
    },
    [filtersState, pickers.assigneeOverlay],
  );
  const handleStagesApply = useCallback(
    (names: string[]) => {
      filtersState.setStageNames(names);
      pickers.stagesOverlay.close();
    },
    [filtersState, pickers.stagesOverlay],
  );
  const handleBoardsApply = useCallback(
    (ids: string[]) => {
      filtersState.setBoardIds(ids);
      pickers.boardsOverlay.close();
    },
    [filtersState, pickers.boardsOverlay],
  );
  const handleTogglePriority = useCallback(
    (priority: Parameters<typeof filtersState.togglePriority>[0]) => {
      filtersState.togglePriority(priority);
      pickers.setPrioritySheetOpen(false);
    },
    [filtersState, pickers],
  );

  // Back (gesture / hardware) closes whatever is open before leaving the screen.
  usePreventRemove(pickers.isAnyOpen, () => {
    pickers.dismissAll();
  });

  useEffect(() => {
    if (!pickers.isAnyOpen && !isSearchOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pickers.dismissAll()) return true;
      closeSearch();
      return true;
    });
    return (): void => subscription.remove();
  }, [pickers, isSearchOpen, closeSearch]);

  const handleBack = useCallback(() => {
    if (pickers.dismissAll()) return;
    if (isSearchOpen) {
      closeSearch();
      return;
    }
    router.back();
  }, [pickers, router, isSearchOpen, closeSearch]);

  const handlePressTicket = useCallback(
    (ticket: ChannelTicketRow) => {
      router.push({
        pathname: '/ticket/[ticketId]',
        params: {
          ticketId: ticket.id,
          channelId: ticket.channelId || channelId,
          ...(ticket.conversationId ? { threadId: ticket.conversationId } : {}),
        },
      });
    },
    [router, channelId],
  );

  const drawerItems = useMemo<ChannelTicketsFilterDrawerItem[]>(
    () => [
      ...(boardOptions.length > 0
        ? [
            {
              kind: 'boards' as const,
              label: 'Board',
              value: labels.board,
              isActive: filters.boardIds.length > 0,
            },
          ]
        : []),
      {
        kind: 'assignee' as const,
        label: 'Assignee',
        value: labels.assignee,
        isActive: filters.assigneeIds.length > 0,
      },
      {
        kind: 'priority' as const,
        label: 'Priority',
        value: labels.priority,
        isActive: filters.priorities.length > 0,
      },
      ...(stageOptions.length > 0
        ? [
            {
              kind: 'stages' as const,
              label: 'Stage',
              value: labels.stage,
              isActive: filters.stageNames.length > 0,
            },
          ]
        : []),
    ],
    [
      boardOptions.length,
      stageOptions.length,
      labels,
      filters.boardIds.length,
      filters.assigneeIds.length,
      filters.priorities.length,
      filters.stageNames.length,
    ],
  );

  return (
    <>
      <ChannelTicketsView
        channelName={channelName}
        rows={visibleRows}
        isEmpty={isEmpty}
        isInitialLoading={isInitialLoading}
        hasMore={showSearchRows ? false : data.hasMore}
        isLoadingMore={showSearchRows ? false : data.isLoadingMore}
        hasActiveFilters={hasActiveFilters}
        drawerOpen={pickers.drawerOpen}
        drawerItems={drawerItems}
        isSearchOpen={isSearchOpen}
        searchQuery={searchQuery}
        isSearching={search.isSearching}
        searchErrorMessage={search.errorMessage}
        palette={palette}
        lookups={lookups}
        topInset={insets.top}
        bottomInset={insets.bottom}
        onBack={handleBack}
        onOpenSearch={openSearch}
        onSearchQueryChange={setSearchQuery}
        onCloseSearch={closeSearch}
        onOpenFilters={pickers.openDrawer}
        onDrawerOpenChange={pickers.handleDrawerOpenChange}
        onDrawerSelect={pickers.selectFromDrawer}
        onClearFilters={filtersState.clearAll}
        onLoadMore={data.loadMore}
        onPressTicket={handlePressTicket}
      />

      {pickers.assigneeOverlay.isMounted ? (
        <TicketsAssigneeFilterOverlay
          progress={pickers.assigneeOverlay.progress}
          isOpen={pickers.assigneeOverlay.isOpen}
          selectedIds={filters.assigneeIds}
          onClose={pickers.assigneeOverlay.close}
          onApply={handleAssigneeApply}
        />
      ) : null}

      {pickers.stagesOverlay.isMounted ? (
        <TicketsMultiSelectFilterOverlay
          progress={pickers.stagesOverlay.progress}
          isOpen={pickers.stagesOverlay.isOpen}
          title='Stages'
          searchPlaceholder='Search stages...'
          emptyLabel='No stages available'
          selectedIds={filters.stageNames}
          options={stageOptions}
          onClose={pickers.stagesOverlay.close}
          onApply={handleStagesApply}
        />
      ) : null}

      {pickers.boardsOverlay.isMounted ? (
        <TicketsMultiSelectFilterOverlay
          progress={pickers.boardsOverlay.progress}
          isOpen={pickers.boardsOverlay.isOpen}
          title='Boards'
          searchPlaceholder='Search boards...'
          emptyLabel='No boards available'
          selectedIds={filters.boardIds}
          options={boardOptions}
          onClose={pickers.boardsOverlay.close}
          onApply={handleBoardsApply}
        />
      ) : null}

      <TicketsPriorityFilterSheet
        isOpen={pickers.prioritySheetOpen}
        selectedPriorities={filters.priorities}
        onOpenChange={pickers.setPrioritySheetOpen}
        onTogglePriority={handleTogglePriority}
      />
    </>
  );
}
