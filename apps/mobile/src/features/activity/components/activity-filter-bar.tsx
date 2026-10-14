import { type ReactElement } from 'react';

import { FilterBar, type FilterBarOption } from '@/src/ui/filter-bar';

import { ACTIVITY_FILTERS, type ActivityFilter } from '../model/filter';
import { activityFilter$, activityFilterCounts$, setActivityFilter } from '../state/filter-store';

/**
 * Every chip but All shows its unread count; zero hides itself. All is the
 * whole feed, and its number would repeat Unread's.
 */
const OPTIONS: readonly FilterBarOption<ActivityFilter>[] = ACTIVITY_FILTERS.map(filter => ({
  id: filter.id,
  label: filter.label,
  showsCount: filter.id !== 'all',
}));

export function ActivityFilterBar(): ReactElement {
  return (
    <FilterBar
      filters={OPTIONS}
      active$={activityFilter$}
      counts$={activityFilterCounts$}
      onSelect={setActivityFilter}
    />
  );
}
