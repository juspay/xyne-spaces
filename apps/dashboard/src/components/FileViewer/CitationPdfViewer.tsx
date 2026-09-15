/**
 * CitationPdfViewer
 *
 * A self-contained PDF viewer for citation previews.
 * Deliberately does NOT use the XState pdfMachine — heights are computed
 * sequentially inside onDocumentLoadSuccess (mirroring the reference KB
 * CitationPreview), so the virtualizer already has correct offsets by the
 * time the initial-page scroll fires.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { DocumentOperations } from '../../contexts/DocumentOperationsContext';

// --------------------------------------------------------------------- types

interface CitationPdfViewerProps {
  /** File or Blob — already fetched by the parent. */
  source: File | Blob;
  /**
   * 1-based page number to open at.
   * If omitted the document opens at page 1.
   */
  initialPage?: number;
  /** Ref to expose goToPage / waitForPageReady for the highlight pipeline. */
  documentOperationsRef?: React.RefObject<DocumentOperations>;
}

// -------------------------------------------------------------- PageWrapper

const PageWrapper = memo(
  ({
    pageNumber,
    scale,
    onCanvas,
    onText,
    onAnno,
  }: {
    pageNumber: number;
    scale: number;
    onCanvas?: () => void;
    onText?: () => void;
    onAnno?: () => void;
  }) => (
    <Page
      pageNumber={pageNumber}
      scale={scale}
      renderTextLayer
      renderAnnotationLayer
      {...(onCanvas && { onRenderSuccess: onCanvas })}
      onRenderTextLayerSuccess={() => requestAnimationFrame(() => onText?.())}
      onRenderAnnotationLayerSuccess={() => requestAnimationFrame(() => onAnno?.())}
      className='shadow-lg'
    />
  ),
  (prev, next) => prev.pageNumber === next.pageNumber && prev.scale === next.scale,
);
PageWrapper.displayName = 'CitationPageWrapper';

// ----------------------------------------------------------- CitationPdfViewer

export const CitationPdfViewer: React.FC<CitationPdfViewerProps> = ({
  source,
  initialPage = 1,
  documentOperationsRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  // Track per-page readiness: canvas + text + annotation layers
  const pageReadyRef = useRef<Record<number, { canvas?: boolean; text?: boolean; anno?: boolean }>>(
    {},
  );

  // Reset readiness on new document
  const markPage = useCallback((page: number, layer: 'canvas' | 'text' | 'anno') => {
    const cur = pageReadyRef.current[page] ?? {};
    pageReadyRef.current[page] = { ...cur, [layer]: true };
  }, []);

  const [numPages, setNumPages] = useState<number | null>(null);
  const [heightMap, setHeightMap] = useState<number[]>([]);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentVisiblePage, setCurrentVisiblePage] = useState(initialPage);
  const [pageInput, setPageInput] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // --------------------------------------------------------- scale calculation

  const calculateScale = useCallback((pageWidth: number): number => {
    const container = containerRef.current;
    if (!container) return 1.2;
    const availableWidth = container.clientWidth - 32; // 16px padding each side
    const fit = availableWidth / pageWidth;
    return Math.max(0.5, Math.min(2.0, fit));
  }, []);

  // ---------------------------------------------------------- height map

  const computeHeightMap = useCallback(
    async (doc: PDFDocumentProxy, s: number): Promise<number[]> => {
      const heights: number[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        if (!isMountedRef.current) break;
        try {
          const page = await doc.getPage(i + 1);
          const vp = page.getViewport({ scale: s });
          heights[i] = vp.height;
          page.cleanup?.();
        } catch {
          heights[i] = Math.round(792 * s);
        }
      }
      return heights;
    },
    [],
  );

  // ---------------------------------------------------------- virtualizer

  const rowVirtualizer = useVirtualizer({
    count: numPages ?? 0,
    getScrollElement: () => containerRef.current,
    estimateSize: index => heightMap[index] ?? Math.round(792 * scale),
    measureElement: el => el.getBoundingClientRect().height,
    overscan: 6,
  });

  // -------------------------------------------------------- scroll tracking

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !numPages) return;

    const onScroll = (): void => {
      const viewportCenter = el.scrollTop + el.clientHeight / 2;
      const items = rowVirtualizer.getVirtualItems();
      if (!items.length) return;

      let best = items[0];
      let bestDist = Infinity;
      for (const it of items) {
        const center = it.start + it.size / 2;
        const dist = Math.abs(center - viewportCenter);
        if (dist < bestDist) {
          bestDist = dist;
          best = it;
        }
      }
      if (!best) return;
      const page = best.index + 1;
      setCurrentVisiblePage(prev => (prev === page ? prev : page));
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [numPages, rowVirtualizer]);

  // ------------------------------------------ onDocumentLoadSuccess (key!)

  const onDocumentLoadSuccess = useCallback(
    async (pdfDoc: PDFDocumentProxy) => {
      if (!isMountedRef.current) return;

      const { numPages: total } = pdfDoc;
      setNumPages(total);

      // 1. Derive scale from first page
      let finalScale = scale;
      try {
        const firstPage = await pdfDoc.getPage(1);
        if (!isMountedRef.current) {
          firstPage.cleanup?.();
          return;
        }
        const vp = firstPage.getViewport({ scale: 1 });
        firstPage.cleanup?.();
        if (!isMountedRef.current) return;
        finalScale = calculateScale(vp.width);
        setScale(finalScale);
      } catch {
        /* keep default scale */
      }

      // 2. Compute per-page heights (sequential, accurate)
      try {
        const heights = await computeHeightMap(pdfDoc, finalScale);
        if (!isMountedRef.current) return;
        setHeightMap(heights);
      } catch {
        /* continue without height map */
      }

      if (!isMountedRef.current) return;

      // 3. Mark loaded — virtualizer now has correct estimateSize data
      setLoading(false);
      pageReadyRef.current = {}; // reset readiness for new document

      const validPage = Math.min(Math.max(1, initialPage), total);
      setCurrentVisiblePage(validPage);

      if (validPage > 1) {
        // One setTimeout so React flushes the setHeightMap update before scroll
        setTimeout(() => {
          if (isMountedRef.current) {
            rowVirtualizer.scrollToIndex(validPage - 1, { align: 'start' });
          }
        }, 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialPage, calculateScale, computeHeightMap, rowVirtualizer],
  );

  // --------------------------------------------------------- navigation

  const goToPage = useCallback(
    (page: number): void => {
      if (!numPages || page < 1 || page > numPages) return;
      rowVirtualizer.scrollToIndex(page - 1, { align: 'start' });
      setCurrentVisiblePage(page);
    },
    [numPages, rowVirtualizer],
  );

  // ---- expose goToPage + waitForPageReady on documentOperationsRef ----
  useEffect(() => {
    const ops = documentOperationsRef?.current;
    if (!ops) return;

    ops.goToPage = (pageIndex: number): Promise<void> => {
      // pageIndex is 0-based (useScopedFind convention)
      goToPage(pageIndex + 1);
      return Promise.resolve();
    };

    ops.waitForPageReady = async (pageIndex: number) => {
      const pageNum = pageIndex + 1;

      const isDone = () => {
        const s = pageReadyRef.current[pageNum];
        return !!s?.canvas && !!s?.text && !!s?.anno;
      };

      if (isDone()) {
        await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        return;
      }

      // Poll up to 5 s
      const maxMs = 5000;
      const start = Date.now();
      while (!isDone() && isMountedRef.current && Date.now() - start < maxMs) {
        await new Promise(r => setTimeout(r, 16));
      }
      // Two frames after all layers agree
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    };

    return () => {
      if (documentOperationsRef?.current) {
        delete documentOperationsRef.current.goToPage;
        delete documentOperationsRef.current.waitForPageReady;
      }
    };
  }, [documentOperationsRef, goToPage]);

  const commitPageInput = useCallback((): void => {
    if (pageInput === null) return;
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n) && n >= 1) {
      goToPage(Math.min(n, numPages ?? 1));
    }
    setPageInput(null);
  }, [pageInput, numPages, goToPage]);

  // ------------------------------------------------------- stable doc key

  const documentKey = useMemo(() => {
    if (source instanceof File) return `file-${source.name}-${source.size}`;
    if (source instanceof Blob) return `blob-${source.size}-${source.type}`;
    return 'unknown';
  }, [source]);

  // ----------------------------------------------------------------- render

  const totalSize = rowVirtualizer.getTotalSize();
  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className='relative w-full h-full flex flex-col bg-gray-100 dark:bg-[#1E1E1E]'>
      {/* Navigation bar — matches existing PdfViewer style */}
      {!loading && !error && numPages && (
        <div className='sticky top-0 bg-white dark:bg-[#1E1E1E] shadow-md z-10 p-4 border-b border-gray-200 dark:border-gray-700 w-full flex-shrink-0'>
          <div className='flex items-center justify-center'>
            <div className='flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg px-4 py-2 shadow-sm'>
              {/* eslint-disable local-rules/require-tracking-on-click */}
              <button
                onClick={() => goToPage(currentVisiblePage - 1)}
                data-track-category='FileViewer'
                data-track-name='PDF_PREV_PAGE'
                disabled={currentVisiblePage <= 1}
                className='flex items-center gap-1 px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors'
              >
                <span className='text-lg'>‹</span>
                <span>Previous</span>
              </button>

              <div className='w-px h-4 bg-gray-300 dark:bg-gray-600 mx-3' />

              <div className='flex items-center gap-2'>
                <span className='text-sm text-gray-500 dark:text-gray-400'>Page</span>
                <input
                  type='number'
                  min={1}
                  max={numPages}
                  value={pageInput !== null ? pageInput : String(currentVisiblePage)}
                  onChange={e => setPageInput(e.target.value)}
                  onFocus={e => {
                    e.currentTarget.select();
                    setPageInput(String(currentVisiblePage));
                  }}
                  onBlur={commitPageInput}
                  onKeyDown={e => {
                    // eslint-disable-line @typescript-eslint/no-misused-promises
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitPageInput();
                    } else if (e.key === 'Escape') setPageInput(null);
                  }}
                  className='w-16 px-2 py-1 text-sm text-center bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                />
                <span className='text-sm text-gray-500 dark:text-gray-400'>of {numPages}</span>
              </div>

              <div className='w-px h-4 bg-gray-300 dark:bg-gray-600 mx-3' />

              <button
                onClick={() => goToPage(currentVisiblePage + 1)}
                data-track-category='FileViewer'
                data-track-name='PDF_NEXT_PAGE'
                disabled={currentVisiblePage >= numPages}
                className='flex items-center gap-1 px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors'
              >
                <span>Next</span>
                <span className='text-lg'>›</span>
              </button>
              {/* eslint-enable local-rules/require-tracking-on-click */}
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className='flex items-center justify-center flex-1 p-8'>
          <div className='animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600' />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className='flex items-center justify-center flex-1 p-6'>
          <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 max-w-md'>
            <p className='text-red-800 dark:text-red-200 font-semibold'>Failed to load PDF</p>
            <p className='text-red-600 dark:text-red-300 text-sm mt-1'>{error}</p>
          </div>
        </div>
      )}

      {/* Scrollable PDF container */}
      {!error && (
        <div
          ref={containerRef}
          className={`flex-1 overflow-y-auto p-4 ${loading ? 'invisible' : ''}`}
          style={{ scrollBehavior: 'auto' }}
        >
          <Document
            key={documentKey}
            file={source}
            onLoadSuccess={pdfDoc => {
              void onDocumentLoadSuccess(pdfDoc);
            }}
            onLoadError={e => {
              setError(e.message);
              setLoading(false);
            }}
            loading={null}
          >
            <div style={{ height: totalSize, position: 'relative' }}>
              {virtualItems.map(vi => (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vi.start}px)`,
                    display: 'flex',
                    justifyContent: 'center',
                    paddingBottom: 16,
                  }}
                >
                  <PageWrapper
                    pageNumber={vi.index + 1}
                    scale={scale}
                    onCanvas={() => markPage(vi.index + 1, 'canvas')}
                    onText={() => markPage(vi.index + 1, 'text')}
                    onAnno={() => markPage(vi.index + 1, 'anno')}
                  />
                </div>
              ))}
            </div>
          </Document>
        </div>
      )}
    </div>
  );
};

export default CitationPdfViewer;
