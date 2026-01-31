import React, { useEffect, useRef, useState } from 'react';
import * as docx from 'docx-preview';
import { BaseViewerProps } from './utils';
import { usePlatform } from '../../hooks/usePlatform';

export const DocxViewer: React.FC<BaseViewerProps> = ({ source }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isMobile } = usePlatform();

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
        makeResponsive(containerRef.current);
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
        <div className='absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-neutral-900/70 z-10'>
          <div className='text-center'>
            <div className='animate-spin border-b-2 border-gray-600 dark:border-gray-300 h-10 w-10 rounded-full mx-auto mb-2' />
            <p className='text-gray-600 dark:text-gray-300'>Loading document...</p>
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
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className={`docx-container bg-white flex ${isMobile ? 'flex-col' : 'flex-row'} flex-wrap align-center justify-center mt-[65px] mb-[65px]`}
      />
    </div>
  );
};

// Post-render: Make DOCX responsive (Tailwind approach)
function makeResponsive(root: HTMLElement): void {
  // Remove width constraints from all wrappers
  root.querySelectorAll('.docx, .docx-wrapper').forEach(el => {
    const wrapper = el as HTMLElement;
    wrapper.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
  });

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
