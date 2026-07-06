import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { X } from 'lucide-react';
import { cn } from '../../utils/classNames';
import PdfViewer from '../FileViewer/PdfViewer';
import { fetchFile } from '../../services/clients/fileFetchService';
import { apiInstance } from '../../services/clients/apiClient';
import { useCitationDocs, type CitationDoc } from './citationDocs';

/**
 * One open citation document: fetches the PDF bytes + the cited chunk's
 * highlight snippet, then renders the shared pdf.js viewer. Self-contained
 * (props only, no route/collection-tree coupling) so it works on the /ai page.
 * Chrome (name / close) lives in the panel's tab strip, not here.
 */
function CitationDocView({ doc }: { doc: CitationDoc }): ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [highlightQuery, setHighlightQuery] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch the file bytes once per file.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFile(null);
    void fetchFile(
      `/collections/items/${doc.fileId}/download`,
      doc.name,
      doc.mimeType ?? 'application/pdf',
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
  }, [doc.fileId, doc.name, doc.mimeType]);

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
    <div className='flex h-full w-full flex-col ai-page-bg'>
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
            fileName={doc.name}
            {...(doc.page ? { initialPage: doc.page } : {})}
            {...(highlightQuery ? { highlightQuery } : {})}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Right-side panel on the /ai page. Shows one open citation doc at a time, with a
 * tab strip to switch between them. All open docs stay mounted (inactive ones
 * hidden) so their scroll position / highlight survive a tab switch — mirrors
 * xyne-search's CitationPanel. Renders nothing when no doc is open.
 */
export function CitationDocsPanel(): ReactElement | null {
  const ctx = useCitationDocs();
  if (!ctx || ctx.docs.length === 0) return null;
  const { docs, activeFileId, setActive, closeDoc } = ctx;
  const active = activeFileId ?? docs[docs.length - 1]?.fileId ?? null;

  return (
    <div className='flex h-full w-full flex-col border-l border-border ai-page-bg'>
      {/* Tab strip — one tab per open doc; click to switch, ✕ to close. */}
      <div className='flex h-9 flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2'>
        {docs.map(doc => {
          const isActive = doc.fileId === active;
          return (
            <div
              key={doc.fileId}
              className={cn(
                'flex h-7 max-w-[220px] flex-shrink-0 items-center rounded pr-1 transition-colors',
                isActive ? 'bg-secondary' : 'hover:bg-secondary/60',
              )}
            >
              <button
                type='button'
                aria-pressed={isActive}
                title={doc.name}
                onClick={() => setActive(doc.fileId)}
                className={cn(
                  'flex h-7 min-w-0 items-center pl-2 pr-1 text-[12px]',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
                data-track-category='ask-ai'
                data-track-name='citation-doc-tab-select'
              >
                <span className='truncate'>{doc.name}</span>
              </button>
              <button
                type='button'
                aria-label={`Close ${doc.name}`}
                onClick={() => closeDoc(doc.fileId)}
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

      {/* Stacked viewers — only the active one is visible; the rest stay mounted
          (hidden) so switching tabs doesn't reload the PDF or lose scroll. */}
      <div className='relative min-h-0 flex-1'>
        {docs.map(doc => {
          const isActive = doc.fileId === active;
          return (
            <div
              key={doc.fileId}
              aria-hidden={!isActive}
              style={{
                visibility: isActive ? 'visible' : 'hidden',
                pointerEvents: isActive ? 'auto' : 'none',
              }}
              className='absolute inset-0'
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
 * With no docs open it renders the chat full-width. Must be rendered inside a
 * `CitationDocsProvider`.
 */
export function ChatWithCitationDocs({ children }: { children: ReactNode }): ReactElement {
  const ctx = useCitationDocs();
  const hasDocs = !!ctx && ctx.docs.length > 0;
  if (!hasDocs) return <>{children}</>;
  return (
    <PanelGroup direction='horizontal' autoSaveId='ai-citation-docs' className='h-full w-full'>
      <Panel defaultSize={55} minSize={30} className='min-w-0'>
        {children}
      </Panel>
      <PanelResizeHandle className='w-px bg-border transition-colors hover:bg-primary/40 data-[resize-handle-state=drag]:bg-primary/60' />
      <Panel defaultSize={45} minSize={25} className='min-w-0'>
        <CitationDocsPanel />
      </Panel>
    </PanelGroup>
  );
}

export default CitationDocsPanel;
