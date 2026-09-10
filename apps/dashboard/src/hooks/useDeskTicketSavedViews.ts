import { useCallback } from 'react';
import { SavedConfigContextType, SavedConfigVisibility } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { queries } from '../zero/queries';
import { mutators } from '../zero/mutators';
import { useZero } from './useZero';
import { useCachedQuery } from './useCachedQuery';
import { deskFiltersToValues, valuesToFilters } from '../utils/savedViewSerialization';
import type { SavedConfigValueRow } from '../utils/savedViewSerialization';
import type { TicketFilters } from '../components/Tickets/TicketFilters/types';

export type DeskTicketSavedView = {
  id: string;
  name: string;
  userId: string;
  visibility: string;
  contextId: string;
  values?: readonly SavedConfigValueRow[];
};

export function useDeskTicketSavedViews(
  channelId: string,
  applyView?: (filters: TicketFilters) => void,
) {
  const zero = useZero();

  const [savedViews] = useCachedQuery(queries.savedDeskTicketConfigsByChannel({ channelId }), {
    enabled: !!channelId,
  });

  const saveView = useCallback(
    async (
      name: string,
      filters: TicketFilters,
      visibility: SavedConfigVisibility,
    ): Promise<string | undefined> => {
      if (!channelId) return undefined;
      const id = uuidv4();
      const values = deskFiltersToValues(filters);
      const res = await zero.mutate(
        mutators.savedUserConfiguration.create({
          id,
          name,
          contextType: SavedConfigContextType.DESK_TICKET,
          contextId: channelId,
          channelId,
          visibility,
          timestamp: Date.now(),
          values,
        }),
      ).server;
      if (res.type === 'error') throw new Error(res.error?.message ?? 'Failed to save view');
      return id;
    },
    [zero, channelId],
  );

  const updateView = useCallback(
    async (configId: string, filters: TicketFilters): Promise<void> => {
      const values = deskFiltersToValues(filters);
      const res = await zero.mutate(
        mutators.savedUserConfiguration.update({
          configId,
          timestamp: Date.now(),
          values,
        }),
      ).server;
      if (res.type === 'error') throw new Error(res.error?.message ?? 'Failed to update view');
    },
    [zero],
  );

  const deleteView = useCallback(
    async (configId: string): Promise<void> => {
      const res = await zero.mutate(mutators.savedUserConfiguration.delete({ configId })).server;
      if (res.type === 'error') throw new Error(res.error?.message ?? 'Failed to delete view');
    },
    [zero],
  );

  const applySavedView = useCallback(
    (view: DeskTicketSavedView): void => {
      if (!applyView || !view.values) return;
      const filters = valuesToFilters(view.values);
      applyView(filters);
    },
    [applyView],
  );

  return {
    savedViews: (savedViews ?? []) as DeskTicketSavedView[],
    saveView,
    updateView,
    deleteView,
    applySavedView,
  };
}
