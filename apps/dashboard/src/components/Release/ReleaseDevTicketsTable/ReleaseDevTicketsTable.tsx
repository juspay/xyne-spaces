/* eslint-disable local-rules/require-tracking-on-click */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type GetRowIdParams,
  type IRowNode,
  type IsFullWidthRowParams,
} from 'ag-grid-community';
import type { ReleaseStageOption } from '../ReleaseStagePicker';
import type {
  DevTicketRepoGroup,
  ReleaseDetailDevTicketRow,
} from '../../../routes/ReleaseDetailScreen/releaseReport.utils';
import { buildReleaseDevTicketColumns } from './releaseDevTicketColumns';
import {
  EMPTY_RELEASE_DEV_TICKET_FILTERS,
  hasActiveReleaseDevTicketFilters,
  matchesReleaseDevTicketRow,
  type ReleaseDevTicketFilters,
} from './releaseDevTicketFilters';
import { buildGridRows } from './buildGridRows';
import { RepoGroupHeaderCell } from './RepoGroupHeaderCell';
import { ReleaseDevTicketFilterBar } from './ReleaseDevTicketFilterBar';
import { ReleaseDevTicketBulkBar } from './ReleaseDevTicketBulkBar';
import { useReleaseDevTicketSelection } from './useReleaseDevTicketSelection';
import type { GridRow } from './types';

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  headerBackgroundColor: 'hsl(var(--card))',
  headerTextColor: 'hsl(var(--muted-foreground))',
  headerFontWeight: '600',
  fontSize: '12px',
  columnBorder: { color: 'hsl(var(--border))', style: 'solid' },
  headerColumnBorder: { color: 'hsl(var(--border))', style: 'solid' },
  rowBorder: { color: 'hsl(var(--border))', style: 'solid' },
  headerRowBorder: { color: 'hsl(var(--border))', style: 'solid' },
  selectedRowBackgroundColor: 'hsl(var(--accent))',
});

interface ReleaseDevTicketsTableProps {
  devTicketRows: ReleaseDetailDevTicketRow[];
  repoGroups: { groups: DevTicketRepoGroup[]; unmapped: ReleaseDetailDevTicketRow[] };
  isMultiRepo: boolean;
  selectedColumns: { key: string; label: string }[];
  stagesByBoard: Map<string, ReleaseStageOption[]>;
  onCancelledStage: (row: ReleaseDetailDevTicketRow, stage: ReleaseStageOption) => void;
  baseRoute: string;
  releaseTicketXyneId: string | null | undefined;
  releaseVersion: string | null;
  onFiltersActiveChange?: (active: boolean) => void;
}

// Stable identities: ag-grid re-processes option objects/callbacks whose identity changes.
const isRowSelectable = (node: IRowNode<GridRow>): boolean => node.data?.kind === 'ticket';
const ROW_SELECTION = {
  mode: 'multiRow',
  checkboxes: false,
  enableClickSelection: false,
  headerCheckbox: false,
  isRowSelectable,
} as const;
const getRowId = (params: GetRowIdParams<GridRow>): string => params.data.id;
const isFullWidthRow = (params: IsFullWidthRowParams<GridRow>): boolean =>
  params.rowNode.data?.kind === 'group';

export const ReleaseDevTicketsTable = ({
  devTicketRows,
  repoGroups,
  isMultiRepo,
  selectedColumns,
  stagesByBoard,
  onCancelledStage,
  baseRoute,
  releaseTicketXyneId,
  releaseVersion,
  onFiltersActiveChange,
}: ReleaseDevTicketsTableProps): ReactElement => {
  const [filters, setFilters] = useState<ReleaseDevTicketFilters>(EMPTY_RELEASE_DEV_TICKET_FILTERS);
  const [search, setSearch] = useState('');

  // Keep the callback stable so columnDefs don't rebuild every parent render.
  const onCancelledRef = useRef(onCancelledStage);
  onCancelledRef.current = onCancelledStage;
  const stableOnCancelled = useCallback(
    (row: ReleaseDetailDevTicketRow, stage: ReleaseStageOption) =>
      onCancelledRef.current(row, stage),
    [],
  );

  const columnDefs = useMemo(
    () =>
      buildReleaseDevTicketColumns({
        selectedColumns,
        stagesByBoard,
        onCancelledStage: stableOnCancelled,
        baseRoute,
      }),
    [selectedColumns, stagesByBoard, stableOnCancelled, baseRoute],
  );

  const searchLower = search.trim().toLowerCase();
  const filteredRows = useMemo(
    () => devTicketRows.filter(row => matchesReleaseDevTicketRow(row, filters, searchLower)),
    [devTicketRows, filters, searchLower],
  );
  const gridRows = useMemo(
    () => buildGridRows({ isMultiRepo, filteredRows, repoGroups }),
    [isMultiRepo, filteredRows, repoGroups],
  );

  const { gridApi, selectedRows, onGridReady, onSelectionChanged } =
    useReleaseDevTicketSelection(gridRows);

  const filtersActive = hasActiveReleaseDevTicketFilters(filters, search);
  // Keep the callback in a ref and depend on filtersActive alone — depending on
  // the inline callback would re-run this effect every render and loop.
  const onFiltersActiveChangeRef = useRef(onFiltersActiveChange);
  onFiltersActiveChangeRef.current = onFiltersActiveChange;
  useEffect(() => {
    onFiltersActiveChangeRef.current?.(filtersActive);
  }, [filtersActive]);

  const clearFilters = (): void => {
    setFilters(EMPTY_RELEASE_DEV_TICKET_FILTERS);
    setSearch('');
  };

  const noMatches = gridRows.length === 0;

  return (
    <div className='flex flex-col gap-3'>
      <ReleaseDevTicketFilterBar
        devTicketRows={devTicketRows}
        filters={filters}
        setFilters={setFilters}
        search={search}
        setSearch={setSearch}
        filtersActive={filtersActive}
        onClear={clearFilters}
      />

      <ReleaseDevTicketBulkBar
        selectedRows={selectedRows}
        selectedColumns={selectedColumns}
        releaseTicketXyneId={releaseTicketXyneId}
        releaseVersion={releaseVersion}
        onClear={() => gridApi?.deselectAll()}
      />

      <div className='overflow-hidden rounded-lg border border-border'>
        <AgGridReact<GridRow>
          getRowId={getRowId}
          rowData={gridRows}
          columnDefs={columnDefs}
          theme={theme}
          domLayout='autoHeight'
          rowHeight={44}
          headerHeight={44}
          rowSelection={ROW_SELECTION}
          isFullWidthRow={isFullWidthRow}
          fullWidthCellRenderer={RepoGroupHeaderCell}
          onSelectionChanged={onSelectionChanged}
          onGridReady={onGridReady}
          suppressCellFocus
          suppressNoRowsOverlay
          alwaysShowHorizontalScroll
        />
        {noMatches && (
          <div className='px-4 py-8 text-center text-sm text-muted-foreground'>
            {filtersActive
              ? 'No dev tickets match the current filters.'
              : 'No dev tickets to show.'}
          </div>
        )}
      </div>
    </div>
  );
};
