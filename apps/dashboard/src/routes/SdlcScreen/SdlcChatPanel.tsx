import { useEffect, useMemo, type ReactElement } from 'react';
import type { SdlcDiscussion } from '@xyne/shared';
import type { ThreadInfo } from '../../machines/xyneAIMachine';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { ThreadMessages } from '../../components/Chat/ThreadPannel';
import ConversationPanelV2 from '../../components/Chat/ConversationPannel/ConversationPanelV2';
import {
  SearchResultsContext,
  type SearchResultsThread,
} from '../../components/Chat/SearchResults/SearchResultsContext';

/**
 * One chat panel for every SDLC surface. Tracks and artifact canvases both
 * chat through DISCUSSION rows in sdlc_entity_links (owner -> CONVERSATION);
 * only the owner in the discussion binding differs.
 */
interface SdlcChatPanelProps {
  channelId: string;
  discussion: Omit<SdlcDiscussion, 'linkId'>;
  conversationIds: string[];
  selectedConversationId: string | null;
  onSelectConversation: (
    conversationId: string | null,
    options?: { selectedTab?: 'details' },
  ) => void;
  /** Thread header's Ask AI. Raised so the host can route it past the frame. */
  onAskAI?: (threadInfo?: ThreadInfo) => void;
  headerActionsContainer?: HTMLElement | null;
}

const noopUserClick = (): void => {};

export function SdlcChatPanel({
  channelId,
  discussion,
  conversationIds,
  selectedConversationId,
  onSelectConversation,
  onAskAI,
  headerActionsContainer,
}: SdlcChatPanelProps): ReactElement {
  const [selectedConversation, selectedConversationDetails] = useCachedQuery(
    queries.sdlcDiscussionConversation({
      channelId,
      conversationId: selectedConversationId || '',
    }),
    { enabled: !!selectedConversationId },
  );

  const ticketCardClickOverride = useMemo(
    () => ({
      onSelectThread: (thread: SearchResultsThread): void =>
        onSelectConversation(thread.conversationId, { selectedTab: 'details' }),
    }),
    [onSelectConversation],
  );

  useEffect(() => {
    if (
      selectedConversationId &&
      selectedConversationDetails.type === 'complete' &&
      !selectedConversation
    ) {
      onSelectConversation(null);
    }
  }, [
    onSelectConversation,
    selectedConversationDetails.type,
    selectedConversation,
    selectedConversationId,
  ]);

  if (selectedConversationId && selectedConversation) {
    const selectedTicketId = selectedConversation.ticketId ?? null;

    return (
      <SearchResultsContext.Provider value={ticketCardClickOverride}>
        <aside
          className='flex h-full min-w-0 flex-col bg-background'
          aria-label='SDLC conversation'
          data-track-category='SdlcHub'
          data-track-name='SdlcChatThreadViewed'
          data-track-metadata={JSON.stringify({
            ownerType: discussion.ownerType,
            conversationId: selectedConversationId,
          })}
        >
          <div className='flex min-h-0 flex-1 flex-col [&_.relative.min-h-0.max-h-full]:flex-1'>
            <ThreadMessages
              channelId={channelId}
              conversationId={selectedConversationId}
              onClose={() => onSelectConversation(null)}
              onUserClick={noopUserClick}
              {...(onAskAI && { onAskAI })}
              {...(headerActionsContainer !== undefined && {
                headerActionsContainer,
                hideHeader: true,
              })}
              {...(selectedTicketId ? { ticketId: selectedTicketId } : { simpleView: true })}
              disableAskAI
            />
          </div>
        </aside>
      </SearchResultsContext.Provider>
    );
  }

  return (
    <SearchResultsContext.Provider value={ticketCardClickOverride}>
      <aside
        className='flex h-full min-w-0 flex-col bg-background'
        aria-label='SDLC conversations'
        data-track-category='SdlcHub'
        data-track-name='SdlcChatListViewed'
        data-track-metadata={JSON.stringify({ ownerType: discussion.ownerType })}
      >
        <ConversationPanelV2
          channelId={channelId}
          previousChannelId={null}
          showHeader={false}
          conversationIds={conversationIds}
          onOpenThread={conversationId => onSelectConversation(conversationId)}
        />
      </aside>
    </SearchResultsContext.Provider>
  );
}
