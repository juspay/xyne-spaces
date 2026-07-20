// PDF viewer built on pdf.js's native `PDFViewer` (the renderer Firefox ships),
// ported from xyne-search's PdfViewer.
//
// Why pdf.js's viewer (and not react-pdf + @tanstack/react-virtual): the
// virtualized react-pdf approach estimated each page's height up-front and
// re-measured it on mount. react-pdf paints its <Page> canvas asynchronously,
// so those estimates and measurements disagreed and the error accumulated
// downward — scroll position and the page indicator desynced after ~6-7 pages.
// pdf.js's PDFViewer pre-measures every page from the PDF's own viewport, keeps
// a buffer of rendered pages, and emits exact `pagechanging` events, so the
// page number and scroll stay correct in both directions.
//
// React's job here is just to: mount the viewer once per file, bridge the
// toolbar (page input, zoom) to viewer events, and tear down on unmount.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer as PdfjsViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import { ChevronUp, ChevronDown, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { BaseViewerProps } from './utils';
import { usePlatform } from '../../hooks/usePlatform';
import { useFileSearchContext } from './search';
import { MIN_QUERY_LENGTH } from './search';

// Worker is copied to /pdfjs/pdf.worker.min.js by vite-plugin-static-copy
// (see dashboard/vite.config.ts). Assigned at module import and re-asserted
// inside the component for bundler tree-shaking safety.
const PDF_WORKER_URL = '/pdfjs/pdf.worker.min.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.1;

export const PdfViewer: React.FC<BaseViewerProps> = ({
  source,
  initialPage,
  highlightQuery,
  onInteractionStateChange,
  searchable,
}) => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

  const { isMobile } = usePlatform();
  const search = useFileSearchContext();

  // pdf.js owns PDF search: it finds across all pages (handling its own page
  // virtualisation) and scrolls/highlights the current match itself. The find
  // bar just feeds it the query and drives next/prev. Refs let the eventBus
  // listeners (registered once per file) read the latest context callbacks.
  const reportMatchStateRef = useRef(search?.reportMatchState);
  reportMatchStateRef.current = search?.reportMatchState;
  const userSearchActiveRef = useRef(false);

  const searchQuery = search?.query ?? '';
  const searchCaseSensitive = search?.options.caseSensitive ?? false;
  const searchWholeWord = search?.options.wholeWord ?? false;
  // The find bar owns `query` and clears it on close, so query length alone
  // signals a user search — matching the other viewers (no isOpen check).
  const isUserSearching = searchQuery.trim().length >= MIN_QUERY_LENGTH;
  // Latest find params for the navigator, whose closures are registered once.
  const findParamsRef = useRef({
    query: searchQuery,
    caseSensitive: searchCaseSensitive,
    wholeWord: searchWholeWord,
  });
  findParamsRef.current = {
    query: searchQuery,
    caseSensitive: searchCaseSensitive,
    wholeWord: searchWholeWord,
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  // pdf.js requires a separate inner div (class `pdfViewer`) to hold the page
  // wrappers; the outer containerRef is the scroll element.
  const viewerInnerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<{
    viewer: PdfjsViewer;
    eventBus: EventBus;
    loadingTask: { destroy: () => Promise<void> } | null;
    pdfDoc: { destroy: () => Promise<void> } | null;
  } | null>(null);

  // True once the user manually zooms, so resize stops auto-refitting to width.
  const hasManualZoomRef = useRef(false);
  // Last initialPage we honored, so re-renders don't keep yanking the user back.
  const lastJumpRef = useRef<string | null>(null);
  // Last highlight phrase dispatched to the find controller (so we don't
  // re-issue the same find on every unrelated re-render).
  const lastHighlightRef = useRef<string | null>(null);
  const onInteractionRef = useRef(onInteractionStateChange);
  onInteractionRef.current = onInteractionStateChange;

  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scalePct, setScalePct] = useState(100);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState('1');
  const [pageInputFocused, setPageInputFocused] = useState(false);
  // The active find query. Set from `highlightQuery` (citation) and fed to
  // pdf.js's find controller — mirrors xyne-search's PdfViewer.
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!pageInputFocused) setPageInput(String(currentPage));
  }, [currentPage, pageInputFocused]);

  // Stable identity so the viewer only rebuilds when the actual file changes.
  const sourceKey = source ? `${source.name}:${source.size}:${source.lastModified}` : null;

  // Report scale + horizontal scroll edges so the modal's mobile carousel knows
  // when a swipe should pan the zoomed PDF vs. change slides.
  const reportInteraction = useCallback((): void => {
    const cb = onInteractionRef.current;
    const container = containerRef.current;
    if (!cb || !container) return;
    const scale = instanceRef.current?.viewer?.currentScale ?? 1;
    const isAtLeftEdge = container.scrollLeft <= 1;
    const isAtRightEdge = container.scrollLeft + container.clientWidth >= container.scrollWidth - 1;
    cb({ scale, isAtLeftEdge, isAtRightEdge });
  }, []);

  // ── Viewer lifecycle: construct once per file ───────────────────────
  useEffect((): (() => void) | undefined => {
    const container = containerRef.current;
    const viewerInner = viewerInnerRef.current;
    if (!container || !viewerInner || !source) return undefined;

    setLoadState('loading');
    setLoadError(null);
    setNumPages(0);
    setCurrentPage(1);
    hasManualZoomRef.current = false;
    lastJumpRef.current = null;
    lastHighlightRef.current = null;
    setQuery('');

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PdfjsViewer({
      container,
      viewer: viewerInner,
      eventBus,
      linkService,
      findController,
      textLayerMode: 2,
      annotationEditorMode: -1,
    });
    linkService.setViewer(viewer);

    eventBus.on('pagesinit', (): void => {
      // Fit to width by default; users override via the zoom controls.
      viewer.currentScaleValue = 'page-width';
      setScalePct(Math.round((viewer.currentScale ?? 1) * 100));
      reportInteraction();
    });
    eventBus.on('pagechanging', (evt: { pageNumber: number }): void => {
      setCurrentPage(evt.pageNumber);
    });
    // Overlay a "Page N" badge on each page as it renders (the badge the
    // previous viewer showed in the top-right of every page).
    eventBus.on(
      'pagerendered',
      (evt: { pageNumber: number; source?: { div?: HTMLElement } }): void => {
        const pageDiv = evt.source?.div;
        if (!pageDiv) return;
        let badge = pageDiv.querySelector<HTMLDivElement>('.xyne-page-badge');
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'xyne-page-badge';
          Object.assign(badge.style, {
            position: 'absolute',
            top: '8px',
            right: '24px',
            fontSize: '0.875rem',
            lineHeight: '1.25rem',
            background: 'rgba(0,0,0,0.5)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: '4px',
            pointerEvents: 'none',
            zIndex: '10',
          });
          pageDiv.appendChild(badge);
        }
        badge.textContent = `Page ${evt.pageNumber}`;
      },
    );
    eventBus.on('scalechanging', (evt: { scale: number }): void => {
      setScalePct(Math.round(evt.scale * 100));
      reportInteraction();
    });
    // pdf.js reports match counts here as it scans pages. `current` is 1-based
    // (0 when none). Feed the find bar its N/M while the user is searching; a 0
    // total on a digital PDF that has the text usually means an image-only /
    // scanned page. Both find events carry the same matchesCount shape.
    const onFindCount = (evt: { matchesCount?: { current?: number; total?: number } }): void => {
      if (!userSearchActiveRef.current) return;
      const current = evt?.matchesCount?.current ?? 0;
      const total = evt?.matchesCount?.total ?? 0;
      reportMatchStateRef.current?.(current > 0 ? current - 1 : 0, total);
    };
    eventBus.on('updatefindmatchescount', onFindCount);
    eventBus.on('updatefindcontrolstate', onFindCount);

    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    void source
      .arrayBuffer()
      .then((buf): Promise<unknown> | undefined => {
        if (cancelled) return undefined;
        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
        return loadingTask.promise;
      })
      .then((pdfDoc): void => {
        if (cancelled || !pdfDoc) return;
        const doc = pdfDoc as { numPages: number; destroy: () => Promise<void> };
        viewer.setDocument(pdfDoc as never);
        linkService.setDocument(pdfDoc as never, null);
        setNumPages(doc.numPages);
        setLoadState('ready');
        instanceRef.current = {
          viewer,
          eventBus,
          loadingTask: loadingTask as unknown as { destroy: () => Promise<void> },
          pdfDoc: doc,
        };
      })
      .catch((err: unknown): void => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      });

    return (): void => {
      cancelled = true;
      const inst = instanceRef.current;
      instanceRef.current = null;
      void inst?.loadingTask?.destroy().catch(() => undefined);
      void inst?.pdfDoc?.destroy().catch(() => undefined);
      try {
        viewer.cleanup();
      } catch {
        /* no-op */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  // ── Initial / re-jump to a page ─────────────────────────────────────
  useEffect((): void => {
    if (loadState !== 'ready' || !initialPage || numPages === 0) return;
    const sig = String(initialPage);
    if (lastJumpRef.current === sig) return;
    const viewer = instanceRef.current?.viewer;
    if (!viewer) return;
    viewer.currentPageNumber = Math.min(Math.max(1, initialPage), numPages);
    lastJumpRef.current = sig;
  }, [loadState, initialPage, numPages]);

  // ── Citation highlight (mirrors xyne-search PdfViewer) ──────────────
  // Step 1: when the caller hands us a citation snippet, drop it into the find
  // query once the doc is ready. Track the last applied phrase so unrelated
  // re-renders don't re-issue it.
  useEffect((): void => {
    if (loadState !== 'ready') return;
    const sig = highlightQuery ?? '';
    if (lastHighlightRef.current === sig) return;
    lastHighlightRef.current = sig;
    if (highlightQuery && highlightQuery.length >= 2) {
      setQuery(highlightQuery);
    }
  }, [highlightQuery, loadState]);

  // Step 2: dispatch the query to pdf.js's find controller, which highlights
  // matches in the transparent text layer (textLayerMode: 2) and scrolls the
  // current match into view. The user's find bar takes precedence over the
  // citation snippet; when the user isn't searching, we fall back to the
  // citation query. Digital PDFs (real text layer) highlight; image-only
  // scanned PDFs won't match.
  useEffect((): void => {
    if (loadState !== 'ready') return;
    const eb = instanceRef.current?.eventBus;
    if (!eb) return;

    if (isUserSearching) {
      userSearchActiveRef.current = true;
      eb.dispatch('find', {
        source: null,
        type: '',
        query: searchQuery.trim(),
        highlightAll: true,
        findPrevious: false,
        caseSensitive: searchCaseSensitive,
        entireWord: searchWholeWord,
      });
      return;
    }

    // Not user-searching: re-assert the citation query (or clear).
    userSearchActiveRef.current = false;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      eb.dispatch('find', {
        source: null,
        type: '',
        query: '',
        highlightAll: false,
        findPrevious: false,
        caseSensitive: false,
        entireWord: false,
      });
      return;
    }
    eb.dispatch('find', {
      source: null,
      type: '',
      query: trimmed,
      highlightAll: true,
      findPrevious: false,
      caseSensitive: false,
      entireWord: false,
    });
  }, [isUserSearching, searchQuery, searchCaseSensitive, searchWholeWord, query, loadState]);

  // ── Find bar integration ────────────────────────────────────────────
  // Register as the find bar's target (so it appears for PDFs) and take over
  // next/prev by dispatching pdf.js "find again". Registered once per file;
  // the handlers read the latest query/options from a ref.
  const registerTarget = search?.registerTarget;
  const registerNavigator = search?.registerNavigator;
  useEffect((): (() => void) | undefined => {
    if (searchable === false || loadState !== 'ready' || !registerTarget || !registerNavigator) {
      return undefined;
    }
    const untarget = registerTarget();
    const dispatchAgain = (findPrevious: boolean): void => {
      const eb = instanceRef.current?.eventBus;
      const { query: q, caseSensitive, wholeWord } = findParamsRef.current;
      const trimmed = q.trim();
      if (!eb || trimmed.length < MIN_QUERY_LENGTH) return;
      eb.dispatch('find', {
        source: null,
        type: 'again',
        query: trimmed,
        highlightAll: true,
        findPrevious,
        caseSensitive,
        entireWord: wholeWord,
      });
    };
    const unnav = registerNavigator({
      next: () => dispatchAgain(false),
      prev: () => dispatchAgain(true),
    });
    return (): void => {
      untarget();
      unnav();
    };
  }, [searchable, loadState, registerTarget, registerNavigator]);

  // ── Re-jump / re-highlight when the same citation is re-clicked ─────
  // CitationLink fires this when its target equals the current URL (a no-op for
  // react-router). Snap back to the cited page and re-assert the highlight.
  useEffect((): (() => void) | undefined => {
    if (!initialPage && !highlightQuery) return undefined;
    const onRejump = (): void => {
      const viewer = instanceRef.current?.viewer;
      if (viewer && initialPage) {
        const total = viewer.pagesCount || initialPage;
        viewer.currentPageNumber = Math.min(Math.max(1, initialPage), total);
      }
      const eb = instanceRef.current?.eventBus;
      const trimmed = (highlightQuery ?? '').trim();
      if (eb && trimmed.length >= 2) {
        eb.dispatch('find', {
          source: null,
          type: '',
          query: trimmed,
          highlightAll: true,
          findPrevious: false,
          caseSensitive: false,
          entireWord: false,
        });
      }
    };
    window.addEventListener('xyne:citation-rejump', onRejump);
    return (): void => window.removeEventListener('xyne:citation-rejump', onRejump);
  }, [initialPage, highlightQuery]);

  // ── Refit to width on container resize (unless the user zoomed) ──────
  useEffect((): (() => void) | undefined => {
    const container = containerRef.current;
    if (!container) return undefined;
    const ro = new ResizeObserver((): void => {
      const viewer = instanceRef.current?.viewer;
      if (!viewer || hasManualZoomRef.current) return;
      try {
        viewer.currentScaleValue = 'page-width';
      } catch {
        /* viewer not ready yet */
      }
    });
    ro.observe(container);
    return (): void => ro.disconnect();
  }, []);

  // ── Horizontal scroll edges for carousel gesture gating ─────────────
  useEffect((): (() => void) | undefined => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onScroll = (): void => reportInteraction();
    container.addEventListener('scroll', onScroll, { passive: true });
    return (): void => container.removeEventListener('scroll', onScroll);
  }, [reportInteraction]);

  // ── Ctrl/Cmd-wheel + trackpad pinch zoom ────────────────────────────
  useEffect((): (() => void) | undefined => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const viewer = instanceRef.current?.viewer;
      if (!viewer) return;
      hasManualZoomRef.current = true;
      const current = viewer.currentScale ?? 1;
      const step = Math.max(-0.5, Math.min(0.5, -e.deltaY * 0.01));
      viewer.currentScaleValue = String(Math.max(MIN_SCALE, Math.min(MAX_SCALE, current + step)));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return (): void => container.removeEventListener('wheel', onWheel);
  }, []);

  // ── Toolbar handlers ────────────────────────────────────────────────
  const goToPage = useCallback((n: number): void => {
    const viewer = instanceRef.current?.viewer;
    if (!viewer) return;
    viewer.currentPageNumber = Math.max(1, Math.min(viewer.pagesCount, n));
  }, []);

  const commitPageInput = useCallback((): void => {
    const n = Number(pageInput);
    if (Number.isInteger(n) && n >= 1 && numPages > 0 && n <= numPages) {
      goToPage(n);
    } else {
      setPageInput(String(currentPage));
    }
  }, [pageInput, numPages, goToPage, currentPage]);

  const zoom = useCallback((delta: number): void => {
    const viewer = instanceRef.current?.viewer;
    if (!viewer) return;
    hasManualZoomRef.current = true;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (viewer.currentScale ?? 1) + delta));
    viewer.currentScaleValue = String(next);
  }, []);

  const resetZoom = useCallback((): void => {
    const viewer = instanceRef.current?.viewer;
    if (!viewer) return;
    hasManualZoomRef.current = false;
    viewer.currentScaleValue = 'page-width';
  }, []);

  if (!source) {
    return <div className='p-4'>No PDF source provided.</div>;
  }

  return (
    <div className='relative w-full h-full flex flex-col bg-gray-100 dark:bg-[#1E1E1E]'>
      {/* Navigation / zoom toolbar */}
      <div className='sticky top-0 bg-white dark:bg-[#1E1E1E] shadow-md z-10 p-4 pt-[65px] border-b border-gray-200 dark:border-gray-700 w-full flex-shrink-0'>
        <div className='flex items-center justify-center'>
          <div className='flex items-center bg-muted dark:bg-gray-700 rounded-lg px-4 py-2 shadow-sm'>
            {/* Previous page */}
            <button
              onClick={(): void => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className='flex items-center gap-1 px-3 py-1 text-sm font-medium text-foreground dark:text-muted hover:text-foreground dark:hover:text-white disabled:text-muted-foreground dark:disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors'
              title='Previous page'
              data-track-category='FileViewer'
              data-track-name='PREVIOUS_PDF_PAGE'
            >
              <ChevronUp className='h-4 w-4' />
              {!isMobile && <span>Previous</span>}
            </button>

            <div className='w-px h-4 bg-muted-foreground/50 dark:bg-gray-600 mx-3'></div>

            {/* Page display */}
            <div className='flex items-center gap-2'>
              <span className='text-sm text-muted-foreground dark:text-muted-foreground'>Page</span>
              <input
                type='text'
                inputMode='numeric'
                value={pageInput}
                onChange={(e): void => setPageInput(e.target.value.replace(/\D/g, ''))}
                onFocus={(e): void => {
                  setPageInputFocused(true);
                  e.currentTarget.select();
                }}
                onBlur={(): void => {
                  setPageInputFocused(false);
                  commitPageInput();
                }}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    setPageInput(String(currentPage));
                    e.currentTarget.blur();
                  }
                }}
                disabled={numPages === 0}
                data-track-category='FileViewer'
                data-track-name='SELECT_PDF_PAGE_INPUT'
                className='w-16 px-2 py-1 text-sm text-center bg-background dark:bg-gray-600 border border-input dark:border-gray-500 rounded text-foreground dark:text-gray-200 focus:outline-none focus:border-muted-foreground dark:focus:border-muted-foreground'
              />
              <span className='text-sm text-muted-foreground dark:text-muted-foreground'>
                of {numPages || '—'}
              </span>
            </div>

            <div className='w-px h-4 bg-muted-foreground/50 dark:bg-gray-600 mx-3'></div>

            {/* Next page */}
            <button
              onClick={(): void => goToPage(currentPage + 1)}
              disabled={numPages > 0 && currentPage >= numPages}
              className='flex items-center gap-1 px-3 py-1 text-sm font-medium text-foreground dark:text-muted hover:text-foreground dark:hover:text-white disabled:text-muted-foreground dark:disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors'
              title='Next page'
              data-track-category='FileViewer'
              data-track-name='NEXT_PDF_PAGE'
            >
              {!isMobile && <span>Next</span>}
              <ChevronDown className='h-4 w-4' />
            </button>

            {!isMobile && (
              <>
                <div className='w-px h-4 bg-muted-foreground/50 dark:bg-gray-600 mx-3'></div>

                <button
                  onClick={(): void => zoom(-ZOOM_STEP)}
                  disabled={scalePct / 100 <= MIN_SCALE}
                  className='inline-flex items-center justify-center w-8 h-8 text-foreground dark:text-muted hover:text-foreground dark:hover:text-white disabled:text-muted-foreground dark:disabled:text-muted-foreground disabled:cursor-not-allowed hover:bg-background/60 dark:hover:bg-gray-600 rounded-md transition-colors'
                  title='Zoom out'
                  aria-label='Zoom out PDF'
                  data-track-category='FileViewer'
                  data-track-name='ZOOM_OUT_PDF'
                >
                  <ZoomOut className='h-4 w-4' />
                </button>

                <span className='w-12 text-center text-sm text-muted-foreground dark:text-muted-foreground'>
                  {scalePct}%
                </span>

                <button
                  onClick={(): void => zoom(ZOOM_STEP)}
                  disabled={scalePct / 100 >= MAX_SCALE}
                  className='inline-flex items-center justify-center w-8 h-8 text-foreground dark:text-muted hover:text-foreground dark:hover:text-white disabled:text-muted-foreground dark:disabled:text-muted-foreground disabled:cursor-not-allowed hover:bg-background/60 dark:hover:bg-gray-600 rounded-md transition-colors'
                  title='Zoom in'
                  aria-label='Zoom in PDF'
                  data-track-category='FileViewer'
                  data-track-name='ZOOM_IN_PDF'
                >
                  <ZoomIn className='h-4 w-4' />
                </button>

                <button
                  onClick={resetZoom}
                  className='inline-flex items-center justify-center w-8 h-8 text-foreground dark:text-muted hover:text-foreground dark:hover:text-white hover:bg-background/60 dark:hover:bg-gray-600 rounded-md transition-colors'
                  title='Fit to width'
                  aria-label='Fit PDF to width'
                  data-track-category='FileViewer'
                  data-track-name='RESET_PDF_ZOOM'
                >
                  <Maximize2 className='h-4 w-4' />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Scroll area — pdf.js mutates the inner `.pdfViewer` div; the outer
          absolute container owns the scrollbar. */}
      <div className='relative flex-1 min-h-0'>
        <div
          ref={containerRef}
          className='absolute inset-0 overflow-auto [&_.pdfViewer]:min-w-full [&_.pdfViewer_.page]:!mx-auto'
        >
          <div ref={viewerInnerRef} className='pdfViewer' />
        </div>

        {loadState === 'loading' && (
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80 dark:bg-black/50'>
            <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-gray-700 dark:border-input'></div>
          </div>
        )}
        {loadState === 'error' && (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center text-red-600'>
            <p className='font-semibold'>Failed to load PDF</p>
            <p className='text-sm'>{loadError}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfViewer;
