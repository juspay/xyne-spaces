import { type ReactElement } from 'react';

import { FilterBar } from '@/src/ui/filter-bar';

import { CHANNEL_FILTERS } from '../model/filter';
import { channelFilter$, channelFilterCounts$, setChannelFilter } from '../state/filter-store';

export function ChannelsFilterBar(): ReactElement {
  return (
    <FilterBar
      filters={CHANNEL_FILTERS}
      active$={channelFilter$}
      counts$={channelFilterCounts$}
      onSelect={setChannelFilter}
    />
  );
}
