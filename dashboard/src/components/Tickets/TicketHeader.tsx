import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Search, LayoutList, Table2, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { DateRangeFilter } from '../ui/DateRangeFilter';
import { Button } from '../ui/Button/Button';
import { SegmentedToggle, SegmentedToggleOption } from '../ui/SegmentedToggle';
import FilterMenu from './FilterMenu';
import ActiveFiltersBar from './ActiveFiltersBar';
import { User } from '@xyne/shared';
import { cn } from '../../utils/classNames';

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export type ViewMode = 'table' | 'list';
export interface TicketFilters {
  searchQuery: string;
  statusFilter: string[];
  workflowTypeFilter: string[];
  environmentFilter: string[];
  createdByFilter: User[];
  assignedToFilter: User[];
  dateRangeFilter: DateRange | null;
}

interface TicketHeaderProps {
  filters: TicketFilters;
  onFiltersChange: (filters: TicketFilters) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

/* ── Status tab presets ── */
type StatusTabKey = 'all' | 'running' | 'pending' | 'paused' | 'completed' | 'failed';

const STATUS_TAB_MAP: Record<StatusTabKey, string[]> = {
  all: [],
  running: ['RUNNING'],
  pending: ['PENDING', 'WAITING'],
  paused: ['PAUSED'],
  completed: ['COMPLETED', 'SUCCESS'],
  failed: ['FAILED', 'FAILURE'],
};

const STATUS_TAB_OPTIONS: SegmentedToggleOption<StatusTabKey>[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Pending' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const arraysEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
};

const TicketHeader: React.FC<TicketHeaderProps> = ({
  filters,
  onFiltersChange,
  viewMode,
  onViewModeChange,
}) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeStatusTab = useMemo((): StatusTabKey => {
    const entry = (Object.entries(STATUS_TAB_MAP) as [StatusTabKey, string[]][]).find(
      ([, statuses]) => arraysEqual(statuses, filters.statusFilter),
    );
    return entry?.[0] ?? 'all';
  }, [filters.statusFilter]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const hasSearchQuery = filters.searchQuery.trim().length > 0;

  const tabsRef = useRef<HTMLDivElement>(null);
  const [markerStyle, setMarkerStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  const updateMarker = useCallback(() => {
    if (!tabsRef.current) return;
    const buttons = tabsRef.current.querySelectorAll<HTMLButtonElement>('[data-slot="status-tab"]');
    const idx = STATUS_TAB_OPTIONS.findIndex(t => t.value === activeStatusTab);
    const btn = buttons[idx];
    if (!btn) return;
    setMarkerStyle({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [activeStatusTab]);

  useEffect(() => {
    updateMarker();
  }, [updateMarker]);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => updateMarker());
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateMarker]);

  const viewToggleOptions: SegmentedToggleOption<ViewMode>[] = useMemo(
    () => [
      { value: 'table' as ViewMode, icon: <Table2 size={14} />, title: 'Table View' },
      { value: 'list' as ViewMode, icon: <LayoutList size={14} />, title: 'List View' },
    ],
    [],
  );

  return (
    <div data-id='ticket-header-container' className='flex flex-col gap-4'>
      {/* Title */}
      <div
        data-id='ticket-header-title-row'
        className='flex items-center justify-between px-6 pt-6 pb-2'
      >
        <h1
          data-id='ticket-header-title'
          className='font-semibold text-base leading-6 tracking-normal text-foreground whitespace-nowrap'
        >
          Tickets Workflows
        </h1>
      </div>

      {/* Filters row */}
      <div
        data-id='ticket-header-filters-row'
        className='flex items-center justify-between gap-4 px-6'
      >
        {/* LEFT: Status tabs */}
        <div
          ref={tabsRef}
          data-id='ticket-header-status-tabs'
          className='relative inline-flex items-center gap-1'
        >
          {/* Sliding pill behind selected tab */}
          <div
            className='absolute inset-y-0 rounded-full border border-action-primary bg-action-primary/10 transition-[left,width] duration-200 ease-in-out'
            style={{ left: markerStyle.left, width: markerStyle.width }}
          />
          {STATUS_TAB_OPTIONS.map(tab => (
            <button
              key={tab.value}
              type='button'
              data-slot='status-tab'
              data-id={`ticket-header-status-tab-${tab.value}`}
              data-track-category='Tickets'
              data-track-name='SelectStatusTab'
              onClick={() =>
                onFiltersChange({ ...filters, statusFilter: STATUS_TAB_MAP[tab.value] })
              }
              className={cn(
                'relative z-10 h-7 px-2.5 text-sm font-normal whitespace-nowrap rounded-full',
                activeStatusTab === tab.value
                  ? 'text-action-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* RIGHT: Controls */}
        <div data-id='ticket-header-controls' className='flex items-center gap-2 flex-shrink-0'>
          {/* Search icon button — !transition-none overrides Button's transition-all to prevent theme switch lag */}
          <Popover.Root open={searchOpen} onOpenChange={setSearchOpen}>
            <Popover.Trigger asChild>
              <Button
                data-id='ticket-header-search-btn'
                variant='outline'
                size='iconSm'
                className={cn(
                  'relative size-7 rounded-full !transition-none',
                  hasSearchQuery && 'border-action-primary',
                )}
                title='Search'
              >
                <Search className='size-3.5' />
                {hasSearchQuery && (
                  <span
                    data-id='ticket-header-search-indicator'
                    className='absolute top-0 right-0 size-2 rounded-full bg-action-primary'
                  />
                )}
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                data-id='ticket-header-search-popover'
                side='bottom'
                align='end'
                sideOffset={4}
                className='z-50 rounded-full border bg-popover text-popover-foreground shadow-md px-3 py-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 duration-150'
                onOpenAutoFocus={e => {
                  e.preventDefault();
                  searchInputRef.current?.focus();
                }}
                onCloseAutoFocus={e => e.preventDefault()}
              >
                <div
                  data-id='ticket-header-search-input-wrapper'
                  className='flex items-center gap-2 w-[280px]'
                >
                  <Search className='size-4 text-muted-foreground flex-shrink-0' />
                  <input
                    data-id='ticket-header-search-input'
                    data-track-category='Tickets'
                    data-track-name='SearchInput'
                    ref={searchInputRef}
                    type='text'
                    value={filters.searchQuery}
                    onChange={e => onFiltersChange({ ...filters, searchQuery: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === 'Enter') setSearchOpen(false);
                      if (e.key === 'Escape') {
                        setSearchOpen(false);
                      }
                    }}
                    placeholder='Search Ticket ID / Title...'
                    className='flex-1 h-7 text-sm bg-transparent outline-none placeholder:text-muted-foreground'
                  />
                  {hasSearchQuery && (
                    <button
                      type='button'
                      data-id='ticket-header-search-clear'
                      data-track-category='Tickets'
                      data-track-name='ClearSearch'
                      onClick={() => onFiltersChange({ ...filters, searchQuery: '' })}
                      className='p-0.5 rounded-sm text-muted-foreground hover:text-foreground'
                    >
                      <X className='size-3.5' />
                    </button>
                  )}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {/* Filter menu */}
          <FilterMenu
            assignedToUsers={filters.assignedToFilter}
            createdByUsers={filters.createdByFilter}
            workflowTypeFilter={filters.workflowTypeFilter}
            onAssignedToChange={users => onFiltersChange({ ...filters, assignedToFilter: users })}
            onCreatedByChange={users => onFiltersChange({ ...filters, createdByFilter: users })}
            onWorkflowTypeChange={values =>
              onFiltersChange({ ...filters, workflowTypeFilter: values })
            }
          />

          {/* Date range */}
          <DateRangeFilter
            dateRange={filters.dateRangeFilter}
            onChange={range => onFiltersChange({ ...filters, dateRangeFilter: range })}
          />

          {/* View toggle */}
          <SegmentedToggle
            options={viewToggleOptions}
            value={viewMode}
            onChange={onViewModeChange}
          />
        </div>
      </div>

      {/* Active filters bar */}
      <ActiveFiltersBar
        createdByUsers={filters.createdByFilter}
        assignedToUsers={filters.assignedToFilter}
        workflowTypeFilter={filters.workflowTypeFilter}
        onRemoveCreatedBy={user =>
          onFiltersChange({
            ...filters,
            createdByFilter: filters.createdByFilter.filter(u => u.id !== user.id),
          })
        }
        onRemoveAssignedTo={user =>
          onFiltersChange({
            ...filters,
            assignedToFilter: filters.assignedToFilter.filter(u => u.id !== user.id),
          })
        }
        onRemoveWorkflowType={value =>
          onFiltersChange({
            ...filters,
            workflowTypeFilter: filters.workflowTypeFilter.filter(v => v !== value),
          })
        }
        onClearAll={() =>
          onFiltersChange({
            ...filters,
            createdByFilter: [],
            assignedToFilter: [],
            workflowTypeFilter: [],
          })
        }
      />
    </div>
  );
};

export default TicketHeader;
