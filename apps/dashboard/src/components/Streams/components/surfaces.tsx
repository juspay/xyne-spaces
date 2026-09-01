import { ReactElement, type ComponentType } from 'react';
import { SparkleAi } from '../../icons/SparkleAi';
import {
  ChatChatting,
  FileText,
  Hashtag,
  KanbanBoard,
  PaperclipSlant,
  TicketToken,
} from '@xyne/icons';
import ConversationPanelV2 from '../../Chat/ConversationPannel/ConversationPanelV2';
import { ThreadMessages } from '../../Chat/ThreadPannel';
import XyneAISidebar from '../../Chat/XyneAISidebar/XyneAISidebar';
import CanvasScreen from '../../Canvas/CanvasScreen/CanvasScreen';
import { TicketDetails } from '../../Tickets/TicketDetails/TicketDetails';
import FileColumn from './FileColumn';
import { useStreamsActions } from './StreamsActions';
import KanbanBoardScreen from '../../../routes/KanbanBoardScreen';
import { useChannel } from '../../../hooks/useChannels';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import type { StreamItem } from '../utils/streamsDnd';
import { SURFACE_MIN_WIDTHS } from '../utils/Streams.types';
import type { ColumnSeed, ColumnSource, SurfaceKind } from '../utils/Streams.types';

/**
 * The surface registry — the single extension point.
 *
 * Adding a kind of column should be one entry here and zero changes to the strip.
 *
 * Rule that everything else depends on: **content never passes through the layout
 * layer.** The strip owns position, width, and focus. The channel component loads
 * channel data; the board component loads board data. The moment message content
 * starts flowing through Streams state, we have signed up to reimplement every
 * surface in the product.
 *
 * Titles resolve through a component rather than a `(source) => string` function
 * because every real title needs hooks (a channel name is a Zero query, and DM
 * names are computed from participants). A sync resolver would only ever be able
 * to return the id.
 */

interface TitleProps {
  source: ColumnSource;
  /**
   * Whether this column is a pane inside another column's box.
   *
   * Optional because only the column header knows it — every other place a
   * title is drawn (jump pills, overview, dock, top nav) shows a joined pane
   * under its parent's name, so a thread reaching those lists is detached by
   * definition and the default is right.
   */
  attached?: boolean;
}

interface BodyProps {
  source: ColumnSource;
  focused: boolean;
  /** The column's own id, for surfaces that act on the stream around them. */
  columnId: string;
  /** Set when something was dropped on this column. See `streamsDnd`. */
  seed?: ColumnSeed | undefined;
}

/**
 * Any icon a surface can wear.
 *
 * Deliberately structural rather than `LucideIcon`: the stream draws icons from
 * two sets. Lucide covers the generic shapes, and `@xyne/icons` carries the
 * ones Xyne has its own mark for — Ask AI being the first. Every render site
 * passes `className` and nothing else, so that is all the contract needs.
 */
export type SurfaceIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

export interface SurfaceDef {
  icon: SurfaceIcon;
  /** Smallest usable width for this surface, in pixels. */
  minWidth: number;
  Title: (props: TitleProps) => ReactElement;
  Body: (props: BodyProps) => ReactElement;
  /**
   * Surfaces that read route state (tab, ticketId, deep-link hash) need their own
   * private URL, or N columns fight over the one real address bar.
   */
  needsRouterScope: boolean;
  /** Seed path for the scoped router; must keep the shape the surface expects. */
  scopePath: (source: ColumnSource, workspaceId: string) => string;
  scopeParams: (source: ColumnSource, workspaceId: string) => Record<string, string>;
  /**
   * Where this column lives in the app proper. The column's private router is a
   * dead end by design, so "open in app" has to escape it deliberately and drive
   * the real one.
   *
   * Omitted by surfaces that exist only inside a stream — a feed has no page to
   * open, so offering the control at all would be a promise nothing keeps.
   */
  appPath?: (source: ColumnSource, workspaceId: string) => string;
  /**
   * What this surface will take from elsewhere in the stream.
   *
   * Declared by kind rather than by inspecting the payload, because a drop target
   * has to decide whether to accept *during* `dragover`, and the browser will not
   * release the payload until the drop itself. The stream decides what accepting
   * then does — a surface saying "I take conversations" does not also have to
   * know that a conversation becomes a prepared question.
   */
  accepts?: (kind: StreamItem['kind']) => boolean;
  /** What the drop overlay promises, in the surface's own terms. */
  dropLabel?: string;
}

// ----------------------------------------------------------------- channel

const ChannelTitle = ({ source }: TitleProps): ReactElement => {
  const channelId = source.kind === 'channel' ? source.channelId : '';
  const channel = useChannel(channelId);
  const { userID } = useAuthContextValues();
  const { displayName } = useChannelDisplayName(channel ?? null, userID);
  return <>{displayName || 'Channel'}</>;
};

const ChannelBody = ({ source }: BodyProps): ReactElement => {
  if (source.kind !== 'channel') return <></>;
  return (
    <div className='flex h-full flex-col'>
      <div className='min-h-0 flex-1'>
        <ConversationPanelV2
          channelId={source.channelId}
          previousChannelId={null}
          showHeader={false}
          linkedConversationIdOverride={source.focusConversationId ?? null}
          // The panel marks its channel read when it unmounts. That is right for
          // the app, where a mounted channel is a channel you opened — and wrong
          // here, where six of them are mounted at once because you are
          // *watching* them. Left on, every unread in the stream drained the moment
          // Streams unmounted, so no column ever had anything to report.
          //
          // Streams marks read itself instead, when focus leaves a column. See
          // `markChannelRead` in StreamsScreen.
          skipMarkAsRead
        />
      </div>
    </div>
  );
};

// ------------------------------------------------------------------- board

const BoardTitle = ({ source }: TitleProps): ReactElement => (
  <>{source.kind === 'board' && source.viewMode === 'my-tickets' ? 'My tickets' : 'Board'}</>
);

const BoardBody = ({ source }: BodyProps): ReactElement => {
  if (source.kind !== 'board') return <></>;
  return (
    <KanbanBoardScreen
      viewMode={source.viewMode}
      {...(source.channelId && { channelId: source.channelId })}
    />
  );
};

// ------------------------------------------------------------------- agent

/**
 * "Ask AI · engineering" when the column carries channel context, "Ask AI" when
 * it does not. Never a stand-in word: if the name has not resolved yet, the
 * suffix is simply absent, because "Ask AI · channel" told you nothing except
 * that something was missing.
 */
const AgentTitle = ({ source }: TitleProps): ReactElement => {
  const channelId = source.kind === 'agent' ? (source.channelId ?? '') : '';
  const channel = useChannel(channelId);
  const { userID } = useAuthContextValues();
  const { displayName } = useChannelDisplayName(channel ?? null, userID);
  if (!channelId || !displayName) return <>Ask AI</>;
  return <>Ask AI · {displayName}</>;
};

/**
 * The column renders the *sidebar* Ask AI chat, not the full-page one.
 *
 * `AIScreen` is a whole page — landing state, session list, its own layout — and
 * squeezing it into a third of the viewport gives you a page pretending to be a
 * panel. `XyneAISidebar` is the same conversation surface already built for a
 * narrow column, so it is the honest fit, and it takes an optional `channelId`
 * so an Ask AI column can carry the context it was opened from.
 */
const AgentBody = ({ source, columnId, seed }: BodyProps): ReactElement => {
  const { closeColumn } = useStreamsActions();
  return (
    <XyneAISidebar
      channelId={source.kind === 'agent' ? (source.channelId ?? null) : null}
      variant='sidebar'
      // Prepared, never sent. `seedNonce` rather than `autoSendNonce` is the
      // whole difference between a drop that hands you a question and a drop
      // that spends a model call on your behalf.
      {...(seed && { seedQuery: seed.query, seedNonce: seed.nonce })}
      startFreshChat
      // The empty state's two tilted cards are a fixed 382px composition. In a
      // column they fill the panel and read as the point of it, rather than as a
      // hint. The heading alone is enough here.
      hideEmptyStateSuggestions
      // No header at all. Hiding only its title still left a second bar under
      // the column's own — same height, same close, one row down. A column has
      // one header, and the column owns it.
      //
      // What that costs: new-chat and history. Both are one column away — close
      // this one and add another for a fresh chat, or open it in the full page.
      // A duplicated title bar in every Ask AI column is the worse trade.
      hideHeader
      // Kept even with the header gone: the sidebar's other exits (onboarding,
      // history) route through it, and without it they fall through to
      // dismissing the global Ask AI drawer, which is not what is on screen.
      onClose={() => closeColumn(columnId)}
    />
  );
};

// ------------------------------------------------------------------ ticket

/**
 * The ticket's own id — `ENG-214` — in preference to its title.
 *
 * A column header is a label you scan sideways past five other columns, and a
 * ticket title is a sentence. The short id is what people say out loud, and the
 * title is one line down inside the panel where there is room for it.
 */
const TicketTitle = ({ source }: TitleProps): ReactElement => {
  const ticketId = source.kind === 'ticket' ? source.ticketId : '';
  const [ticket] = useCachedQuery(queries.ticketByIdV2({ ticketId }), {
    enabled: ticketId !== '',
  });
  if (!ticket) return <>Ticket</>;
  return <>{ticket.xyneId || ticket.title || 'Ticket'}</>;
};

/**
 * The ticket, and only the ticket.
 *
 * In the app a ticket opens as a two-pane view — details on the left, its
 * discussion on the right — because the app has one pane to spend and has to
 * fit both in it. A stream does not have that problem: the discussion is a thread,
 * and a thread is its own column. Splitting a 480px column in two to reproduce
 * the app's compromise would give you two unusable halves of something the stream
 * can show side by side properly.
 */
const TicketBody = ({ source, columnId }: BodyProps): ReactElement => {
  const { openBeside } = useStreamsActions();
  if (source.kind !== 'ticket') return <></>;
  return (
    <div className='h-full overflow-y-auto'>
      <TicketDetails
        ticketId={source.ticketId}
        expandedView
        // The column header already names the ticket, and a column has no
        // "back" — it is the ticket, not a page you navigated into.
        hideBackNav
        // Sub-tickets and linked tickets land beside this one rather than
        // replacing it — following a reference is exactly the move that should
        // not cost you where you were.
        onNavigateToTicket={next => openBeside(columnId, { kind: 'ticket', ticketId: next })}
      />
    </div>
  );
};

// ------------------------------------------------------------------ thread

/**
 * Where the thread is, not what it says, and not what kind of thing it is.
 *
 * The first line of a thread is already the first thing inside the panel, so
 * repeating it in the header buys nothing and truncates badly. The channel is
 * the fact the header can add — it is the one thing you cannot see by looking
 * at the column.
 *
 * No "Thread ·" prefix. The icon in front of the title already says which kind
 * of column this is, in every column, and spelling it out in words as well made
 * the one piece of information the header carries — the channel — the second
 * thing you read.
 */
const ThreadTitle = ({ source, attached = false }: TitleProps): ReactElement => {
  const channelId = source.kind === 'thread' ? source.channelId : '';
  const channel = useChannel(channelId);
  const { userID } = useAuthContextValues();
  const { displayName } = useChannelDisplayName(channel ?? null, userID);
  // Joined, the parent is sitting right there wearing the channel name, so
  // repeating it printed `engineering` twice inside one box and said nothing.
  // Detached, the channel may be scrolled away or closed, so the pane has to
  // carry its own origin — the same shape as `Ask AI · engineering`.
  if (attached || !displayName) return <>Thread</>;
  return <>Thread · {displayName}</>;
};

const ThreadBody = ({ source }: BodyProps): ReactElement => {
  if (source.kind !== 'thread') return <></>;
  return (
    <ThreadMessages
      channelId={source.channelId}
      conversationId={source.conversationId}
      {...(source.ticketId && { ticketId: source.ticketId })}
      // Same call as Ask AI, for the same reason: the panel's own header is a
      // second bar directly under the column's, carrying a second title and a
      // second close — and of the two closes, the inner one does not close the
      // column, which is the worst possible pair of buttons to sit side by side.
      //
      // What it costs: Ask-AI-about-this-thread, start a call, and the overflow
      // menu (thread tags, add context, copy link). All of them are one click
      // away through the column's own "open in full page".
      hideHeader
    />
  );
};

// ---------------------------------------------------------------- document

/**
 * `getCanvas` runs its query through a visibility filter that erases the row
 * type on the way out, so the result arrives as `{}` and a plain `.title` does
 * not compile. Read defensively rather than casting the whole row to `Canvas`:
 * a title is the only field this needs, and a bad cast would let four more
 * through unchecked.
 */
const stringField = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const held = (value as Record<string, unknown>)[key];
  return typeof held === 'string' ? held : undefined;
};

const DocumentTitle = ({ source }: TitleProps): ReactElement => {
  const canvasId = source.kind === 'document' ? source.canvasId : '';
  const [canvas] = useCachedQuery(queries.getCanvas({ canvasId }), { enabled: canvasId !== '' });
  return <>{stringField(canvas, 'title') || 'Document'}</>;
};

const DocumentBody = ({ source }: BodyProps): ReactElement => {
  if (source.kind !== 'document') return <></>;
  // `canvasId` as a prop rather than through the scoped URL: `CanvasScreen`
  // already supports it, and a document that reads its identity from props
  // cannot be knocked off it by anything that navigates inside the column.
  return <CanvasScreen canvasId={source.canvasId} />;
};

// -------------------------------------------------------------------- file

const FileTitle = ({ source }: TitleProps): ReactElement => (
  <>{source.kind === 'file' ? source.fileName : 'File'}</>
);

const FileBody = ({ source }: BodyProps): ReactElement => {
  if (source.kind !== 'file') return <></>;
  return (
    <FileColumn
      attachmentId={source.attachmentId}
      fileName={source.fileName}
      mimeType={source.mimeType}
      fileSize={source.fileSize}
    />
  );
};

// ---------------------------------------------------------------- registry

export const SURFACES: Record<SurfaceKind, SurfaceDef> = {
  channel: {
    icon: Hashtag,
    minWidth: SURFACE_MIN_WIDTHS.channel,
    Title: ChannelTitle,
    Body: ChannelBody,
    needsRouterScope: true,
    scopePath: (source, workspaceId) =>
      `/${workspaceId}/chat/dir/${source.kind === 'channel' ? source.channelId : ''}`,
    scopeParams: (source, workspaceId) => ({
      workspaceId,
      channelId: source.kind === 'channel' ? source.channelId : '',
      context: 'dir',
    }),
    appPath: (source, workspaceId) =>
      `/${workspaceId}/chat/dir/${source.kind === 'channel' ? source.channelId : ''}`,
  },
  board: {
    icon: KanbanBoard,
    // A kanban board narrower than this shows one and a half stage columns.
    minWidth: SURFACE_MIN_WIDTHS.board,
    Title: BoardTitle,
    Body: BoardBody,
    needsRouterScope: true,
    scopePath: (_source, workspaceId) => `/${workspaceId}/projects`,
    scopeParams: (_source, workspaceId) => ({ workspaceId }),
    appPath: (source, workspaceId) =>
      source.kind === 'board' && source.viewMode === 'my-tickets'
        ? `/${workspaceId}/chat/dir/my-tickets`
        : `/${workspaceId}/projects`,
  },
  agent: {
    icon: SparkleAi,
    // The composer control row and citation panel need more than a third.
    minWidth: SURFACE_MIN_WIDTHS.agent,
    Title: AgentTitle,
    Body: AgentBody,
    needsRouterScope: true,
    scopePath: (_source, workspaceId) => `/${workspaceId}/ai/chat/new`,
    scopeParams: (_source, workspaceId) => ({ workspaceId }),
    appPath: (_source, workspaceId) => `/${workspaceId}/ai/chat/new`,
    // The first surface that takes anything. A thread dragged here becomes a
    // question about that thread, waiting in the composer.
    accepts: kind => kind === 'conversation',
    dropLabel: 'Ask about this thread',
  },

  // --- item surfaces. None appears in the add palette: you cannot pick a ticket
  // you cannot name, so these arrive by being clicked inside a column that lists
  // them. See `columnIntent`.

  ticket: {
    icon: TicketToken,
    // Below this the details pane's two-column field rows collapse into a list
    // of orphaned labels.
    minWidth: SURFACE_MIN_WIDTHS.ticket,
    Title: TicketTitle,
    Body: TicketBody,
    needsRouterScope: true,
    // Seeded at the channel the ticket belongs to, because `TicketDetails` reads
    // `useRouteContext` to build its own links, and that hook derives everything
    // from the path it is standing on.
    scopePath: (source, workspaceId) =>
      `/${workspaceId}/chat/dir/${source.kind === 'ticket' ? (source.channelId ?? '') : ''}`,
    scopeParams: (source, workspaceId) => ({
      workspaceId,
      ticketId: source.kind === 'ticket' ? source.ticketId : '',
      channelId: source.kind === 'ticket' ? (source.channelId ?? '') : '',
      context: 'dir',
    }),
    appPath: (source, workspaceId) => {
      if (source.kind !== 'ticket' || !source.channelId) return `/${workspaceId}/projects`;
      const params = new URLSearchParams({ tab: 'tickets', ticketId: source.ticketId });
      if (source.conversationId) params.set('conversationId', source.conversationId);
      return `/${workspaceId}/chat/dir/${source.channelId}?${params.toString()}`;
    },
  },

  thread: {
    icon: ChatChatting,
    minWidth: SURFACE_MIN_WIDTHS.thread,
    Title: ThreadTitle,
    Body: ThreadBody,
    needsRouterScope: true,
    scopePath: (source, workspaceId) =>
      source.kind === 'thread'
        ? `/${workspaceId}/chat/dir/${source.channelId}/${source.conversationId}`
        : `/${workspaceId}/chat/dir`,
    scopeParams: (source, workspaceId) => ({
      workspaceId,
      channelId: source.kind === 'thread' ? source.channelId : '',
      conversationId: source.kind === 'thread' ? source.conversationId : '',
      context: 'dir',
    }),
    appPath: (source, workspaceId) =>
      source.kind === 'thread'
        ? `/${workspaceId}/chat/dir/${source.channelId}/${source.conversationId}`
        : `/${workspaceId}/chat/dir`,
    // Same as Ask AI: a thread is a place a question about another thread can
    // usefully land, and the stream turns the drop into a prepared message.
    accepts: kind => kind === 'conversation',
    dropLabel: 'Quote this thread',
  },

  document: {
    icon: FileText,
    // The editor's block controls and slash menu are laid out for prose; much
    // narrower and every paragraph wraps every four words.
    minWidth: SURFACE_MIN_WIDTHS.document,
    Title: DocumentTitle,
    Body: DocumentBody,
    needsRouterScope: true,
    scopePath: (source, workspaceId) =>
      `/${workspaceId}/chat/canvas/${source.kind === 'document' ? source.canvasId : ''}`,
    scopeParams: (source, workspaceId) => ({
      workspaceId,
      canvasId: source.kind === 'document' ? source.canvasId : '',
    }),
    appPath: (source, workspaceId) =>
      `/${workspaceId}/chat/canvas/${source.kind === 'document' ? source.canvasId : ''}`,
  },

  file: {
    icon: PaperclipSlant,
    minWidth: SURFACE_MIN_WIDTHS.file,
    Title: FileTitle,
    Body: FileBody,
    // Renders one attachment from its own props and navigates nowhere.
    needsRouterScope: false,
    scopePath: (_source, workspaceId) => `/${workspaceId}/streams`,
    scopeParams: (_source, workspaceId) => ({ workspaceId }),
    // No `appPath`. A file has no page in the app — it opens in a modal over
    // whatever you were looking at, which is the thing this column exists to
    // avoid. Offering "open in full page" would send you somewhere worse.
  },
};

export const surfaceFor = (source: ColumnSource): SurfaceDef => SURFACES[source.kind];
