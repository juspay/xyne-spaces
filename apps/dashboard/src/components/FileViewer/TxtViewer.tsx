import React, { useEffect, useState, useMemo, memo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BaseViewerProps } from './utils';
import { HighlightedText } from './search/HighlightedText';
import { useLineSearch, useMatchScroll } from './search';

// Reusable Loading Component
const LoadingSpinner: React.FC = () => (
  <div className='flex items-center justify-center h-full min-h-[200px]'>
    <div className='text-center'>
      <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-action-primary mx-auto mb-3'></div>
      <p className='text-muted-foreground dark:text-muted text-sm'>Loading text file...</p>
    </div>
  </div>
);

// Reusable Error Component
const ErrorDisplay: React.FC<{ error: string; canRetry?: boolean; onRetry?: () => void }> = ({
  error,
  canRetry = false,
  onRetry,
}) => (
  <div className='flex items-center justify-center h-full min-h-[200px]'>
    <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 max-w-md text-center'>
      <p className='text-red-800 dark:text-red-200 font-semibold mb-2'>Unable to display file</p>
      <p className='text-red-600 dark:text-red-300 text-sm mb-3'>{error}</p>
      {canRetry && onRetry && (
        <button
          onClick={onRetry}
          className='px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors'
          data-track-category='FileViewer'
          data-track-name='RetryLoadTxt'
        >
          Try Again
        </button>
      )}
    </div>
  </div>
);

const TxtViewer: React.FC<BaseViewerProps> = memo(({ source, searchable }) => {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine if the file is large
  const isLargeFile = useMemo(() => {
    return source ? source.size > 10 * 1024 : false; // 10KB
  }, [source]);

  // Calculate file size for display
  const fileSizeMB = useMemo(() => {
    return source ? source.size / (1024 * 1024) : 0;
  }, [source]);

  // Determine if we should use virtualization
  const shouldVirtualize = lines.length > 1000;

  // Setup virtualizer for large files
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 20, // Approximate line height in pixels
    overscan: 10,
    enabled: shouldVirtualize && !loading && !error,
  });

  // Matches come from `lines`, not the DOM: when virtualized, only ~30 rows are
  // mounted, so a DOM scan would miss almost every match in a large file.
  const { matchesByRow, activeMatch } = useLineSearch(
    lines,
    searchable !== false && !loading && !error,
  );
  useMatchScroll(activeMatch, virtualizer, shouldVirtualize, containerRef);

  const loadFile = useCallback(async (): Promise<void> => {
    if (!source) {
      setError('No file source provided');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use FileReader with proper error handling
      const reader = new FileReader();

      const readPromise = new Promise<string>((resolve, reject) => {
        reader.onload = (e: ProgressEvent<FileReader>): void => {
          const result = e.target?.result;
          if (typeof result === 'string') {
            resolve(result);
          } else {
            reject(new Error('Failed to read file as text'));
          }
        };

        reader.onerror = (): void => {
          reject(new Error('File reading failed - file may be corrupted'));
        };

        reader.onabort = (): void => {
          reject(new Error('File reading was aborted'));
        };
      });

      // Start reading the file
      if (typeof source === 'string') {
        reader.readAsText(new Blob([source]), 'UTF-8');
      } else {
        reader.readAsText(source, 'UTF-8');
      }

      const text = await readPromise;

      if (!text) {
        throw new Error('File is empty or contains no readable content');
      }

      // Split into lines
      const allLines = text.split(/\r?\n/);
      setLines(allLines);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred while reading file';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const handleRetry = (): void => {
    void loadFile();
  };

  // Render loading state
  if (loading) {
    return (
      <div className='relative h-full bg-background dark:bg-[#1E1E1E]'>
        <LoadingSpinner />
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className='relative h-full bg-background dark:bg-[#1E1E1E]'>
        <ErrorDisplay error={error} canRetry onRetry={handleRetry} />
      </div>
    );
  }

  // Render content
  return (
    <div
      className={`font-mono text-sm bg-background dark:bg-[#1E1E1E] text-foreground dark:text-gray-100 border border-border dark:border-gray-700 rounded-lg ${isLargeFile ? 'mt-[65px]' : ''}`}
      style={{
        // The 65px margin clears the modal's floating top bar, so the height
        // must subtract it: 100% + a 65px margin overflows the scrollable
        // wrapper (`h-full w-full overflow-auto p-4`) by 65px, which clips the
        // bottom ~48px of this viewer out of sight. That hides the last lines of
        // the file and, because the clipped strip is still inside this
        // element's own rect, lets find land on a match nobody can see.
        height: isLargeFile ? 'calc(100% - 65px)' : '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header with file info */}
      <div className='flex items-center justify-between p-3 border-b border-border dark:border-gray-700 bg-muted dark:bg-gray-800/50 rounded-t-lg'>
        <div className='flex items-center gap-2'>
          <svg className='w-4 h-4 text-muted-foreground' fill='currentColor' viewBox='0 0 20 20'>
            <path
              fillRule='evenodd'
              d='M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z'
              clipRule='evenodd'
            />
          </svg>
          <span className='text-xs text-muted-foreground dark:text-muted-foreground'>
            {lines.length.toLocaleString()} lines • {fileSizeMB.toFixed(2)}MB
          </span>
        </div>
        {shouldVirtualize && (
          <span className='text-xs text-action-primary font-medium'>Virtualized</span>
        )}
      </div>

      {/* Content area */}
      <div
        ref={containerRef}
        className='flex-1 overflow-auto p-3'
        style={{
          maxHeight: shouldVirtualize ? '100%' : 'none',
        }}
      >
        {shouldVirtualize ? (
          // Virtualized rendering for large files
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map(virtualRow => (
              // The positioned wrapper and the measured element must stay
              // separate: pinning `height` on the element that carries
              // `measureElement` feeds the 20px estimate back to the measurer,
              // so wrapped lines never report their real height — rows overlap
              // and scrolling to a match drifts. The inner div is left at its
              // natural height to be measured.
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className='flex w-full'
                >
                  <span className='text-muted-foreground dark:text-muted-foreground text-xs w-12 text-right mr-3 flex-shrink-0 select-none'>
                    {virtualRow.index + 1}
                  </span>
                  <span className='flex-1 whitespace-pre-wrap break-words'>
                    <HighlightedText
                      text={lines[virtualRow.index] || ''}
                      ranges={matchesByRow.get(virtualRow.index)}
                    />
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Regular rendering for small files
          <div>
            {lines.map((line, index) => (
              <div key={index} className='flex min-h-[20px]'>
                <span className='text-muted-foreground dark:text-muted-foreground text-xs w-12 text-right mr-3 flex-shrink-0 select-none'>
                  {index + 1}
                </span>
                <span className='flex-1 whitespace-pre-wrap break-words'>
                  {/* Non-breaking space keeps empty lines from collapsing */}
                  <HighlightedText text={line} ranges={matchesByRow.get(index)} fallback='\u00A0' />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

TxtViewer.displayName = 'TxtViewer';

export default TxtViewer;
