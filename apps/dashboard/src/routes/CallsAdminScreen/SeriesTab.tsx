import { useMemo, useState, type ReactElement } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RecurringCallSeriesStatus } from '@xyne/shared';
import { CalendarCancel, CheckTickCircle } from '@xyne/icons';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import Tooltip from '@/components/ui/Tooltip';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePlatform } from '@/hooks/usePlatform';
import { cn } from '@/utils/classNames';
import { AdminTable } from '@/routes/AIScreen/library/admin/components/AdminTable';
import { AdminSearchField } from '@/routes/AIScreen/library/admin/components/AdminSearchField';
import { FilterSelect } from '@/routes/AIScreen/library/admin/components/FilterSelect';
import { TabMessage } from '@/routes/AIScreen/library/admin/components/TabMessage';
import { PersonPill } from '@/routes/AIScreen/library/shared/primitives/PersonPill';
import {
  callAdminErrorText,
  cancelAdminSeries,
  listAdminSeries,
  type CallAdminListScope,
  type CallAdminSeriesFilters,
  type CallAdminSeriesRow,
} from '@/services/Call/callAdminService';
import { CALLS_ADMIN_TRACK, formatDateTime, titleCase, userLabel } from './CallsAdminScreen.utils';
import { callsAdminPrefix, callsAdminSeriesKey } from './callsAdminQueryKeys';
import { CursorPager } from './CursorPager';
import { useCursorPages } from './useCursorPages';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...Object.values(RecurringCallSeriesStatus).map(status => ({
    value: status,
    label: titleCase(status),
  })),
];

export function SeriesTab({ scope }: { scope: CallAdminListScope }): ReactElement {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [cancelTarget, setCancelTarget] = useState<CallAdminSeriesRow | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const { isMobile } = usePlatform();

  const baseFilters = useMemo<CallAdminSeriesFilters>(
    () => ({
      scope,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(status ? { status } : {}),
    }),
    [scope, debouncedSearch, status],
  );

  const pages = useCursorPages(JSON.stringify(baseFilters));
  const filters: CallAdminSeriesFilters = {
    ...baseFilters,
    ...(pages.cursor ? { cursor: pages.cursor } : {}),
  };

  const { data, isPending, isError, isFetching } = useQuery({
    queryKey: callsAdminSeriesKey(filters),
    queryFn: () => listAdminSeries(filters),
    placeholderData: keepPreviousData,
  });

  const cancelSeries = useMutation({
    mutationFn: (seriesId: string) => cancelAdminSeries(seriesId),
    onSuccess: ({ cancelledCalls }) => {
      toast.success(
        `Series cancelled — ${cancelledCalls} upcoming call${cancelledCalls === 1 ? '' : 's'} removed`,
      );
      setCancelTarget(null);
      void queryClient.invalidateQueries({ queryKey: callsAdminPrefix });
    },
    onError: error => toast.error(callAdminErrorText(error, 'Could not cancel the series')),
  });

  const toolbar = (
    <div className='flex shrink-0 flex-wrap items-center gap-3'>
      <AdminSearchField
        value={search}
        onChange={setSearch}
        placeholder='Search by title or series id'
        ariaLabel='Search recurring series'
        trackName='Calls admin: search series'
        trackCategory={CALLS_ADMIN_TRACK}
        className='min-w-[16rem] flex-1'
      />
      <FilterSelect
        ariaLabel='Series status filter'
        icon={<CheckTickCircle className='size-4 shrink-0 text-muted-foreground' aria-hidden />}
        value={status}
        onChange={setStatus}
        options={STATUS_OPTIONS}
      />
    </div>
  );

  if (isPending) {
    return (
      <div className='flex min-h-0 flex-1 flex-col gap-4'>
        {toolbar}
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  if (isError) {
    return (
      <div className='flex min-h-0 flex-1 flex-col gap-4'>
        {toolbar}
        <TabMessage>Couldn’t load recurring series.</TabMessage>
      </div>
    );
  }

  if (data.rows.length === 0) {
    return (
      <div className='flex min-h-0 flex-1 flex-col gap-4'>
        {toolbar}
        <TabMessage>No recurring series match these filters.</TabMessage>
        <CursorPager pages={pages} nextCursor={data.nextCursor} trackPrefix='Calls admin: series' />
      </div>
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4'>
      {toolbar}
      <AdminTable
        headers={[
          { label: 'Series', width: 'max-w-[20rem]' },
          { label: 'Organizer', width: 'max-w-[12rem]' },
          { label: 'Schedule', width: 'max-w-[18rem]' },
          { label: 'Next call' },
          { label: 'Status' },
          { label: '', align: 'right' as const, width: 'w-14' },
        ]}
      >
        {data.rows.map(series => (
          <tr
            key={series.id}
            className={cn(
              'border-b border-border',
              !isMobile && 'hover:bg-muted/40',
              isFetching && 'opacity-70',
            )}
          >
            <td className='max-w-[20rem] px-4 py-3 align-top leading-5'>
              <div className='flex flex-col gap-0.5'>
                <span className='truncate text-foreground'>{series.title}</span>
                <span className='truncate font-mono text-xs text-muted-foreground'>
                  {series.id}
                </span>
              </div>
            </td>
            <td className='max-w-[12rem] px-4 py-3 align-top leading-5 text-muted-foreground'>
              <PersonPill
                userId={series.organizer.id}
                name={userLabel(series.organizer)}
                className='block truncate text-xs'
              />
            </td>
            <td className='max-w-[18rem] px-4 py-3 align-top text-xs leading-5 text-muted-foreground'>
              <div className='flex flex-col gap-0.5'>
                <span className='text-foreground'>
                  {series.startTime}–{series.endTime} {series.timezone}
                </span>
                <span className='break-words font-mono'>{series.recurrenceRule}</span>
              </div>
            </td>
            <td className='whitespace-nowrap px-4 py-3 align-top text-xs leading-5 text-muted-foreground'>
              {formatDateTime(series.nextInstance?.startsAt ?? null)}
            </td>
            <td className='px-4 py-3 align-top leading-5'>
              <Badge
                variant={
                  series.status === RecurringCallSeriesStatus.ACTIVE ? 'primary' : 'secondary'
                }
                className='-ml-2'
              >
                {titleCase(series.status)}
              </Badge>
            </td>
            <td className='px-4 py-3 text-right align-top leading-5'>
              {series.allowedActions.includes('cancel') && (
                <Tooltip content='Cancel series' side='top'>
                  <span className='inline-flex'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='iconSm'
                      disabled={cancelSeries.isPending}
                      onClick={() => setCancelTarget(series)}
                      className={cn(
                        '-my-2 text-muted-foreground',
                        !isMobile && 'hover:text-destructive',
                      )}
                      aria-label={`Cancel series ${series.title}`}
                      data-track-category={CALLS_ADMIN_TRACK}
                      data-track-name='Calls admin: cancel series'
                    >
                      <CalendarCancel className='size-4 text-current' />
                    </Button>
                  </span>
                </Tooltip>
              )}
            </td>
          </tr>
        ))}
      </AdminTable>
      <CursorPager pages={pages} nextCursor={data.nextCursor} trackPrefix='Calls admin: series' />

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={open => {
          if (!open) setCancelTarget(null);
        }}
        title='Cancel this series?'
        description={
          cancelTarget
            ? `${cancelTarget.title} — every upcoming call in the series is cancelled and its reminders and calendar invites are withdrawn. Past calls are kept.`
            : undefined
        }
        confirmLabel='Cancel series'
        danger
        loading={cancelSeries.isPending}
        trackCategory={CALLS_ADMIN_TRACK}
        onConfirm={() => {
          if (cancelTarget) cancelSeries.mutate(cancelTarget.id);
        }}
      />
    </div>
  );
}
