import React, { useState, useMemo, useEffect } from 'react';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import { RadioGroup, Radio } from '../../ui/RadioGroup';
import type { Ticket } from '@xyne/shared';

interface MergeTicketsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tickets: Ticket[];
  onMerge: (parentTicketId: string) => void | Promise<void>;
}

export const MergeTicketsDialog: React.FC<MergeTicketsDialogProps> = ({
  open,
  onOpenChange,
  tickets,
  onMerge,
}) => {
  const [isMerging, setIsMerging] = useState(false);
  const [selectedParentTicketId, setSelectedParentTicketId] = useState<string | null>(null);

  const sortedTickets = useMemo(
    () => [...tickets].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [tickets],
  );

  useEffect(() => {
    if (!open) {
      setSelectedParentTicketId(null);
    }
  }, [open]);

  useEffect(() => {
    if (open && selectedParentTicketId === null && sortedTickets.length > 0) {
      setSelectedParentTicketId(sortedTickets[0]?.id ?? null);
    }
  }, [open, sortedTickets, selectedParentTicketId]);

  const handleMerge = async (): Promise<void> => {
    if (!selectedParentTicketId) return;
    setIsMerging(true);
    try {
      await onMerge(selectedParentTicketId);
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Merge ${sortedTickets.length} Tickets`}>
      <div className='p-6 space-y-4'>
        <p className='text-sm text-muted-foreground'>
          Select the ticket that will be the parent. All other selected tickets will be archived and
          linked as merged into it.
        </p>

        {sortedTickets.length === 0 ? (
          <p className='text-sm text-destructive'>Could not load ticket details.</p>
        ) : (
          <div className='space-y-2'>
            <div className='text-sm font-medium'>Parent ticket</div>
            <RadioGroup
              value={selectedParentTicketId ?? ''}
              onChange={value => setSelectedParentTicketId(value)}
              aria-label='Parent ticket'
            >
              {sortedTickets.map(ticket => (
                <Radio key={ticket.id} value={ticket.id} subtext={ticket.title || 'No subject'}>
                  <span className='font-mono text-xs text-muted-foreground'>
                    {ticket.xyneId || ticket.id.slice(0, 8)}
                  </span>
                  <span className='text-muted-foreground ml-2'>
                    {new Date(ticket.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </Radio>
              ))}
            </RadioGroup>
          </div>
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
            disabled={isMerging || !selectedParentTicketId || sortedTickets.length === 0}
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
