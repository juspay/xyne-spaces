import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '../../../hooks/useQuery';
import { queries } from '../../../zero/queries';
import type {
  LegacyCreatedTicket,
  LegacyTicketSuggestion,
} from '../../../utils/markdownTicketUpdates';

interface LegacySuggestedTicketsProps {
  suggestions: LegacyTicketSuggestion[];
  created: LegacyCreatedTicket[];
  /** Channel of the message; used when a created ticket can no longer be resolved. */
  channelId: string;
}

const preview = (value: string, limit = 100): string =>
  value.length > limit ? `${value.slice(0, limit)}...` : value;

/**
 * Read-only view of a retired "Suggested Tickets" card. The feature that created
 * tickets from these suggestions is gone, so the suggestions are listed as plain
 * text and only the tickets that were actually created stay as links.
 */
export const LegacySuggestedTickets: React.FC<LegacySuggestedTicketsProps> = ({
  suggestions,
  created,
  channelId,
}) => {
  const navigate = useNavigate();
  const createdIds = useMemo(() => created.map(c => c.ticketId), [created]);
  // The old card never recorded the ticket's channel; take it from the ticket itself.
  const [tickets] = useQuery(queries.ticketsByIds({ ticketIds: createdIds }), {
    enabled: createdIds.length > 0,
  });
  const channelByTicketId = useMemo(
    () => new Map((tickets ?? []).map(t => [t.id, t.channelId])),
    [tickets],
  );

  if (suggestions.length === 0 && created.length === 0) return null;

  const openTicket = (ticket: LegacyCreatedTicket): void => {
    const ticketChannelId = channelByTicketId.get(ticket.ticketId) ?? channelId;
    void navigate(
      `/chat/dir/${ticketChannelId}/${ticket.conversationId}/${ticket.ticketId}?selectedTab=details`,
      { state: { trackSource: 'chat_message' } },
    );
  };

  return (
    <div className='mt-3 pl-2 -ml-8 space-y-2 text-sm'>
      {created.map(ticket => (
        <div key={ticket.ticketId}>
          <button
            onClick={() => openTicket(ticket)}
            data-track-category='MESSAGE'
            data-track-name='OPEN_SUGGESTED_TICKET'
            className='text-left hover:underline focus:outline-none bg-transparent border-none p-0'
          >
            <span className='font-semibold text-primary'>{ticket.xyneId}</span>
            <span className='mx-1.5 text-muted-foreground'>•</span>
            <span className='text-foreground'>{ticket.title}</span>
          </button>
        </div>
      ))}
      {suggestions.length > 0 && (
        <>
          <ul className='space-y-1'>
            {suggestions.map((suggestion, index) => (
              <li key={`${index}-${suggestion.title}`}>
                <span className='font-medium text-foreground'>{suggestion.title}</span>
                {suggestion.description ? (
                  <span className='text-muted-foreground'>: {preview(suggestion.description)}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className='text-xs text-muted-foreground'>
            These suggestions are from an earlier version and can no longer be turned into tickets
            here.
          </div>
        </>
      )}
    </div>
  );
};
