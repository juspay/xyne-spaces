import React from 'react';
import { cn } from '../../../utils/classNames';
import { Skeleton } from '../../ui/Skeleton';
import { TicketListRow } from './TicketListRow';
import type { TicketListItem, TicketListViewProps } from './TicketListView.types';

export function TicketListView<T extends TicketListItem>({
  tickets,
  onTicketClick,
  renderRow,
  showExtraFields = false,
  activeTicketId,
  isLoading = false,
  skeletonRowCount = 8,
  emptyState,
  className,
}: TicketListViewProps<T>): React.ReactElement {
  if (isLoading) {
    return (
      <div data-slot='ticket-list-view' className={cn('flex flex-col', className)}>
        {Array.from({ length: skeletonRowCount }).map((_, i) => (
          <div key={i} className='flex items-center gap-3 px-6 py-3 border-b border-border'>
            <Skeleton className='h-3.5 w-3.5 rounded-full flex-shrink-0' />
            <Skeleton className='h-3 w-24 flex-shrink-0' />
            <Skeleton className='h-3.5 w-full max-w-[300px]' />
            <div className='flex-1' />
            <Skeleton className='h-3 w-12 flex-shrink-0' />
          </div>
        ))}
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div
        data-slot='ticket-list-view'
        className={cn(
          'flex items-center justify-center py-12 text-muted-foreground text-sm',
          className,
        )}
      >
        {emptyState ?? 'No tickets found'}
      </div>
    );
  }

  return (
    <div data-slot='ticket-list-view' className={cn('flex flex-col', className)}>
      {tickets.map((ticket, index) => {
        const ticketIdValue = ticket.xyneId || ticket.id;
        const isActive = activeTicketId === ticketIdValue;

        if (renderRow) {
          return (
            <React.Fragment key={ticket.id}>{renderRow(ticket, isActive, index)}</React.Fragment>
          );
        }

        return (
          <TicketListRow
            key={ticket.id}
            ticket={ticket}
            isActive={isActive}
            showExtraFields={showExtraFields}
            onClick={() => onTicketClick(ticket)}
          />
        );
      })}
    </div>
  );
}
