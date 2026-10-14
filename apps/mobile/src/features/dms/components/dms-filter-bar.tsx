import { type ReactElement } from 'react';

import { FilterBar, type FilterBarOption } from '@/src/ui/filter-bar';

import { DM_FILTERS, filterShowsCount, type DmFilter } from '../model/filter';
import { dmFilterCounts$, dmFilter$, setDmFilter } from '../state/filter-store';

const OPTIONS: readonly FilterBarOption<DmFilter>[] = DM_FILTERS.map(filter => ({
  id: filter.id,
  label: filter.label,
  showsCount: filterShowsCount(filter),
}));

export function DmsFilterBar(): ReactElement {
  return (
    <FilterBar
      filters={OPTIONS}
      active$={dmFilter$}
      counts$={dmFilterCounts$}
      onSelect={setDmFilter}
    />
  );
}
