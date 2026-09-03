import React, { useEffect, useRef, useState } from 'react';
import * as docx from 'docx-preview';
import { BaseViewerProps } from './utils';
import { usePlatform } from '../../hooks/usePlatform';
import { useMobileZoom } from '../../hooks/useMobileZoom';
import { useDomSearch } from './search';

/**
 * Standard US Letter page width in pixels at 96 DPI.
 * US Letter paper size is 8.5 inches × 11 inches.
 * Standard screen resolution is 96 pixels per inch (PPI).
 * 8.5 inches × 96 PPI = 816 pixels.
 * This constant is used for calculating mobile zoom scaling to fit
 * DOCX pages within the viewport width on Mobile Screens.
 */
const PAGE_WIDTH = 816;

export const DocxViewer: React.FC<BaseViewerProps> = ({ source, searchable }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isMobile } = usePlatform();

  // docx-preview renders the whole document into containerRef (no
  // virtualization), so search extracts text + DOM ranges and paints via the
  // CSS Custom Highlight API without mutating docx-preview's markup.
  useDomSearch(containerRef, searchable !== false && !loading && !error);

  // Mobile zoom hook for pinch-to-zoom
  const {
    scale: mobileZoomScale,
    transformOrigin,
    resetZoom,
  } = useMobileZoom({
    enabled: Boolean(isMobile),
    containerRef,
    targetRef: contentRef,
    minScale: 1,
    maxScale: 3,
  });

  // Reset zoom when source changes
  useEffect(() => {
    resetZoom();
  }, [source, resetZoom]);

  useEffect(() => {
    let mounted = true;
    let retryCount = 0;
    const maxRetries = 10;

    const tryLoadDocument = () => {
      if (!mounted) return;

      if (containerRef.current) {
        void loadDocument();
      } else if (retryCount < maxRetries) {
        retryCount++;
        setTimeout(tryLoadDocument, 100);
      } else {
        setError('Failed to initialize document viewer');
        setLoading(false);
      }
    };

    tryLoadDocument();

    return () => {
      mounted = false;
    };
  }, [source]);

  const loadDocument = async () => {
    if (!containerRef.current) {
      setError('Container not ready');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      containerRef.current.innerHTML = '';

      if (!source) {
        throw new Error('No document source provided');
      }

      if (source.size === 0) {
        throw new Error('File is empty');
      }

      const data = await source.arrayBuffer();

      if (data.byteLength === 0) {
        throw new Error('Document is empty');
      }

      if (!containerRef.current) return;
      containerRef.current.innerHTML = '';

      await docx.renderAsync(data, containerRef.current, undefined, {
        className: 'docx',
        inWrapper: false,
        breakPages: true,
      });

      // After rendering, remove any inline width constraints and make it responsive
      if (containerRef.current) {
        makeResponsive(containerRef.current, isMobile);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load document';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='relative min-h-screen dark:bg-neutral-900 p-4'>
      {loading && (
        <div className='absolute inset-0 flex items-center justify-center bg-background/60 dark:bg-neutral-900/70 z-10'>
          <div className='text-center'>
            <div className='animate-spin border-b-2 border-gray-600 dark:border-input h-10 w-10 rounded-full mx-auto mb-2' />
            <p className='text-muted-foreground dark:text-muted'>Loading document...</p>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className='absolute inset-0 flex items-center justify-center z-10'>
          <div className='bg-red-100 dark:bg-red-900 p-4 rounded shadow'>
            <p className='text-red-700 dark:text-red-300 font-semibold'>Error loading document</p>
            <p className='text-red-600 dark:text-red-400 text-sm'>{error}</p>
            <button
              onClick={() => void loadDocument()}
              className='mt-2 px-3 py-1 bg-red-600 dark:bg-red-700 text-white text-sm rounded hover:bg-red-700 dark:hover:bg-red-600 transition-colors'
              data-track-category='FileViewer'
              data-track-name='RETRY_LOAD_DOCUMENT'
              data-track-metadata={JSON.stringify({ fileType: 'docx', source })}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div
        ref={contentRef}
        style={{
          transform: isMobile ? `scale(${mobileZoomScale})` : undefined,
          transformOrigin,
          transition: isMobile ? 'transform 0.05s ease-out' : undefined,
        }}
        className='w-full'
      >
        <div
          ref={containerRef}
          className={`docx-container bg-transparent flex ${isMobile ? 'flex-col' : 'flex-row'} flex-wrap align-center justify-center mt-[65px] mb-[65px] max-w-full overflow-x-hidden`}
        />
      </div>
    </div>
  );
};

// Post-render: Make DOCX responsive (Tailwind approach)
function makeResponsive(root: HTMLElement, isMobile: boolean): void {
  const containerWidth = root.clientWidth;
  // On mobile, calculate zoom to fit pages to viewport width
  if (isMobile) {
    const targetWidth = containerWidth - 32;
    const zoom = Math.min(targetWidth / PAGE_WIDTH, 1);

    if (zoom < 1) {
      const wrapper = root.querySelector('.docx-wrapper, .docx') as HTMLElement;
      if (wrapper) {
        wrapper.style.zoom = String(zoom);
      }
    }
  }

  // Make tables responsive
  root.querySelectorAll('table').forEach(table => {
    const tableEl = table as HTMLElement;
    tableEl.style.width = '100%';
    tableEl.style.maxWidth = '100%';
    tableEl.style.minWidth = 'auto';
    tableEl.style.tableLayout = 'fixed';

    // Make all cells wrap content properly
    tableEl.querySelectorAll('td, th').forEach(cell => {
      const cellEl = cell as HTMLElement;
      cellEl.style.overflowWrap = 'break-word';
      cellEl.style.whiteSpace = 'normal';
      cellEl.style.maxWidth = '100px';
      cellEl.style.minWidth = '0';
      cellEl.style.boxSizing = 'border-box';
      cellEl.style.padding = '5px';
    });
  });

  // Make images responsive
  root.querySelectorAll('img').forEach(img => {
    const imgEl = img as HTMLElement;
    imgEl.style.maxWidth = '100%';
    imgEl.style.height = 'auto';
    imgEl.style.width = 'auto';
  });
}

export default DocxViewer;
