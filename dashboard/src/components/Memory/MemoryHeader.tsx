import React from 'react';
import { TextInput, MultiSelect } from '@juspay/blend-design-system';
import { Search, Brain } from 'lucide-react';
import type { MemoryFilters } from '../../types/memory';

interface MemoryHeaderProps {
  filters: MemoryFilters;
  onFiltersChange: (filters: MemoryFilters) => void;
}

const MemoryHeader: React.FC<MemoryHeaderProps> = ({ filters, onFiltersChange }) => {
  const hasActiveFilters = (): boolean => {
    return (
      filters.docTypeFilter.length > 0 ||
      filters.tagsFilter.trim().length > 0 ||
      filters.repoUrlFilter.trim().length > 0 ||
      filters.commitIdFilter.trim().length > 0 ||
      filters.sessionIdFilter.trim().length > 0 ||
      filters.filePointersFilter.trim().length > 0 ||
      filters.ticketIdFilter.trim().length > 0
    );
  };

  const clearAllFilters = (): void => {
    onFiltersChange({
      ...filters,
      searchQuery: '',
      includeQuery: true,
      includeSummary: true,
      docTypeFilter: [],
      tagsFilter: '',
      repoUrlFilter: '',
      commitIdFilter: '',
      sessionIdFilter: '',
      filePointersFilter: '',
      ticketIdFilter: '',
    });
  };

  const clearFilters = (): void => {
    onFiltersChange({
      ...filters,
      docTypeFilter: [],
      tagsFilter: '',
      repoUrlFilter: '',
      commitIdFilter: '',
      sessionIdFilter: '',
      filePointersFilter: '',
      ticketIdFilter: '',
    });
  };

  const handleDocTypeChange = (value: string): void => {
    if (value === '') {
      onFiltersChange({ ...filters, docTypeFilter: [] });
    } else {
      const newValues = filters.docTypeFilter.includes(value)
        ? filters.docTypeFilter.filter(v => v !== value)
        : [...filters.docTypeFilter, value];
      onFiltersChange({ ...filters, docTypeFilter: newValues });
    }
  };

  const docTypeOptions = ['fact', 'sop'];
  const scopeOptions = [
    { label: 'Mine', value: 'my' },
    { label: 'All', value: 'all' },
  ];

  const getSearchPlaceholder = (): string => {
    if (filters.includeQuery && filters.includeSummary) {
      return 'Search in query and summary...';
    } else if (filters.includeQuery) {
      return 'Search in query...';
    } else if (filters.includeSummary) {
      return 'Search in summary...';
    }
    return 'Search context...';
  };

  return (
    <div className='space-y-6 mb-8'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <Brain size={24} className='text-purple-600' />
          <h1 className='font-semibold text-xl leading-[32px] tracking-normal text-foreground whitespace-nowrap'>
            Context
          </h1>
        </div>
      </div>

      <div className='flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4'>
        <div className='flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full lg:w-auto'>
          <div className='flex items-center gap-2'>
            <div className='w-[300px]'>
              <TextInput
                placeholder={getSearchPlaceholder()}
                value={filters.searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onFiltersChange({ ...filters, searchQuery: e.target.value })
                }
                leftSlot={<Search className='w-4 h-4' />}
              />
            </div>
            <div className='flex items-center gap-1'>
              <button
                onClick={() => {
                  // Prevent deselecting both - at least one must be selected
                  if (filters.includeQuery && !filters.includeSummary) return;
                  onFiltersChange({ ...filters, includeQuery: !filters.includeQuery });
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  filters.includeQuery
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
                title='Include user query in search ranking'
                data-track-category='Memory'
                data-track-name='ToggleIncludeQuery'
              >
                Query
              </button>
              <button
                onClick={() => {
                  // Prevent deselecting both - at least one must be selected
                  if (filters.includeSummary && !filters.includeQuery) return;
                  onFiltersChange({ ...filters, includeSummary: !filters.includeSummary });
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  filters.includeSummary
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
                title='Include summary in search ranking'
                data-track-category='Memory'
                data-track-name='ToggleIncludeSummary'
              >
                Summary
              </button>
            </div>
          </div>
          {filters.searchQuery.trim() && (
            <button
              onClick={clearAllFilters}
              className='flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors whitespace-nowrap'
              data-track-category='Memory'
              data-track-name='ClearAllFilters'
            >
              <span>Clear All</span>
            </button>
          )}
        </div>

        <div className='flex flex-wrap items-center gap-2 lg:gap-4 w-full lg:w-auto'>
          {hasActiveFilters() && (
            <button
              onClick={clearFilters}
              className='flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors whitespace-nowrap'
              data-track-category='Memory'
              data-track-name='ClearFilters'
            >
              <span>Clear Filters</span>
            </button>
          )}

          <MultiSelect
            label=''
            items={[
              {
                items: scopeOptions.map(option => ({
                  label: option.label,
                  value: option.value,
                })),
              },
            ]}
            selectedValues={[filters.scope]}
            onChange={(value: string) => {
              if (value === 'my' || value === 'all') {
                onFiltersChange({ ...filters, scope: value });
              }
            }}
            placeholder='Scope'
            enableSearch={false}
            enableSelectAll={false}
          />

          <MultiSelect
            label=''
            items={[
              {
                items: docTypeOptions.map(option => ({
                  label: option,
                  value: option,
                })),
              },
            ]}
            selectedValues={filters.docTypeFilter}
            onChange={handleDocTypeChange}
            placeholder='Doc Type'
            enableSearch={false}
            enableSelectAll={true}
          />

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by tag...'
              value={filters.tagsFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, tagsFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by repo URL...'
              value={filters.repoUrlFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, repoUrlFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by commit ID...'
              value={filters.commitIdFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, commitIdFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by session ID...'
              value={filters.sessionIdFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, sessionIdFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by file...'
              value={filters.filePointersFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, filePointersFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by ticket ID...'
              value={filters.ticketIdFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, ticketIdFilter: e.target.value })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemoryHeader;
