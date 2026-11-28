import { useDependencyHighlightSource } from '../../../hooks/useDependencyHighlight';
import { useState } from 'react';
import { useDependencyData } from '../../../hooks/useDependencyState';
import { HoverCard } from '../../ui/HoverCard/HoverCard';
import { DependencyBadge } from './DependencyBadge';
import { DependencyHoverCard } from './DependencyHoverCard';

export function TicketDependencyBadge({
  ticketId,
  compact = false,
}: {
  ticketId: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const view = useDependencyData([ticketId]).get(ticketId);
  const state = view?.batch.states[ticketId];
  const hasBadge = Boolean(state && (state.primary || state.blocking.length));
  useDependencyHighlightSource(ticketId, hasBadge ? view?.batch : undefined, open);
  if (!state || (!state.primary && !state.blocking.length)) return null;
  const edges = new Map(view.batch.edges.map(edge => [edge.id, edge]));
  return (
    <span
      role='presentation'
      data-track-category='TICKET_DEPENDENCIES'
      data-track-name='OpenDependencySummary'
      className='max-w-full'
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <HoverCard
        open={open}
        onOpenChange={setOpen}
        openDelay={200}
        align='start'
        className='w-72 max-w-[85vw] p-3'
        trigger={
          <button
            data-track-category='TICKET_DEPENDENCIES'
            data-track-name='DependencyAction'
            type='button'
            onClick={() => setOpen(true)}
            onFocus={() => setOpen(true)}
            className='max-w-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            aria-expanded={open}
            aria-label={`${state.primary ?? 'Dependencies'}${state.blockedBy.length ? `, waiting on ${state.blockedBy.length} tickets` : ''}${state.blocking.length ? `, blocking ${state.blocking.length} tickets` : ''}`}
          >
            <DependencyBadge
              compact={compact}
              state={{
                ...state,
                blockedBy: state.blockedBy.flatMap(id => edges.get(id) ?? []),
                blocking: state.blocking.flatMap(id => edges.get(id) ?? []),
              }}
            />
          </button>
        }
      >
        <DependencyHoverCard ticketId={ticketId} batch={view.batch} />
      </HoverCard>
    </span>
  );
}
