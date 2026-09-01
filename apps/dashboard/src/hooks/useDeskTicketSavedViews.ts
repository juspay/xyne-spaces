import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { SavedConfigContextType, SavedConfigEntityName, SavedConfigVisibility } from '@xyne/shared';
import { queries } from '../zero/queries';
import { mutators } from '../zero/mutators';
import { useZero } from './useZero';
import { useCachedQuery } from './useCachedQuery';
import {
  deskTicketFiltersToValues,
  valuesToDeskTicketFilters,
  type DeskTicketValueRow,
} from '../utils/deskTicketViewSerialization';
import type { TicketFilters } from '../components/Tickets/TicketFilters/types';

export interface DeskTicketSavedView {
  id: string;
  name: string;
  userId: string;
  visibility: SavedConfigVisibility;
  values: readonly { fieldName: string; fieldValue: string; entityName: SavedConfigEntityName }[];
}

export function useDeskTicketSavedViews(
  channelId: string,
  applyView?: (filters: TicketFilters) => void,
) {
  const zero = useZero();

  const [rawViews] = useCachedQuery(queries.savedDeskTicketConfigsByChannel({ channelId }), {
    enabled: !!channelId,
  });

  const savedViews: DeskTicketSavedView[] = (rawViews ?? []).map(v => ({
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
      applyView(valuesToDeskTicketFilters(view.values));
    },
    [savedViews, applyView],
  );

  const saveView = useCallback(
    async (
      name: string,
      filters: TicketFilters,
      visibility: SavedConfigVisibility = SavedConfigVisibility.PRIVATE,
    ): Promise<string> => {
      const id = uuidv4();
      const valueRows: DeskTicketValueRow[] = deskTicketFiltersToValues(filters);
      const res = await zero.mutate(
        mutators.savedUserConfiguration.create({
          id,
          name,
          contextType: SavedConfigContextType.DESK_TICKET,
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

  const deleteView = useCallback(
    async (configId: string): Promise<void> => {
      const res = await zero.mutate(mutators.savedUserConfiguration.delete({ configId })).server;
      if (res.type === 'error') {
        throw new Error(res.error?.message ?? 'Failed to delete view');
      }
    },
    [zero],
  );

  return { savedViews, saveView, deleteView, applySavedView };
}
