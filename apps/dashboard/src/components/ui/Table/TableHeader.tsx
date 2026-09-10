import React from 'react';
import {
  ArrowUpAZ,
  ArrowDownZA,
  ArrowUpNarrowWide,
  ArrowDownNarrowWide,
  ArrowUpDown,
} from 'lucide-react';
import { cn } from '../../../utils/classNames';
import type { ColumnDef, SortState } from './Table.types';

interface TableHeaderProps<TData extends Record<string, unknown>> {
  columns: ColumnDef<TData>[];
  sortable?: boolean;
  currentSort: SortState;
  onSortChange: (field: string) => void;
}

export function TableHeader<TData extends Record<string, unknown>>({
  columns,
  sortable,
  currentSort,
  onSortChange,
}: TableHeaderProps<TData>): React.ReactElement {
  return (
    <thead data-slot='table-header'>
      <tr className='border-b border-border bg-secondary'>
        {columns.map(col => {
          const isSortable = sortable && col.sortable !== false;
          const isActive = currentSort.field === col.field && currentSort.direction !== null;

          const isDate = col.sortType === 'date';
          const AscIcon = isDate ? ArrowUpNarrowWide : ArrowUpAZ;
          const DescIcon = isDate ? ArrowDownNarrowWide : ArrowDownZA;
          const SortIcon = isActive
            ? currentSort.direction === 'asc'
              ? AscIcon
              : DescIcon
            : ArrowUpDown;

          const style: React.CSSProperties = {};
          if (col.width) style.width = col.width;
          if (col.minWidth) style.minWidth = col.minWidth;

          return (
            <th
              key={col.field}
              data-slot='table-header-cell'
              style={style}
              className={cn(
                'text-left text-xs font-medium uppercase text-muted-foreground select-none',
                isSortable && 'cursor-pointer hover:text-foreground',
                col.headerClassName,
              )}
              onClick={isSortable ? () => onSortChange(col.field) : undefined}
              data-track-category='TABLE'
              data-track-name='SORT_COLUMN'
              data-track-metadata={JSON.stringify({ field: col.field })}
            >
              <div className='flex items-center justify-between gap-1.5'>
                <span>{col.renderHeader ? col.renderHeader() : col.header}</span>
                {isSortable && (
                  <SortIcon
                    size={12}
                    className={cn(
                      'flex-shrink-0',
                      isActive ? 'text-foreground' : 'text-muted-foreground/50',
                    )}
                  />
                )}
              </div>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
