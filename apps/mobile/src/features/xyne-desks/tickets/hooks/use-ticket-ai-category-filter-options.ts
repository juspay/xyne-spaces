import { useMemo } from 'react';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

import type { TicketsMultiSelectFilterOption } from '../components/tickets-multi-select-filter';

/**
 * AI classification categories for a desk channel (mirrors dashboard AICategorySubmenu).
 * Unique mapping categories + "Other" when any exist.
 */
export function useTicketAiCategoryFilterOptions(channelId: string): {
  options: TicketsMultiSelectFilterOption[];
} {
  const [mappings] = useCachedQuery(queries.getClassificationMappings({ channelId }), {
    enabled: Boolean(channelId),
    ttl: '10m',
  });

  const options = useMemo((): TicketsMultiSelectFilterOption[] => {
    const fromMappings = [
      ...new Set(
        (mappings ?? []).map(m => m.category?.trim()).filter((c): c is string => Boolean(c)),
      ),
    ];
    if (fromMappings.length === 0) return [];
    if (!fromMappings.includes('Other')) {
      fromMappings.push('Other');
    }
    return fromMappings.map(category => ({ id: category, label: category }));
  }, [mappings]);

  return { options };
}
