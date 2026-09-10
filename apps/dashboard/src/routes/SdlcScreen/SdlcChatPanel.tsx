import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronLeft, Folder } from 'lucide-react';
import type { SdlcDiscussion } from '@xyne/shared';
import type { ThreadInfo } from '../../machines/xyneAIMachine';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { ThreadMessages } from '../../components/Chat/ThreadPannel';
import ConversationPanelV2 from '../../components/Chat/ConversationPannel/ConversationPanelV2';
import { ConversationBadgeContext } from '../../components/Chat/ConversationPannel/ConversationBadgeContext';
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
  /** Whose conversations these are, named in the panel's own bar. */
  title: string;
  /**
   * Set when the conversations belong to something inside the track rather than
   * to the track itself, so the bar says whose it is and offers the way back.
   */
  scopeHeader?: { name: string; onExit: () => void };
  /**
   * Marks each row in the list with where it came from. A track's list carries
   * the conversations of every folder inside it, which otherwise arrive with
   * nothing to say they were not started on the track itself.
   */
  renderConversationBadge?: (conversationId: string) => ReactNode;
}

const noopUserClick = (): void => {};

export function SdlcChatPanel({
  channelId,
  discussion,
  conversationIds,
  selectedConversationId,
  onSelectConversation,
  onAskAI,
  title,
  scopeHeader,
  renderConversationBadge,
}: SdlcChatPanelProps): ReactElement {
  /**
   * The thread's own actions render in this panel's bar rather than in the page
   * header, so opening a conversation changes nothing above the panel.
   */
  const [headerActionsEl, setHeaderActionsEl] = useState<HTMLElement | null>(null);
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

  const threadOpen = Boolean(selectedConversationId && selectedConversation);
  const selectedTicketId = selectedConversation?.ticketId ?? null;

  /**
   * The bar earns its place only when it has something to say: whose folder
   * these conversations are, or the way back out of a thread. A track's list
   * already sits under the page header naming the track, so it gets none.
   * Sticky as well as shrink-0, to hold whichever element ends up scrolling.
   */
  const header =
    scopeHeader || threadOpen ? (
      <div className='sticky top-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-border bg-background px-2.5 py-1.5'>
        <button
          type='button'
          onClick={() => (threadOpen ? onSelectConversation(null) : scopeHeader?.onExit())}
          title={threadOpen ? 'Back to conversations' : 'Back to the track'}
          aria-label={threadOpen ? 'Back to conversations' : 'Back to the track'}
          className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground'
          data-track-category='SdlcHub'
          data-track-name={threadOpen ? 'SdlcChatThreadExited' : 'FolderConversationsExited'}
        >
          <ChevronLeft className='size-4' />
        </button>
        {scopeHeader && <Folder className='size-3.5 shrink-0 fill-primary/25 text-primary/70' />}
        <span className='min-w-0 flex-1 truncate text-[12.5px] font-semibold tracking-[-0.01em]'>
          {scopeHeader?.name ?? title}
        </span>
        {/* Where ThreadMessages portals its overflow menu. */}
        <div
          ref={setHeaderActionsEl}
          className='flex shrink-0 items-center [&>div]:animate-in [&>div]:fade-in [&>div]:duration-300 [&>div]:!gap-1.5'
        />
      </div>
    ) : null;

  return (
    <SearchResultsContext.Provider value={ticketCardClickOverride}>
      <aside
        className='flex h-full min-w-0 flex-col bg-background'
        aria-label={threadOpen ? 'SDLC conversation' : 'SDLC conversations'}
        data-track-category='SdlcHub'
        data-track-name={threadOpen ? 'SdlcChatThreadViewed' : 'SdlcChatListViewed'}
        data-track-metadata={JSON.stringify(
          threadOpen
            ? { ownerType: discussion.ownerType, conversationId: selectedConversationId }
            : { ownerType: discussion.ownerType },
        )}
      >
        {header}
        {threadOpen && selectedConversationId ? (
          <div className='flex min-h-0 flex-1 flex-col [&_.relative.min-h-0.max-h-full]:flex-1'>
            <ThreadMessages
              channelId={channelId}
              conversationId={selectedConversationId}
              onClose={() => onSelectConversation(null)}
              onUserClick={noopUserClick}
              {...(onAskAI && { onAskAI })}
              headerActionsContainer={headerActionsEl}
              hideHeader
              overflowActionsOnly
              {...(selectedTicketId ? { ticketId: selectedTicketId } : { tabbedView: true })}
              disableAskAI
            />
          </div>
        ) : (
          <ConversationBadgeContext.Provider value={renderConversationBadge ?? null}>
            <ConversationPanelV2
              channelId={channelId}
              previousChannelId={null}
              showHeader={false}
              conversationIds={conversationIds}
              onOpenThread={conversationId => onSelectConversation(conversationId)}
            />
          </ConversationBadgeContext.Provider>
        )}
      </aside>
    </SearchResultsContext.Provider>
  );
}
