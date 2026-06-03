import { ReactElement, useMemo } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Filter,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import {
  type Column,
  type ColumnDef,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { TableData } from '@xyne/shared';
import { Popover } from '../../../ui/Popover/Popover';
import { humanize, toStr } from './utils';

interface TableRendererProps {
  data: TableData;
  title?: string;
}

type Row_ = Record<string, unknown>;
type FilterKind = 'enum' | 'contains' | 'range' | 'boolean';

const ENUM_THRESHOLD = 20;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];

function defaultCell(getValue: () => unknown): string {
  const v = getValue();
  return v === null || v === undefined ? '—' : toStr(v);
}

const booleanFilter: FilterFn<Row_> = (row, columnId, value: unknown) => {
  if (value !== 'true' && value !== 'false') return true;
  const raw = row.getValue<unknown>(columnId);
  if (typeof raw === 'boolean') return raw === (value === 'true');
  return toStr(raw) === value;
};

const globalFilter: FilterFn<Row_> = (row, _columnId, value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') return true;
  const needle = value.trim().toLowerCase();
  return row.getAllCells().some(c => toStr(c.getValue()).toLowerCase().includes(needle));
};

function pickKind(column: Column<Row_, unknown>, typeHint?: string): FilterKind {
  if (typeHint === 'boolean') return 'boolean';
  if (typeHint === 'number') return 'range';
  const unique = column.getFacetedUniqueValues();
  if (unique.size === 0) return 'contains';
  let allBoolean = true;
  let allNumeric = true;
  for (const v of unique.keys()) {
    const s = toStr(v);
    if (typeof v !== 'boolean' && s !== 'true' && s !== 'false') allBoolean = false;
    if (typeof v !== 'number' && !/^-?\d+(\.\d+)?$/.test(s)) allNumeric = false;
    if (!allBoolean && !allNumeric && unique.size > ENUM_THRESHOLD) break;
  }
  if (allBoolean) return 'boolean';
  if (allNumeric) return 'range';
  return unique.size <= ENUM_THRESHOLD ? 'enum' : 'contains';
}

const TableRenderer = ({ data }: TableRendererProps): ReactElement => {
  const safeData: TableData = useMemo(() => {
    if (!data || typeof data !== 'object') return { columns: [], rows: [] };
    const d = data as Partial<TableData>;
    return {
      columns: Array.isArray(d.columns) ? d.columns : [],
      rows: Array.isArray(d.rows) ? d.rows : Array.isArray(data) ? (data as Row_[]) : [],
    };
  }, [data]);

  const columns = useMemo<Array<ColumnDef<Row_>>>(
    () =>
      safeData.columns.map(col => ({
        id: col.key,
        accessorKey: col.key,
        header: humanize(col.key, col.label),
        sortUndefined: 'last',
        filterFn:
          col.type === 'number' ? 'inNumberRange' : col.type === 'boolean' ? booleanFilter : 'auto', // react-table picks includesString / arrIncludesSome
        meta: { type: col.type },
        cell: info => defaultCell(info.getValue),
      })),
    [safeData.columns],
  );

  const table = useReactTable({
    data: safeData.rows,
    columns,
    globalFilterFn: globalFilter,
    initialState: { pagination: { pageSize: 50 } },
    autoResetPageIndex: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const { pageIndex, pageSize } = table.getState().pagination;
  const totalRows = safeData.rows.length;
  const filteredRows = table.getFilteredRowModel().rows.length;
  const state = table.getState();
  const globalFilterValue = (state.globalFilter as string | undefined) ?? '';
  const hasAnyActive =
    state.columnFilters.length > 0 || state.sorting.length > 0 || globalFilterValue !== '';

  if (totalRows === 0) {
    return (
      <div className='flex items-center justify-center h-full text-sm text-muted-foreground'>
        No rows
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full min-h-0'>
      <div className='flex items-center gap-2 px-3 py-1.5 border-b border-border'>
        <Search size={12} className='text-muted-foreground shrink-0' />
        <input
          type='text'
          value={globalFilterValue}
          onChange={e => table.setGlobalFilter(e.target.value || undefined)}
          placeholder='Search all columns…'
          className='flex-1 text-xs bg-transparent focus:outline-none placeholder:text-muted-foreground'
          data-track-category='DASHBOARD_TABLE'
          data-track-name='Global_Search_Change'
        />
      </div>

      <div className='flex-1 min-h-0 overflow-auto'>
        <table className='w-full text-sm'>
          <thead className='sticky top-0 bg-xyne-gray-50 border-b border-border z-10'>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => {
                  const col = header.column;
                  const type = (col.columnDef.meta as { type?: string } | undefined)?.type;
                  const sorted = col.getIsSorted();
                  const canSort = col.getCanSort();
                  const canFilter = col.getCanFilter();
                  const filterActive = col.getFilterValue() !== undefined;
                  return (
                    <th
                      key={header.id}
                      className={`group px-3 py-2 font-semibold text-foreground/80 text-xs whitespace-nowrap ${
                        type === 'number' ? 'text-right' : 'text-left'
                      }`}
                    >
                      <div
                        className={`flex items-center gap-1 ${type === 'number' ? 'justify-end' : 'justify-start'}`}
                      >
                        {canSort ? (
                          <button
                            type='button'
                            onClick={col.getToggleSortingHandler()}
                            className='inline-flex items-center gap-1 hover:text-foreground transition-colors'
                            data-track-category='DASHBOARD_TABLE'
                            data-track-name='Toggle_Sort'
                          >
                            <span>{flexRender(col.columnDef.header, header.getContext())}</span>
                            {sorted === 'asc' ? (
                              <ArrowUp size={12} className='text-foreground' />
                            ) : sorted === 'desc' ? (
                              <ArrowDown size={12} className='text-foreground' />
                            ) : (
                              <ChevronsUpDown
                                size={12}
                                className='opacity-0 group-hover:opacity-50 transition-opacity'
                              />
                            )}
                          </button>
                        ) : (
                          <span>{flexRender(col.columnDef.header, header.getContext())}</span>
                        )}
                        {canFilter && (
                          <span
                            className={
                              filterActive
                                ? ''
                                : 'opacity-0 group-hover:opacity-100 transition-opacity'
                            }
                          >
                            <ColumnFilterButton column={col} active={filterActive} />
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className='border-b border-border hover:bg-accent'>
                {row.getVisibleCells().map(cell => {
                  const type = (cell.column.columnDef.meta as { type?: string } | undefined)?.type;
                  return (
                    <td
                      key={cell.id}
                      className={`px-3 py-2 ${type === 'number' ? 'text-right tabular-nums' : ''}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {filteredRows === 0 && (
          <div className='px-3 py-6 text-sm text-center text-muted-foreground'>
            No rows match the active filters.
          </div>
        )}
      </div>

      <div className='flex items-center justify-between px-3 py-1.5 border-t border-border bg-muted/30 text-[11px] text-muted-foreground gap-2'>
        <span className='shrink-0'>
          {hasAnyActive
            ? `${filteredRows} of ${totalRows} row${totalRows === 1 ? '' : 's'}`
            : `${totalRows} row${totalRows === 1 ? '' : 's'}`}
        </span>

        <div className='flex items-center gap-1.5'>
          <label htmlFor='table-page-size' className='sr-only'>
            Rows per page
          </label>
          <select
            id='table-page-size'
            value={pageSize}
            onChange={e => table.setPageSize(Number(e.target.value))}
            className='bg-background border border-border rounded px-1 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring'
            data-track-category='DASHBOARD_TABLE'
            data-track-name='Change_Page_Size'
          >
            {PAGE_SIZE_OPTIONS.map(n => (
              <option key={n} value={n}>
                {n}/page
              </option>
            ))}
          </select>

          <PagerButton
            onClick={() => table.firstPage()}
            disabled={!table.getCanPreviousPage()}
            label='First'
            name='Page_First'
          >
            <ChevronsLeft size={12} />
          </PagerButton>
          <PagerButton
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            label='Previous'
            name='Page_Prev'
          >
            <ChevronLeft size={12} />
          </PagerButton>
          <span className='tabular-nums px-1'>
            {pageIndex + 1} / {Math.max(1, table.getPageCount())}
          </span>
          <PagerButton
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            label='Next'
            name='Page_Next'
          >
            <ChevronRight size={12} />
          </PagerButton>
          <PagerButton
            onClick={() => table.lastPage()}
            disabled={!table.getCanNextPage()}
            label='Last'
            name='Page_Last'
          >
            <ChevronsRight size={12} />
          </PagerButton>
        </div>

        {hasAnyActive ? (
          <button
            type='button'
            onClick={() => {
              table.resetColumnFilters();
              table.resetSorting();
              table.resetGlobalFilter();
            }}
            className='flex items-center gap-1 hover:text-foreground transition-colors shrink-0'
            data-track-category='DASHBOARD_TABLE'
            data-track-name='Reset_Filters'
          >
            <RotateCcw size={11} /> Reset
          </button>
        ) : (
          <span className='w-12' />
        )}
      </div>
    </div>
  );
};

interface PagerButtonProps {
  onClick: () => void;
  disabled: boolean;
  label: string;
  name: string;
  children: ReactElement;
}

const PagerButton = ({
  onClick,
  disabled,
  label,
  name,
  children,
}: PagerButtonProps): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    className='p-0.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
    data-track-category='DASHBOARD_TABLE'
    data-track-name={name}
  >
    {children}
  </button>
);

interface ColumnFilterButtonProps {
  column: Column<Row_, unknown>;
  active: boolean;
}

const ColumnFilterButton = ({ column, active }: ColumnFilterButtonProps): ReactElement => {
  const typeHint = (column.columnDef.meta as { type?: string } | undefined)?.type;
  const kind = useMemo(() => pickKind(column, typeHint), [column, typeHint]);
  return (
    <Popover
      side='bottom'
      align='end'
      sideOffset={4}
      trigger={
        <button
          type='button'
          className={`p-0.5 rounded hover:bg-accent transition-colors relative ${
            active ? 'text-foreground' : 'text-muted-foreground/60'
          }`}
          aria-label={`Filter ${column.id}`}
          data-track-category='DASHBOARD_TABLE'
          data-track-name='Open_Column_Filter'
        >
          <Filter size={12} />
          {active && (
            <span className='absolute top-0 right-0 w-1.5 h-1.5 bg-primary rounded-full' />
          )}
        </button>
      }
    >
      <div className='w-56 p-2 space-y-2 normal-case tracking-normal'>
        <div className='flex items-center justify-between'>
          <span className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
            Filter
          </span>
          {active && (
            <button
              type='button'
              onClick={() => column.setFilterValue(undefined)}
              className='inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground'
              data-track-category='DASHBOARD_TABLE'
              data-track-name='Clear_Column_Filter'
            >
              <X size={11} /> Clear
            </button>
          )}
        </div>
        <FilterEditor column={column} kind={kind} />
      </div>
    </Popover>
  );
};

interface FilterEditorProps {
  column: Column<Row_, unknown>;
  kind: FilterKind;
}

const FilterEditor = ({ column, kind }: FilterEditorProps): ReactElement => {
  const value = column.getFilterValue();

  if (kind === 'enum') {
    const uniques = Array.from(column.getFacetedUniqueValues().keys())
      .filter(v => v !== null && v !== undefined)
      .map(toStr)
      .sort((a, b) => a.localeCompare(b));
    const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
    const toggle = (v: string): void => {
      const next = new Set(selected);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      column.setFilterValue(next.size === 0 ? undefined : Array.from(next));
    };
    return (
      <div className='max-h-56 overflow-auto'>
        {uniques.map(v => (
          <label
            key={v}
            className='flex items-center gap-2 px-1 py-1 rounded hover:bg-accent cursor-pointer text-sm'
          >
            <input
              type='checkbox'
              checked={selected.has(v)}
              onChange={() => toggle(v)}
              className='h-3.5 w-3.5'
              data-track-category='DASHBOARD_TABLE'
              data-track-name='Filter_Enum_Toggle'
            />
            <span className='truncate'>{v}</span>
          </label>
        ))}
      </div>
    );
  }

  if (kind === 'contains') {
    const needle = typeof value === 'string' ? value : '';
    return (
      <input
        type='text'
        autoFocus
        value={needle}
        onChange={e =>
          column.setFilterValue(e.target.value.trim() === '' ? undefined : e.target.value)
        }
        placeholder='Contains…'
        className='w-full text-sm px-2 py-1.5 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-ring'
        data-track-category='DASHBOARD_TABLE'
        data-track-name='Filter_Contains_Change'
      />
    );
  }

  if (kind === 'range') {
    const [dataMin, dataMax] = column.getFacetedMinMaxValues() ?? [undefined, undefined];
    const [min, max] = Array.isArray(value)
      ? (value as [number | undefined, number | undefined])
      : [undefined, undefined];
    const placeholder = (n: unknown): string =>
      typeof n === 'number' && Number.isFinite(n) ? String(n) : '';
    const commit = (lo: number | undefined, hi: number | undefined): void => {
      column.setFilterValue(lo === undefined && hi === undefined ? undefined : [lo, hi]);
    };
    return (
      <div className='flex items-center gap-1.5'>
        <input
          type='number'
          value={min ?? ''}
          onChange={e => commit(e.target.value === '' ? undefined : Number(e.target.value), max)}
          placeholder={placeholder(dataMin) || 'Min'}
          className='w-full text-sm px-2 py-1.5 bg-background border border-border rounded tabular-nums focus:outline-none focus:ring-2 focus:ring-ring'
          data-track-category='DASHBOARD_TABLE'
          data-track-name='Filter_Range_Min_Change'
        />
        <span className='text-muted-foreground text-xs'>–</span>
        <input
          type='number'
          value={max ?? ''}
          onChange={e => commit(min, e.target.value === '' ? undefined : Number(e.target.value))}
          placeholder={placeholder(dataMax) || 'Max'}
          className='w-full text-sm px-2 py-1.5 bg-background border border-border rounded tabular-nums focus:outline-none focus:ring-2 focus:ring-ring'
          data-track-category='DASHBOARD_TABLE'
          data-track-name='Filter_Range_Max_Change'
        />
      </div>
    );
  }

  const want = value === 'true' || value === 'false' ? value : null;
  return (
    <div className='grid grid-cols-3 gap-1.5 text-xs'>
      {(['any', 'true', 'false'] as const).map(label => {
        const isOn = label === 'any' ? want === null : want === label;
        return (
          <button
            key={label}
            type='button'
            onClick={() => column.setFilterValue(label === 'any' ? undefined : label)}
            data-track-category='DASHBOARD_TABLE'
            data-track-name='Filter_Boolean_Pick'
            className={`px-2 py-1.5 rounded border transition-colors ${
              isOn
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-accent text-foreground'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};

export default TableRenderer;
