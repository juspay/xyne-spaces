import { logger, Event as LogEvent } from '../../../utils/logger';
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import { TicketSuggestion, TicketCreatedInfo } from '../../../utils/markdownTicketSuggestions.ts';
import { useChannel } from '../../../hooks/useChannels';
import { conversationService } from '../../../services/Chat/conversationService';
import { toast } from 'sonner';

interface TicketSuggestionsProps {
  suggestions: TicketSuggestion[];
  ticketsCreated: TicketCreatedInfo[];
  channelId: string;
  messageId: string;
  conversationId: string;
}

const previewDescription = (text: string, limit = 100) =>
  text.length > limit ? `${text.slice(0, limit)}...` : text;

export const TicketSuggestions: React.FC<TicketSuggestionsProps> = ({
  suggestions,
  ticketsCreated,
  channelId,
  messageId,
  conversationId,
}) => {
  // Queue-based state management (single source of truth)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creationQueue, setCreationQueue] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [initialQueueLength, setInitialQueueLength] = useState(0);

  const currentChannel = useChannel(channelId || '');
  const navigate = useNavigate();

  // Memoized lookup for O(1) access
  const suggestionMap = useMemo(
    () => new Map(suggestions.map(s => [s.suggestionId, s])),
    [suggestions],
  );

  // Store snapshot of suggestions at creation time to survive WebSocket updates
  const queuedSuggestionsRef = React.useRef<Map<string, TicketSuggestion>>(new Map());

  // Derived state - modal visibility is determined purely by queue state
  const activeId = creationQueue[0] ?? null;
  const activeSuggestion = activeId ? queuedSuggestionsRef.current.get(activeId) : null;
  const shouldShowModal = creationQueue.length > 0 && activeSuggestion !== null;

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const startCreation = () => {
    if (selectedIds.length > 0) {
      // Snapshot the suggestions at creation time
      queuedSuggestionsRef.current.clear();
      selectedIds.forEach(id => {
        const suggestion = suggestionMap.get(id);
        if (suggestion) {
          queuedSuggestionsRef.current.set(id, suggestion);
        }
      });

      setInitialQueueLength(selectedIds.length);
      setCreationQueue(selectedIds);
    }
  };

  const handleTicketCreated = async (
    suggestionId: string,
    ticket: { id: string; conversationId?: string; xyneId?: string },
  ) => {
    setIsUpdating(true);

    try {
      const suggestion = queuedSuggestionsRef.current.get(suggestionId);
      if (!suggestion) {
        throw new Error(`Suggestion ${suggestionId} not found in queue`);
      }

      await conversationService.markTicketSuggestionAsCreated(conversationId, messageId, {
        suggestionId,
        ticketId: ticket.id,
        xyneId: ticket.xyneId ?? `TICKET-${ticket.id.slice(0, 8)}`,
        title: suggestion.title,
        ticketConversationId: ticket.conversationId ?? '',
      });

      toast.success(`Ticket created: ${ticket.xyneId ?? `TICKET-${ticket.id.slice(0, 8)}`}`);

      setSelectedIds(ids => ids.filter(id => id !== suggestionId));
      setIsUpdating(false);
      setCreationQueue(queue => queue.slice(1));
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Error creating ticket:'),
        error: error,
      });
      toast.error('Ticket created but failed to save status');
      setCreationQueue([]);
      setIsUpdating(false);
    }
  };

  const handleNavigateToTicket = (created: TicketCreatedInfo) => {
    void navigate(
      `/chat/dir/${channelId}/${created.conversationId}/${created.ticketId}?selectedTab=details`,
    );
  };

  return (
    <div className='mt-3 pl-2 -ml-8'>
      {/* Render created tickets (read-only links) */}
      {ticketsCreated.map(created => (
        <div key={created.ticketId} className='flex items-start gap-2 py-2'>
          <div className='flex-1 min-w-0'>
            <button
              onClick={() => handleNavigateToTicket(created)}
              data-track-category='MESSAGE'
              data-track-name='OPEN_SUGGESTED_TICKET'
              className='text-sm text-left hover:underline focus:outline-none bg-transparent border-none p-0'
            >
              <span className='font-semibold text-primary'>{created.xyneId}</span>
              <span className='mx-1.5 text-muted-foreground'>•</span>
              <span className='font-normal text-foreground'>{created.title}</span>
            </button>
          </div>
        </div>
      ))}

      {/* Ticket rows (uncreated suggestions) */}
      {suggestions.map(suggestion => {
        const isSelected = selectedIds.includes(suggestion.suggestionId);
        const checkboxId = `ticket-suggestion-${suggestion.suggestionId}`;

        return (
          <div key={suggestion.suggestionId} className='flex items-start gap-2 py-2'>
            <input
              id={checkboxId}
              type='checkbox'
              checked={isSelected}
              className='mt-1 h-4 w-4 shrink-0 rounded border-border cursor-pointer'
              disabled={isUpdating}
              onChange={() => toggleSelection(suggestion.suggestionId)}
              data-track-category='MESSAGE'
              data-track-name='TOGGLE_TICKET_SUGGESTION'
            />
            <label htmlFor={checkboxId} className='text-sm text-left flex-1 cursor-pointer'>
              <span className='font-medium text-foreground'>{suggestion.title}</span>
              <span className='text-muted-foreground'>: </span>
              <span className='text-muted-foreground'>
                {previewDescription(suggestion.description)}
              </span>
            </label>
          </div>
        );
      })}

      {/* Create button */}
      {selectedIds.length > 0 && (
        <div className='pt-1'>
          <button
            onClick={startCreation}
            data-track-category='MESSAGE'
            data-track-name='START_TICKET_FROM_SUGGESTION'
            disabled={isUpdating}
            className='text-sm font-medium text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none p-0'
          >
            {isUpdating ? 'Creating...' : `Create Tickets (${selectedIds.length})`}
          </button>
        </div>
      )}

      {/* Create Ticket Modal - driven by derived state */}
      {shouldShowModal && currentChannel && (
        <CreateTicketModal
          key={activeId}
          isOpen={true}
          onClose={() => {
            if (!isUpdating) {
              setCreationQueue([]);
              queuedSuggestionsRef.current.clear();
            }
          }}
          channelId={channelId}
          projectId={currentChannel.projectId ?? ''}
          initialTitle={activeSuggestion!.title}
          initialDescription={activeSuggestion!.description}
          initialAssignee={
            activeSuggestion!.suggestedAssignee !== 'unassigned'
              ? {
                  type: 'assigneeTo',
                  value: activeSuggestion!.suggestedAssignee,
                }
              : null
          }
          isFromAI={true}
          ticketSequence={{
            current: initialQueueLength - creationQueue.length + 1,
            total: initialQueueLength,
          }}
          onTicketCreated={ticket => {
            void handleTicketCreated(activeSuggestion!.suggestionId, ticket);
          }}
        />
      )}
    </div>
  );
};
