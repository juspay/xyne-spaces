import { logger, Event as LogEvent } from '../../../utils/logger';
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BulkTicketMode } from '@xyne/shared';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import { BulkCreateTicketsModal } from '../../Tickets/BulkCreateTicketsModal/BulkCreateTicketsModal';
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
  existingParentTicket?: {
    id: string;
    xyneId?: string;
    conversationId: string;
  } | null;
}

const previewDescription = (text: string, limit = 100) =>
  text.length > limit ? `${text.slice(0, limit)}...` : text;

export const TicketSuggestions: React.FC<TicketSuggestionsProps> = ({
  suggestions,
  ticketsCreated,
  channelId,
  messageId,
  conversationId,
  existingParentTicket,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creationQueue, setCreationQueue] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [initialQueueLength, setInitialQueueLength] = useState(0);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);

  const currentChannel = useChannel(channelId || '');
  const navigate = useNavigate();

  const suggestionMap = useMemo(
    () => new Map(suggestions.map(s => [s.suggestionId, s])),
    [suggestions],
  );

  const queuedSuggestionsRef = React.useRef<Map<string, TicketSuggestion>>(new Map());

  const activeId = creationQueue[0] ?? null;
  const activeSuggestion = activeId ? queuedSuggestionsRef.current.get(activeId) : null;
  const shouldShowModal = creationQueue.length > 0 && activeSuggestion !== null;

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const startCreation = () => {
    if (selectedIds.length > 0) {
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

  const startBulkCreation = () => {
    if (suggestions.length === 0) return;
    setIsBulkModalOpen(true);
  };

  const bulkParentTitle = suggestions[0]?.title ?? '';
  const bulkSubTitleTitles = existingParentTicket
    ? suggestions.map(s => s.title)
    : suggestions.slice(1).map(s => s.title);
  const bulkSubDescriptions = [
    suggestions[0]?.description ?? '',
    ...suggestions.slice(1).map(s => s.description),
  ];
  const bulkClientRowIds = suggestions.map(s => s.suggestionId);

  return (
    <div className='mt-3 pl-2 -ml-8'>
      {ticketsCreated.map(created => (
        <div key={created.ticketId} className='flex items-start gap-2 py-2'>
          <div className='flex-1 min-w-0'>
            <button
              onClick={() => handleNavigateToTicket(created)}
              className='text-sm text-left hover:underline focus:outline-none bg-transparent border-none p-0'
            >
              <span className='font-semibold text-primary'>{created.xyneId}</span>
              <span className='mx-1.5 text-muted-foreground'>•</span>
              <span className='font-normal text-foreground'>{created.title}</span>
            </button>
          </div>
        </div>
      ))}

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

      <div className='pt-1 flex items-center gap-3'>
        {selectedIds.length > 0 && (
          <button
            onClick={startCreation}
            disabled={isUpdating}
            className='text-sm font-medium text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none p-0'
            data-track-category='Tickets'
            data-track-name='TicketSuggestionsCreateSelected'
          >
            {isUpdating ? 'Creating...' : `Create Tickets (${selectedIds.length})`}
          </button>
        )}
      </div>

      {suggestions.length >= 2 && (
        <div className='pt-1'>
          <button
            onClick={startBulkCreation}
            disabled={isUpdating}
            className='text-sm font-medium text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none p-0'
            data-track-category='Tickets'
            data-track-name='TicketSuggestionsCreateBulk'
          >
            Create all as sub-tickets
          </button>
        </div>
      )}

      {isBulkModalOpen && currentChannel && (
        <BulkCreateTicketsModal
          isOpen={true}
          onClose={() => setIsBulkModalOpen(false)}
          channelId={channelId}
          projectId={currentChannel.projectId ?? ''}
          mode={BulkTicketMode.PARENT_SUB}
          parentTitle={existingParentTicket ? undefined : bulkParentTitle}
          subTitleTitles={bulkSubTitleTitles}
          subDescriptions={bulkSubDescriptions}
          clientRowIds={bulkClientRowIds}
          existingParentTicket={existingParentTicket ?? undefined}
          sourceMessageId={existingParentTicket ? messageId : undefined}
          sourceConversationId={existingParentTicket ? undefined : conversationId}
          onTicketCreated={() => {
            setIsBulkModalOpen(false);
            toast.success('Tickets queued', {
              description: 'Tickets will be created shortly.',
            });
          }}
        />
      )}

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
