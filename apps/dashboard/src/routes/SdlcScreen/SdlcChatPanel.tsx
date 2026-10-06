import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { ChevronLeft, SquareArrowOutUpRight, X } from 'lucide-react';
import { parseTicketMd, type SdlcDiscussion } from '@xyne/shared';
import type { ThreadInfo } from '../../machines/xyneAIMachine';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { cn } from '../../utils/classNames';
import { getInitialMessageFromConversation } from '../../utils/conversationMessageHelpers';
import { ThreadMessages } from '../../components/Chat/ThreadPannel';
import ConversationPanelV2 from '../../components/Chat/ConversationPannel/ConversationPanelV2';
import {
  ConversationBadgeContext,
  type ConversationBadgeRenderer,
} from '../../components/Chat/ConversationPannel/ConversationBadgeContext';
import {
  DiscussionListContext,
  type DiscussionScope,
} from '../../components/Chat/ConversationPannel/DiscussionListContext';
import {
  SearchResultsContext,
  type SearchResultsThread,
} from '../../components/Chat/SearchResults/SearchResultsContext';

/**
 * One panel for every SDLC surface. Tracks, their items and artifact canvases all
 * discuss through DISCUSSION rows in sdlc_entity_links (owner -> CONVERSATION); only
 * the owner in the discussion binding differs.
 *
 * Its conversations read as discussions: each started with a title, shown as a
 * card, and opened into its thread, which is where people talk. The messages, their
 * actions and the composer are the channel's own.
 */
interface SdlcChatPanelProps {
  channelId: string;
  discussion: Omit<SdlcDiscussion, 'linkId'>;
  /** Which discussions the list shows, joined in its queries: a track's, or an item's. */
  discussionScope: DiscussionScope;
  selectedConversationId: string | null;
  /**
   * The open conversation came from outside the list — a ticket opened from the
   * board — so there is no list behind it to go back to; closing it closes the panel.
   */
  threadOnly?: boolean;
  onSelectConversation: (
    conversationId: string | null,
    options?: { selectedTab?: 'details' },
  ) => void;
  /** Thread header's Ask AI. Raised so the host can route it past the frame. */
  onAskAI?: (threadInfo?: ThreadInfo) => void;
  /** Whose discussions these are: the track's, the item's or the artifact's name. */
  title: string;
  onClose: () => void;
  /**
   * Set when the discussions belong to something inside the track rather than to
   * the track itself, so the bar says whose they are and offers the way back.
   */
  scopeHeader?: {
    name: string;
    icon?: ReactNode;
    onExit?: () => void;
    /** Opens the item itself, as double-clicking it in the file list does. */
    onOpen?: () => void;
  };
  /**
   * The item the open conversation is filed on, named under its title with the way
   * to open it — what a call's discussion reached from a list otherwise doesn't say.
   * Absent for one on the track itself, or on the item already open beside it.
   */
  threadSubject?: { name: string; icon: ReactNode; onOpen: () => void } | null;
  /**
   * Marks each discussion in the list with where it came from. A track's list
   * carries those of every item inside it, which otherwise arrive with nothing to
   * say they were not started on the track itself.
   */
  renderConversationBadge?: ConversationBadgeRenderer;
  /**
   * Calls, tickets and Ask AI for whatever this panel is about. Shown on the
   * list; a thread portals its own actions into the same place, so the bar
   * never carries two sets at once.
   */
  listActions?: ReactNode;
  /**
   * Whether the bar draws its rule. Off beside a page whose own header draws none —
   * a track's page, where the tab row under the title does — so the two lines
   * don't sit at different heights across the divider.
   */
  headerRule?: boolean;
}

const noopUserClick = (): void => {};
const FADE_PX = 24;

/** The text of an opening message's first line: a titled discussion's title. */
function firstLineOf(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const first = body.firstElementChild ?? body;
  return (first.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** A scroller inside the panel that fades at an edge while there is more past it. */
interface FadedScroller {
  selector: string;
  axis: 'x' | 'y';
  px: number;
}

/**
 * The panel's scrollers — the discussion list, a thread's messages, its tab row —
 * belong to the chat components it hosts, so they are found in the page rather
 * than handed refs, and faded as the hub's own lists are.
 */
const FADED_SCROLLERS: readonly FadedScroller[] = [
  { selector: '[data-virtuoso-scroller="true"]', axis: 'y', px: 40 },
  { selector: '[data-component="ThreadList"]', axis: 'y', px: 40 },
  { selector: '[role="tablist"]', axis: 'x', px: FADE_PX },
];

function paintFade(element: HTMLElement, axis: 'x' | 'y', px: number): void {
  const position = axis === 'y' ? element.scrollTop : element.scrollLeft;
  const visible = axis === 'y' ? element.clientHeight : element.clientWidth;
  const total = axis === 'y' ? element.scrollHeight : element.scrollWidth;
  const start = position > 1;
  const end = position + visible < total - 1;
  const mask =
    start || end
      ? `linear-gradient(${axis === 'y' ? 'to bottom' : 'to right'}, ${
          start ? 'transparent' : 'black'
        }, black ${start ? px : 0}px, black calc(100% - ${end ? px : 0}px), ${
          end ? 'transparent' : 'black'
        })`
      : '';
  element.style.setProperty('mask-image', mask);
  element.style.setProperty('-webkit-mask-image', mask);
}

function usePanelScrollFades(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const host = root.current;
    if (!host) return undefined;
    const attached = new Map<HTMLElement, () => void>();
    const size = new ResizeObserver(entries => {
      for (const entry of entries) attached.get(entry.target as HTMLElement)?.();
    });
    const attach = (): void => {
      for (const { selector, axis, px } of FADED_SCROLLERS) {
        const found = host.querySelector(selector);
        // A tab list scrolls in its wrapper; the lists scroll themselves.
        const element = axis === 'x' ? found?.parentElement : found;
        if (!(element instanceof HTMLElement) || attached.has(element)) continue;
        const paint = (): void => paintFade(element, axis, px);
        element.addEventListener('scroll', paint, { passive: true });
        size.observe(element);
        if (element.firstElementChild) size.observe(element.firstElementChild);
        attached.set(element, paint);
        paint();
      }
      for (const [element, paint] of attached) {
        if (host.contains(element)) continue;
        element.removeEventListener('scroll', paint);
        size.unobserve(element);
        attached.delete(element);
      }
    };
    attach();
    const children = new MutationObserver(attach);
    children.observe(host, { childList: true, subtree: true });
    return () => {
      children.disconnect();
      size.disconnect();
      for (const [element, paint] of attached) element.removeEventListener('scroll', paint);
    };
  }, [root]);
}

export function SdlcChatPanel({
  channelId,
  discussion,
  discussionScope,
  selectedConversationId,
  threadOnly = false,
  onSelectConversation,
  onAskAI,
  title,
  onClose,
  scopeHeader,
  renderConversationBadge,
  listActions,
  headerRule = true,
  threadSubject,
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
  const discussionSettings = useMemo(
    () => ({ subject: scopeHeader?.name ?? title }),
    [scopeHeader?.name, title],
  );

  // What the open conversation is called: a ticket by its key and title, anything
  // else by its opening line — the title it was started with.
  const threadTitle = useMemo(() => {
    if (!selectedConversation) return '';
    const ticket = parseTicketMd(selectedConversation.ticket_md);
    if (ticket?.title) return ticket.xyneId ? `${ticket.xyneId} · ${ticket.title}` : ticket.title;
    const opening = getInitialMessageFromConversation(selectedConversation);
    return (opening && firstLineOf(opening.content)) || 'Discussion';
  }, [selectedConversation]);

  const panelRef = useRef<HTMLElement>(null);
  usePanelScrollFades(panelRef);

  // Back steps out of whatever is on show: a thread to its list — unless it was
  // opened on its own, with no list behind it — or an item's discussions to the
  // track's.
  const back: { label: string; run: () => void; trackName: string } | null = threadOpen
    ? threadOnly
      ? null
      : {
          label: 'Back to discussions',
          run: () => onSelectConversation(null),
          trackName: 'SdlcChatThreadExited',
        }
    : scopeHeader?.onExit
      ? {
          label: "Back to the track's discussions",
          run: scopeHeader.onExit,
          trackName: 'FolderConversationsExited',
        }
      : null;

  // This panel's own header band. It matches the page header's 52px so the two
  // meet across a divider that runs the full height of the page.
  const header = (
    <div
      className={cn(
        'z-10 flex h-[52px] shrink-0 items-center gap-1.5 bg-background/95 px-3 backdrop-blur',
        headerRule && 'border-b',
      )}
    >
      {back && (
        <button
          type='button'
          onClick={back.run}
          title={back.label}
          aria-label={back.label}
          className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground'
          data-track-category='SdlcHub'
          data-track-name={back.trackName}
        >
          <ChevronLeft className='size-4' />
        </button>
      )}
      {!threadOpen && (scopeHeader?.icon ?? null)}
      {threadOpen ? (
        <span className='flex min-w-0 flex-1 flex-col'>
          <span
            className='truncate text-[13px] font-semibold tracking-[-0.01em]'
            title={threadTitle}
          >
            {threadTitle}
          </span>
          {threadSubject && (
            <button
              type='button'
              onClick={threadSubject.onOpen}
              title={`Open ${threadSubject.name}`}
              className='flex w-fit max-w-full items-center gap-1 rounded text-[11px] leading-4 text-muted-foreground transition-colors hover:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='SdlcChatSubjectOpened'
            >
              {threadSubject.icon}
              <span className='truncate'>{threadSubject.name}</span>
              <SquareArrowOutUpRight className='size-3 shrink-0' aria-hidden='true' />
            </button>
          )}
        </span>
      ) : (
        <span className='flex min-w-0 flex-1 items-center gap-1.5'>
          <span className='min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em]'>
            {scopeHeader?.name ?? 'Discussions'}
          </span>
          {scopeHeader?.onOpen && (
            <button
              type='button'
              onClick={scopeHeader.onOpen}
              title={`Open ${scopeHeader.name}`}
              aria-label={`Open ${scopeHeader.name}`}
              className='flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground'
              data-track-category='SdlcHub'
              data-track-name='SdlcChatScopeOpened'
            >
              <SquareArrowOutUpRight className='size-3' aria-hidden='true' />
              Open
            </button>
          )}
        </span>
      )}
      {!threadOpen && listActions ? (
        <div className='flex shrink-0 items-center gap-1 [&_button]:!size-7 [&_button]:!rounded-lg'>
          {listActions}
        </div>
      ) : null}
      {/* Where ThreadMessages portals its actions. */}
      <div
        ref={setHeaderActionsEl}
        className='flex shrink-0 items-center [&>div]:animate-in [&>div]:fade-in [&>div]:duration-300 [&>div]:!gap-1'
      />
      <button
        type='button'
        onClick={onClose}
        title='Close'
        aria-label='Close discussions'
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
        ref={panelRef}
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
          <DiscussionListContext.Provider value={discussionSettings}>
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
                  discussionScope={discussionScope}
                  onOpenThread={conversationId => onSelectConversation(conversationId)}
                />
              </div>
            </ConversationBadgeContext.Provider>
          </DiscussionListContext.Provider>
        )}
      </aside>
    </SearchResultsContext.Provider>
  );
}
