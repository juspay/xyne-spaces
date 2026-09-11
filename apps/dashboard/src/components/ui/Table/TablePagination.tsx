import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../Select/Select';

interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export const TablePagination: React.FC<TablePaginationProps> = ({
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions,
}) => {
  return (
    <div data-slot='table-pagination' className='flex items-center justify-between'>
      <div className='flex items-center gap-2'>
        {pageSizeOptions && pageSizeOptions.length > 1 && (
          <Select value={String(pageSize)} onValueChange={val => onPageSizeChange(Number(val))}>
            <SelectTrigger size='sm' className='h-7 rounded-full pl-2.5 pr-1 gap-2 w-auto min-w-0'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position='popper' side='top' align='start' sideOffset={4}>
              {pageSizeOptions.map(size => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className='flex items-center gap-2'>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          data-track-category='TABLE'
          data-track-name='PREV_PAGE'
          disabled={currentPage <= 1}
          className='p-1.5 rounded-full border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
        >
          <ChevronLeft size={14} />
        </button>
        <span className='text-sm text-muted-foreground px-1'>
          {currentPage} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          data-track-category='TABLE'
          data-track-name='NEXT_PAGE'
          disabled={currentPage >= totalPages}
          className='p-1.5 rounded-full border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};
