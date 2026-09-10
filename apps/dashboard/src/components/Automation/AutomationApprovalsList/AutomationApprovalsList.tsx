import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckTickSingle, MultipleCrossCancelDefault, SearchDefault, Spinner } from '@xyne/icons';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';
import { Dialog } from '../../ui/Dialog/Dialog';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import Avatar from '../../ui/Avatar/Avatar';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useSelf, useUser } from '../../../hooks/useUsers';
// `useUser` is used below to surface the proposer's display name beside their avatar.
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { workflowToAutomation } from '../automation.adapter';
import { AutomationStatusValues, type Automation } from '../Automation.types';
import { useIsAutomationsAdmin } from '../useIsAutomationsAdmin';
import { AutomationFiltersBar } from '../AutomationsList/AutomationFiltersBar/AutomationFiltersBar';
import {
  DEFAULT_AUTOMATION_FILTERS,
  filterAutomations,
  type AutomationFilters,
} from '../AutomationsList/AutomationFiltersBar/filters';

/**
 * Approvals inbox — lists every PROPOSAL row in `PENDING_APPROVAL` status
 * across the workspace, with Approve / Reject buttons. Visible only to
 * users with `ADMIN` on the `AUTOMATIONS` resource.
 */
export function AutomationApprovalsList(): React.ReactElement {
  const navigate = useNavigate();
  const me = useSelf();
  const zero = useZero();
  const isAdmin = useIsAutomationsAdmin();
  const { workspaceId } = useAuthContextValues();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [query, setQuery] = useState('');
  // Status stays fixed at PENDING_APPROVAL for this view (the filter bar hides
  // that pill via `hideStatus`) — every other field stays user-adjustable.
  const [filters, setFilters] = useState<AutomationFilters>(DEFAULT_AUTOMATION_FILTERS);

  const [rows, rowsMeta] = useCachedQuery(queries.automationsList({ workspaceId }));
  const isLoading = !rows || rowsMeta?.type !== 'complete';

  const pending: Automation[] = useMemo(() => {
    if (!rows) return [];
    return rows
      .map(workflowToAutomation)
      .filter(a => a.status === AutomationStatusValues.PENDING_APPROVAL)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [rows]);

  const filtered: Automation[] = useMemo(
    () => filterAutomations(pending, query, filters),
    [pending, query, filters],
  );

  const approveMutation = useMutation({
    mutationFn: (id: string): Promise<void> => {
      zero.mutate(mutators.automations.approve({ id, note: null, timestamp: Date.now() }));
      toast.success('Proposal approved');
      return Promise.resolve();
    },
    onError: err => {
      toast.error(err instanceof Error ? err.message : 'Approve failed');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }): Promise<void> => {
      zero.mutate(mutators.automations.reject({ id, note, timestamp: Date.now() }));
      toast.success('Proposal rejected');
      return Promise.resolve();
    },
    onSuccess: () => {
      setRejectingId(null);
      setRejectNote('');
    },
    onError: err => {
      toast.error(err instanceof Error ? err.message : 'Reject failed');
    },
  });

  // Anyone can read the inbox — visibility into "what's waiting for admin
  // sign-off" is useful for the whole team. Non-admins just don't see the
  // Approve / Reject buttons on each row (the action buttons in PendingRow
  // are themselves gated by `isAdmin`).
  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <header className='sticky top-0 z-10 flex flex-col gap-4 border-b border-border bg-background px-6 pt-5 pb-4'>
        <div className='flex flex-col gap-1'>
          <h1 className='text-2xl font-semibold leading-[1.2] tracking-[-0.24px] text-foreground'>
            Approvals
          </h1>
          <p className='max-w-2xl text-sm leading-relaxed text-muted-foreground'>
            Proposed automations waiting on an admin decision. Approving one promotes it to live,
            and any other pending proposals for the same automation are auto-revoked.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <div className='relative w-56 max-w-full'>
            <SearchDefault
              aria-hidden='true'
              className='pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground'
            />
            <Input
              type='search'
              aria-label='Search proposals'
              placeholder='Search proposals…'
              value={query}
              onChange={e => setQuery(e.target.value)}
              className='h-8 rounded-md pl-8 text-xs'
            />
          </div>
          <AutomationFiltersBar
            query={query}
            filters={filters}
            onChange={setFilters}
            onClearQuery={() => setQuery('')}
            items={pending}
            hideStatus
          />
        </div>
      </header>

      <div className='flex-1 overflow-y-auto bg-muted/30 px-6 py-6'>
        <div className='mx-auto w-full max-w-4xl'>
          {isLoading ? (
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Spinner className='size-4 animate-spin' aria-hidden='true' />
              Loading proposals…
            </div>
          ) : filtered.length === 0 ? (
            <div className='rounded-md border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground'>
              {pending.length === 0
                ? 'No proposals waiting for approval.'
                : 'No proposals match your search.'}
            </div>
          ) : (
            <ul className='flex flex-col gap-3'>
              {filtered.map(item => (
                <PendingRow
                  key={item.id}
                  proposal={item}
                  currentUserId={me?.id ?? ''}
                  isAdmin={isAdmin}
                  approveLoading={
                    approveMutation.isPending && approveMutation.variables === item.id
                  }
                  onApprove={() => approveMutation.mutate(item.id)}
                  onReject={() => {
                    setRejectingId(item.id);
                    setRejectNote('');
                  }}
                  onOpen={() => void navigate(`/automations/${item.id}?from=approvals`)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <Dialog
        open={rejectingId !== null}
        onOpenChange={open => {
          if (!open) {
            setRejectingId(null);
            setRejectNote('');
          }
        }}
        title='Reject proposal'
        className='sm:max-w-md'
      >
        <div className='flex flex-col gap-3 px-5 py-4'>
          <p className='text-xs text-muted-foreground'>
            The author will get a DM with this note. Be specific so they can address it in a new
            proposal.
          </p>
          <Textarea
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            placeholder='Why are you rejecting this?'
            rows={4}
            data-track-category='automation-approvals'
            data-track-name='reject-note'
          />
          <div className='flex justify-end gap-2'>
            <Button
              variant='outline'
              onClick={() => {
                setRejectingId(null);
                setRejectNote('');
              }}
              data-track-category='automation-approvals'
              data-track-name='reject-cancel'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              disabled={rejectNote.trim().length === 0 || rejectMutation.isPending}
              loading={rejectMutation.isPending}
              onClick={() => {
                if (rejectingId) {
                  rejectMutation.mutate({
                    id: rejectingId,
                    note: rejectNote.trim(),
                  });
                }
              }}
              data-track-category='automation-approvals'
              data-track-name='reject-confirm'
            >
              Reject
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function PendingRow({
  proposal,
  currentUserId,
  isAdmin,
  approveLoading,
  onApprove,
  onReject,
  onOpen,
}: {
  proposal: Automation;
  currentUserId: string;
  isAdmin: boolean;
  approveLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
  onOpen: () => void;
}): React.ReactElement {
  // Author of a proposal is the row's createdById (set on creation).
  const author = useUser(proposal.createdById || '');
  const isSelfAuthored = proposal.createdById === currentUserId;
  const submittedAt = new Date(proposal.updatedAt);

  // Make the whole card clickable, but exclude the action area on the
  // right so clicking Approve / Reject doesn't also open the proposal.
  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-row-stop]')) return;
    onOpen();
  };
  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <li>
      <div
        role='button'
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        className={cn(
          'flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-background p-4 transition-colors',
          'hover:border-foreground/20 hover:bg-muted/40',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
          'sm:flex-row sm:items-start sm:justify-between',
        )}
        data-track-category='automation-approvals'
        data-track-name='open-proposal'
      >
        <div className='flex flex-1 items-start gap-3 min-w-0'>
          <Avatar userId={proposal.createdById || null} size='md' />
          <div className='flex flex-1 flex-col gap-1 min-w-0'>
            <div className='flex flex-wrap items-baseline gap-2'>
              <span className='truncate text-sm font-semibold text-foreground'>
                {proposal.name || 'Untitled automation'}
              </span>
              <span className='text-[11px] text-muted-foreground'>
                by {author?.name ?? 'unknown'} · {formatRelative(submittedAt)}
              </span>
            </div>
            {proposal.description ? (
              <p className='line-clamp-2 text-xs text-muted-foreground'>{proposal.description}</p>
            ) : null}
          </div>
        </div>
        {/* Approve / Reject only render for admins. Non-admins still see the
          row so they know what's in flight. The data-row-stop attr keeps
          clicks here from bubbling up and triggering the card's onOpen. */}
        {isAdmin ? (
          <div data-row-stop className='flex flex-shrink-0 items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={onReject}
              data-track-category='automation-approvals'
              data-track-name='reject-open'
            >
              <MultipleCrossCancelDefault className='size-4' />
              Reject
            </Button>
            <Button
              size='sm'
              disabled={isSelfAuthored || approveLoading}
              loading={approveLoading}
              title={isSelfAuthored ? 'Authors cannot approve their own proposals' : ''}
              onClick={onApprove}
              data-track-category='automation-approvals'
              data-track-name='approve'
            >
              <CheckTickSingle className='size-4' />
              Approve
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
