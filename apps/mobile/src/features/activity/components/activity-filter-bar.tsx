import { useValue } from '@legendapp/state/react';
import { useMemo, type ReactElement } from 'react';

import { FilterBar, type FilterBarOption } from '@/src/ui/filter-bar';

import { visibleActivityFilters, type ActivityFilter } from '../model/filter';
import { activityFilter$, activityFilterCounts$, setActivityFilter } from '../state/filter-store';
import { appliedActivityPreferences$ } from '../state/preferences-store';

/**
 * The chips for the current set — the standard tabs, or Actionable and FYI when
 * the Actionable preference is on. Every chip but All shows its unread count;
 * zero hides itself. All is the whole feed, and its number would repeat the
 * Unread switch's.
 */
export function ActivityFilterBar(): ReactElement {
  const actionable = useValue(appliedActivityPreferences$.actionable);

  const options = useMemo<readonly FilterBarOption<ActivityFilter>[]>(
    () =>
      visibleActivityFilters(actionable).map(filter => ({
        id: filter.id,
        label: filter.label,
        showsCount: filter.id !== 'all',
      })),
    [actionable],
  );

  return (
    <FilterBar
      filters={options}
      active$={activityFilter$}
      counts$={activityFilterCounts$}
      onSelect={setActivityFilter}
    />
  );
}
