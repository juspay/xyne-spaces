import { useState, useMemo, useCallback } from 'react';
import type { PaginationState } from './Table.types';

interface UseTablePaginationOptions {
  pagination?: PaginationState | undefined;
  serverSidePagination?: boolean | undefined;
  onPageChange?: ((page: number) => void) | undefined;
  onPageSizeChange?: ((pageSize: number) => void) | undefined;
}

interface UseTablePaginationResult<TData> {
  paginatedData: TData[];
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalRows: number;
  handlePageChange: (page: number) => void;
  handlePageSizeChange: (pageSize: number) => void;
}

export function useTablePagination<TData>(
  data: TData[],
  options: UseTablePaginationOptions,
): UseTablePaginationResult<TData> {
  const { pagination, serverSidePagination, onPageChange, onPageSizeChange } = options;

  const [internalPage, setInternalPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(pagination?.pageSize ?? 10);

  const currentPage = pagination?.currentPage ?? internalPage;
  const pageSize = pagination?.pageSize ?? internalPageSize;
  const totalRows = pagination?.totalRows ?? data.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  const handlePageChange = useCallback(
    (page: number) => {
      if (onPageChange) {
        onPageChange(page);
      } else {
        setInternalPage(page);
      }
    },
    [onPageChange],
  );

  const handlePageSizeChange = useCallback(
    (newPageSize: number) => {
      if (onPageSizeChange) {
        onPageSizeChange(newPageSize);
      } else {
        setInternalPageSize(newPageSize);
        setInternalPage(1);
      }
    },
    [onPageSizeChange],
  );

  const paginatedData = useMemo(() => {
    // Server-side: data is already sliced by the parent
    if (serverSidePagination) return data;

    // No pagination configured
    if (!pagination && !internalPage) return data;

    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return data.slice(start, end);
  }, [data, currentPage, pageSize, serverSidePagination, pagination, internalPage]);

  return {
    paginatedData,
    currentPage,
    pageSize,
    totalPages,
    totalRows,
    handlePageChange,
    handlePageSizeChange,
  };
}
