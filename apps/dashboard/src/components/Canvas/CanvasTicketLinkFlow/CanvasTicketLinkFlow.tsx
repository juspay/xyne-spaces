import { TicketToken } from '@xyne/icons';
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { queries } from '../../../zero/queries';
import { Dialog } from '../../ui/Dialog';
import type { CanvasTicketAnchor } from '../useCanvasTicketEditorBridge';

interface CanvasTicketLinkFlowProps {
  anchor: CanvasTicketAnchor | null;
  onClose: () => void;
  onTicketSelected: (ticket: { id: string }) => void;
}

const TICKET_SEARCH_LIMIT = 20;

export function CanvasTicketLinkFlow({
  anchor,
  onClose,
  onTicketSelected,
}: CanvasTicketLinkFlowProps): ReactElement | null {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  useEffect(() => {
    if (!anchor) setSearch('');
  }, [anchor]);

  const [tickets] = useCachedQuery(
    queries.ticketsSearch({
      search: debouncedSearch.trim() || undefined,
      limit: TICKET_SEARCH_LIMIT,
    }),
    { enabled: !!anchor },
  );

  const rows = useMemo(() => tickets ?? [], [tickets]);
  if (!anchor) return null;

  return (
    <Dialog
      open={true}
      onOpenChange={open => !open && onClose()}
      title='Link existing ticket'
      description='Choose a ticket to link to the selected canvas text.'
      className='w-[min(92vw,480px)] overflow-hidden border border-border'
      mobileVariant='dialog'
    >
      <div className='flex items-center justify-between border-b border-border px-4 py-3'>
        <h2 className='text-sm font-semibold'>Link existing ticket</h2>
        <button
          type='button'
          onClick={onClose}
          className='rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground'
          aria-label='Close'
          data-track-category='CANVAS'
          data-track-name='Selection_Link_Ticket_Close'
        >
          <X className='size-4' aria-hidden='true' />
        </button>
      </div>
      <div className='p-3'>
        <div className='flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5'>
          <Search className='size-4 shrink-0 text-muted-foreground' aria-hidden='true' />
          <input
            autoFocus
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder='Search by ticket ID or title'
            className='min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
            data-track-category='CANVAS'
            data-track-name='Selection_Link_Ticket_Search'
          />
        </div>
        <div className='mt-2 max-h-72 overflow-y-auto'>
          {!tickets ? (
            <p className='px-2 py-6 text-center text-sm text-muted-foreground'>
              Loading tickets...
            </p>
          ) : rows.length === 0 ? (
            <p className='px-2 py-6 text-center text-sm text-muted-foreground'>No tickets found</p>
          ) : (
            rows.map(ticket => (
              <button
                key={ticket.id}
                type='button'
                onClick={() => onTicketSelected({ id: ticket.id })}
                className='flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent'
                data-track-category='CANVAS'
                data-track-name='Selection_Link_Ticket_Select'
              >
                <TicketToken
                  className='mt-0.5 size-4 shrink-0 text-muted-foreground'
                  aria-hidden='true'
                />
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>
                    {ticket.xyneId || ticket.title || 'Untitled ticket'}
                  </span>
                  {ticket.xyneId && ticket.title && (
                    <span className='block truncate text-xs text-muted-foreground'>
                      {ticket.title}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
