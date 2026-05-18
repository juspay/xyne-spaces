import React, { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { CHART_COLORS } from './constants';

export interface DataTableColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'status' | 'priority' | 'sla' | 'badge';
  width?: string;
  sortable?: boolean;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
}

interface DataTableRow {
  id?: string;
  [key: string]: unknown;
}

interface DataTableProps {
  title: string;
  columns: DataTableColumn[];
  rows: DataTableRow[];
  queryLabel?: string;
  className?: string;
  pageSize?: number;
  onRowClick?: (row: DataTableRow) => void;
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusStyles: Record<string, string> = {
    open: 'bg-blue-500/20 text-blue-600 border-blue-500/20',
    resolved: 'bg-green-500/20 text-green-600 border-green-500/20',
    pending: 'bg-orange-500/20 text-orange-600 border-orange-500/20',
    critical: 'bg-red-500/20 text-red-600 border-red-500/20',
    'in-progress': 'bg-purple-500/20 text-purple-600 border-purple-500/20',
  };

  const style = statusStyles[status.toLowerCase()] || statusStyles['open'];

  return (
    <span className={cn('px-2 py-1 rounded-full text-xs font-semibold border', style)}>
      {status}
    </span>
  );
};

const PriorityDot: React.FC<{ priority: string }> = ({ priority }) => {
  const priorityColors: Record<string, string> = {
    high: CHART_COLORS.error,
    medium: CHART_COLORS.warning,
    low: CHART_COLORS.success,
    critical: CHART_COLORS.error,
  };

  const color = priorityColors[priority.toLowerCase()] || priorityColors['low'];

  return (
    <div className='flex items-center gap-2'>
      <div className='w-2 h-2 rounded-full' style={{ backgroundColor: color }} />
      <span className='text-sm'>{priority}</span>
    </div>
  );
};

const SLAIndicator: React.FC<{ status: 'breached' | 'warning' | 'on-track' }> = ({ status }) => {
  const styles = {
    breached: 'bg-red-500/20 text-red-600 border-red-500/20',
    warning: 'bg-orange-500/20 text-orange-600 border-orange-500/20',
    'on-track': 'bg-green-500/20 text-green-600 border-green-500/20',
  };

  return (
    <span className={cn('px-2 py-1 rounded-full text-xs font-semibold border', styles[status])}>
      {status === 'breached' ? '🔴 Breached' : status === 'warning' ? '🟡 Warning' : '🟢 On-track'}
    </span>
  );
};

export const DataTable: React.FC<DataTableProps> = ({
  title,
  columns,
  rows,
  queryLabel,
  className,
  pageSize = 10,
  onRowClick,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: 'asc' | 'desc';
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(0);

  // Filter rows based on search
  const filteredRows = useMemo(() => {
    if (!searchQuery) return rows;

    return rows.filter(row =>
      columns.some(col => {
        const value = row[col.key];
        switch (typeof value) {
          case 'string':
            return value.toLowerCase().includes(searchQuery.toLowerCase());
          case 'number':
          case 'boolean':
            return String(value).toLowerCase().includes(searchQuery.toLowerCase());
          case 'object':
            if (value === null) return false;
            return JSON.stringify(value).toLowerCase().includes(searchQuery.toLowerCase());
          default:
            return false;
        }
      }),
    );
  }, [rows, searchQuery, columns]);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!sortConfig) return filteredRows;

    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      // Helper to safely convert values to strings for comparison
      const toComparableString = (val: unknown): string => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') {
          // Convert objects to JSON string
          return JSON.stringify(val).toLowerCase();
        }
        // At this point val is guaranteed to be a primitive (string, number, boolean, bigint, symbol)
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return String(val).toLowerCase();
      };

      const aStr = toComparableString(aValue);
      const bStr = toComparableString(bValue);

      return sortConfig.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });

    return sorted;
  }, [filteredRows, sortConfig]);

  // Paginate rows
  const paginatedRows = useMemo(() => {
    const start = currentPage * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedRows.length / pageSize);

  const renderCell = (column: DataTableColumn, row: DataTableRow): React.ReactNode => {
    const value = row[column.key];

    if (column.render) {
      return column.render(value, row);
    }

    switch (column.type) {
      case 'status':
        return <StatusBadge status={String(value)} />;
      case 'priority':
        return <PriorityDot priority={String(value)} />;
      case 'sla':
        return <SLAIndicator status={value as 'breached' | 'warning' | 'on-track'} />;
      case 'badge':
        return <StatusBadge status={String(value)} />;
      case 'number':
        return <span className='text-right'>{Number(value).toLocaleString()}</span>;
      default:
        return <span>{String(value)}</span>;
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-border/40 bg-gradient-to-br from-background via-background/90 to-background/80 p-6',
        'flex flex-col shadow-lg hover:shadow-xl transition-all duration-300 backdrop-blur-sm',
        className,
      )}
    >
      {/* Header */}
      <div className='mb-6 pb-4 border-b border-border/30'>
        <h3 className='text-base font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent mb-3'>
          {title}
        </h3>
        {queryLabel && (
          <p className='text-xs text-muted-foreground font-mono mb-4 line-clamp-1 opacity-70'>
            {queryLabel}
          </p>
        )}

        {/* Search */}
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50' />
          <input
            type='text'
            placeholder='Search...'
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setCurrentPage(0);
            }}
            className='w-full pl-9 pr-3 py-2.5 text-sm border border-border/50 rounded-lg bg-background/80 hover:bg-background focus:bg-background focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50 font-medium'
            data-track-category='ANALYTICS'
            data-track-name='DataTable_Search'
          />
        </div>
      </div>

      {/* Table */}
      <div className='flex-1 min-h-0 overflow-auto'>
        <table className='w-full text-sm'>
          {/* Table Head */}
          <thead className='sticky top-0 z-10'>
            <tr className='border-b border-gray-200 dark:border-gray-700'>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400',
                    'bg-gray-50 dark:bg-gray-900/50',
                    col.sortable && 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/50',
                  )}
                  style={{ width: col.width }}
                  onClick={() => {
                    if (!col.sortable) return;
                    if (sortConfig?.key === col.key) {
                      setSortConfig({
                        key: col.key,
                        direction: sortConfig.direction === 'asc' ? 'desc' : 'asc',
                      });
                    } else {
                      setSortConfig({ key: col.key, direction: 'asc' });
                    }
                  }}
                  data-track-category={col.sortable ? 'ANALYTICS' : undefined}
                  data-track-name={col.sortable ? 'Sort_DataTable_Column' : undefined}
                >
                  <div className='flex items-center gap-2'>
                    {col.label}
                    {col.sortable && sortConfig?.key === col.key && (
                      <>
                        {sortConfig.direction === 'asc' ? (
                          <ChevronUp className='w-4 h-4' />
                        ) : (
                          <ChevronDown className='w-4 h-4' />
                        )}
                      </>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Table Body */}
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className='px-4 py-8 text-center text-gray-500'>
                  No data found
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, idx) => (
                <tr
                  key={row.id || idx}
                  className={cn(
                    'border-b border-gray-200 dark:border-gray-700 transition-colors',
                    'hover:bg-gray-50 dark:hover:bg-gray-900/50',
                    onRowClick && 'cursor-pointer',
                  )}
                  onClick={() => onRowClick?.(row)}
                  data-track-category={onRowClick ? 'ANALYTICS' : undefined}
                  data-track-name={onRowClick ? 'DataTable_Row_Click' : undefined}
                >
                  {columns.map(col => (
                    <td key={col.key} className='px-4 py-3'>
                      {renderCell(col, row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-sm'>
          <span className='text-gray-500'>
            Page {currentPage + 1} of {totalPages} ({sortedRows.length} total)
          </span>
          <div className='flex gap-2'>
            <button
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className='px-3 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              data-track-category='ANALYTICS'
              data-track-name='DataTable_Previous_Page'
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage === totalPages - 1}
              className='px-3 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              data-track-category='ANALYTICS'
              data-track-name='DataTable_Next_Page'
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const getDataTablePreview = (): Record<string, unknown>[] => [
  { id: '1', title: 'Sample Item 1', status: 'Active', created: '2024-01-15' },
  { id: '2', title: 'Sample Item 2', status: 'Pending', created: '2024-01-14' },
  { id: '3', title: 'Sample Item 3', status: 'Active', created: '2024-01-13' },
  { id: '4', title: 'Sample Item 4', status: 'Inactive', created: '2024-01-12' },
  { id: '5', title: 'Sample Item 5', status: 'Active', created: '2024-01-11' },
];

export default DataTable;
