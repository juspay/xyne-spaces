import { useEffect, useMemo, useState } from 'react';

import { tagsConfigApi } from '../api/tags-config-api';
import type { TicketsMultiSelectFilterOption } from '../components/tickets-multi-select-filter';
import { mapGeneratedTagsToFilterOptions } from '../utils/map-generated-tags-to-filter-options';

/**
 * Flatten generated tags as `category:tag` options (dashboard GeneratedTagsSubmenu).
 * Loads the pinned catalog endpoint once (`all-generated-tags`).
 */
export function useTicketAiTagsFilterOptions(channelId: string): {
  options: TicketsMultiSelectFilterOption[];
  isLoading: boolean;
} {
  const [options, setOptions] = useState<TicketsMultiSelectFilterOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!channelId) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const tags = await tagsConfigApi.getAllGeneratedTags(channelId);
        if (!cancelled) setOptions(mapGeneratedTagsToFilterOptions(tags));
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  return useMemo(() => ({ options, isLoading }), [options, isLoading]);
}
