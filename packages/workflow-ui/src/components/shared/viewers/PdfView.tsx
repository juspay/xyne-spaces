// PDF viewer built on pdf.js's native `PDFViewer` component (the same
// renderer Firefox ships) — ported from the xyne app's `PdfViewer` so the
// SDK renders documents exactly like the rest of the product.
//
// Why pdf.js's viewer (and not react-pdf): react-pdf flickers on
// virtualized scroll because page heights are estimated up-front and
// remeasured on mount, plus pages unmount on overscan (white flashes on
// scroll-back). pdf.js's PDFViewer pre-measures every page from the PDF's
// viewport, keeps a buffer of rendered pages, has built-in text-layer
// rendering, and ships its own findController.
//
// It also replaces the browser's native <iframe> plugin, which forces a
// dark chrome + page-thumbnail rail that can't be restyled.
//
// Styling is driven entirely by the SDK's `--wui-*` theme tokens, so
// whatever the host application defines flows into this viewer.
//
// React's job here is just:
//   1. Mount the viewer once when the file URL changes.
//   2. Bridge our toolbar (page input, zoom, search) to viewer events.
//   3. Tear down on unmount.
//
// Imperative wiring is small but unavoidable because the viewer manages
// its own DOM; we don't try to fight that.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer as PdfjsViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import {
  ChevronUp,
  ChevronDown,
  Download,
  Loader2,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react';

// Worker is served by the host app from its public root. pdf.js's default
// route-relative resolution 404s into an SPA fallback, so pin an absolute
// path. Re-asserted inside the component for bundler-tree-shaking safety.
const PDF_WORKER_URL = '/pdf.worker.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

// pdf.js's getDocument options. withCredentials so the browser ships the
// same auth cookies as fetch().
type GetDocOpts = { url: string; withCredentials: boolean };

// pdf.js FindState values — exported at runtime but absent from the type
// declarations, so mirrored here.
const FIND_NOT_FOUND = 1;
const FIND_PENDING = 3;

/**
 * When a highlight phrase spans a page break, find where it splits: the
 * longest word-boundary head that appears on one page whose tail appears on
 * the following page. Returns the two fragments (both individually findable,
 * so a `query: [head, tail]` array search highlights the value on BOTH
 * pages), or null when the value doesn't split cleanly across two pages.
 */
async function computePageSplit(
  doc: PDFDocumentProxy,
  value: string,
): Promise<[string, string] | null> {
  const normWS = (s: string) => s.replace(/\s+/g, ' ').trim();
  const v = normWS(value);
  const words = v.split(' ');
  if (words.length < 2) return null;
  // Text of each page, whitespace-normalized. Capped for very large docs —
  // this only runs on the miss path, and a citation far past 50 pages can
  // still fall back to the prefix ladder.
  const pageTexts: string[] = [];
  const maxPages = Math.min(doc.numPages, 50);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pageTexts.push(normWS(tc.items.map((it) => ('str' in it ? it.str : '')).join(' ')));
  }
  // Whole value present on a single page → not a page-split problem.
  if (pageTexts.some((p) => p.includes(v))) return null;
  for (let i = 0; i < pageTexts.length - 1; i++) {
    for (let k = words.length - 1; k >= 1; k--) {
      const head = words.slice(0, k).join(' ');
      const tail = words.slice(k).join(' ');
      if (pageTexts[i]!.includes(head) && pageTexts[i + 1]!.includes(tail)) {
        return [head, tail];
      }
    }
  }
  return null;
}

/**
 * Progressively shorter prefixes of a highlight phrase, longest first.
 *
 * pdf.js's find controller matches within a single page's text, so a value
 * that spans pages (or whose middle drifted in OCR) never matches as a
 * whole. The page-split search above is tried first; this ladder is the
 * last-resort fallback — the *start* of the value is on the cited page by
 * definition, so shorter heads eventually highlight something.
 */
function buildQueryLadder(value: string): string[] {
  const words = value.trim().split(/\s+/);
  const ladder: string[] = [];
  for (const n of [words.length, 6, 4, 3, 2]) {
    if (n < 2 || n > words.length) continue;
    const q = words.slice(0, n).join(' ');
    if (q.length >= 4 && !ladder.includes(q)) ladder.push(q);
  }
  return ladder.length ? ladder : [value.trim()];
}

export interface PdfViewProps {
  /** Same-origin URL for the raw PDF bytes (cookie auth). */
  url: string;
  /** Display name shown in the toolbar and used for the download filename. */
  name?: string | undefined;
  /** 1-indexed page to scroll to on first load (e.g. a citation's pageNumber). */
  initialPage?: number | undefined;
  /**
   * Initial zoom. A number is a literal scale (1 = 100%); the named pdf.js
   * modes fit the page to the container. Defaults to `'page-width'` because
   * this viewer is embedded in a narrow, resizable side panel — a literal
   * 100% would overflow horizontally. Named modes re-fit on container resize;
   * once the user zooms manually we stop re-fitting.
   */
  initialScale?: number | 'page-width' | 'page-fit' | 'page-actual' | 'auto' | undefined;
  /**
   * Bump this to re-jump to `initialPage` even when the value didn't change —
   * lets a host pull the user back to the cited page on re-click. Also
   * re-applies `highlightQuery`.
   */
  navSeq?: number | undefined;
  /**
   * When provided, prefills the Find input and pdf.js's findController
   * highlights matches in the text layer.
   */
  highlightQuery?: string | null | undefined;
  /** Leading slot in the toolbar (e.g. a Back button). */
  leading?: ReactNode;
  /** Optional right-side companion rendered alongside the scroll area. */
  rightSlot?: ReactNode;
  /** Extreme-right Close button — only when the host wants a dismiss affordance. */
  onClose?: (() => void) | undefined;
  /** Hide the Download link. */
  hideDownload?: boolean | undefined;
}

const iconBtn =
  'grid h-7 w-7 place-items-center rounded-[var(--wui-radius-sm)] text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)] disabled:cursor-not-allowed disabled:opacity-40';

export default function PdfView({
  url,
  name = 'Document',
  initialPage,
  initialScale = 'page-width',
  navSeq,
  highlightQuery,
  leading,
  rightSlot,
  onClose,
  hideDownload = false,
}: PdfViewProps) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

  const containerRef = useRef<HTMLDivElement | null>(null);
  // pdf.js requires a separate inner div with class `pdfViewer` to hold the
  // page wrappers — the outer `containerRef` is the scroll element.
  const viewerInnerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<{
    viewer: PdfjsViewer;
    eventBus: EventBus;
    findController: PDFFindController;
    loadingTask: { destroy: () => Promise<void> } | null;
    pdfDoc: { destroy: () => Promise<void> } | null;
  } | null>(null);
  // Last navSeq we honored so re-renders don't keep yanking the user back.
  const lastJumpRef = useRef<string | null>(null);
  const lastHighlightRef = useRef<string | null>(null);
  // Read inside the viewer effect without making them dependencies (a change
  // must not tear down and rebuild the viewer).
  const initialScaleRef = useRef(initialScale);
  initialScaleRef.current = initialScale;
  const initialPageRef = useRef(initialPage);
  initialPageRef.current = initialPage;
  const navSeqRef = useRef(navSeq);
  navSeqRef.current = navSeq;
  // Auto-highlight fallback state: the query we injected (null once the user
  // types their own), the full value for page-split detection, the remaining
  // shorter prefixes to try, and guards for the async split attempt.
  const autoQueryRef = useRef<string | null>(null);
  const autoFullRef = useRef<string | null>(null);
  const autoLadderRef = useRef<string[]>([]);
  const splitTriedRef = useRef(false);
  const splitBusyRef = useRef(false);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scalePct, setScalePct] = useState(100);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState('1');
  const [pageInputFocused, setPageInputFocused] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!pageInputFocused) setPageInput(String(currentPage));
  }, [currentPage, pageInputFocused]);

  const fileUrl = /^https?:/i.test(url) ? url : `${window.location.origin}${url}`;

  // Drop the caller's highlight phrase into Find; re-apply on navSeq bump.
  // Arms the split/prefix fallbacks so a phrase that spans a page break (or
  // drifted in OCR) still highlights on the cited page. The signature
  // includes the file URL so switching this instance to another document
  // re-arms the auto-highlight for it.
  useEffect(() => {
    if (loadState !== 'ready') return;
    const sig = `${fileUrl}#${highlightQuery ?? ''}#${String(navSeq ?? 0)}`;
    if (lastHighlightRef.current === sig) return;
    lastHighlightRef.current = sig;
    if (highlightQuery && highlightQuery.length >= 2) {
      const ladder = buildQueryLadder(highlightQuery);
      const first = ladder[0] ?? highlightQuery;
      autoQueryRef.current = first;
      autoFullRef.current = highlightQuery;
      autoLadderRef.current = ladder.slice(1);
      splitTriedRef.current = false;
      setQuery(first);
    }
  }, [fileUrl, highlightQuery, navSeq, loadState]);

  // ── Viewer lifecycle ──────────────────────────────────────────────────
  // Construct once per URL. The viewer owns its DOM subtree; we just hand it
  // the container + scroll element. Destroy on unmount to release the
  // worker-side document and any page render tasks.
  useEffect(() => {
    const container = containerRef.current;
    const viewerInner = viewerInnerRef.current;
    if (!container || !viewerInner) return undefined;

    setLoadState('loading');
    setLoadError(null);
    setNumPages(0);
    setCurrentPage(1);
    lastJumpRef.current = null;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PdfjsViewer({
      container,
      viewer: viewerInner,
      eventBus,
      linkService,
      findController,
      // Hidden text layer is required for search highlighting.
      textLayerMode: 2,
      // Disable annotation editing/forms — this viewer is read-only.
      annotationEditorMode: -1,
    });
    linkService.setViewer(viewer);

    eventBus.on('pagesinit', () => {
      // Fit-to-width by default: this viewer lives in a narrow side panel, so
      // a literal 100% would overflow. Named modes also let us re-fit on
      // resize. The centering CSS keeps the page middled when it's narrower.
      viewer.currentScaleValue = String(initialScaleRef.current);
      setScalePct(Math.round((viewer.currentScale ?? 1) * 100));
      // Land directly on the cited page. Setting it here — inside pagesinit,
      // before the first paint — means page 1 is never rendered; a post-ready
      // React effect would jump only after page 1 had flashed. (This is how
      // pdf.js's own viewer applies its #page= hash.) The jump effect below
      // stays for navSeq re-jumps; marking lastJumpRef stops it re-firing.
      const target = initialPageRef.current;
      if (target && target >= 1 && target <= viewer.pagesCount) {
        viewer.currentPageNumber = target;
        lastJumpRef.current = `${String(target)}#${String(navSeqRef.current ?? 0)}`;
      }
    });
    eventBus.on('pagechanging', (evt: { pageNumber: number }) => {
      setCurrentPage(evt.pageNumber);
    });
    eventBus.on('scalechanging', (evt: { scale: number }) => {
      setScalePct(Math.round(evt.scale * 100));
    });
    // Auto-highlight fallback: when the query we injected finds nothing
    // (value spans a page break / OCR drift), first try to SPLIT the value at
    // the actual page boundary and search both fragments at once (pdf.js
    // accepts a query array — highlights land on both pages); only if no
    // clean split exists, step down the prefix ladder. User-typed queries
    // never trigger any of this — typing clears autoQueryRef.
    const stepLadder = () => {
      const next = autoLadderRef.current.shift();
      if (next) {
        autoQueryRef.current = next;
        setQuery(next);
      } else {
        autoQueryRef.current = null; // exhausted — leave Find as-is
      }
    };
    const handleAutoNotFound = async () => {
      if (splitBusyRef.current) return;
      if (!splitTriedRef.current && autoFullRef.current && pdfDocRef.current) {
        splitTriedRef.current = true;
        splitBusyRef.current = true;
        try {
          const frags = await computePageSplit(pdfDocRef.current, autoFullRef.current);
          // Re-check auto mode — the user may have typed meanwhile.
          if (frags && autoQueryRef.current) {
            autoQueryRef.current = frags.join(' ');
            eventBus.dispatch('find', {
              source: null,
              type: '',
              query: frags,
              highlightAll: true,
              findPrevious: false,
              caseSensitive: false,
              entireWord: false,
            });
            return;
          }
        } catch {
          /* split is best-effort — fall through to the ladder */
        } finally {
          splitBusyRef.current = false;
        }
      }
      stepLadder();
    };
    eventBus.on('updatefindcontrolstate', (evt: { state: number; rawQuery?: string | null }) => {
      if (evt.state === FIND_PENDING) return;
      const auto = autoQueryRef.current;
      if (!auto) return;
      if (typeof evt.rawQuery === 'string' && evt.rawQuery !== auto) return;
      if (evt.state === FIND_NOT_FOUND) {
        void handleAutoNotFound();
      } else {
        autoLadderRef.current = []; // found — stop stepping down
      }
    });

    const loadingTask = pdfjsLib.getDocument({
      url: fileUrl,
      withCredentials: true,
    } as GetDocOpts);

    let cancelled = false;
    void loadingTask.promise
      .then((pdfDoc) => {
        if (cancelled) return;
        viewer.setDocument(pdfDoc);
        linkService.setDocument(pdfDoc, null);
        pdfDocRef.current = pdfDoc;
        setNumPages(pdfDoc.numPages);
        setLoadState('ready');
        instanceRef.current = {
          viewer,
          eventBus,
          findController,
          loadingTask: loadingTask as unknown as { destroy: () => Promise<void> },
          pdfDoc: pdfDoc as unknown as { destroy: () => Promise<void> },
        };
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      });

    return () => {
      cancelled = true;
      pdfDocRef.current = null;
      const inst = instanceRef.current;
      instanceRef.current = null;
      // Best-effort cleanup — destroy() returns a promise but we don't wait.
      void inst?.loadingTask?.destroy().catch(() => undefined);
      void inst?.pdfDoc?.destroy().catch(() => undefined);
      try {
        viewer.cleanup();
      } catch {
        /* no-op */
      }
    };
  }, [fileUrl]);

  // ── Re-jump to a page on navSeq bump ──────────────────────────────────
  // The *initial* landing happens in pagesinit (pre-paint, no page-1 flash);
  // this effect only handles later navSeq bumps (host re-clicks a citation),
  // plus the fallback where pagesinit couldn't honor the target.
  useEffect(() => {
    if (loadState !== 'ready' || !initialPage || numPages === 0) return;
    const sig = `${String(initialPage)}#${String(navSeq ?? 0)}`;
    if (lastJumpRef.current === sig) return;
    lastJumpRef.current = sig;
    if (initialPage > numPages) return;
    const viewer = instanceRef.current?.viewer;
    if (!viewer) return;
    viewer.currentPageNumber = initialPage;
  }, [loadState, initialPage, navSeq, numPages]);

  // ── Re-fit on container resize ────────────────────────────────────────
  // The host panel is user-resizable. While the scale is a *named* pdf.js
  // mode ('page-width' etc.), reassigning it recomputes the fit. Once the
  // user zooms manually the value becomes numeric and we leave it alone.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const ro = new ResizeObserver(() => {
      const viewer = instanceRef.current?.viewer;
      const current = viewer?.currentScaleValue;
      if (!viewer || !current || !Number.isNaN(Number(current))) return;
      viewer.currentScaleValue = current;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Trackpad pinch-to-zoom + Ctrl/Cmd-wheel zoom ──────────────────────
  // Browsers translate pinch gestures into `wheel` events with ctrlKey:true.
  // Passive:false so preventDefault() fires — otherwise the page zooms.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const viewer = instanceRef.current?.viewer;
      if (!viewer) return;
      const current = viewer.currentScale ?? 1;
      const step = Math.max(-0.5, Math.min(0.5, -e.deltaY * 0.01));
      viewer.currentScaleValue = String(Math.max(0.25, Math.min(5, current + step)));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // ── Find/search ───────────────────────────────────────────────────────
  useEffect(() => {
    if (loadState !== 'ready') return;
    const eb = instanceRef.current?.eventBus;
    if (!eb) return;
    const trimmed = query.trim();
    eb.dispatch('find', {
      source: null,
      type: '',
      query: trimmed.length < 2 ? '' : trimmed,
      highlightAll: trimmed.length >= 2,
      findPrevious: false,
      caseSensitive: false,
      entireWord: false,
    });
  }, [query, loadState]);

  // ── Toolbar handlers ──────────────────────────────────────────────────
  const goToPage = useCallback((n: number): void => {
    const viewer = instanceRef.current?.viewer;
    if (!viewer) return;
    viewer.currentPageNumber = Math.max(1, Math.min(viewer.pagesCount, n));
  }, []);

  const commitPageInput = useCallback((): void => {
    const n = Number(pageInput);
    if (Number.isInteger(n) && n >= 1 && numPages > 0 && n <= numPages) goToPage(n);
    else setPageInput(String(currentPage));
  }, [pageInput, numPages, goToPage, currentPage]);

  const zoom = useCallback((delta: number): void => {
    const viewer = instanceRef.current?.viewer;
    if (!viewer) return;
    viewer.currentScaleValue = String(
      Math.max(0.25, Math.min(5, (viewer.currentScale ?? 1) + delta)),
    );
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--wui-bg)]">
      {/* Toolbar. The host panel is resizable from 280px up, so the full
          control set can't always sit on one row. Rather than clip (or wrap
          mid-group, orphaning a lone "+"), the controls are grouped into
          atomic clusters that only ever wrap at their boundaries. The zoom
          percentage — the one purely informational control — drops out via a
          container query when even that isn't enough.

          The filename is intentionally not shown: hosts already label the
          document (e.g. the origin panel's tab); `name` only feeds download. */}
      <div className="wui-pdf-toolbar relative flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1.5 border-b border-[var(--wui-border)] px-3 py-2">
        {/* `leading` is taken out of flow so it can't pull the clusters
            off-centre (they wrap and would otherwise absorb the slack). */}
        {leading && (
          <div className="absolute left-3 top-1/2 flex min-w-0 -translate-y-1/2 items-center gap-2">
            {leading}
          </div>
        )}

        {/* Cluster: in-PDF search */}
        <div className="relative shrink-0">
          <Search
            className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--wui-fg-muted)]"
            aria-hidden
            strokeWidth={2}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              // The user took over the Find box — disarm the auto fallback.
              autoQueryRef.current = null;
              autoLadderRef.current = [];
              setQuery(e.target.value);
            }}
            placeholder="Find"
            aria-label="Find in document"
            // Reserve room for the clear button only while there is a query —
            // buys back the pixels the cluster separators cost.
            className={`h-7 w-[84px] rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] pl-6 ${
              query.length > 0 ? 'pr-6' : 'pr-2'
            } text-[12px] text-[var(--wui-fg)] outline-none transition placeholder:text-[var(--wui-fg-muted)] focus:border-[var(--wui-primary)]`}
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
            >
              <X className="h-3 w-3" aria-hidden strokeWidth={2} />
            </button>
          )}
        </div>

        <span className="wui-pdf-sep h-4 w-px shrink-0 bg-[var(--wui-border)]" aria-hidden />

        {/* Cluster: page navigation */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
            className={iconBtn}
          >
            <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <div className="flex items-center gap-0.5 text-[12px] tabular-nums text-[var(--wui-fg-muted)]">
            <input
              type="text"
              inputMode="numeric"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
              onFocus={(e) => {
                setPageInputFocused(true);
                e.target.select();
              }}
              onBlur={() => {
                setPageInputFocused(false);
                commitPageInput();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  setPageInput(String(currentPage));
                  e.currentTarget.blur();
                }
              }}
              disabled={numPages === 0}
              aria-label="Go to page"
              className="h-7 w-10 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] text-center text-[12px] tabular-nums text-[var(--wui-fg)] outline-none transition focus:border-[var(--wui-primary)] disabled:opacity-40"
            />
            <span aria-hidden>/</span>
            <span className="min-w-[20px] text-center">{numPages > 0 ? String(numPages) : '—'}</span>
          </div>
          <button
            type="button"
            aria-label="Next page"
            disabled={numPages > 0 && currentPage >= numPages}
            onClick={() => goToPage(currentPage + 1)}
            className={iconBtn}
          >
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        <span className="wui-pdf-sep h-4 w-px shrink-0 bg-[var(--wui-border)]" aria-hidden />

        {/* Cluster: zoom + actions — kept together so download/close never
            orphan onto a row of their own. */}
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => zoom(-0.1)} className={iconBtn}>
            <Minus className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <span className="wui-pdf-zoom-pct min-w-[44px] text-center text-[12px] tabular-nums text-[var(--wui-fg-muted)]">
            {`${String(scalePct)}%`}
          </span>
          <button type="button" aria-label="Zoom in" onClick={() => zoom(0.1)} className={iconBtn}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </button>

          {!hideDownload && (
            <>
              <span className="mx-0.5 h-4 w-px bg-[var(--wui-border)]" aria-hidden />
              <a href={url} download={name} aria-label="Download" className={iconBtn}>
                <Download className="h-3.5 w-3.5" strokeWidth={2} />
              </a>
            </>
          )}

          {onClose && (
            <>
              <span className="mx-0.5 h-4 w-px bg-[var(--wui-border)]" aria-hidden />
              <button type="button" aria-label="Close" onClick={onClose} className={iconBtn}>
                <X className="h-4 w-4" aria-hidden strokeWidth={2} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body: pdf.js requires absolute children, so the viewer div lives
          inside this scroll wrapper. The wrapper owns the scrollbar; the
          inner `.pdfViewer` div is what PDFViewer mutates. */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div
            ref={containerRef}
            className="pdf-host absolute inset-0 overflow-auto bg-[var(--wui-bg-subtle)] [&_.pdfViewer]:min-w-full [&_.pdfViewer_.page]:!mx-auto"
          >
            <div ref={viewerInnerRef} className="pdfViewer" />
          </div>

          {loadState === 'loading' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-[var(--wui-fg-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              Loading document…
            </div>
          )}
          {loadState === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
              <p className="text-[14px] font-medium text-[var(--wui-fg)]">
                Could not display this file
              </p>
              <p className="text-[12.5px] text-[var(--wui-fg-muted)]">{loadError}</p>
            </div>
          )}
        </div>
        {rightSlot}
      </div>
    </div>
  );
}
