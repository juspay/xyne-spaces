import { ReactElement, useMemo } from 'react';
import { Filter, X } from 'lucide-react';
import { Button } from '../ui/Button/Button';
import { FilterMultiSelect } from '../ui/Select/FilterMultiSelect';
import type { ScheduledMessage } from '../../services/scheduledMessageService';

export interface ScheduledMessageFiltersState {
  channelIds: string[];
  createdByIds: string[];
}

interface ScheduledMessageFiltersProps {
  messages: ScheduledMessage[];
  channelsMap: Map<string, string>;
  usersMap: Map<string, string>;
  currentUserId: string;
  filters: ScheduledMessageFiltersState;
  onFiltersChange: (filters: ScheduledMessageFiltersState) => void;
}

export const ScheduledMessageFilters = ({
  messages,
  channelsMap,
  usersMap,
  currentUserId,
  filters,
  onFiltersChange,
}: ScheduledMessageFiltersProps): ReactElement => {
  const channelOptions = useMemo(() => {
    const uniqueChannelIds = [...new Set(messages.map(m => m.channelId))];
    return uniqueChannelIds
      .map(channelId => ({
        value: channelId,
        label: channelsMap.get(channelId) || 'Unknown Channel',
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [messages, channelsMap]);

  const creatorOptions = useMemo(() => {
    const uniqueCreatorIds = [
      ...new Set([...messages.map(m => m.createdBy), ...filters.createdByIds]),
    ];
    return uniqueCreatorIds
      .map(userId => ({
        value: userId,
        label: usersMap.get(userId) || 'Unknown User',
      }))
      .sort((a, b) => {
        if (a.value === currentUserId) return -1;
        if (b.value === currentUserId) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [messages, usersMap, currentUserId, filters.createdByIds]);

  const hasActiveFilters = filters.channelIds.length > 0 || filters.createdByIds.length > 0;

  return (
    <div className='bg-background border border-border rounded-lg p-4'>
      <div className='flex items-center gap-2 mb-4'>
        <Filter className='w-4 h-4 text-muted-foreground' />
        <h3 className='text-sm font-medium text-foreground'>Filters</h3>
      </div>

      <div className='flex flex-wrap items-center gap-4'>
        <FilterMultiSelect
          options={channelOptions}
          selectedValues={filters.channelIds}
          onChange={channelIds => onFiltersChange({ ...filters, channelIds })}
          placeholder='All channels'
        />

        <FilterMultiSelect
          options={creatorOptions}
          selectedValues={filters.createdByIds}
          onChange={createdByIds => onFiltersChange({ ...filters, createdByIds })}
          placeholder='All creators'
        />

        {hasActiveFilters && (
          <Button
            onClick={() => onFiltersChange({ channelIds: [], createdByIds: [] })}
            data-track-category='scheduled-message'
            data-track-name='CLEAR_SCHEDULED_MESSAGE_FILTERS'
            variant='ghost'
            size='sm'
            className='ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
          >
            <X className='w-3 h-3' />
            Clear all
          </Button>
        )}
      </div>
    </div>
  );
};
