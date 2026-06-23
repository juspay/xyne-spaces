import React, { useEffect, useRef, memo, useState, useCallback } from 'react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { useMachine } from '@xstate/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import pdfMachine from '../../machines/pdfMachine';
import { BaseViewerProps } from './utils';
import { usePlatform } from '../../hooks/usePlatform';
import { useMobileZoom } from '../../hooks/useMobileZoom';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

// Memoized PageWrapper to prevent unnecessary re-renders
const PageWrapper = memo(
  ({ pageNumber, scale }: { pageNumber: number; scale: number }) => (
    <Page
      pageNumber={pageNumber}
      scale={scale}
      renderTextLayer
      renderAnnotationLayer
      className='shadow-lg'
    />
  ),
  (prev, next) => prev.pageNumber === next.pageNumber && prev.scale === next.scale,
);
PageWrapper.displayName = 'PageWrapper';

const MIN_DESKTOP_SCALE = 0.5;
const MAX_DESKTOP_SCALE = 3;
const DESKTOP_ZOOM_STEP = 0.25;

export const PdfViewer: React.FC<BaseViewerProps> = ({
  source,
  initialPage,
  onInteractionStateChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfContentRef = useRef<HTMLDivElement>(null);
  const containerSizeRef = useRef<{ width: number; height: number } | null>(null);
  const hasManualDesktopZoomRef = useRef(false);
  const [currentVisiblePage, setCurrentVisiblePage] = useState<number>(initialPage ?? 1);
  const [pageInput, setPageInput] = useState<string | null>(null);
  const { isMobile } = usePlatform();

  const [state, send] = useMachine(pdfMachine);

  const { numPages, scale: pdfScale, heightMap, error } = state.context;

  const setDesktopScale = useCallback(
    (nextScale: number): void => {
      const clampedScale = Math.min(Math.max(nextScale, MIN_DESKTOP_SCALE), MAX_DESKTOP_SCALE);
      hasManualDesktopZoomRef.current = true;
      send({ type: 'SCALE_CHANGED', scale: clampedScale });
    },
    [send],
  );

  const handleZoomIn = useCallback((): void => {
    setDesktopScale(pdfScale + DESKTOP_ZOOM_STEP);
  }, [pdfScale, setDesktopScale]);

  const handleZoomOut = useCallback((): void => {
    setDesktopScale(pdfScale - DESKTOP_ZOOM_STEP);
  }, [pdfScale, setDesktopScale]);

  const handleResetZoom = useCallback((): void => {
    hasManualDesktopZoomRef.current = false;
    send({ type: 'RESIZE' });
  }, [send]);

  // Mobile zoom hook for pinch-to-zoom and pan
  const {
    scale: mobileZoomScale,
    transformOrigin,
    panX,
    resetZoom,
    isPinching,
  } = useMobileZoom({
    enabled: Boolean(isMobile),
    containerRef,
    targetRef: pdfContentRef,
    minScale: 1,
    maxScale: 3,
    onInteractionStateChange,
  });

  // Use pdfScale directly for Page rendering - CSS transform handles visual zoom
  // This prevents white flashes from canvas recreation during pinch
  const scale = pdfScale;

  // Track cumulative zoom to apply to machine after pinch ends
  const pendingScaleMultiplierRef = useRef(1);

  // Apply accumulated scale to machine when pinch ends
  useEffect(() => {
    if (!isPinching && pendingScaleMultiplierRef.current !== 1) {
      const newScale = pdfScale * pendingScaleMultiplierRef.current;
      // Clamp scale to reasonable bounds
      const clampedScale = Math.min(Math.max(newScale, 0.5), 3);
      send({ type: 'SCALE_CHANGED', scale: clampedScale });
      pendingScaleMultiplierRef.current = 1;
    }
  }, [isPinching, pdfScale, send]);

  // Update pending multiplier during pinch
  useEffect(() => {
    if (isPinching) {
      pendingScaleMultiplierRef.current = mobileZoomScale;
    }
  }, [mobileZoomScale, isPinching]);

  /* --------------------------- Load on mount ---------------------------- */
  useEffect(() => {
    if (!source) return;
    send({
      type: 'LOAD',
      source,
      initialPage: initialPage ?? 1,
    });
  }, [source, send, initialPage]);

  // Reset zoom when source changes
  useEffect(() => {
    resetZoom();
  }, [source, resetZoom]);

  /* --------------------------- Virtualizer ------------------------------ */
  const rowVirtualizer = useVirtualizer({
    count: numPages ?? 0,
    getScrollElement: () => containerRef.current,
    estimateSize: (index: number): number => heightMap[index] ?? 800,
    measureElement: (el: HTMLElement): number => el.getBoundingClientRect().height,
    overscan: 6,
  });

  /* --------------------------- Scroll tracking ------------------------------ */
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
      if (best) {
        const page = best.index + 1;
        setCurrentVisiblePage(prev => (prev === page ? prev : page));
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [numPages, rowVirtualizer]);

  const hasScrolledToInitialRef = useRef(false);
  useEffect(() => {
    hasScrolledToInitialRef.current = false;
  }, [source, initialPage]);
  useEffect(() => {
    if (hasScrolledToInitialRef.current) return;
    if (!numPages || !initialPage || initialPage < 1) return;
    const target = Math.min(initialPage, numPages);
    rowVirtualizer.scrollToIndex(target - 1, { align: 'start' });
    setCurrentVisiblePage(target);
    hasScrolledToInitialRef.current = true;
  }, [numPages, initialPage, rowVirtualizer]);

  /* --------------------------- Navigation functions ------------------------------ */
  const goToPage = useCallback(
    (page: number): void => {
      if (!numPages || page < 1 || page > numPages) return;
      const index = page - 1;
      rowVirtualizer.scrollToIndex(index, { align: 'start' });
      setCurrentVisiblePage(page);
    },
    [numPages, rowVirtualizer],
  );

  const goToPreviousPage = useCallback(() => {
    const prevPage = Math.max(1, currentVisiblePage - 1);
    goToPage(prevPage);
  }, [currentVisiblePage, goToPage]);

  const goToNextPage = useCallback(() => {
    const nextPage = Math.min(numPages || 1, currentVisiblePage + 1);
    goToPage(nextPage);
  }, [currentVisiblePage, numPages, goToPage]);

  const commitPageInput = useCallback(() => {
    if (pageInput === null) return;
    const num = parseInt(pageInput, 10);
    if (!Number.isNaN(num) && num >= 1) {
      const clamped = Math.min(num, numPages || 1);
      goToPage(clamped);
      setTimeout(() => {
        setPageInput(null);
      }, 0);
    } else {
      setPageInput(null);
    }
  }, [pageInput, numPages, goToPage]);

  /* --------------------------- Resize handling --------------------------- */

  useEffect((): (() => void) => {
    const handler = (): void => {
      hasManualDesktopZoomRef.current = false;
      send({ type: 'RESIZE' });
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [send]);

  useEffect((): (() => void) => {
    const container = containerRef.current;
    if (!container || isMobile) return () => {};

    const handleWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      setDesktopScale(pdfScale + direction * DESKTOP_ZOOM_STEP);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isMobile, pdfScale, setDesktopScale]);

  /* --------------------------- Keyboard zoom shortcuts --------------------------- */

  useEffect((): (() => void) => {
    if (isMobile) return () => {};

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;

      switch (event.code) {
        case 'Equal':
        case 'NumpadAdd':
          event.preventDefault();
          handleZoomIn();
          break;
        case 'Minus':
        case 'NumpadSubtract':
          event.preventDefault();
          handleZoomOut();
          break;
        case 'Digit0':
        case 'Numpad0':
          event.preventDefault();
          handleResetZoom();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, handleZoomIn, handleZoomOut, handleResetZoom]);

  /* --------------------------- Container resize handling --------------------------- */

  useEffect((): (() => void) => {
    const container = containerRef.current;
    if (!container) return () => {};

    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;

      const rect = container.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const previousSize = containerSizeRef.current;
      containerSizeRef.current = { width, height };

      if (hasManualDesktopZoomRef.current) return;

      if (!previousSize || previousSize.width !== width || previousSize.height !== height) {
        send({ type: 'RESIZE' });
      }
    });

    const rect = container.getBoundingClientRect();
    containerSizeRef.current = {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [send]);

  /* --------------------------- Early return AFTER hooks --------------------------- */

  if (!source) {
    return <div className='p-4'>No PDF source provided.</div>;
  }

  /* --------------------------- ERROR UI --------------------------- */

  if (error) {
    return (
      <div className='relative p-6 text-red-600'>
        <p className='font-semibold'>Failed to load PDF</p>
        <p className='text-sm'>{error}</p>
        <button
          onClick={(): void => send({ type: 'RETRY' })}
          className='mt-4 px-4 py-2 bg-red-600 text-white rounded'
          data-track-category='FileViewer'
          data-track-name='RETRY_LOAD_PDF'
        >
          Retry
        </button>
      </div>
    );
  }

  /* --------------------------- LOADING UI --------------------------- */

  const isLoading = state.matches('loading') || state.matches('calculatingScale');

  return (
    <div
      data-pdf-container
      className={`relative w-full h-full flex flex-col bg-gray-100 dark:bg-[#1E1E1E]`}
      style={{ touchAction: isMobile ? 'none' : 'auto' }}
    >
      {/* Navigation Controls */}
      {numPages && (
        <div className='sticky top-0 bg-white dark:bg-[#1E1E1E] shadow-md z-10 p-4 pt-[65px] border-b border-gray-200 dark:border-gray-700 w-full flex-shrink-0'>
          <div className='flex items-center justify-center'>
            <div className='flex items-center bg-muted dark:bg-gray-700 rounded-lg px-4 py-2 shadow-sm'>
              {/* Previous Page Button */}
              <button
                onClick={goToPreviousPage}
                disabled={currentVisiblePage <= 1}
                className='flex items-center gap-1 px-3 py-1 text-sm font-medium text-foreground dark:text-muted hover:text-foreground dark:hover:text-white disabled:text-muted-foreground dark:disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors'
                title='Previous page'
                data-track-category='FileViewer'
                data-track-name='PREVIOUS_PDF_PAGE'
              >
                <span className='text-lg'>‹</span>
                {!isMobile && <span>Previous</span>}
              </button>

              <div className='w-px h-4 bg-muted-foreground/50 dark:bg-gray-600 mx-3'></div>

              {/* Page Display */}
              <div className='flex items-center gap-2'>
                <span className='text-sm text-muted-foreground dark:text-muted-foreground'>
                  Page
                </span>
                <input
                  type='number'
                  min='1'
                  max={numPages}
                  value={pageInput !== null ? pageInput : String(currentVisiblePage)}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '' || /^[0-9]+$/.test(v)) {
                      const num = parseInt(v, 10);
                      if (v === '' || (num >= 1 && num <= (numPages || 1))) {
                        setPageInput(v);
                      }
                    }
                  }}
                  onFocus={e => {
                    e.currentTarget.select();
                    setPageInput(String(currentVisiblePage));
                  }}
                  onClick={e => e.currentTarget.select()}
                  onBlur={commitPageInput}
                  data-track-category='FileViewer'
                  data-track-name='SELECT_PDF_PAGE_INPUT'
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitPageInput();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setPageInput(null);
                    }
                  }}
                  className='w-16 px-2 py-1 text-sm text-center bg-background dark:bg-gray-600 border border-input dark:border-gray-500 rounded text-foreground dark:text-gray-200 focus:outline-none focus:border-muted-foreground dark:focus:border-muted-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                />
                <span className='text-sm text-muted-foreground dark:text-muted-foreground'>
                  of {numPages}
                </span>
              </div>

              <div className='w-px h-4 bg-muted-foreground/50 dark:bg-gray-600 mx-3'></div>

              {/* Next Page Button */}
              <button
                onClick={goToNextPage}
                disabled={currentVisiblePage >= numPages}
                className='flex items-center gap-1 px-3 py-1 text-sm font-medium text-foreground dark:text-muted hover:text-foreground dark:hover:text-white disabled:text-muted-foreground dark:disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors'
                title='Next page'
                data-track-category='FileViewer'
                data-track-name='NEXT_PDF_PAGE'
              >
                {!isMobile && <span>Next</span>}
                <span className='text-lg'>›</span>
              </button>

              {!isMobile && (
                <>
                  <div className='w-px h-4 bg-muted-foreground/50 dark:bg-gray-600 mx-3'></div>

                  <button
                    onClick={handleZoomOut}
                    disabled={pdfScale <= MIN_DESKTOP_SCALE}
                    className='inline-flex items-center justify-center w-8 h-8 text-foreground dark:text-muted hover:text-foreground dark:hover:text-white disabled:text-muted-foreground dark:disabled:text-muted-foreground disabled:cursor-not-allowed hover:bg-background/60 dark:hover:bg-gray-600 rounded-md transition-colors'
                    title='Zoom out (Ctrl -)'
                    aria-label='Zoom out PDF'
                    data-track-category='FileViewer'
                    data-track-name='ZOOM_OUT_PDF'
                  >
                    <ZoomOut className='h-4 w-4' />
                  </button>

                  <span className='w-12 text-center text-sm text-muted-foreground dark:text-muted-foreground'>
                    {Math.round(pdfScale * 100)}%
                  </span>

                  <button
                    onClick={handleZoomIn}
                    disabled={pdfScale >= MAX_DESKTOP_SCALE}
                    className='inline-flex items-center justify-center w-8 h-8 text-foreground dark:text-muted hover:text-foreground dark:hover:text-white disabled:text-muted-foreground dark:disabled:text-muted-foreground disabled:cursor-not-allowed hover:bg-background/60 dark:hover:bg-gray-600 rounded-md transition-colors'
                    title='Zoom in (Ctrl +)'
                    aria-label='Zoom in PDF'
                    data-track-category='FileViewer'
                    data-track-name='ZOOM_IN_PDF'
                  >
                    <ZoomIn className='h-4 w-4' />
                  </button>

                  <button
                    onClick={handleResetZoom}
                    className='inline-flex items-center justify-center w-8 h-8 text-foreground dark:text-muted hover:text-foreground dark:hover:text-white hover:bg-background/60 dark:hover:bg-gray-600 rounded-md transition-colors'
                    title='Reset zoom to fit (Ctrl 0)'
                    aria-label='Reset PDF zoom to fit'
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
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className='absolute inset-0 flex items-center justify-center bg-background/80 dark:bg-black/50 z-20'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-gray-700 dark:border-input'></div>
        </div>
      )}

      {/* PDF + Virtualized Pages */}
      <div ref={containerRef} className='overflow-auto flex-1'>
        <Document file={source} loading={null} error={null}>
          <div
            ref={pdfContentRef}
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: 'relative',
              transform: isMobile ? `translateX(${panX}px) scale(${mobileZoomScale})` : undefined,
              transformOrigin,
              transition: isMobile ? 'transform 0.05s ease-out' : undefined,
            }}
            className='w-full flex justify-center'
          >
            {rowVirtualizer.getVirtualItems().map(virtualItem => {
              const pageNumber = virtualItem.index + 1;

              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: virtualItem.start,
                    width: '100%',
                    padding: '16px 0',
                  }}
                >
                  <div className='flex justify-center'>
                    <PageWrapper pageNumber={pageNumber} scale={scale} />
                  </div>

                  <div className='absolute top-2 right-6 text-sm bg-black/50 text-white px-2 py-1 rounded pointer-events-none'>
                    Page {pageNumber}
                  </div>
                </div>
              );
            })}
          </div>
        </Document>
      </div>
    </div>
  );
};

export default PdfViewer;
