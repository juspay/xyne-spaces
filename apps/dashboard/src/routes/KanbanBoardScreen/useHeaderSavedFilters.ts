import { useCallback, useMemo } from 'react';
import { SavedConfigEntityName, SavedConfigVisibility } from '@xyne/shared';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import type { HeaderSavedFilter } from '../../components/Tickets/TicketsHeader/TicketsHeader.types';
import { valuesToFilters } from '../../utils/savedViewSerialization';
import { logger, Event } from '../../utils/logger';
import { DEFAULT_VISIBLE_COLUMNS, mergeSavedColumns } from './KanbanBoardScreen.utils';
import type { GroupByType } from './KanbanBoardScreen.types';

interface SavedConfigValue {
  entityName: SavedConfigEntityName;
  fieldName: string;
  fieldValue: string;
}

interface SavedConfig {
  id: string;
  name: string;
  userId: string;
  visibility: SavedConfigVisibility;
  values?: readonly SavedConfigValue[] | undefined;
}

export interface HeaderSavedFiltersOptions {
  savedConfigs: readonly SavedConfig[] | undefined;
  savedViewsBoardId: string | null;
  boards: string[] | undefined;
  userId: string | undefined;
  activeViewKey: string;
  selectedViewId: string | null;
  setSelectedViewId: (id: string | null) => void;
  setFilters: (filters: TicketFilters) => void;
  setGroupBy: (value: GroupByType) => void;
  setVisibleColumns: (update: (prev: Set<string>) => Set<string>) => void;
  onRequestDelete: (item: HeaderSavedFilter) => void;
}

export interface HeaderSavedFilters {
  items: HeaderSavedFilter[];
  activeId: string | null;
  onApply: (id: string) => void;
  onDismiss: () => void;
  onDelete: (item: HeaderSavedFilter) => void;
}

const rememberActiveView = (key: string, configId: string | null): void => {
  try {
    if (configId === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, configId);
  } catch (err) {
    logger.error(Event.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to persist active view to sessionStorage'),
      error: err,
    });
  }
};

export const useHeaderSavedFilters = ({
  savedConfigs,
  savedViewsBoardId,
  boards,
  userId,
  activeViewKey,
  selectedViewId,
  setSelectedViewId,
  setFilters,
  setGroupBy,
  setVisibleColumns,
  onRequestDelete,
}: HeaderSavedFiltersOptions): HeaderSavedFilters | null => {
  const onApply = useCallback(
    (configId: string): void => {
      const config = savedConfigs?.find(c => c.id === configId);
      if (!config) return;
      const allValues = config.values ?? [];
      const groupByEntry = allValues.find(v => v.fieldName === '__groupBy');
      const columnsEntry = allValues.find(v => v.fieldName === '__columns');
      const filterValues = allValues.filter(
        v => v.fieldName !== '__groupBy' && v.fieldName !== '__columns',
      );

      const savedColumns = columnsEntry
        ? columnsEntry.fieldValue.split(',').filter(Boolean)
        : DEFAULT_VISIBLE_COLUMNS;
      setVisibleColumns(prev => mergeSavedColumns(prev, savedColumns));

      const newFilters = valuesToFilters(filterValues);
      if (boards) newFilters.boards = boards;
      setFilters(newFilters);

      setSelectedViewId(config.id);
      rememberActiveView(activeViewKey, config.id);

      if (!groupByEntry) {
        setGroupBy('none');
        return;
      }
      try {
        setGroupBy(JSON.parse(groupByEntry.fieldValue) as GroupByType);
      } catch {
        setGroupBy(groupByEntry.fieldValue as GroupByType);
      }
    },
    [
      savedConfigs,
      boards,
      setFilters,
      activeViewKey,
      setGroupBy,
      setSelectedViewId,
      setVisibleColumns,
    ],
  );

  const onDismiss = useCallback((): void => {
    setSelectedViewId(null);
    rememberActiveView(activeViewKey, null);
    setFilters({ ...(boards ? { boards } : {}) });
    setGroupBy('none');
  }, [activeViewKey, boards, setFilters, setGroupBy, setSelectedViewId]);

  return useMemo(
    () =>
      savedViewsBoardId && savedConfigs && savedConfigs.length > 0
        ? {
            items: savedConfigs.map(config => ({
              id: config.id,
              name: config.name,
              isPrivate: config.visibility === SavedConfigVisibility.PRIVATE,
              isOwn: config.userId === userId,
            })),
            activeId: selectedViewId,
            onApply,
            onDismiss,
            onDelete: onRequestDelete,
          }
        : null,
    [savedViewsBoardId, savedConfigs, userId, selectedViewId, onApply, onDismiss, onRequestDelete],
  );
};
