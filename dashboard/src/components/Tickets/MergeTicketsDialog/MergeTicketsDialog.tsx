import React, { useState, useMemo, useEffect } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import { RadioGroup, Radio } from '../../ui/RadioGroup';
import { useQuery } from '../../../hooks/useQuery';
import { queries } from '../../../zero/queries';
import { htmlToPlainText } from '../../../utils/sanitizer';
interface MergeTicket {
  id: string;
  createdAt?: number | null;
  title?: string | null;
  xyneId?: string | null;
}

interface MergeTicketsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tickets: MergeTicket[];
  onMerge: (parentTicketId: string, ticketIds: string[]) => void | Promise<void>;
}

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
          Select the ticket that will be the parent. All other selected tickets will be archived and
          linked as merged into it.
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
          <div className='space-y-2'>
            <div className='text-sm font-medium'>Parent ticket</div>
            <RadioGroup
              value={selectedParentTicketId ?? ''}
              onChange={value => setSelectedParentTicketId(value)}
              aria-label='Parent ticket'
            >
              {visibleTickets.map(ticket => {
                const plainTitle = ticket.title ? htmlToPlainText(ticket.title) : '';
                return (
                  <div key={ticket.id} className='flex items-center gap-2'>
                    <Radio
                      value={ticket.id}
                      subtext={plainTitle || 'No subject'}
                      className='flex-1'
                    >
                      <span className='font-mono text-xs text-muted-foreground'>
                        {ticket.xyneId || ticket.id.slice(0, 8)}
                      </span>
                      <span className='text-muted-foreground ml-2'>
                        {new Date(ticket.createdAt ?? 0).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </Radio>
                    <button
                      type='button'
                      onClick={() => handleRemoveTicket(ticket.id)}
                      className='flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs hover:text-foreground hover:border-input'
                      aria-label={`Remove ${plainTitle || 'ticket'} from merge`}
                      data-track-category='Support'
                      data-track-name='RemoveTicketFromMerge'
                    >
                      <X className='size-3' strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })}
            </RadioGroup>
          </div>
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
