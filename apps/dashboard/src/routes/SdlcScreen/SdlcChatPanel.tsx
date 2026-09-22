import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
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
  title: string;
  onClose: () => void;
  /**
   * Set when the conversations belong to something inside the track rather than
   * to the track itself, so the bar says whose it is and offers the way back.
   */
  scopeHeader?: { name: string; icon?: ReactNode; onExit?: () => void };
  /**
   * Marks each row in the list with where it came from. A track's list carries
   * the conversations of every folder inside it, which otherwise arrive with
   * nothing to say they were not started on the track itself.
   */
  renderConversationBadge?: (conversationId: string) => ReactNode;
  /**
   * Calls, tickets and Ask AI for whatever this panel is about. Shown on the
   * list; a thread portals its own actions into the same place, so the bar
   * never carries two sets at once.
   */
  listActions?: ReactNode;
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
  onClose,
  scopeHeader,
  renderConversationBadge,
  listActions,
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
  const canGoBack = threadOpen || Boolean(scopeHeader?.onExit);
  // This panel's own header band. It matches the page header's 52px so the two
  // meet across a divider that now runs the full height of the page.
  const header = (
    <div className='z-10 flex h-[52px] shrink-0 items-center gap-1.5 border-b bg-background/95 px-3 backdrop-blur'>
      {canGoBack && (
        <button
          type='button'
          onClick={() => (threadOpen ? onSelectConversation(null) : scopeHeader?.onExit?.())}
          title={threadOpen ? 'Back to conversations' : 'Back to the track'}
          aria-label={threadOpen ? 'Back to conversations' : 'Back to the track'}
          className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground'
          data-track-category='SdlcHub'
          data-track-name={threadOpen ? 'SdlcChatThreadExited' : 'FolderConversationsExited'}
        >
          <ChevronLeft className='size-4' />
        </button>
      )}
      {scopeHeader?.icon ?? null}
      <span className='min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em]'>
        {scopeHeader?.name ?? title}
      </span>
      {!threadOpen && listActions ? (
        <div className='flex shrink-0 items-center gap-1.5 [&_button]:!size-7 [&_button]:!rounded-lg'>
          {listActions}
        </div>
      ) : null}
      {/* Where ThreadMessages portals its overflow menu. */}
      <div
        ref={setHeaderActionsEl}
        className='flex shrink-0 items-center [&>div]:animate-in [&>div]:fade-in [&>div]:duration-300 [&>div]:!gap-1.5'
      />
      <button
        type='button'
        onClick={onClose}
        title='Close chat'
        aria-label='Close chat'
        className='shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground'
        data-track-category='SdlcHub'
        data-track-name='SdlcChatClosed'
      >
        <X className='size-4' />
      </button>
    </div>
  );

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
              {...(selectedTicketId ? { ticketId: selectedTicketId } : { tabbedView: true })}
              disableAskAI
            />
          </div>
        ) : (
          <ConversationBadgeContext.Provider value={renderConversationBadge ?? null}>
            {/* The panel's own height, minus the header — the same box the thread
                branch gets. ConversationPanelV2's root is h-full, so without a
                flex child to measure against it takes the whole aside and pushes
                itself down past the header, scrolling the panel by 52px. */}
            <div className='flex min-h-0 flex-1 flex-col'>
              <ConversationPanelV2
                channelId={channelId}
                previousChannelId={null}
                showHeader={false}
                conversationIds={conversationIds}
                onOpenThread={conversationId => onSelectConversation(conversationId)}
              />
            </div>
          </ConversationBadgeContext.Provider>
        )}
      </aside>
    </SearchResultsContext.Provider>
  );
}
