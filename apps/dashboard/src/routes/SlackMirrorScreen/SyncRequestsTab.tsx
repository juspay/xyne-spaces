import { useMemo, useState, type ReactElement } from 'react';
import { WorkspaceRole } from '@xyne/shared';
import { format } from 'date-fns';
import { toast } from 'sonner';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { DateRangeFilter, type DateRangeValue } from '../../components/ui/DateRangeFilter';
import { Dialog } from '../../components/ui/Dialog';
import Input from '../../components/ui/Input/Input';
import { MultiSelect } from '../../components/ui/MultiSelect';
import { Table, type ColumnDef } from '../../components/ui/Table';
import Textarea from '../../components/ui/Textarea/Textarea';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshSlackMirror, useSyncRequests } from '../../hooks/useSlackMirror';
import { useSelf } from '../../hooks/useUsers';
import {
  approveSyncRequest,
  rejectSyncRequest,
  slackMirrorErrorMessage,
  type SyncRequestRow,
  type SyncRequestStatus,
} from '../../services/clients/slackMirrorApi';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: SyncRequestStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_BADGE: Record<SyncRequestStatus, 'default' | 'secondary' | 'destructive' | 'outline'> =
  {
    PENDING: 'default',
    APPROVED: 'secondary',
    REJECTED: 'destructive',
    CANCELLED: 'outline',
  };

const formatTime = (iso: string): string => format(new Date(iso), 'MMM d, yyyy h:mm a');

/** Organisations → Slack Mirror → Requests: channel admins' sync requests, approved here. */
export function SyncRequestsTab(): ReactElement {
  const self = useSelf();
  const canDecide = self?.role === WorkspaceRole.OWNER || self?.role === WorkspaceRole.ADMIN;
  const refresh = useRefreshSlackMirror();
  const [statuses, setStatuses] = useState<SyncRequestStatus[]>(['PENDING']);
  const [range, setRange] = useState<DateRangeValue | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<SyncRequestRow | null>(null);

  const filters = useMemo(
    () => ({
      statuses,
      ...(range && { from: range.startDate.toISOString(), to: range.endDate.toISOString() }),
      search: debouncedSearch.trim(),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [statuses, range, debouncedSearch, page],
  );
  const { data, isLoading, isError } = useSyncRequests(filters, canDecide);

  // A failed re-check rejects the request on the server, so the list is refreshed either way.
  const approve = (row: SyncRequestRow) => async (): Promise<void> => {
    try {
      await approveSyncRequest(row.id);
      toast.success(`#${row.spacesChannelName ?? 'channel'} now syncs with #${row.externalName}`);
    } catch (error) {
      toast.error(slackMirrorErrorMessage(error, "Couldn't approve the request."));
    } finally {
      await refresh.requests();
    }
  };

  const columns: ColumnDef<SyncRequestRow>[] = [
    {
      field: 'spacesChannelName',
      header: 'Spaces channel',
      renderCell: (_, row) => `#${row.spacesChannelName ?? 'deleted channel'}`,
    },
    {
      field: 'externalName',
      header: 'Slack channel',
      renderCell: (_, row) => `#${row.externalName}`,
    },
    {
      field: 'requesterName',
      header: 'Requested by',
      renderCell: (_, row) => row.requesterName ?? '—',
    },
    {
      field: 'requestedAt',
      header: 'Requested',
      renderCell: (_, row) => formatTime(row.requestedAt),
    },
    {
      field: 'status',
      header: 'Status',
      renderCell: (_, row) => (
        <div className='flex flex-col gap-1'>
          <Badge variant={STATUS_BADGE[row.status]}>
            {STATUS_OPTIONS.find(option => option.value === row.status)?.label}
          </Badge>
          {row.deciderName && row.decidedAt && (
            <span className='text-xs text-muted-foreground'>
              by {row.deciderName}, {formatTime(row.decidedAt)}
            </span>
          )}
          {row.reason && <span className='text-xs text-muted-foreground'>{row.reason}</span>}
        </div>
      ),
    },
    {
      field: 'id',
      header: '',
      renderCell: (_, row) =>
        row.status === 'PENDING' ? (
          <div className='flex justify-end gap-2'>
            <Button size='sm' trackId='slack_sync_request_approve' trackAction={approve(row)}>
              Approve
            </Button>
            <Button
              size='sm'
              variant='outline'
              trackId='slack_sync_request_reject_open'
              onClick={() => setRejecting(row)}
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className='space-y-4'>
      <div>
        <h2 className='text-lg font-semibold text-foreground'>Slack sync requests</h2>
        <p className='text-sm text-muted-foreground'>
          Channel admins ask to sync their channel with a Slack channel. Approving links them; if
          the channels can&apos;t be linked any more, the request is rejected with the reason.
        </p>
      </div>

      {!canDecide ? (
        <div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
          Only workspace admins and owners can review Slack sync requests.
        </div>
      ) : (
        <Table
          data={data?.requests ?? []}
          columns={columns}
          idField='id'
          isLoading={isLoading}
          {...(isError && { errorState: "Couldn't load requests. Try again." })}
          emptyState='No requests match these filters.'
          pagination={{ currentPage: page, pageSize: PAGE_SIZE, totalRows: data?.total ?? 0 }}
          serverSidePagination
          onPageChange={setPage}
          toolbar={
            <div className='flex flex-wrap items-center gap-2 pb-3'>
              <MultiSelect
                className='w-56'
                options={STATUS_OPTIONS}
                selectedValues={statuses}
                onChange={values => {
                  setStatuses(values as SyncRequestStatus[]);
                  setPage(1);
                }}
                placeholder='All statuses'
              />
              <DateRangeFilter
                dateRange={range}
                onChange={value => {
                  setRange(value);
                  setPage(1);
                }}
              />
              <Input
                className='w-64'
                value={search}
                onChange={event => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder='Search channel or requester'
                aria-label='Search requests'
              />
            </div>
          }
        />
      )}

      <RejectDialog
        row={rejecting}
        onClose={() => setRejecting(null)}
        onRejected={refresh.requests}
      />
    </div>
  );
}

function RejectDialog(props: {
  row: SyncRequestRow | null;
  onClose: () => void;
  onRejected: () => Promise<unknown>;
}): ReactElement {
  const { row, onClose, onRejected } = props;
  const [reason, setReason] = useState('');

  const reject = async (): Promise<void> => {
    if (!row) return;
    try {
      await rejectSyncRequest(row.id, reason.trim());
      toast.success('Request rejected');
      setReason('');
      onClose();
    } catch (error) {
      toast.error(slackMirrorErrorMessage(error, "Couldn't reject the request."));
    } finally {
      await onRejected();
    }
  };

  return (
    <Dialog
      open={!!row}
      onOpenChange={open => !open && onClose()}
      title='Reject sync request'
      {...(row && {
        description: `#${row.spacesChannelName ?? 'channel'} with #${row.externalName}. The requester sees your reason.`,
      })}
    >
      <div className='flex flex-col gap-3'>
        <Textarea
          value={reason}
          onChange={event => setReason(event.target.value)}
          placeholder='Why is this rejected?'
          maxLength={500}
          aria-label='Reason'
        />
        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            disabled={!reason.trim()}
            trackId='slack_sync_request_reject'
            trackAction={reject}
          >
            Reject
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
