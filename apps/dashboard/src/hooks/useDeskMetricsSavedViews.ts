import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { SavedConfigContextType, SavedConfigEntityName, SavedConfigVisibility } from '@xyne/shared';
import { queries } from '../zero/queries';
import { mutators } from '../zero/mutators';
import { useZero } from './useZero';
import { useCachedQuery } from './useCachedQuery';
import {
  deskMetricsFiltersToValues,
  valuesToDeskMetricsFilters,
  type DeskMetricsValueRow,
} from '../utils/deskMetricsViewSerialization';
import type { StoredFilters } from './usePersistedDeskMetricsFilters';

export interface DeskMetricsSavedView {
  id: string;
  name: string;
  userId: string;
  visibility: SavedConfigVisibility;
  values: readonly { fieldName: string; fieldValue: string; entityName: SavedConfigEntityName }[];
}

export function useDeskMetricsSavedViews(
  channelId: string,
  applyView?: (partial: Partial<StoredFilters>, viewId: string) => void,
) {
  const zero = useZero();

  const [rawViews] = useCachedQuery(queries.savedDeskMetricsConfigsByChannel({ channelId }), {
    enabled: !!channelId,
  });

  const savedViews: DeskMetricsSavedView[] = (rawViews ?? []).map(v => ({
    id: v.id,
    name: v.name,
    userId: v.userId,
    visibility: v.visibility,
    values: v.values ?? [],
  }));

  const applySavedView = useCallback(
    (viewId: string) => {
      if (!applyView) return;
      const view = savedViews.find(v => v.id === viewId);
      if (!view) return;
      applyView(valuesToDeskMetricsFilters(view.values), viewId);
    },
    [savedViews, applyView],
  );

  // Returns the new view's id on success, throws on error (server-confirmed).
  const saveView = useCallback(
    async (
      name: string,
      filters: StoredFilters,
      visibility: SavedConfigVisibility = SavedConfigVisibility.PRIVATE,
    ): Promise<string> => {
      const id = uuidv4();
      const valueRows: DeskMetricsValueRow[] = deskMetricsFiltersToValues(filters);
      const res = await zero.mutate(
        mutators.savedUserConfiguration.create({
          id,
          name,
          contextType: SavedConfigContextType.DESK_METRICS,
          contextId: channelId,
          channelId,
          visibility,
          timestamp: Date.now(),
          values: valueRows.map(r => ({ id: uuidv4(), ...r })),
        }),
      ).server;
      if (res.type === 'error') {
        throw new Error(res.error?.message ?? 'Failed to save view');
      }
      return id;
    },
    [zero, channelId],
  );

  const updateView = useCallback(
    async (configId: string, name: string, filters: StoredFilters): Promise<void> => {
      const valueRows: DeskMetricsValueRow[] = deskMetricsFiltersToValues(filters);
      const res = await zero.mutate(
        mutators.savedUserConfiguration.update({
          configId,
          name,
          timestamp: Date.now(),
          values: valueRows.map(r => ({ id: uuidv4(), ...r })),
        }),
      ).server;
      if (res.type === 'error') {
        throw new Error(res.error?.message ?? 'Failed to update view');
      }
    },
    [zero],
  );

  const deleteView = useCallback(
    async (configId: string): Promise<void> => {
      const res = await zero.mutate(mutators.savedUserConfiguration.delete({ configId })).server;
      if (res.type === 'error') {
        throw new Error(res.error?.message ?? 'Failed to delete view');
      }
    },
    [zero],
  );

  const getViewFilters = useCallback(
    (viewId: string): Partial<StoredFilters> | null => {
      const view = savedViews.find(v => v.id === viewId);
      if (!view) return null;
      return valuesToDeskMetricsFilters(view.values);
    },
    [savedViews],
  );

  return { savedViews, saveView, updateView, deleteView, getViewFilters, applySavedView };
}
