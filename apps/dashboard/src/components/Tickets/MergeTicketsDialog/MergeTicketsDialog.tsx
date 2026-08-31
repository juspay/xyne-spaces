import React, { useState, useMemo, useEffect } from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { UserDefault as User, MultipleCrossCancelDefault as X } from '@xyne/icons';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import Avatar from '../../ui/Avatar/Avatar';
import Tooltip, { TruncatedTooltip } from '../../ui/Tooltip';
import { useUser } from '../../../hooks/useUsers';
import { useUserGroupById } from '../../../hooks/useUserGroup';
import { useQuery } from '../../../hooks/useQuery';
import { queries } from '../../../zero/queries';
import { TicketStatusWithStages } from '../TicketStatus/TicketStatusIcon';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import { cn } from '../../../utils/classNames';
import { htmlToPlainText } from '../../../utils/sanitizer';
import type { TicketPriority } from '@xyne/shared';

interface MergeTicket {
  id: string;
  createdAt?: number | null | undefined;
  title?: string | null | undefined;
  xyneId?: string | null | undefined;
  stageName?: string | null | undefined;
  priority?: TicketPriority | string | null | undefined;
  assignedTo?: string | null | undefined;
  userGroupId?: string | null | undefined;
}

interface MergeTicketsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tickets: MergeTicket[];
  onMerge: (parentTicketId: string, ticketIds: string[]) => void | Promise<void>;
}

const formatTicketDate = (timestamp?: number | null): string =>
  new Date(timestamp ?? 0).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** Mirrors TicketCard's renderAssignee() — same markup/classes, display-only. */
const MergeTicketAssignee: React.FC<{
  assignedTo?: string | null | undefined;
  userGroupId?: string | null | undefined;
}> = ({ assignedTo, userGroupId }) => {
  // Same precedence as TicketCard: a user assignee wins; otherwise fall back to
  // a legacy `group:<id>` in assignedTo, then the dedicated userGroupId column.
  const assigneeUserId =
    assignedTo && !assignedTo.startsWith('group:') ? assignedTo.replace(/^user:/, '') : '';
  const assigneeGroupId = assigneeUserId
    ? ''
    : assignedTo?.startsWith('group:')
      ? assignedTo.slice('group:'.length)
      : userGroupId || '';
  const isGroup = !assigneeUserId && !!assigneeGroupId;
  const user = useUser(assigneeUserId);
  const group = useUserGroupById(assigneeGroupId);

  if (!isGroup && user) {
    return (
      <Tooltip content={user.name || user.email || 'Unknown user'}>
        <div className='relative'>
          <Avatar userId={user.id} showActiveStatus={false} className='size-6' />
        </div>
      </Tooltip>
    );
  }
  if (isGroup && group) {
    return (
      <Tooltip content={group.name}>
        <div className='w-6 h-6 rounded-lg bg-border flex items-center justify-center'>
          <span className='text-xs font-medium text-muted-foreground'>
            {group.name.charAt(0).toUpperCase()}
          </span>
        </div>
      </Tooltip>
    );
  }
  return (
    <Tooltip content='Unassigned'>
      <div className='w-6 h-6 rounded-lg border border-dashed border-muted-foreground bg-background flex items-center justify-center'>
        <User className='w-3 h-3 text-muted-foreground' strokeWidth={1.5} />
      </div>
    </Tooltip>
  );
};

export const MergeTicketsDialog: React.FC<MergeTicketsDialogProps> = ({
  open,
  onOpenChange,
  tickets,
  onMerge,
}) => {
  const [isMerging, setIsMerging] = useState(false);
  const [selectedParentTicketId, setSelectedParentTicketId] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());

  const sortedTickets = useMemo(
    () => [...tickets].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [tickets],
  );

  const ticketIds = useMemo(() => tickets.map(t => t.id), [tickets]);
  // useQuery, not useCachedQuery — the latter can replay a stale "complete" snapshot from its cross-mount cache.
  const [liveTickets, liveTicketsDetails] = useQuery(queries.ticketsByIds({ ticketIds }), {
    enabled: open && ticketIds.length > 0,
  });
  // Fail closed until the live archived check has actually resolved, not just "no data yet".
  const archivedStateLoaded = ticketIds.length === 0 || liveTicketsDetails.type === 'complete';
  const archivedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!archivedStateLoaded) return ids;
    for (const t of liveTickets ?? []) {
      if (t.isArchived) ids.add(t.id);
    }
    return ids;
  }, [liveTickets, archivedStateLoaded]);

  const excludedTickets = sortedTickets.filter(t => archivedIds.has(t.id));
  const visibleTickets = useMemo(
    () =>
      archivedStateLoaded
        ? sortedTickets.filter(t => !archivedIds.has(t.id) && !removedIds.has(t.id))
        : [],
    [sortedTickets, archivedIds, removedIds, archivedStateLoaded],
  );

  useEffect(() => {
    if (!open) {
      setSelectedParentTicketId(null);
      setRemovedIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open || !archivedStateLoaded) return;
    if (selectedParentTicketId && visibleTickets.some(t => t.id === selectedParentTicketId)) return;
    setSelectedParentTicketId(visibleTickets[0]?.id ?? null);
  }, [open, archivedStateLoaded, visibleTickets, selectedParentTicketId]);

  const handleRemoveTicket = (ticketId: string): void => {
    setRemovedIds(prev => new Set(prev).add(ticketId));
  };

  const handleMerge = async (): Promise<void> => {
    if (!selectedParentTicketId || !archivedStateLoaded) return;
    setIsMerging(true);
    try {
      await onMerge(
        selectedParentTicketId,
        visibleTickets.map(t => t.id),
      );
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Merge ${visibleTickets.length} Tickets`}
    >
      <div className='p-6 space-y-4'>
        <p className='text-sm text-muted-foreground'>
          Pick the ticket that stays open. The rest will be archived and linked as merged into it —
          you can split them back out later with{' '}
          <span className='font-medium text-foreground'>Unmerge</span>.
        </p>

        {sortedTickets.length === 0 ? (
          <p className='text-sm text-destructive'>Could not load ticket details.</p>
        ) : !archivedStateLoaded ? (
          <p className='text-sm text-muted-foreground'>Checking ticket status…</p>
        ) : visibleTickets.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            All selected tickets are already archived. Cancel and reselect to start over.
          </p>
        ) : visibleTickets.length < 2 ? (
          <p className='text-sm text-muted-foreground'>
            Only one ticket left to merge. Cancel and reselect at least two.
          </p>
        ) : (
          <>
            <div className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
              Parent ticket
            </div>
            <RadioGroupPrimitive.Root
              value={selectedParentTicketId}
              onValueChange={setSelectedParentTicketId}
              aria-label='Parent ticket'
              className='space-y-1.5 max-h-[360px] overflow-y-auto -mx-1 px-1 py-0.5'
            >
              {visibleTickets.map(ticket => {
                const isParent = ticket.id === selectedParentTicketId;
                const priority = ticket.priority as TicketPriority | undefined;
                const priorityIcon = priority ? getPriorityIcon(priority) : null;

                const plainTitle = ticket.title ? htmlToPlainText(ticket.title) : '';

                return (
                  <RadioGroupPrimitive.Item
                    key={ticket.id}
                    value={ticket.id}
                    className={cn(
                      'relative flex w-full flex-col gap-1.5 rounded-md border py-2.5 pl-4 pr-3 text-left',
                      'shadow-sm transition-all outline-none',
                      'focus-visible:ring-2 focus-visible:ring-ring/50',
                      isParent
                        ? 'border-primary/40 bg-primary/[0.04]'
                        : 'border-border bg-card hover:border-input hover:shadow',
                    )}
                    data-track-category='Support'
                    data-track-name='SelectMergeParent'
                  >
                    {isParent && (
                      <span className='absolute inset-y-1.5 left-1 w-[3px] rounded-full bg-primary' />
                    )}

                    <button
                      type='button'
                      onClick={e => {
                        e.stopPropagation();
                        handleRemoveTicket(ticket.id);
                      }}
                      className='absolute -left-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground hover:border-input'
                      aria-label={`Remove ${plainTitle || 'ticket'} from merge`}
                      data-track-category='Support'
                      data-track-name='RemoveTicketFromMerge'
                    >
                      <X className='size-2.5' strokeWidth={2.5} />
                    </button>

                    <div className='flex items-center gap-2 min-w-0'>
                      <span className='font-mono text-xs text-muted-foreground shrink-0'>
                        {ticket.xyneId || ticket.id.slice(0, 8)}
                      </span>
                      <TruncatedTooltip content={plainTitle || 'No subject'}>
                        <h3 className='flex-1 min-w-0 truncate text-[15px] font-semibold text-foreground'>
                          {plainTitle || 'No subject'}
                        </h3>
                      </TruncatedTooltip>
                      <span
                        className={cn(
                          'shrink-0 inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
                          isParent
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {isParent ? 'Parent' : 'Merges in'}
                      </span>
                    </div>

                    <div className='flex items-center gap-3 pl-0'>
                      {ticket.stageName !== undefined && (
                        <TicketStatusWithStages
                          currentStageName={ticket.stageName}
                          showLeadingDot={false}
                          labelClassName='max-w-[120px] truncate'
                        />
                      )}
                      {priorityIcon && (
                        <Tooltip content={`Priority: ${priority}`}>
                          <span className='flex items-center'>{priorityIcon}</span>
                        </Tooltip>
                      )}
                      <span className='text-xs text-muted-foreground tabular-nums'>
                        {formatTicketDate(ticket.createdAt)}
                      </span>
                      {(ticket.assignedTo !== undefined || ticket.userGroupId !== undefined) && (
                        <span className='ml-auto flex items-center'>
                          <MergeTicketAssignee
                            assignedTo={ticket.assignedTo}
                            userGroupId={ticket.userGroupId}
                          />
                        </span>
                      )}
                    </div>
                  </RadioGroupPrimitive.Item>
                );
              })}
            </RadioGroupPrimitive.Root>
          </>
        )}

        {excludedTickets.length > 0 && (
          <p className='text-xs text-muted-foreground'>
            Already archived, excluded from this merge:{' '}
            {excludedTickets.map(t => t.xyneId || t.id.slice(0, 8)).join(', ')}
          </p>
        )}

        <div className='flex justify-end gap-3 pt-2'>
          <Button
            variant='secondary'
            onClick={() => onOpenChange(false)}
            data-track-category='Support'
            data-track-name='CancelMergeTickets'
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleMerge()}
            disabled={
              isMerging ||
              !archivedStateLoaded ||
              !selectedParentTicketId ||
              visibleTickets.length < 2
            }
            data-track-category='Support'
            data-track-name='ConfirmMergeTickets'
          >
            {isMerging ? 'Merging...' : 'Merge'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
