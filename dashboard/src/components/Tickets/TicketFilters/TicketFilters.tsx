import { ReactElement, useCallback, useMemo } from 'react';
import { Filter, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { PriorityFilter } from './PriorityFilter';
import { UserFilter } from './UserFilter';
// import { UserGroupFilter } from './UserGroupFilter';
import { DateRangeFilter } from './DateRangeFilter';
import { TicketFiltersProps, TicketFilters as TicketFiltersType } from './types';

export const TicketFilters = ({
  filters,
  onFiltersChange,
  projectId: _projectId,
  className = '',
}: TicketFiltersProps): ReactElement => {
  const handleFilterChange = (key: keyof TicketFiltersType, value: unknown): void => {
    const newFilters = {
      ...filters,
      [key]: value,
    };

    // Remove undefined values to keep filters clean
    Object.keys(newFilters).forEach((filterKey: string) => {
      const k = filterKey as keyof TicketFiltersType;
      const filterValue = newFilters[k];
      if (!filterValue || (Array.isArray(filterValue) && filterValue.length === 0)) {
        delete newFilters[k];
      }
    });

    onFiltersChange(newFilters);
  };

  const handleClearAll = (): void => {
    onFiltersChange({});
  };

  const getActiveFilterCount = (): number => {
    let count = 0;
    if (filters.priority?.length) count++;
    if (filters.assignee?.length) count++;
    if (filters.userGroups?.length) count++;
    if (filters.createdBy?.length) count++;
    if (filters.dueDateStart !== undefined || filters.dueDateEnd !== undefined) count++;
    if (filters.createdDateStart !== undefined || filters.createdDateEnd !== undefined) count++;
    return count;
  };

  const hasActiveFilters = getActiveFilterCount() > 0;

  // Refactored date range handler to eliminate duplication
  const handleDateRangeChange = useCallback(
    (keyPrefix: 'dueDate' | 'createdDate', dateRange: { start?: number; end?: number }) => {
      const newFilters = { ...filters };
      delete newFilters[`${keyPrefix}Start`];
      delete newFilters[`${keyPrefix}End`];
      if (dateRange.start !== undefined) newFilters[`${keyPrefix}Start`] = dateRange.start;
      if (dateRange.end !== undefined) newFilters[`${keyPrefix}End`] = dateRange.end;
      onFiltersChange(newFilters);
    },
    [filters, onFiltersChange],
  );

  // Memoize date ranges to prevent unnecessary re-renders
  const dueDateRange = useMemo(() => {
    const range: { start?: number; end?: number } = {};
    if (filters.dueDateStart !== undefined) range.start = filters.dueDateStart;
    if (filters.dueDateEnd !== undefined) range.end = filters.dueDateEnd;
    return range;
  }, [filters.dueDateStart, filters.dueDateEnd]);

  const createdDateRange = useMemo(() => {
    const range: { start?: number; end?: number } = {};
    if (filters.createdDateStart !== undefined) range.start = filters.createdDateStart;
    if (filters.createdDateEnd !== undefined) range.end = filters.createdDateEnd;
    return range;
  }, [filters.createdDateStart, filters.createdDateEnd]);

  return (
    <div className={`bg-background border border-border rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className='flex items-center justify-between mb-4'>
        <div className='flex items-center gap-2'>
          <Filter className='w-4 h-4 text-muted-foreground' />
          <h3 className='text-sm font-medium text-foreground'>Filters</h3>
          {hasActiveFilters && (
            <span className='bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full'>
              {getActiveFilterCount()} active
            </span>
          )}
        </div>

        {hasActiveFilters && (
          <Button
            onClick={handleClearAll}
            variant='ghost'
            size='sm'
            className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
            title='Clear all filters'
            data-track-category='Tickets'
            data-track-name='ClearAllFilters'
          >
            <X className='w-3 h-3' />
            Clear all
          </Button>
        )}
      </div>

      {/* Filter Grid */}
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
        {/* Priority Filter */}
        <PriorityFilter
          selectedPriorities={filters.priority || []}
          onChange={priorities => handleFilterChange('priority', priorities)}
        />

        {/* Assignee Filter */}
        <UserFilter
          selectedUsers={filters.assignee || []}
          onChange={users => handleFilterChange('assignee', users)}
          placeholder='Filter by assignee...'
        />

        {/* Created By Filter */}
        <UserFilter
          selectedUsers={filters.createdBy || []}
          onChange={users => handleFilterChange('createdBy', users)}
          placeholder='Filter by creator...'
        />

        {/* User Groups Filter */}
        {/* <UserGroupFilter
          selectedGroups={filters.userGroups || []}
          onChange={groups => handleFilterChange('userGroups', groups)}
          placeholder='Filter by user groups...'
        /> */}

        {/* Due Date Filter */}
        <DateRangeFilter
          dateRange={dueDateRange}
          onChange={range => handleDateRangeChange('dueDate', range)}
          label='Due Date'
          placeholder='Filter by due date...'
        />

        {/* Created Date Filter */}
        <DateRangeFilter
          dateRange={createdDateRange}
          onChange={range => handleDateRangeChange('createdDate', range)}
          label='Created Date'
          placeholder='Filter by created date...'
        />
      </div>

      {/* Active Filters Summary */}
      {hasActiveFilters && (
        <div className='mt-4 pt-4 border-t border-border'>
          <div className='text-xs font-medium text-muted-foreground mb-2'>Active filters:</div>
          <div className='flex flex-wrap gap-2'>
            {filters.priority?.length && (
              <div className='inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded border border-blue-200'>
                <span>Priority: {filters.priority.length}</span>
                <Button
                  onClick={() => handleFilterChange('priority', [])}
                  variant='ghost'
                  size='sm'
                  className='ml-1 hover:text-blue-900 p-0 h-auto min-w-0'
                  title='Clear priority filter'
                  data-track-category='Tickets'
                  data-track-name='ClearPriorityFilter'
                >
                  <X className='w-3 h-3' />
                </Button>
              </div>
            )}

            {filters.assignee?.length && (
              <div className='inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded border border-blue-200'>
                <span>Assignee: {filters.assignee.length}</span>
                <Button
                  onClick={() => handleFilterChange('assignee', [])}
                  variant='ghost'
                  size='sm'
                  className='ml-1 hover:text-blue-900 p-0 h-auto min-w-0'
                  title='Clear assignee filter'
                  data-track-category='Tickets'
                  data-track-name='ClearAssigneeFilter'
                >
                  <X className='w-3 h-3' />
                </Button>
              </div>
            )}

            {filters.createdBy?.length && (
              <div className='inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded border border-blue-200'>
                <span>Created by: {filters.createdBy.length}</span>
                <Button
                  onClick={() => handleFilterChange('createdBy', [])}
                  variant='ghost'
                  size='sm'
                  className='ml-1 hover:text-blue-900 p-0 h-auto min-w-0'
                  title='Clear created by filter'
                >
                  <X className='w-3 h-3' />
                </Button>
              </div>
            )}

            {filters.userGroups?.length && (
              <div className='inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded border border-blue-200'>
                <span>User groups: {filters.userGroups.length}</span>
                <Button
                  onClick={() => handleFilterChange('userGroups', [])}
                  variant='ghost'
                  size='sm'
                  className='ml-1 hover:text-blue-900 p-0 h-auto min-w-0'
                  title='Clear user groups filter'
                >
                  <X className='w-3 h-3' />
                </Button>
              </div>
            )}

            {filters.dueDateStart !== undefined || filters.dueDateEnd !== undefined ? (
              <div className='inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded border border-blue-200'>
                <span>Due date</span>
                <Button
                  onClick={(): void => {
                    const newFilters = { ...filters };
                    delete newFilters.dueDateStart;
                    delete newFilters.dueDateEnd;
                    onFiltersChange(newFilters);
                  }}
                  variant='ghost'
                  size='sm'
                  className='ml-1 hover:text-blue-900 p-0 h-auto min-w-0'
                  title='Clear due date filter'
                >
                  <X className='w-3 h-3' />
                </Button>
              </div>
            ) : null}

            {filters.createdDateStart !== undefined || filters.createdDateEnd !== undefined ? (
              <div className='inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded border border-blue-200'>
                <span>Created date</span>
                <Button
                  onClick={(): void => {
                    const newFilters = { ...filters };
                    delete newFilters.createdDateStart;
                    delete newFilters.createdDateEnd;
                    onFiltersChange(newFilters);
                  }}
                  variant='ghost'
                  size='sm'
                  className='ml-1 hover:text-blue-900 p-0 h-auto min-w-0'
                  title='Clear created date filter'
                >
                  <X className='w-3 h-3' />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
