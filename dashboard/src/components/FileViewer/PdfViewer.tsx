import React, { useEffect, useRef, memo, useState, useCallback } from 'react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { useMachine } from '@xstate/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import pdfMachine from '../../machines/pdfMachine';
import { BaseViewerProps } from './utils';
import { usePlatform } from '../../hooks/usePlatform';

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

export const PdfViewer: React.FC<BaseViewerProps> = ({ source }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentVisiblePage, setCurrentVisiblePage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string | null>(null);
  const { isMobile } = usePlatform();

  const [state, send] = useMachine(pdfMachine);

  const { numPages, scale, heightMap, error } = state.context;

  /* --------------------------- Load on mount ---------------------------- */
  useEffect(() => {
    if (!source) return;
    send({
      type: 'LOAD',
      source,
      initialPage: 1,
    });
  }, [source, send]);

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
    const handler = (): void => send({ type: 'RESIZE' });
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [send]);

  /* --------------------------- Container resize handling --------------------------- */

  useEffect((): (() => void) => {
    const container = containerRef.current;
    if (!container) return () => {};

    const resizeObserver = new ResizeObserver(() => {
      send({ type: 'RESIZE' });
    });

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
    >
      {/* Navigation Controls */}
      {numPages && (
        <div className='sticky top-0 bg-white dark:bg-[#1E1E1E] shadow-md z-10 p-4 pt-[65px] border-b border-gray-200 dark:border-gray-700 w-full flex-shrink-0'>
          <div className='flex items-center justify-center'>
            <div className='flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg px-4 py-2 shadow-sm'>
              {/* Previous Page Button */}
              <button
                onClick={goToPreviousPage}
                disabled={currentVisiblePage <= 1}
                className='flex items-center gap-1 px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors'
                title='Previous page'
              >
                <span className='text-lg'>‹</span>
                {!isMobile && <span>Previous</span>}
              </button>

              <div className='w-px h-4 bg-gray-300 dark:bg-gray-600 mx-3'></div>

              {/* Page Display */}
              <div className='flex items-center gap-2'>
                <span className='text-sm text-gray-500 dark:text-gray-400'>Page</span>
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
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitPageInput();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setPageInput(null);
                    }
                  }}
                  className='w-16 px-2 py-1 text-sm text-center bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded text-gray-800 dark:text-gray-200 focus:outline-none focus:border-gray-400 dark:focus:border-gray-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                />
                <span className='text-sm text-gray-500 dark:text-gray-400'>of {numPages}</span>
              </div>

              <div className='w-px h-4 bg-gray-300 dark:bg-gray-600 mx-3'></div>

              {/* Next Page Button */}
              <button
                onClick={goToNextPage}
                disabled={currentVisiblePage >= numPages}
                className='flex items-center gap-1 px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors'
                title='Next page'
              >
                {!isMobile && <span>Next</span>}
                <span className='text-lg'>›</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className='absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-black/50 z-20'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-gray-700 dark:border-gray-300'></div>
        </div>
      )}

      {/* PDF + Virtualized Pages */}
      <div ref={containerRef} className='overflow-auto flex-1'>
        <Document file={source} loading={null} error={null}>
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: 'relative',
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
