import React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../../utils/classNames';
import type { TableProps } from './Table.types';
import { TableHeader } from './TableHeader';
import { TableBody } from './TableBody';
import { TablePagination } from './TablePagination';
import { TableEmpty } from './TableEmpty';
import { TableError } from './TableError';
import { TableLoading } from './TableLoading';
import { useTableSort } from './useTableSort';
import { useTablePagination } from './useTablePagination';

const tableVariants = cva('w-full text-sm', {
  variants: {
    variant: {
      default: '',
      bordered: '[&_td]:border [&_td]:border-border [&_th]:border [&_th]:border-border',
      striped: '[&_tbody_tr:nth-child(even)]:bg-muted/30',
    },
    size: {
      sm: '[&_th]:py-2 [&_th]:px-3 [&_td]:py-2 [&_td]:px-3 text-xs',
      md: '[&_th]:py-3 [&_th]:px-4 [&_td]:py-3 [&_td]:px-4 text-sm',
      lg: '[&_th]:py-4 [&_th]:px-5 [&_td]:py-4 [&_td]:px-5 text-base',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

export function Table<TData extends Record<string, unknown>>({
  data,
  columns,
  idField,
  // Sorting
  sortable = false,
  sort,
  onSortChange,
  defaultSort,
  // Pagination
  pagination,
  serverSidePagination = false,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  // Row interaction
  onRowClick,
  rowClassName,
  // States
  isLoading = false,
  skeletonRowCount = 5,
  emptyState,
  errorState,
  // Appearance
  variant = 'default',
  size = 'md',
  hoverable = true,
  className,
  tableClassName,
  maxHeight,
  // Composition
  toolbar,
  footer,
}: TableProps<TData>): React.ReactElement {
  const { sortedData, currentSort, handleSortChange } = useTableSort(data, {
    defaultSort,
    controlledSort: sort,
    onSortChange,
  });

  const {
    paginatedData,
    currentPage,
    pageSize,
    totalPages,
    totalRows,
    handlePageChange,
    handlePageSizeChange,
  } = useTablePagination(sortedData, {
    pagination,
    serverSidePagination,
    onPageChange,
    onPageSizeChange,
  });

  const colCount = columns.length;
  const showPagination = pagination !== undefined;
  const showData = !isLoading && !errorState && paginatedData.length > 0;
  const showEmpty = !isLoading && !errorState && paginatedData.length === 0;

  const scrollStyle: React.CSSProperties = maxHeight ? { maxHeight, overflowY: 'auto' } : {};

  return (
    <div data-slot='table' className={cn('flex flex-col min-h-0 gap-3', className)}>
      {toolbar && <div data-slot='table-toolbar'>{toolbar}</div>}

      <div className='overflow-auto min-h-0 border border-border rounded-lg' style={scrollStyle}>
        <table className={cn(tableVariants({ variant, size }), tableClassName)}>
          <TableHeader
            columns={columns}
            sortable={sortable}
            currentSort={currentSort}
            onSortChange={handleSortChange}
          />

          {isLoading && <TableLoading colSpan={colCount} rowCount={skeletonRowCount} />}

          {!isLoading && errorState && <TableError colSpan={colCount}>{errorState}</TableError>}

          {!isLoading && showEmpty && <TableEmpty colSpan={colCount}>{emptyState}</TableEmpty>}

          {!isLoading && showData && (
            <TableBody
              data={paginatedData}
              columns={columns}
              idField={idField}
              hoverable={hoverable}
              onRowClick={onRowClick}
              rowClassName={rowClassName}
            />
          )}
        </table>
      </div>

      {showPagination && !isLoading && (
        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalRows={totalRows}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          pageSizeOptions={pageSizeOptions}
        />
      )}

      {footer && <div data-slot='table-footer'>{footer}</div>}
    </div>
  );
}

export { tableVariants };
export default Table;
