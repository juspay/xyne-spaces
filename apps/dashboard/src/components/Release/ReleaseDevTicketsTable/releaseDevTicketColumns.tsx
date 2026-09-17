/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import type { ColDef, ICellRendererParams, ValueGetterParams } from 'ag-grid-community';
import {
  devTicketAddableCellValue,
  type ReleaseDetailDevTicketRow,
} from '../../../routes/ReleaseDetailScreen/releaseReport.utils';
import type { ChangeCounts } from '../releaseChanges.utils';
import type { ReleaseStageOption } from '../ReleaseStagePicker';
import { DevTicketStagePicker } from '../DevTicketStagePicker';
import { QAOwnerPicker } from '../QAOwnerPicker';
import { createGridSelectionRenderers } from '../../ui/DataGrid/gridSelection';
import type { GridRow } from './types';

const { IndexHeaderRenderer, IndexCellRenderer } = createGridSelectionRenderers<GridRow>({
  isSelectable: node => node.data?.kind === 'ticket',
  tracking: {
    category: 'Release',
    selectAll: 'ToggleSelectAllDevTickets',
    select: 'SelectDevTicketRow',
    deselect: 'DeselectDevTicketRow',
  },
  checkIcon: Check,
});

// Cell renderer that only draws for ticket rows — group headers are full-width,
// so every ticket cell shares this guard instead of repeating it.
const ticketCell =
  (render: (row: ReleaseDetailDevTicketRow) => ReactElement | null) =>
  (params: ICellRendererParams<GridRow>): ReactElement | null =>
    params.data?.kind === 'ticket' ? render(params.data.row) : null;

const ChangeCountBadge = ({ counts }: { counts?: ChangeCounts | undefined }): ReactElement => {
  if (!counts || (counts.env === 0 && counts.mig === 0)) {
    return <span className='text-muted-foreground'>—</span>;
  }
  return (
    <span className='inline-flex items-center gap-1 text-xs'>
      {counts.env > 0 && (
        <span className='px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'>
          {counts.env} env
        </span>
      )}
      {counts.mig > 0 && (
        <span className='px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'>
          {counts.mig} mig
        </span>
      )}
    </span>
  );
};

const TicketIdCell = (
  params: ICellRendererParams<GridRow> & { baseRoute: string },
): ReactElement | null => {
  const navigate = useNavigate();
  if (params.data?.kind !== 'ticket') return null;
  const row = params.data.row;
  if (row.internalTicketId && row.channelId && row.conversationId) {
    return (
      <button
        className='text-primary hover:underline cursor-pointer font-mono text-xs'
        onClick={() =>
          void navigate(
            `${params.baseRoute}/${row.channelId}/${row.conversationId}/${row.internalTicketId}?selectedTab=details`,
          )
        }
      >
        {row.ticketId}
      </button>
    );
  }
  return <span className='text-muted-foreground font-mono text-xs'>{row.ticketId}</span>;
};

const TitleCell = ticketCell(row => (
  <span title={row.title} className='truncate block'>
    {row.title}
  </span>
));

const PrCell = ticketCell(row =>
  row.prId && row.prUrl ? (
    <a
      href={row.prUrl}
      target='_blank'
      rel='noopener noreferrer'
      className='text-primary hover:underline'
    >
      #{row.prId}
    </a>
  ) : (
    <span className='text-muted-foreground'>—</span>
  ),
);

const TypeHotfixCell = ticketCell(row => (
  <div className='flex items-center gap-1.5'>
    <span className='text-xs px-2 py-0.5 rounded bg-muted'>{row.type}</span>
    {row.isHotfix && (
      <span className='text-xs px-2 py-0.5 rounded font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'>
        🔥 Hotfix
      </span>
    )}
  </div>
));

const StatusCell = (
  params: ICellRendererParams<GridRow> & {
    stagesByBoard: Map<string, ReleaseStageOption[]>;
    onCancelledStage: (row: ReleaseDetailDevTicketRow, stage: ReleaseStageOption) => void;
  },
): ReactElement | null => {
  if (params.data?.kind !== 'ticket') return null;
  const row = params.data.row;
  return (
    <DevTicketStagePicker
      ticketId={row.internalTicketId}
      stageName={row.status}
      stages={row.boardId ? (params.stagesByBoard.get(row.boardId) ?? []) : []}
      artId={row.artId}
      onCancelled={stage => params.onCancelledStage(row, stage)}
    />
  );
};

const ChangesCell = ticketCell(row => <ChangeCountBadge counts={row.changeCounts} />);

const QaCell = ticketCell(row => (
  <QAOwnerPicker
    artId={row.artId}
    testedBy={row.testedBy}
    currentUserName={row.testedBy ? row.qaOwner : null}
  />
));

const ticketRow = (p: { data?: GridRow | undefined }): ReleaseDetailDevTicketRow | null =>
  p.data?.kind === 'ticket' ? p.data.row : null;

export interface BuildReleaseDevTicketColumnsArgs {
  selectedColumns: readonly { key: string; label: string }[];
  stagesByBoard: Map<string, ReleaseStageOption[]>;
  onCancelledStage: (row: ReleaseDetailDevTicketRow, stage: ReleaseStageOption) => void;
  baseRoute: string;
}

// sortable is off on every column: sorting would scatter the full-width group headers.
export function buildReleaseDevTicketColumns({
  selectedColumns,
  stagesByBoard,
  onCancelledStage,
  baseRoute,
}: BuildReleaseDevTicketColumnsArgs): ColDef<GridRow>[] {
  return [
    {
      colId: 'select',
      headerName: '',
      width: 48,
      maxWidth: 48,
      pinned: 'left',
      lockPosition: true,
      suppressMovable: true,
      sortable: false,
      resizable: false,
      headerComponent: IndexHeaderRenderer,
      cellRenderer: IndexCellRenderer,
      cellStyle: { padding: 0 },
    },
    {
      colId: 'ticketId',
      headerName: 'Ticket Id',
      pinned: 'left',
      width: 120,
      sortable: false,
      cellRenderer: TicketIdCell,
      cellRendererParams: { baseRoute },
    },
    {
      colId: 'title',
      headerName: 'Title',
      pinned: 'left',
      minWidth: 240,
      flex: 1,
      sortable: false,
      cellRenderer: TitleCell,
    },
    {
      colId: 'pr',
      headerName: 'PR',
      width: 90,
      sortable: false,
      cellRenderer: PrCell,
    },
    {
      colId: 'devOwner',
      headerName: 'Dev Owner',
      minWidth: 140,
      sortable: false,
      cellClass: 'text-muted-foreground',
      valueGetter: (p: ValueGetterParams<GridRow>) => ticketRow(p)?.devOwner ?? '',
    },
    {
      colId: 'type',
      headerName: 'Type',
      minWidth: 120,
      sortable: false,
      cellRenderer: TypeHotfixCell,
    },
    {
      colId: 'status',
      headerName: 'Status',
      minWidth: 160,
      sortable: false,
      cellRenderer: StatusCell,
      cellRendererParams: { stagesByBoard, onCancelledStage },
    },
    {
      colId: 'changes',
      headerName: 'Changes',
      minWidth: 120,
      sortable: false,
      cellRenderer: ChangesCell,
    },
    {
      colId: 'qa',
      headerName: 'QA Owner',
      minWidth: 140,
      sortable: false,
      cellRenderer: QaCell,
    },
    ...selectedColumns.map(
      (col): ColDef<GridRow> => ({
        colId: `add:${col.key}`,
        headerName: col.label,
        minWidth: 120,
        sortable: false,
        cellClass: 'text-muted-foreground',
        valueGetter: (p: ValueGetterParams<GridRow>) => {
          const row = ticketRow(p);
          return row ? devTicketAddableCellValue(row, col.key) : '';
        },
      }),
    ),
  ];
}
