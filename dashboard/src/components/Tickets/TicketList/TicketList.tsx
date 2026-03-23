import React, { useState, useMemo } from 'react';
import { Search, Calendar } from 'lucide-react';
import Input from '../../ui/Input';
import Avatar from '../../ui/Avatar/Avatar';
import type { Ticket } from '../../../hooks/useTickets';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import {
  getPriorityIcon,
  formatStatusLabel,
  formatEta,
  isEtaUrgent,
  STATUS_CONFIG,
  PRIORITY_LABELS,
} from '../TicketCard/TicketCard.utils';
import { useUser } from '../../../hooks/useUsers';
import { cn } from '../../../utils/classNames';
import { usePlatform } from '../../../hooks/usePlatform';

export interface TicketListProps {
  tickets: Ticket[];
  onSelect: (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => void;
  loading?: boolean;
  currentUserId?: string;
  selectedTicketId?: string | null;
  activeFilter?: 'all' | 'my_tickets';
  onFilterChange?: (filter: 'all' | 'my_tickets') => void;
}

// Assignee cell component
const AssigneeCell: React.FC<{ userId?: string | null }> = ({ userId }) => {
  const user = useUser(userId ?? '');

  if (!userId) {
    return (
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        <div className='w-6 h-6 rounded-full bg-muted flex items-center justify-center'>
          <span className='text-xs'>?</span>
        </div>
        <span>Unassigned</span>
      </div>
    );
  }

  return (
    <div className='flex items-center gap-2 text-sm'>
      <Avatar userId={userId} size='sm' />
      <span className='text-foreground truncate'>{user?.name || user?.email || 'Unknown'}</span>
    </div>
  );
};

export const TicketList: React.FC<TicketListProps> = ({
  tickets,
  onSelect,
  loading = false,
  currentUserId,
  selectedTicketId = null,
  activeFilter: externalActiveFilter,
  onFilterChange,
}) => {
  const { isMobile } = usePlatform();
  const [searchQuery, setSearchQuery] = useState('');
  const [internalActiveFilter, setInternalActiveFilter] = useState<'all' | 'my_tickets'>('all');

  // Use external filter if provided, otherwise use internal state
  const activeFilter = externalActiveFilter ?? internalActiveFilter;

  const setActiveFilter = (filter: 'all' | 'my_tickets'): void => {
    if (onFilterChange) {
      onFilterChange(filter);
    } else {
      setInternalActiveFilter(filter);
    }
  };

  const filteredTickets = useMemo(() => {
    let filtered = tickets;

    // Apply "My Tickets" filter - show tickets assigned to current user
    if (activeFilter === 'my_tickets' && currentUserId) {
      filtered = filtered.filter(ticket =>
        ticket.assignments?.some(assignment => assignment.userId === currentUserId),
      );
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        ticket =>
          ticket.title.toLowerCase().includes(query) ||
          ticket.xyneId?.toLowerCase().includes(query) ||
          ticket.id.toLowerCase().includes(query),
      );
    }

    return filtered;
  }, [tickets, activeFilter, currentUserId, searchQuery]);

  if (loading) {
    return (
      <div className='flex items-center justify-center h-64'>
        <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600'></div>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full bg-background' data-testid='ticket-list'>
      {/* Search Bar with Filter Tabs */}
      <div className='px-4 md:px-6 py-4 border-b border-border flex-shrink-0'>
        <div className='flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0'>
          <div className='flex items-center gap-2'>
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all ${
                activeFilter === 'all'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
              data-testid='ticket-filter-all'
              data-track-category='TICKET'
              data-track-name='FILTER_ALL'
            >
              All Tickets
            </button>
            <button
              onClick={() => setActiveFilter('my_tickets')}
              className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all ${
                activeFilter === 'my_tickets'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
              data-testid='ticket-filter-my-tickets'
              data-track-category='TICKET'
              data-track-name='FILTER_MY_TICKETS'
            >
              My Tickets
            </button>
          </div>
          <div className='relative w-full sm:w-64'>
            <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground' />
            <Input
              type='text'
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              placeholder='Search Ticket'
              className='pl-9 w-full'
            />
          </div>
        </div>
      </div>

      <div className='flex-1 overflow-auto'>
        {filteredTickets.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-center py-16'>
            <h3 className='text-lg font-medium text-foreground mb-2'>
              {searchQuery ? 'No tickets found' : 'No tickets yet'}
            </h3>
            <p className='text-muted-foreground text-sm'>
              {searchQuery
                ? 'Try adjusting your search'
                : 'Create your first ticket to get started'}
            </p>
          </div>
        ) : isMobile ? (
          // Mobile: Card layout
          <div className='divide-y divide-border'>
            {filteredTickets.map(ticket => {
              const isSelected = selectedTicketId === ticket.id;
              const status = ticket.statusV2 || TicketStatusV2.TODO;
              const priority = ticket.priority || TicketPriority.LOW;
              const etaFormatted = formatEta(ticket.eta);
              const isUrgent = isEtaUrgent(ticket.eta, ticket.statusV2);
              const statusInfo = STATUS_CONFIG[status] || STATUS_CONFIG[TicketStatusV2.TODO];

              return (
                <div
                  key={ticket.id}
                  onClick={e => onSelect(e, ticket)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(e as unknown as KeyboardEvent, ticket);
                    }
                  }}
                  role='button'
                  tabIndex={0}
                  style={{
                    borderLeft: isSelected ? '4px solid rgb(59 130 246)' : '4px solid transparent',
                  }}
                  className={cn(
                    'flex flex-col px-4 py-3 gap-2 hover:bg-accent transition-colors cursor-pointer',
                    isSelected && 'bg-blue-50',
                  )}
                  data-track-category='Tickets'
                  data-track-name='SelectTicket'
                  data-track-metadata={JSON.stringify({
                    ticketId: ticket.id,
                    xyneId: ticket.xyneId,
                  })}
                >
                  {/* Ticket Name */}
                  <div className='flex flex-col gap-0.5 min-w-0'>
                    <div className='flex items-center gap-2'>
                      <span className='text-xs font-mono text-muted-foreground font-medium flex-shrink-0'>
                        {ticket.xyneId || ticket.id}
                      </span>
                      <span className='text-sm font-medium text-foreground truncate'>
                        {ticket.title}
                      </span>
                    </div>
                  </div>

                  {/* Compact info row */}
                  <div className='flex items-center gap-3 text-xs flex-wrap'>
                    {/* Status */}
                    <span className={cn('flex items-center gap-1', statusInfo.color)}>
                      <span className='text-sm'>{statusInfo.icon}</span>
                      <span>{formatStatusLabel(status)}</span>
                    </span>

                    {/* Priority */}
                    <span className='flex items-center gap-1'>
                      <span className='flex-shrink-0 scale-75'>{getPriorityIcon(priority)}</span>
                      <span>{PRIORITY_LABELS[priority]}</span>
                    </span>

                    {/* Due Date */}
                    {ticket.eta && (
                      <span
                        className={cn(
                          'flex items-center gap-1',
                          isUrgent ? 'text-red-600 font-medium' : 'text-muted-foreground',
                        )}
                      >
                        <Calendar className='w-3 h-3' />
                        <span>{etaFormatted}</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // Desktop: Semantic HTML table
          <table className='w-full border-collapse'>
            <thead className='sticky top-0 bg-muted/30 z-10'>
              <tr className='border-b border-border'>
                <th className='px-4 py-3 text-xs font-medium text-muted-foreground text-center w-12'>
                  #
                </th>
                <th className='px-4 py-3 text-xs font-medium text-muted-foreground text-left'>
                  Ticket name
                </th>
                <th className='px-4 py-3 text-xs font-medium text-muted-foreground text-left'>
                  Assignee
                </th>
                <th className='px-4 py-3 text-xs font-medium text-muted-foreground text-left'>
                  Due date
                </th>
                <th className='px-4 py-3 text-xs font-medium text-muted-foreground text-left'>
                  Status Category
                </th>
                <th className='px-4 py-3 text-xs font-medium text-muted-foreground text-left'>
                  Priority
                </th>
                <th className='px-4 py-3 text-xs font-medium text-muted-foreground text-left'>
                  Tags
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map((ticket, index) => {
                const isSelected = selectedTicketId === ticket.id;
                const assignment = ticket.assignments?.[0];
                const assigneeId = assignment?.userId;
                const status = ticket.statusV2 || TicketStatusV2.TODO;
                const priority = ticket.priority || TicketPriority.LOW;
                const etaFormatted = formatEta(ticket.eta);
                const isUrgent = isEtaUrgent(ticket.eta, ticket.statusV2);
                const statusInfo = STATUS_CONFIG[status] || STATUS_CONFIG[TicketStatusV2.TODO];

                return (
                  <tr
                    key={ticket.id}
                    onClick={e => onSelect(e, ticket)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(e as unknown as KeyboardEvent, ticket);
                      }
                    }}
                    tabIndex={0}
                    style={{
                      borderLeft: isSelected
                        ? '4px solid rgb(59 130 246)'
                        : '4px solid transparent',
                    }}
                    className={cn(
                      'border-b border-border hover:bg-accent transition-colors cursor-pointer',
                      isSelected && 'bg-blue-50',
                    )}
                    data-track-category='Tickets'
                    data-track-name='SelectTicket'
                    data-track-metadata={JSON.stringify({
                      ticketId: ticket.id,
                      xyneId: ticket.xyneId,
                    })}
                  >
                    {/* Index */}
                    <td className='px-4 py-3 text-sm text-muted-foreground text-center'>
                      {index + 1}
                    </td>

                    {/* Ticket Name */}
                    <td className='px-4 py-3'>
                      <div className='flex items-center gap-2 min-w-0'>
                        <span className='text-xs font-mono text-muted-foreground font-medium flex-shrink-0'>
                          {ticket.xyneId || ticket.id}
                        </span>
                        <span className='text-sm font-medium text-foreground truncate'>
                          {ticket.title}
                        </span>
                      </div>
                    </td>

                    {/* Assignee */}
                    <td className='px-4 py-3'>
                      <AssigneeCell userId={assigneeId ?? null} />
                    </td>

                    {/* Due Date */}
                    <td className='px-4 py-3'>
                      {ticket.eta ? (
                        <div className='flex items-center gap-1.5 text-sm'>
                          <Calendar
                            className={cn(
                              'w-3.5 h-3.5',
                              isUrgent ? 'text-red-500' : 'text-muted-foreground',
                            )}
                          />
                          <span
                            className={cn(
                              isUrgent ? 'text-red-600 font-medium' : 'text-foreground',
                            )}
                          >
                            {etaFormatted}
                          </span>
                        </div>
                      ) : (
                        <span className='text-muted-foreground text-xs'>No due date</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className='px-4 py-3'>
                      <span className={cn('text-sm flex items-center gap-1.5', statusInfo.color)}>
                        <span className='text-base'>{statusInfo.icon}</span>
                        <span>{formatStatusLabel(status)}</span>
                      </span>
                    </td>

                    {/* Priority */}
                    <td className='px-4 py-3'>
                      <div className='flex items-center gap-2'>
                        <span className='flex-shrink-0'>{getPriorityIcon(priority)}</span>
                        <span className='text-sm text-foreground'>{PRIORITY_LABELS[priority]}</span>
                      </div>
                    </td>

                    {/* Tags */}
                    <td className='px-4 py-3 text-sm text-muted-foreground'>—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
