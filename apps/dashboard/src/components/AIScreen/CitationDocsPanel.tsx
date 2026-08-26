import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Panel, ResizableGroup, Separator, usePanelRef } from '../ui/Resizable/Resizable';
import {
  ChevronDown,
  FileText,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  SquareArrowOutUpRight,
  SquarePen,
  Ticket,
  X,
} from 'lucide-react';
import { cn } from '../../utils/classNames';
import PdfViewer from '../FileViewer/PdfViewer';
import ReadmeViewer from '../FileViewer/ReadmeViewer';
import { detectFileType } from '../FileViewer/utils';
import { fetchFile } from '../../services/clients/fileFetchService';
import { apiInstance } from '../../services/clients/apiClient';
import {
  useCitationDocs,
  type CitationDoc,
  type CitationKbFileDoc,
  type CitationThreadDoc,
  type CitationTicketDoc,
  type CitationCanvasDoc,
} from './citationDocs';
import { ThreadMessages } from '../Chat/ThreadPannel';
import { TicketDetails } from '../Tickets/TicketDetails/TicketDetails';
import CanvasScreen from '../Canvas/CanvasScreen';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

/** No-op used to disable an embedded view's internal navigation (e.g. profile
 *  clicks) so interacting inside a citation tab never navigates the /ai page
 *  away. Mirrors the SDLC panels' use of the same prop. */
const noop = (): void => {};

/** Tab-strip icon per doc source. */
function iconForSource(source: CitationDoc['source']): ReactElement {
  switch (source) {
    case 'thread':
      return <MessageSquare className='h-3.5 w-3.5 flex-shrink-0' />;
    case 'ticket':
      return <Ticket className='h-3.5 w-3.5 flex-shrink-0' />;
    case 'canvas':
      return <SquarePen className='h-3.5 w-3.5 flex-shrink-0' />;
    default:
      return <FileText className='h-3.5 w-3.5 flex-shrink-0' />;
  }
}

/** Fetches a KB file's bytes once per fileId/mimeType. Shared by both the PDF
 *  and markdown branches below — only what's rendered on top differs. */
function useCitationFile(
  doc: Pick<CitationKbFileDoc, 'fileId' | 'title' | 'mimeType'>,
  fallbackMimeType: string,
): { file: File | null; loading: boolean; error: string | null } {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFile(null);
    void fetchFile(
      `/collections/items/${doc.fileId}/download`,
      doc.title,
      doc.mimeType ?? fallbackMimeType,
    )
      .then(f => {
        if (!cancelled) setFile(f);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load file.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.fileId, doc.title, doc.mimeType, fallbackMimeType]);

  return { file, loading, error };
}

/** PDF branch: adds the cited chunk's highlight snippet on top of the shared
 *  file fetch, then renders the shared pdf.js viewer. */
function CitationPdfView({ doc }: { doc: CitationKbFileDoc }): ReactElement {
  const { file, loading, error } = useCitationFile(doc, 'application/pdf');
  const [highlightQuery, setHighlightQuery] = useState<string | undefined>(undefined);

  // Resolve the cited chunk's highlight snippet. Re-runs on navSeq (re-click) so
  // a re-clicked citation re-highlights. Best-effort.
  useEffect(() => {
    if (doc.chunkIndex === undefined) {
      setHighlightQuery(undefined);
      return;
    }
    let cancelled = false;
    void apiInstance
      .get(`/collections/items/${doc.fileId}/chunk`, { params: { index: doc.chunkIndex } })
      .then(res => {
        if (cancelled) return;
        const chunkText = (res.data as { chunkText?: string | null })?.chunkText;
        if (typeof chunkText === 'string' && chunkText.trim().length >= 2) {
          setHighlightQuery(chunkText.trim());
        } else {
          setHighlightQuery(undefined);
        }
      })
      .catch(() => {
        /* best-effort — no highlight */
      });
    return () => {
      cancelled = true;
    };
  }, [doc.fileId, doc.chunkIndex, doc.navSeq]);

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <div className='min-h-0 flex-1'>
        {loading ? (
          <div className='flex h-full items-center justify-center'>
            <div className='h-8 w-8 animate-spin rounded-full border-b-2 border-ring' />
          </div>
        ) : error ? (
          <div className='flex h-full items-center justify-center px-4 text-center text-sm text-destructive'>
            {error}
          </div>
        ) : file ? (
          <PdfViewer
            source={file}
            fileName={doc.title}
            {...(doc.page ? { initialPage: doc.page } : {})}
            {...(highlightQuery ? { highlightQuery } : {})}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Markdown branch: a compact filename + Raw/Preview header (mirrors the
 *  reference design) over either the rendered doc (ReadmeViewer, reused from
 *  the KB file viewer) or the raw source text. No chunk-highlight support —
 *  ReadmeViewer doesn't have a find-and-scroll path like pdf.js does. */
function CitationMarkdownView({ doc }: { doc: CitationKbFileDoc }): ReactElement {
  const { file, loading, error } = useCitationFile(doc, 'text/markdown');
  const [mode, setMode] = useState<'raw' | 'preview'>('preview');
  const [rawText, setRawText] = useState<string | null>(null);

  useEffect(() => {
    setRawText(null);
    if (!file) return;
    let cancelled = false;
    void file
      .text()
      .then(text => {
        if (!cancelled) setRawText(text);
      })
      .catch(() => {
        if (!cancelled) setRawText('Failed to read file.');
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <div className='flex h-10 flex-shrink-0 items-center justify-between gap-3 border-b border-border px-3'>
        <span className='min-w-0 truncate text-sm font-medium text-foreground' title={doc.title}>
          {doc.title}
        </span>
        <div className='flex flex-shrink-0 items-center gap-1 rounded-md bg-muted p-0.5'>
          <button
            type='button'
            onClick={() => setMode('raw')}
            aria-pressed={mode === 'raw'}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              mode === 'raw'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-track-category='ask-ai'
            data-track-name='citation-doc-raw'
          >
            Raw
          </button>
          <button
            type='button'
            onClick={() => setMode('preview')}
            aria-pressed={mode === 'preview'}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              mode === 'preview'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-track-category='ask-ai'
            data-track-name='citation-doc-preview'
          >
            Preview
          </button>
        </div>
      </div>
      <div className='relative min-h-0 flex-1'>
        {loading ? (
          <div className='flex h-full items-center justify-center'>
            <div className='h-8 w-8 animate-spin rounded-full border-b-2 border-ring' />
          </div>
        ) : error ? (
          <div className='flex h-full items-center justify-center px-4 text-center text-sm text-destructive'>
            {error}
          </div>
        ) : mode === 'preview' ? (
          <div className='h-full min-h-0'>
            <ReadmeViewer source={file} fileName={doc.title} />
          </div>
        ) : (
          <pre className='h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-sm text-foreground'>
            {rawText ?? ''}
          </pre>
        )}
      </div>
    </div>
  );
}

/** Everything else the KB file viewer already knows how to render — docx,
 *  csv, excel, images, video, non-md code, html, txt — via the same
 *  `FILE_TYPE_CONFIG` lookup `FileViewerPanel` uses, just with a plain
 *  filename header (no Raw/Preview — that's a markdown-only concept, these
 *  viewers already render "the preview"). No chunk-highlight: only pdf.js
 *  (via PdfViewer) actually consumes `highlightQuery`. */
function CitationGenericView({ doc }: { doc: CitationKbFileDoc }): ReactElement {
  const fileType = detectFileType(doc.mimeType ?? '', doc.title);
  const { file, loading, error } = useCitationFile(doc, doc.mimeType ?? 'application/octet-stream');
  const ViewerComponent = fileType?.component;

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <div className='flex h-10 flex-shrink-0 items-center border-b border-border px-3'>
        <span className='truncate text-sm font-medium text-foreground' title={doc.title}>
          {doc.title}
        </span>
      </div>
      <div className='relative min-h-0 flex-1'>
        {loading ? (
          <div className='flex h-full items-center justify-center'>
            <div className='h-8 w-8 animate-spin rounded-full border-b-2 border-ring' />
          </div>
        ) : error ? (
          <div className='flex h-full items-center justify-center px-4 text-center text-sm text-destructive'>
            {error}
          </div>
        ) : file && ViewerComponent ? (
          <div className={cn(fileType.wrapperClass, 'bg-background max-w-full max-h-full')}>
            <ViewerComponent
              source={file}
              fileName={doc.title}
              {...(doc.page ? { initialPage: doc.page } : {})}
            />
          </div>
        ) : (
          <div className='flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground'>
            Preview not available for this file type
          </div>
        )}
      </div>
    </div>
  );
}

/** Messages / in-directory ticket thread — rendered live via the same
 *  `ThreadMessages` panel the chat routes use. `onUserClick={noop}` and
 *  `showChannelLink={false}` keep interactions inside the tab (no /ai nav). */
function CitationThreadView({ doc }: { doc: CitationThreadDoc }): ReactElement {
  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <ThreadMessages
        channelId={doc.channelId}
        conversationId={doc.conversationId}
        ticketId={doc.ticketId ?? null}
        matchedMessageId={doc.messageId ?? null}
        showHeader={false}
        showChannelLink={false}
        onUserClick={noop}
        {...(doc.ticketId ? { underTicketView: true, hideTabBar: true } : {})}
      />
    </div>
  );
}

/** Desk ticket — rendered live via the same `TicketDetails` the support view
 *  uses. `onNavigateToTicket` re-opens a linked ticket in a new panel tab so a
 *  ticket-to-ticket jump stays inside the /ai panel. */
function CitationTicketView({ doc }: { doc: CitationTicketDoc }): ReactElement {
  const ctx = useCitationDocs();
  return (
    <div className='flex h-full w-full flex-col overflow-auto bg-background'>
      <TicketDetails
        ticketId={doc.ticketId}
        stageReadOnly
        onNavigateToTicket={ticketId =>
          ctx?.openDoc({
            source: 'ticket',
            id: `ticket:${ticketId}`,
            title: `Ticket ${ticketId}`,
            ticketId,
          })
        }
      />
    </div>
  );
}

/** Canvas — rendered live via the same `CanvasScreen` the canvas route uses. */
function CitationCanvasView({ doc }: { doc: CitationCanvasDoc }): ReactElement {
  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <CanvasScreen canvasId={doc.canvasId} />
    </div>
  );
}

function CitationDocView({ doc }: { doc: CitationDoc }): ReactElement {
  switch (doc.source) {
    case 'thread':
      return <CitationThreadView doc={doc} />;
    case 'ticket':
      return <CitationTicketView doc={doc} />;
    case 'canvas':
      return <CitationCanvasView doc={doc} />;
    case 'kb-file':
      if (doc.fileKind === 'markdown') return <CitationMarkdownView doc={doc} />;
      if (doc.fileKind === 'pdf') return <CitationPdfView doc={doc} />;
      return <CitationGenericView doc={doc} />;
  }
}

/**
 * Right-side panel on the /ai page. Shows one open citation doc at a time, with a
 * tab strip to switch between them. All open docs stay mounted (inactive ones
 * hidden) so their scroll position / highlight survive a tab switch — mirrors
 * xyne-search's CitationPanel. Renders nothing when no doc is open.
 */
export function CitationDocsPanel(): ReactElement | null {
  const ctx = useCitationDocs();
  const navigate = useNavigate();
  // Ref on the active tab so it auto-scrolls into view in the horizontally
  // scrollable strip whenever it changes (opening / switching a tab that's
  // off-screen would otherwise leave the active tab hidden).
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const docs = ctx?.docs ?? [];
  const active = ctx?.activeId ?? docs[docs.length - 1]?.id ?? null;
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  if (!ctx || ctx.docs.length === 0) return null;
  const { setActive, closeDoc, closeAll, collapsed, setCollapsed } = ctx;
  const activeDoc = docs.find(d => d.id === active) ?? null;
  // "Open the full page" — navigate to the citation's real route for full
  // context. In-app paths go through the router (same tab); a rare absolute URL
  // opens in a new tab. The in-panel view stays the default; this is opt-in.
  const openActiveSource = (): void => {
    const url = activeDoc?.sourceUrl;
    if (!url) return;
    if (/^https?:\/\//.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      void navigate(url);
    }
  };

  // Collapsed: a thin re-open rail instead of the tab strip + viewer — the
  // open docs stay in state, just not rendered, so re-expanding restores them.
  if (collapsed) {
    return (
      <div className='flex h-full w-full flex-col items-center border-l border-border bg-background pt-2'>
        <button
          type='button'
          onClick={() => setCollapsed(false)}
          aria-label='Expand documents panel'
          title='Expand'
          className='grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          data-track-category='ask-ai'
          data-track-name='citation-docs-expand'
        >
          <PanelRightOpen className='h-4 w-4' />
        </button>
        <span className='mt-1.5 text-[11px] font-medium text-muted-foreground'>{docs.length}</span>
      </div>
    );
  }

  return (
    <div className='flex h-full w-full flex-col border-l border-border bg-background'>
      {/* Header — open-doc count dropdown, the tab strip, then collapse / close-all. */}
      <div className='flex h-9 flex-shrink-0 items-center gap-1 border-b border-border pl-2 pr-1'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className='flex h-7 flex-shrink-0 items-center gap-0.5 rounded px-1.5 text-[12px] font-medium text-foreground hover:bg-secondary/60'
              aria-label='List open documents'
              data-track-category='ask-ai'
              data-track-name='citation-docs-list-open'
            >
              {docs.length}
              <ChevronDown className='h-3.5 w-3.5 text-muted-foreground' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='w-64'>
            {docs.map(doc => (
              <DropdownMenuItem
                key={doc.id}
                onClick={() => setActive(doc.id)}
                className='flex items-center justify-between gap-2 cursor-pointer'
              >
                <span className='flex min-w-0 items-center gap-2 text-muted-foreground'>
                  {iconForSource(doc.source)}
                  <span className='truncate'>{doc.title}</span>
                </span>
                {doc.source === 'kb-file' && typeof doc.chunkIndex === 'number' && (
                  <span className='flex-shrink-0 text-xs text-muted-foreground'>
                    ch {doc.chunkIndex}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className='flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto'>
          {docs.map(doc => {
            const isActive = doc.id === active;
            return (
              <div
                key={doc.id}
                ref={isActive ? activeTabRef : undefined}
                className={cn(
                  'flex h-7 max-w-[220px] flex-shrink-0 items-center rounded pr-1 transition-colors',
                  isActive ? 'bg-secondary' : 'hover:bg-secondary/60',
                )}
              >
                <button
                  type='button'
                  aria-pressed={isActive}
                  title={doc.title}
                  onClick={() => setActive(doc.id)}
                  className={cn(
                    'flex h-7 min-w-0 items-center gap-1.5 pl-2 pr-1 text-[12px]',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                  data-track-category='ask-ai'
                  data-track-name='citation-doc-tab-select'
                >
                  {iconForSource(doc.source)}
                  <span className='truncate'>{doc.title}</span>
                </button>
                <button
                  type='button'
                  aria-label={`Close ${doc.title}`}
                  onClick={() => closeDoc(doc.id)}
                  className='grid h-4 w-4 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-foreground/10'
                  data-track-category='ask-ai'
                  data-track-name='citation-doc-tab-close'
                >
                  <X className='h-3 w-3' strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>

        <div className='flex flex-shrink-0 items-center gap-0.5 pl-1'>
          {activeDoc?.sourceUrl && (
            <button
              type='button'
              onClick={openActiveSource}
              aria-label='Jump to Source'
              title='Jump to Source'
              className='grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              data-track-category='ask-ai'
              data-track-name='citation-docs-open-source'
            >
              <SquareArrowOutUpRight className='h-4 w-4' />
            </button>
          )}
          <button
            type='button'
            onClick={() => setCollapsed(true)}
            aria-label='Collapse panel'
            title='Collapse'
            className='grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
            data-track-category='ask-ai'
            data-track-name='citation-docs-collapse'
          >
            <PanelRightClose className='h-4 w-4' />
          </button>
          <button
            type='button'
            onClick={closeAll}
            aria-label='Close all documents'
            title='Close all'
            className='grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
            data-track-category='ask-ai'
            data-track-name='citation-docs-close-all'
          >
            <X className='h-4 w-4' />
          </button>
        </div>
      </div>

      {/* Stacked viewers — only the active one is shown; the rest stay mounted
          AND laid out (so the PDF/canvas keep their measured size and scroll and
          don't reload on tab switch). Inactive layers are hidden with
          `opacity:0` + `pointer-events:none` rather than `visibility:hidden`:
          the embedded views (Radix / BlockNote / thread) set
          `visibility:visible` on their own inner nodes, which overrides an
          ancestor's `hidden` and bleeds the inactive tab through during a
          switch. An ancestor `opacity:0` forms a compositing group a descendant
          can't undo, so nothing leaks; and unlike `display:none` it keeps the
          layer sized so the viewers don't re-measure to 0. The active layer sits
          on top (z-10) and is opaque so it fully occludes the stack. */}
      <div className='relative min-h-0 flex-1'>
        {docs.map(doc => {
          const isActive = doc.id === active;
          return (
            <div
              key={doc.id}
              aria-hidden={!isActive}
              style={{
                opacity: isActive ? 1 : 0,
                pointerEvents: isActive ? 'auto' : 'none',
                zIndex: isActive ? 10 : 0,
              }}
              className='absolute inset-0 bg-background'
            >
              <CitationDocView doc={doc} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Wraps the chat thread. When one or more citation docs are open, it splits the
 * area into a resizable chat column (left) + the citation docs panel (right).
 * With no docs open the chat panel is alone and fills the width. Must be
 * rendered inside a `CitationDocsProvider`.
 *
 * The group and the chat Panel render UNCONDITIONALLY; only the separator and
 * docs Panel are appended. That is load-bearing: this used to return a bare
 * `<>{children}</>` until a doc opened, which moved `children` to a different
 * position in the element tree — React then remounts the whole subtree, and
 * AIChatThread keeps the conversation in local state, so opening a citation
 * wiped every message.
 */
export function ChatWithCitationDocs({ children }: { children: ReactNode }): ReactElement {
  const ctx = useCitationDocs();
  const hasDocs = !!ctx && ctx.docs.length > 0;
  const collapsed = !!ctx?.collapsed;
  const docsPanelRef = usePanelRef();

  // Drive the Panel's own collapse/expand via its imperative handle, keyed off
  // the collapse button's state in context — the Panel stays mounted (rail UI
  // renders inside it at collapsedSize) so the group's saved layout survives.
  //
  // The ref callback fires as soon as the Panel mounts, but the group doesn't
  // register its layout constraints (measured via ResizeObserver) until a
  // moment later — calling isCollapsed()/collapse()/expand() in that window
  // throws "Panel constraints not found". That window only exists right on
  // mount; by the time a user can actually click the collapse button the
  // panel is long since registered, so best-effort + swallow is safe here.
  useEffect(() => {
    const handle = docsPanelRef.current;
    if (!handle || !hasDocs) return;
    try {
      if (collapsed && !handle.isCollapsed()) handle.collapse();
      else if (!collapsed && handle.isCollapsed()) handle.expand();
    } catch {
      /* constraints not registered yet — nothing to sync on this pass */
    }
  }, [collapsed, hasDocs, docsPanelRef]);

  return (
    <ResizableGroup
      orientation='horizontal'
      autoSaveId='ai-citation-docs'
      // Which Panels are actually mounted, so the persisted layout restores
      // against the right set instead of the last one written.
      panelIds={hasDocs ? ['ai-chat', 'ai-citation-docs'] : ['ai-chat']}
      className='h-full w-full'
    >
      <Panel
        id='ai-chat'
        defaultSize={hasDocs ? '55%' : '100%'}
        minSize={hasDocs ? '30%' : '100%'}
        className='min-w-0'
      >
        {children}
      </Panel>
      {hasDocs && (
        <>
          <Separator className='w-px bg-border transition-colors hover:bg-primary/40 active:bg-primary/60' />
          <Panel
            id='ai-citation-docs'
            defaultSize='45%'
            minSize='25%'
            collapsible
            collapsedSize={40}
            panelRef={docsPanelRef}
            className='min-w-0'
          >
            <CitationDocsPanel />
          </Panel>
        </>
      )}
    </ResizableGroup>
  );
}

export default CitationDocsPanel;
