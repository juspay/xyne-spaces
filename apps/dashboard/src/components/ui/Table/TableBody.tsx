import React from 'react';
import { cn } from '../../../utils/classNames';
import type { ColumnDef } from './Table.types';

interface TableBodyProps<TData extends Record<string, unknown>> {
  data: TData[];
  columns: ColumnDef<TData>[];
  idField: keyof TData & string;
  hoverable?: boolean | undefined;
  onRowClick?: ((row: TData, index: number) => void) | undefined;
  rowClassName?: string | ((row: TData, index: number) => string) | undefined;
}

export function TableBody<TData extends Record<string, unknown>>({
  data,
  columns,
  idField,
  hoverable = true,
  onRowClick,
  rowClassName,
}: TableBodyProps<TData>): React.ReactElement {
  return (
    <tbody data-slot='table-body'>
      {data.map((row, rowIndex) => {
        const rowKey = String(row[idField] ?? rowIndex);
        const resolvedRowClass =
          typeof rowClassName === 'function' ? rowClassName(row, rowIndex) : rowClassName;

        return (
          <tr
            key={rowKey}
            data-slot='table-row'
            onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
            data-track-category='TABLE'
            data-track-name='OPEN_ROW'
            className={cn(
              'border-b border-border last:border-b-0',
              hoverable && 'hover:bg-muted/50',
              onRowClick && 'cursor-pointer',
              resolvedRowClass,
            )}
          >
            {columns.map(col => {
              const value = row[col.field];
              const style: React.CSSProperties = {};
              if (col.width) style.width = col.width;
              if (col.minWidth) style.minWidth = col.minWidth;

              return (
                <td
                  key={col.field}
                  data-slot='table-cell'
                  style={style}
                  className={cn('text-foreground', col.className)}
                >
                  {col.renderCell ? col.renderCell(value, row, rowIndex) : String(value ?? '')}
                </td>
              );
            })}
          </tr>
        );
      })}
    </tbody>
  );
}
