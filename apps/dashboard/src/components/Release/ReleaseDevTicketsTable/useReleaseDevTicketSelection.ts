import { useEffect, useState } from 'react';
import type { GridApi, GridReadyEvent, SelectionChangedEvent } from 'ag-grid-community';
import type { ReleaseDetailDevTicketRow } from '../../../routes/ReleaseDetailScreen/releaseReport.utils';
import { pickTicketRows, type GridRow } from './types';

interface ReleaseDevTicketSelection {
  gridApi: GridApi<GridRow> | null;
  selectedRows: ReleaseDetailDevTicketRow[];
  onGridReady: (event: GridReadyEvent<GridRow>) => void;
  onSelectionChanged: (event: SelectionChangedEvent<GridRow>) => void;
}

// Owns the multi-row selection: mirrors the grid's selected ticket rows into
// React state and resyncs when `gridRows` changes drop deselected rows.
export function useReleaseDevTicketSelection(gridRows: GridRow[]): ReleaseDevTicketSelection {
  const [gridApi, setGridApi] = useState<GridApi<GridRow> | null>(null);
  const [selectedRows, setSelectedRows] = useState<ReleaseDetailDevTicketRow[]>([]);

  useEffect(() => {
    if (!gridApi) return;
    setSelectedRows(pickTicketRows(gridApi.getSelectedRows()));
  }, [gridRows, gridApi]);

  return {
    gridApi,
    selectedRows,
    onGridReady: event => setGridApi(event.api),
    onSelectionChanged: event => setSelectedRows(pickTicketRows(event.api.getSelectedRows())),
  };
}
