import { ReactNode } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortState {
  field: string;
  direction: SortDirection;
}

export interface PaginationState {
  currentPage: number;
  pageSize: number;
  totalRows: number;
}

export interface ColumnDef<TData extends Record<string, unknown>> {
  /** The key in TData to read from */
  field: keyof TData & string;
  /** Column header text */
  header: string;
  /** Whether this column is sortable. Default: false */
  sortable?: boolean;
  /** Sort icon type. 'string' = A-Z icons, 'date' = narrow-wide icons. Default: 'string' */
  sortType?: 'string' | 'date';
  /** Fixed width (CSS value) */
  width?: string;
  /** Min width (CSS value) */
  minWidth?: string;
  /** Additional CSS class for the <td> cells */
  className?: string;
  /** Additional CSS class for the <th> header cell */
  headerClassName?: string;
  /** Custom cell renderer */
  renderCell?: (value: unknown, row: TData, index: number) => ReactNode;
  /** Custom header renderer */
  renderHeader?: () => ReactNode;
}

export type TableVariant = 'default' | 'bordered' | 'striped';
export type TableSize = 'sm' | 'md' | 'lg';

export interface TableProps<TData extends Record<string, unknown>> {
  /** Row data array */
  data: TData[];
  /** Column definitions */
  columns: ColumnDef<TData>[];
  /** Unique key field in each row */
  idField: keyof TData & string;

  // -- Sorting --
  /** Enable sorting. Default: false */
  sortable?: boolean;
  /** Controlled sort state (server-side sorting) */
  sort?: SortState;
  /** Callback when sort changes. If provided, sorting is server-side. */
  onSortChange?: (sort: SortState) => void;
  /** Default sort for uncontrolled (client-side) mode */
  defaultSort?: SortState;

  // -- Pagination --
  /** Pagination config. If omitted, no pagination is shown. */
  pagination?: PaginationState;
  /** Server-side pagination. Default: false */
  serverSidePagination?: boolean;
  /** Callback when page changes */
  onPageChange?: (page: number) => void;
  /** Callback when page size changes */
  onPageSizeChange?: (pageSize: number) => void;
  /** Page size options. Default: [10, 20, 50] */
  pageSizeOptions?: number[];

  // -- Row interaction --
  /** Callback when a row is clicked */
  onRowClick?: (row: TData, index: number) => void;
  /** Custom row class name or function */
  rowClassName?: string | ((row: TData, index: number) => string);

  // -- States --
  /** Whether data is loading */
  isLoading?: boolean;
  /** Number of skeleton rows while loading. Default: 5 */
  skeletonRowCount?: number;
  /** Custom empty state content */
  emptyState?: ReactNode;
  /** Custom error state content */
  errorState?: ReactNode;

  // -- Appearance --
  /** Table visual variant. Default: 'default' */
  variant?: TableVariant;
  /** Table density. Default: 'md' */
  size?: TableSize;
  /** Highlight rows on hover. Default: true */
  hoverable?: boolean;
  /** Additional CSS class for the outermost wrapper */
  className?: string;
  /** Additional CSS class for the <table> element */
  tableClassName?: string;
  /** Max height for the table body (enables vertical scroll) */
  maxHeight?: string | number;

  // -- Composition --
  /** Content rendered above the table */
  toolbar?: ReactNode;
  /** Content rendered below the table */
  footer?: ReactNode;
}
