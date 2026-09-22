/* eslint-disable local-rules/require-tracking-on-click */
import { useMemo, useState, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { SearchableMultiSelect } from '../../ui/SearchableMultiSelect/SearchableMultiSelect';
import type { ReleaseDetailDevTicketRow } from '../../../routes/ReleaseDetailScreen/releaseReport.utils';
import type { ReleaseDevTicketFilters } from './releaseDevTicketFilters';

const distinct = (values: readonly string[]): string[] =>
  [...new Set(values.filter(v => v && v.trim()))].sort();

const Facet = ({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  return (
    <SearchableMultiSelect
      options={options.map(o => ({ value: o, label: o }))}
      selectedValues={selected}
      onSelectedValuesChange={onChange}
      isOpen={open}
      onOpenChange={setOpen}
      searchPlaceholder={`Search ${label.toLowerCase()}…`}
      searchAriaLabel={`Search ${label}`}
      listAriaLabel={label}
      emptyMessage='No values'
      trigger={
        <button
          type='button'
          className={cn(
            'inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted',
            selected.length > 0
              ? 'border-primary text-foreground'
              : 'border-border text-muted-foreground',
          )}
        >
          {label}
          {selected.length > 0 && (
            <span className='rounded bg-primary px-1.5 text-xs text-primary-foreground'>
              {selected.length}
            </span>
          )}
          <ChevronDown size={14} className='opacity-60' />
        </button>
      }
    />
  );
};

interface ReleaseDevTicketFilterBarProps {
  devTicketRows: ReleaseDetailDevTicketRow[];
  filters: ReleaseDevTicketFilters;
  setFilters: Dispatch<SetStateAction<ReleaseDevTicketFilters>>;
  search: string;
  setSearch: (value: string) => void;
  filtersActive: boolean;
  onClear: () => void;
}

export const ReleaseDevTicketFilterBar = ({
  devTicketRows,
  filters,
  setFilters,
  search,
  setSearch,
  filtersActive,
  onClear,
}: ReleaseDevTicketFilterBarProps): ReactElement => {
  const statusOptions = useMemo(() => distinct(devTicketRows.map(r => r.status)), [devTicketRows]);
  const typeOptions = useMemo(() => distinct(devTicketRows.map(r => r.type)), [devTicketRows]);
  const devOwnerOptions = useMemo(
    () => distinct(devTicketRows.map(r => r.devOwner)),
    [devTicketRows],
  );
  const anyHotfix = useMemo(() => devTicketRows.some(r => r.isHotfix), [devTicketRows]);

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <div className='relative'>
        <Search
          size={14}
          className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground'
        />
        <input
          type='text'
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder='Search dev tickets…'
          data-testid='release-dev-tickets-search'
          className='w-56 rounded border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:border-input'
        />
      </div>
      <Facet
        label='Status'
        options={statusOptions}
        selected={filters.statuses}
        onChange={values => setFilters(prev => ({ ...prev, statuses: values }))}
      />
      <Facet
        label='Type'
        options={typeOptions}
        selected={filters.types}
        onChange={values => setFilters(prev => ({ ...prev, types: values }))}
      />
      <Facet
        label='Dev Owner'
        options={devOwnerOptions}
        selected={filters.devOwners}
        onChange={values => setFilters(prev => ({ ...prev, devOwners: values }))}
      />
      {anyHotfix && (
        <button
          type='button'
          onClick={() => setFilters(prev => ({ ...prev, hotfixOnly: !prev.hotfixOnly }))}
          className={cn(
            'inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted',
            filters.hotfixOnly
              ? 'border-orange-400 text-orange-700 dark:text-orange-400'
              : 'border-border text-muted-foreground',
          )}
        >
          🔥 Hotfix
        </button>
      )}
      {filtersActive && (
        <button
          type='button'
          onClick={onClear}
          className='inline-flex items-center gap-1 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground'
        >
          <X size={14} />
          Clear
        </button>
      )}
    </div>
  );
};
