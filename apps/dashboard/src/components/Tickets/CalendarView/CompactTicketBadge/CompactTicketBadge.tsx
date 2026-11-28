import { useDependencyHighlight } from '../../../../hooks/useDependencyHighlight';
import { TicketDependencyBadge } from '../../Dependencies/TicketDependencyBadge';
import { getTicketStatusColor } from './utils';
import type { CompactTicketBadgeProps } from './types';

export function CompactTicketBadge({ ticket, onClick }: CompactTicketBadgeProps) {
  const dependencyHighlighted = useDependencyHighlight(ticket.id);
  const statusColor = getTicketStatusColor(ticket.statusV2);
  return (
    <div
      data-dependency-highlighted={dependencyHighlighted || undefined}
      className={`${dependencyHighlighted ? 'outline outline-2 outline-primary -outline-offset-2' : ''} w-full rounded-lg border border-border bg-muted p-2 transition-all hover:bg-background hover:shadow-sm`}
    >
      <button
        type='button'
        onClick={onClick}
        className='group flex w-full items-center gap-2 text-left'
        title={`${ticket.xyneId}: ${ticket.title}`}
        data-track-category='CALENDAR'
        data-track-name='OpenTicketFromCalendar'
        data-track-metadata={JSON.stringify({ ticketId: ticket.id, xyneId: ticket.xyneId })}
      >
        <span
          className='h-8 w-1.5 shrink-0 rounded-full'
          style={{ backgroundColor: statusColor }}
        />
        <span className='min-w-0 flex-1'>
          <span className='mb-0.5 block font-mono text-[10px] font-medium text-muted-foreground'>
            {ticket.xyneId}
          </span>
          <span className='block truncate text-xs font-medium text-foreground'>{ticket.title}</span>
        </span>
      </button>
      <TicketDependencyBadge ticketId={ticket.id} compact />
    </div>
  );
}
