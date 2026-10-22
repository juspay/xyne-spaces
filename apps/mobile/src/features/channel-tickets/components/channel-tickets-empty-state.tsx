import { memo } from 'react';

import { ListEmptyState } from '@/src/components/ui/empty-state/list-empty-state';

type ChannelTicketsEmptyStateProps = {
  hasActiveFilters: boolean;
  insetTop?: number;
};

export const ChannelTicketsEmptyState = memo(function ChannelTicketsEmptyState({
  hasActiveFilters,
  insetTop = 0,
}: ChannelTicketsEmptyStateProps) {
  return (
    <ListEmptyState
      illustration='activityTickets'
      title={hasActiveFilters ? 'No tickets match' : 'No tickets yet'}
      subtitle={
        hasActiveFilters
          ? 'Try clearing a filter to see more tickets.'
          : 'Tickets created in this channel will show up here.'
      }
      insetTop={insetTop}
    />
  );
});
