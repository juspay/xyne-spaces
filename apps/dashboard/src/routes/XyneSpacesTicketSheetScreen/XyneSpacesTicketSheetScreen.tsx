import { ReactElement, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type ValueFormatterParams,
} from 'ag-grid-community';
import type { QueryResultType } from '@rocicorp/zero';
import { ArrowUpRight, Search } from 'lucide-react';
import type { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { queries } from '@/zero/queries';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { useChannelByName, useGetChannelUserStatus } from '@/hooks/useChannels';
import { useUsersById } from '@/hooks/useUsers';
import { cn } from '@/utils/classNames';

ModuleRegistry.registerModules([AllCommunityModule]);

type TicketSheetRow = NonNullable<QueryResultType<typeof queries.ticketsByChannelSheet>[number]>;

type StatusCount = Record<string, number>;

const CHANNEL_NAME = 'xyne-spaces';

const gridTheme = themeQuartz.withParams({
  backgroundColor: 'transparent',
  foregroundColor: 'hsl(var(--foreground))',
  headerBackgroundColor: 'hsl(var(--muted))',
  headerTextColor: 'hsl(var(--muted-foreground))',
  headerFontWeight: '700',
  fontSize: '12px',
  borderColor: 'hsl(var(--border))',
  rowBorder: { color: 'hsl(var(--border))', style: 'solid' },
  headerRowBorder: { color: 'hsl(var(--border))', style: 'solid' },
  columnBorder: { color: 'hsl(var(--border))', style: 'solid' },
  headerColumnBorder: { color: 'hsl(var(--border))', style: 'solid' },
  selectedRowBackgroundColor: 'hsl(var(--accent))',
});

const normalizeIdentity = (value?: string | null): string =>
  value?.replace(/^(user|group|userGroup):/, '') ?? '';

const formatDateTime = (value?: number | string | Date | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const formatDate = (value?: number | string | Date | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const sentenceCase = (value?: string | null): string => {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const Pill = ({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'status' | 'priority' | 'plain';
}): ReactElement => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
      tone === 'status' && 'border-blue-200 bg-blue-50 text-blue-700',
      tone === 'priority' && 'border-amber-200 bg-amber-50 text-amber-700',
      tone === 'plain' && 'border-border bg-muted text-muted-foreground',
    )}
  >
    {children}
  </span>
);

const XyneSpacesTicketSheetScreen = (): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const navigate = useNavigate();
  const channel = useChannelByName(CHANNEL_NAME);
  const channelUserStatus = useGetChannelUserStatus(channel?.id ?? '');
  const usersById = useUsersById();
  const [quickFilter, setQuickFilter] = useState('');

  const isMember = Boolean(
    channelUserStatus && !channelUserStatus.isClosed && !channelUserStatus.isDeleted,
  );
  const [tickets, ticketQuery] = useCachedQuery(
    queries.ticketsByChannelSheet({ channelId: channel?.id ?? '', isMember }),
    { enabled: Boolean(channel?.id) },
  );

  const rows = useMemo(() => tickets ?? [], [tickets]);

  const statusCounts = useMemo<StatusCount>(() => {
    return rows.reduce<StatusCount>((acc, ticket) => {
      const key = ticket.statusV2 || ticket.status || 'UNKNOWN';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }, [rows]);

  const openTicket = useCallback(
    (ticket: TicketSheetRow): void => {
      const prefix = workspaceId ? `/${workspaceId}` : '';
      void navigate(`${prefix}/chat/dir/${ticket.channelId}/tickets/${ticket.id}`, {
        state: { returnToUrl: window.location.pathname + window.location.search },
      });
    },
    [navigate, workspaceId],
  );

  const columnDefs = useMemo<ColDef<TicketSheetRow>[]>(
    () => [
      {
        headerName: 'Ticket',
        field: 'xyneId',
        pinned: 'left',
        minWidth: 145,
        cellRenderer: (params: ICellRendererParams<TicketSheetRow>): ReactNode => {
          if (!params.data) return null;
          return (
            <button
              type='button'
              className='inline-flex h-full items-center gap-1 font-mono text-xs font-semibold text-primary hover:underline'
              onClick={() => params.data && openTicket(params.data)}
              data-track-category='Tickets'
              data-track-name='OpenXyneSpacesTicketSheetRow'
            >
              {params.value}
              <ArrowUpRight className='h-3 w-3' aria-hidden='true' />
            </button>
          );
        },
      },
      { headerName: 'Title', field: 'title', minWidth: 360, flex: 1 },
      {
        headerName: 'Status',
        field: 'statusV2',
        minWidth: 150,
        cellRenderer: (params: ICellRendererParams<TicketSheetRow, TicketStatusV2>): ReactNode => (
          <Pill tone='status'>{sentenceCase(params.value)}</Pill>
        ),
      },
      {
        headerName: 'Priority',
        field: 'priority',
        minWidth: 130,
        cellRenderer: (params: ICellRendererParams<TicketSheetRow, TicketPriority>): ReactNode => (
          <Pill tone='priority'>{sentenceCase(params.value)}</Pill>
        ),
      },
      { headerName: 'Stage', field: 'stageName', minWidth: 180 },
      {
        headerName: 'Assignee',
        field: 'assignedTo',
        minWidth: 190,
        valueFormatter: (
          params: ValueFormatterParams<TicketSheetRow, string | null | undefined>,
        ): string => {
          const id = normalizeIdentity(params.value);
          return usersById.get(id)?.name || usersById.get(id)?.email || 'Unassigned';
        },
      },
      {
        headerName: 'Created by',
        field: 'createdBy',
        minWidth: 190,
        valueFormatter: (params: ValueFormatterParams<TicketSheetRow, string>): string => {
          const id = normalizeIdentity(params.value);
          return usersById.get(id)?.name || usersById.get(id)?.email || params.value || '—';
        },
      },
      {
        headerName: 'Labels',
        colId: 'labels',
        minWidth: 220,
        valueGetter: (params): string =>
          params.data?.tagMappings?.map((tag: { tagName: string }) => tag.tagName).join(', ') || '',
        cellRenderer: (params: ICellRendererParams<TicketSheetRow, string>): ReactNode => {
          const labels = params.value ? params.value.split(', ').filter(Boolean) : [];
          if (!labels.length) return <span className='text-muted-foreground'>—</span>;
          return (
            <div className='flex h-full items-center gap-1 overflow-hidden'>
              {labels.slice(0, 2).map(label => (
                <Pill key={label} tone='plain'>
                  {label}
                </Pill>
              ))}
              {labels.length > 2 && (
                <span className='text-xs text-muted-foreground'>+{labels.length - 2}</span>
              )}
            </div>
          );
        },
      },
      {
        headerName: 'Project',
        colId: 'project',
        minWidth: 180,
        valueGetter: (params): string => params.data?.project?.name ?? '—',
      },
      {
        headerName: 'Due date',
        field: 'eta',
        minWidth: 140,
        valueFormatter: (
          params: ValueFormatterParams<TicketSheetRow, number | null | undefined>,
        ): string => formatDate(params.value),
      },
      {
        headerName: 'Created at',
        field: 'createdAt',
        minWidth: 190,
        valueFormatter: (params: ValueFormatterParams<TicketSheetRow, number>): string =>
          formatDateTime(params.value),
      },
      {
        headerName: 'Updated at',
        field: 'updatedAt',
        minWidth: 190,
        valueFormatter: (params: ValueFormatterParams<TicketSheetRow, number>): string =>
          formatDateTime(params.value),
      },
    ],
    [openTicket, usersById],
  );

  const defaultColDef = useMemo<ColDef<TicketSheetRow>>(
    () => ({ sortable: true, filter: true, resizable: true, editable: false }),
    [],
  );

  const isLoading = ticketQuery.type !== 'complete' && rows.length === 0 && Boolean(channel?.id);

  if (!channel) {
    return (
      <div className='flex h-full items-center justify-center p-8'>
        <div className='max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm'>
          <p className='text-sm font-semibold text-foreground'>Could not find #xyne-spaces</p>
          <p className='mt-2 text-sm text-muted-foreground'>
            Join the channel or check that it exists in this workspace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='border-b border-border bg-card px-6 py-5'>
        <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
          <div>
            <p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>
              Channel ticket sheet
            </p>
            <h1 className='mt-2 text-2xl font-semibold tracking-tight text-foreground'>
              #xyne-spaces tickets
            </h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              A spreadsheet-style view of every non-archived ticket visible to you in this channel.
            </p>
          </div>
          <div className='relative w-full max-w-sm'>
            <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
            <input
              value={quickFilter}
              onChange={event => setQuickFilter(event.target.value)}
              placeholder='Search this sheet'
              className='h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20'
              aria-label='Search tickets'
              data-track-category='Tickets'
              data-track-name='XyneSpacesTicketSheetSearch'
            />
          </div>
        </div>

        <div className='mt-4 flex flex-wrap gap-2'>
          <Pill tone='plain'>{rows.length} tickets</Pill>
          {Object.entries(statusCounts).map(([status, count]) => (
            <Pill key={status} tone='status'>
              {sentenceCase(status)} · {count}
            </Pill>
          ))}
        </div>
      </div>

      <div className='min-h-0 flex-1 p-4'>
        <div className='h-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm'>
          {isLoading ? (
            <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
              Loading tickets…
            </div>
          ) : rows.length === 0 ? (
            <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
              No tickets found in #xyne-spaces.
            </div>
          ) : (
            <AgGridReact<TicketSheetRow>
              rowData={rows}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              theme={gridTheme}
              getRowId={params => params.data.id}
              quickFilterText={quickFilter}
              rowHeight={42}
              headerHeight={42}
              animateRows
              enableCellTextSelection
              pagination
              paginationPageSize={50}
              paginationPageSizeSelector={[25, 50, 100]}
              onRowDoubleClicked={event => event.data && openTicket(event.data)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default XyneSpacesTicketSheetScreen;
