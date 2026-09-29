import { useMemo, useState, type ReactElement } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { CallStatus, CallType } from '@xyne/shared';
import { CheckTickCircle, VideoCallDefault } from '@xyne/icons';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  cancelAdminCall,
  forceEndAdminCall,
  listAdminCalls,
  regenerateAdminSummary,
  reprocessAdminTranscript,
  roomStillLiveParticipants,
  unlinkAdminTranscript,
  type CallAdminAction,
  type CallAdminCallFilters,
  type CallAdminCallRow,
  type CallAdminListScope,
} from '@/services/Call/callAdminService';
import {
  ACTION_LABELS,
  CALLS_ADMIN_TRACK,
  callStatusVariant,
  formatDateTime,
  summaryStatusVariant,
  titleCase,
  userLabel,
} from './CallsAdminScreen.utils';
import { callsAdminCallsKey, callsAdminPrefix } from './callsAdminQueryKeys';
import { ChangeOwnerDialog } from './ChangeOwnerDialog';
import { CursorPager } from './CursorPager';
import { useCursorPages } from './useCursorPages';

type QuickFilterId = 'stuck' | 'summary' | 'no-transcript';

const QUICK_FILTERS: readonly {
  id: QuickFilterId;
  label: string;
  filters: Pick<CallAdminCallFilters, 'status' | 'summaryStatus' | 'hasTranscript'>;
}[] = [
  {
    id: 'stuck',
    label: 'Stuck active',
    filters: { status: `${CallStatus.ACTIVE},${CallStatus.IN_PROGRESS}` },
  },
  { id: 'summary', label: 'Summary pending/failed', filters: { summaryStatus: 'pending,failed' } },
  {
    id: 'no-transcript',
    label: 'No transcript',
    filters: { status: CallStatus.ENDED, hasTranscript: false },
  },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...Object.values(CallStatus).map(status => ({ value: status, label: titleCase(status) })),
];

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: CallType.VIDEO, label: 'Video' },
  { value: CallType.AUDIO, label: 'Audio' },
  { value: CallType.HEADLESS, label: 'Recording' },
];

type DirectAction = Exclude<CallAdminAction, 'changeOwner'>;
type ConfirmedAction = Extract<DirectAction, 'cancel' | 'forceEnd' | 'unlinkTranscript'>;

const CONFIRM_COPY: Record<
  ConfirmedAction,
  { title: string; description: string; confirmLabel: string }
> = {
  cancel: {
    title: 'Cancel this call?',
    description:
      'The call is marked cancelled, its reminders are removed and the calendar invite is withdrawn.',
    confirmLabel: 'Cancel call',
  },
  forceEnd: {
    title: 'Force-end this call?',
    description:
      'Only works once the call room is gone. The call is marked ended and its thread message is closed out.',
    confirmLabel: 'Force end',
  },
  unlinkTranscript: {
    title: 'Unlink the transcript?',
    description:
      'The transcript is removed from the call, its thread and search. The stored file is kept, so it can be reprocessed later.',
    confirmLabel: 'Unlink',
  },
};

const SUCCESS_TOASTS: Record<DirectAction, string> = {
  cancel: 'Call cancelled',
  forceEnd: 'Call ended',
  unlinkTranscript: 'Transcript unlinked',
  regenerateSummary: 'Summary regeneration started',
  reprocessTranscript: 'Transcript reprocessing started',
};

const isConfirmed = (action: DirectAction): action is ConfirmedAction => action in CONFIRM_COPY;

function runDirectAction(action: DirectAction, externalId: string): Promise<void> {
  switch (action) {
    case 'cancel':
      return cancelAdminCall(externalId);
    case 'forceEnd':
      return forceEndAdminCall(externalId);
    case 'unlinkTranscript':
      return unlinkAdminTranscript(externalId);
    case 'regenerateSummary':
      return regenerateAdminSummary(externalId);
    case 'reprocessTranscript':
      return reprocessAdminTranscript(externalId);
  }
}

const typeLabel = (type: CallType): string =>
  type === CallType.HEADLESS ? 'Recording' : titleCase(type);

export function CallsTab({ scope }: { scope: CallAdminListScope }): ReactElement {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilterId | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    action: ConfirmedAction;
    call: CallAdminCallRow;
  } | null>(null);
  const [ownerTarget, setOwnerTarget] = useState<CallAdminCallRow | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const { isMobile } = usePlatform();

  const baseFilters = useMemo<CallAdminCallFilters>(() => {
    const quick = QUICK_FILTERS.find(filter => filter.id === quickFilter);
    return {
      scope,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(type ? { type } : {}),
      ...(quick ? quick.filters : status ? { status } : {}),
    };
  }, [scope, debouncedSearch, type, status, quickFilter]);

  const pages = useCursorPages(JSON.stringify(baseFilters));
  const filters: CallAdminCallFilters = {
    ...baseFilters,
    ...(pages.cursor ? { cursor: pages.cursor } : {}),
  };

  const { data, isPending, isError, isFetching } = useQuery({
    queryKey: callsAdminCallsKey(filters),
    queryFn: () => listAdminCalls(filters),
    placeholderData: keepPreviousData,
  });

  const runAction = useMutation({
    mutationFn: ({ action, call }: { action: DirectAction; call: CallAdminCallRow }) =>
      runDirectAction(action, call.externalId),
    onSuccess: (_result, { action }) => {
      toast.success(SUCCESS_TOASTS[action]);
      setConfirmTarget(null);
      void queryClient.invalidateQueries({ queryKey: callsAdminPrefix });
    },
    onError: (error, { action }) => {
      const liveParticipants = action === 'forceEnd' ? roomStillLiveParticipants(error) : null;
      if (liveParticipants !== null) {
        toast.error(
          `Room still live (${liveParticipants} participant${liveParticipants === 1 ? '' : 's'}) — use End for all in the call`,
        );
        setConfirmTarget(null);
        return;
      }
      toast.error(callAdminErrorText(error, 'Something went wrong. Try again.'));
    },
  });

  const onSelectAction = (action: CallAdminAction, call: CallAdminCallRow): void => {
    if (action === 'changeOwner') {
      setOwnerTarget(call);
    } else if (isConfirmed(action)) {
      setConfirmTarget({ action, call });
    } else {
      runAction.mutate({ action, call });
    }
  };

  const toolbar = (
    <div className='flex shrink-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <AdminSearchField
          value={search}
          onChange={setSearch}
          placeholder='Search by title or call id'
          ariaLabel='Search calls'
          trackName='Calls admin: search calls'
          trackCategory={CALLS_ADMIN_TRACK}
          className='min-w-[16rem] flex-1'
        />
        <FilterSelect
          ariaLabel='Call type filter'
          icon={<VideoCallDefault className='size-4 shrink-0 text-muted-foreground' aria-hidden />}
          value={type}
          onChange={setType}
          options={TYPE_OPTIONS}
        />
        <FilterSelect
          ariaLabel='Status filter'
          icon={<CheckTickCircle className='size-4 shrink-0 text-muted-foreground' aria-hidden />}
          value={status}
          onChange={value => {
            setQuickFilter(null);
            setStatus(value);
          }}
          options={STATUS_OPTIONS}
        />
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        {QUICK_FILTERS.map(filter => {
          const active = quickFilter === filter.id;
          return (
            <button
              key={filter.id}
              type='button'
              aria-pressed={active}
              onClick={() => {
                setStatus('');
                setQuickFilter(active ? null : filter.id);
              }}
              data-track-category={CALLS_ADMIN_TRACK}
              data-track-name={`Calls admin: quick filter ${filter.label}`}
              className={cn(
                'h-7 rounded-full border px-3 text-xs transition-colors',
                active
                  ? 'border-foreground bg-muted text-foreground'
                  : 'border-border text-muted-foreground',
                !active && !isMobile && 'hover:text-foreground',
              )}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
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
        <TabMessage>Couldn’t load calls.</TabMessage>
      </div>
    );
  }

  if (data.rows.length === 0) {
    return (
      <div className='flex min-h-0 flex-1 flex-col gap-4'>
        {toolbar}
        <TabMessage>No calls match these filters.</TabMessage>
        <CursorPager pages={pages} nextCursor={data.nextCursor} trackPrefix='Calls admin: calls' />
      </div>
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4'>
      {toolbar}
      <AdminTable
        headers={[
          { label: 'Call', width: 'max-w-[20rem]' },
          { label: 'Owner', width: 'max-w-[12rem]' },
          { label: 'Type' },
          { label: 'Status' },
          { label: 'When' },
          { label: 'Transcript' },
          { label: 'Summary' },
          { label: '', align: 'right' as const, width: 'w-14' },
        ]}
      >
        {data.rows.map(call => (
          <tr
            key={call.id}
            className={cn(
              'border-b border-border',
              !isMobile && 'hover:bg-muted/40',
              isFetching && 'opacity-70',
            )}
          >
            <td className='max-w-[20rem] px-4 py-3 align-top leading-5'>
              <div className='flex flex-col gap-0.5'>
                <span className='truncate text-foreground'>{call.title || 'Untitled call'}</span>
                <span className='truncate font-mono text-xs text-muted-foreground'>
                  {call.externalId}
                </span>
              </div>
            </td>
            <td className='max-w-[12rem] px-4 py-3 align-top leading-5 text-muted-foreground'>
              <PersonPill
                userId={call.owner.id}
                name={userLabel(call.owner)}
                className='block truncate text-xs'
              />
            </td>
            <td className='px-4 py-3 align-top leading-5'>
              <Badge variant='secondary' className='-ml-2'>
                {typeLabel(call.type)}
              </Badge>
            </td>
            <td className='px-4 py-3 align-top leading-5'>
              <Badge variant={callStatusVariant(call.status)} className='-ml-2'>
                {titleCase(call.status)}
              </Badge>
            </td>
            <td className='whitespace-nowrap px-4 py-3 align-top text-xs leading-5 text-muted-foreground'>
              {formatDateTime(
                call.status === CallStatus.SCHEDULED && call.startsAt
                  ? call.startsAt
                  : call.startedAt,
              )}
            </td>
            <td className='px-4 py-3 align-top text-xs leading-5 text-muted-foreground'>
              {call.hasTranscript ? 'Linked' : call.transcriptUnlinked ? 'Unlinked' : '—'}
            </td>
            <td className='px-4 py-3 align-top leading-5'>
              {call.summaryStatus ? (
                <Badge variant={summaryStatusVariant(call.summaryStatus)} className='-ml-2'>
                  {titleCase(call.summaryStatus)}
                </Badge>
              ) : (
                <span className='text-xs text-muted-foreground'>—</span>
              )}
            </td>
            <td className='px-4 py-3 text-right align-top leading-5'>
              {call.allowedActions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type='button'
                      variant='ghost'
                      size='iconSm'
                      disabled={runAction.isPending}
                      aria-label={`Actions for ${call.title || 'untitled call'}`}
                      className={cn(
                        '-my-2 text-muted-foreground',
                        !isMobile && 'hover:text-foreground',
                      )}
                      data-track-category={CALLS_ADMIN_TRACK}
                      data-track-name='Calls admin: open call actions'
                    >
                      <MoreHorizontal className='size-4' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    {call.allowedActions.map(action => (
                      <DropdownMenuItem
                        key={action}
                        onSelect={() => onSelectAction(action, call)}
                        data-track-category={CALLS_ADMIN_TRACK}
                        data-track-name={`Calls admin: ${ACTION_LABELS[action]}`}
                        className={cn(
                          action !== 'changeOwner' &&
                            isConfirmed(action) &&
                            'text-destructive focus:text-destructive',
                        )}
                      >
                        {ACTION_LABELS[action]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </td>
          </tr>
        ))}
      </AdminTable>
      <CursorPager pages={pages} nextCursor={data.nextCursor} trackPrefix='Calls admin: calls' />

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={open => {
          if (!open) setConfirmTarget(null);
        }}
        title={confirmTarget ? CONFIRM_COPY[confirmTarget.action].title : ''}
        description={
          confirmTarget
            ? `${confirmTarget.call.title || 'Untitled call'} — ${CONFIRM_COPY[confirmTarget.action].description}`
            : undefined
        }
        confirmLabel={confirmTarget ? CONFIRM_COPY[confirmTarget.action].confirmLabel : 'Confirm'}
        danger
        loading={runAction.isPending}
        trackCategory={CALLS_ADMIN_TRACK}
        onConfirm={() => {
          if (confirmTarget) runAction.mutate(confirmTarget);
        }}
      />

      <ChangeOwnerDialog
        key={ownerTarget?.externalId ?? 'none'}
        call={ownerTarget}
        onClose={() => setOwnerTarget(null)}
      />
    </div>
  );
}
