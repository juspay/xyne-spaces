import { Plus } from 'lucide-react';
import type { TicketFieldSearchResult } from '../../../hooks/useTicketFieldSearch';
import UserAvatar, { AvatarShape, AvatarSize } from '../../UserAvatar/UserAvatar';
import { cn } from '../../../utils/classNames';
import { splitTitleByQuery } from './ticketLinkUtils';

export type TicketLinkHighlight = number | 'create' | null;

interface TicketLinkPickerProps {
  query: string;
  results: TicketFieldSearchResult[];
  isLoading: boolean;
  hasMore: boolean;
  totalCount: number;
  boardsSearched: number;
  highlight: TicketLinkHighlight;
  onHighlight: (highlight: TicketLinkHighlight) => void;
  onSelect: (ticket: TicketFieldSearchResult) => void;
  onScrollEnd: () => void;
  onCreateTicket: () => void;
  canCreateTicket: boolean;
}

const HighlightedTitle: React.FC<{ title: string; query: string }> = ({ title, query }) => (
  <>
    {splitTitleByQuery(title, query).map((part, index) =>
      part.match ? (
        <mark key={index} className='rounded-sm bg-rose-100 font-medium text-rose-700'>
          {part.text}
        </mark>
      ) : (
        <span key={index}>{part.text}</span>
      ),
    )}
  </>
);

export const TicketLinkPicker: React.FC<TicketLinkPickerProps> = ({
  query,
  results,
  isLoading,
  hasMore,
  totalCount,
  boardsSearched,
  highlight,
  onHighlight,
  onSelect,
  onScrollEnd,
  onCreateTicket,
  canCreateTicket,
}) => {
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  const handleScroll = (event: React.UIEvent<HTMLUListElement>): void => {
    const target = event.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 40) {
      onScrollEnd();
    }
  };

  return (
    <div className='absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-border bg-background shadow-lg'>
      {canCreateTicket ? (
        <button
          type='button'
          onMouseEnter={() => onHighlight('create')}
          onClick={onCreateTicket}
          className={cn(
            'flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-sm text-foreground transition-colors',
            highlight === 'create' && 'bg-accent',
          )}
          data-track-category='Tickets'
          data-track-name='TicketLinkCreateOption'
        >
          <Plus className='size-4 shrink-0 text-muted-foreground' />
          <span className='min-w-0 truncate'>Create ticket on a board…</span>
          {hasQuery ? (
            <span className='ml-auto max-w-[45%] shrink-0 truncate text-muted-foreground'>
              “{trimmedQuery}”
            </span>
          ) : null}
        </button>
      ) : null}

      {!hasQuery ? (
        <p className='px-3 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground'>
          Recent
        </p>
      ) : null}

      <ul className='max-h-60 overflow-y-auto py-1' onScroll={handleScroll} role='listbox'>
        {results.length === 0 && !isLoading ? (
          <li className='px-3 py-4 text-center text-sm text-muted-foreground'>
            {hasQuery ? 'No tickets found' : 'Start typing to search tickets'}
          </li>
        ) : (
          results.map((ticket, index) => {
            const selected = highlight === index;
            return (
              <li key={ticket.id} role='option' aria-selected={selected}>
                <button
                  type='button'
                  onMouseEnter={() => onHighlight(index)}
                  onClick={() => onSelect(ticket)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left',
                    selected && 'bg-accent',
                  )}
                  data-track-category='Tickets'
                  data-track-name='TicketLinkSelectOption'
                  data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                >
                  <span className='w-[96px] shrink-0 truncate font-mono text-[13px] text-muted-foreground'>
                    {ticket.xyneId || ticket.id}
                  </span>
                  <span className='min-w-0 flex-1 truncate text-sm text-foreground'>
                    <HighlightedTitle
                      title={ticket.title || ticket.xyneId || ticket.id}
                      query={hasQuery ? trimmedQuery : ''}
                    />
                  </span>
                  {ticket.assignedTo ? (
                    <UserAvatar
                      userId={ticket.assignedTo}
                      size={AvatarSize.SM}
                      shape={AvatarShape.CIRCULAR}
                    />
                  ) : null}
                </button>
              </li>
            );
          })
        )}
        {isLoading ? <li className='px-3 py-2 text-sm text-muted-foreground'>Searching…</li> : null}
        {hasMore && !isLoading ? (
          <li className='px-3 py-2 text-center text-xs text-muted-foreground'>Scroll for more</li>
        ) : null}
      </ul>

      <div className='border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground'>
        {hasQuery ? (
          <span>
            {totalCount} {totalCount === 1 ? 'ticket' : 'tickets'}
            {boardsSearched > 0
              ? ` · ${boardsSearched} ${boardsSearched === 1 ? 'board' : 'boards'} searched`
              : ''}
          </span>
        ) : (
          <span>↑↓ to move ↵ to link esc to close</span>
        )}
      </div>
    </div>
  );
};
