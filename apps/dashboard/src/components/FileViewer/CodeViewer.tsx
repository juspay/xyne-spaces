import React, { useEffect, useState, useMemo, memo, useCallback, useRef } from 'react';
import type { BaseViewerProps } from './utils';
import hljs from 'highlight.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import ReadmeViewer from './ReadmeViewer';
import { injectMarks, useLineSearch, useMatchScroll } from './search';
import { Button } from '../ui/Button/Button';

// Static lookup map — O(1) vs sequential if-chain
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.sql': 'sql',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.json': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
};

/**
 * Splits a highlight.js HTML string into per-line segments while correctly
 * reopening/closing <span> tags that cross line boundaries.
 *
 * highlight.js wraps tokens in <span class="hljs-*"> tags that can span
 * multiple lines (e.g. multi-line comments/strings). Naively splitting by \n
 * would break those tags. This function tracks the open-tag stack and inserts
 * the necessary closing/reopening tags at each line boundary.
 */
function splitHighlightedLines(html: string): string[] {
  const normalized = html.replace(/\r\n/g, '\n');
  const result: string[] = [];
  const openTags: string[] = [];

  for (const line of normalized.split('\n')) {
    const lineOpenTags = [...openTags];
    let pos = 0;

    while (pos < line.length) {
      const nextOpen = line.indexOf('<span', pos);
      const nextClose = line.indexOf('</span>', pos);

      if (nextOpen === -1 && nextClose === -1) break;

      if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
        const endOfTag = line.indexOf('>', nextOpen) + 1;
        if (endOfTag > 0) openTags.push(line.substring(nextOpen, endOfTag));
        pos = endOfTag > 0 ? endOfTag : pos + 1;
      } else {
        openTags.pop();
        pos = nextClose + 7; // '</span>'.length === 7
      }
    }

    result.push(lineOpenTags.join('') + line + '</span>'.repeat(openTags.length));
  }

  return result;
}

// ── Shared UI sub-components (same pattern as TxtViewer / JsonViewer) ────────

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
        <Button
          onClick={onRetry}
          variant='ghost'
          className='px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors'
          data-track-category='FileViewer'
          data-track-name='RetryLoadCode'
          trackId='retry_load_code'
        >
          Try Again
        </Button>
      )}
    </div>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const CodeViewer: React.FC<BaseViewerProps> = memo(({ source, fileName, searchable }) => {
  const [lines, setLines] = useState<string[]>([]);
  // Plain-text shadow of `lines`, kept in lockstep. `lines` holds highlight.js
  // HTML, whose string offsets don't correspond to text offsets (tags are
  // zero-width, `&amp;` is 5 chars for 1). Search runs against this copy and
  // injectMarks maps the resulting offsets back into the HTML.
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isMarkdown = fileName
    ? fileName.toLowerCase().endsWith('.md') || fileName.toLowerCase().endsWith('.markdown')
    : false;

  const [markdownMode, setMarkdownMode] = useState<'raw' | 'rendered'>(
    isMarkdown ? 'rendered' : 'raw',
  );

  const fileSizeMB = useMemo(() => {
    return source ? source.size / (1024 * 1024) : 0;
  }, [source]);

  const language = useMemo(() => {
    if (!fileName) return undefined;
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex === -1) return undefined;
    const ext = fileName.slice(dotIndex).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext];
  }, [fileName]);

  const shouldVirtualize = lines.length > 1000;

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 20,
    overscan: 10,
    enabled: shouldVirtualize && !loading && !error,
  });

  // Force measurement after lines render to prevent overlap
  useEffect(() => {
    if (!shouldVirtualize || loading || error) return;

    const id1 = requestAnimationFrame(() => {
      virtualizer.measure();
    });

    const id2 = requestAnimationFrame(() => {
      virtualizer.measure();
    });

    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [lines, shouldVirtualize, loading, error, virtualizer]);

  // Re-measure on container resize to handle responsive width changes
  useEffect(() => {
    if (!containerRef.current || !shouldVirtualize) return;

    const resizeObserver = new ResizeObserver(() => {
      virtualizer.measure();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [virtualizer, shouldVirtualize]);

  const loadFile = useCallback(async (): Promise<void> => {
    if (!source) {
      setError('No file source provided');
      return;
    }

    setLoading(true);
    setError(null);

    try {
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

      reader.readAsText(source, 'UTF-8');

      const text = await readPromise;

      if (!text) {
        throw new Error('File is empty or contains no readable content');
      }

      // hljs only wraps tokens and escapes entities — it never alters the text
      // itself — so splitting the raw text the same way yields a 1:1 line
      // correspondence with the highlighted output.
      setRawLines(text.split(/\r?\n/));

      try {
        const highlighted = language
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value;
        setLines(splitHighlightedLines(highlighted));
      } catch {
        // Fallback: plain text with HTML escaping
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        setLines(escaped.split(/\r?\n/));
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred while reading file';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [source, language]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const handleRetry = (): void => {
    void loadFile();
  };

  // Rendered markdown is ReadmeViewer's own DOM, which this viewer neither owns
  // nor virtualizes — searching it needs the DOM path, so search is off here and
  // the find bar hides until the user switches back to code view.
  const isRenderedMarkdown = isMarkdown && markdownMode === 'rendered';
  const { matchesByRow, activeMatch } = useLineSearch(
    rawLines,
    searchable !== false && !loading && !error && !isRenderedMarkdown,
  );
  useMatchScroll(activeMatch, virtualizer, shouldVirtualize, containerRef);

  // Markdown "rendered" view uses ReadmeViewer in-place (same modal).
  if (isRenderedMarkdown) {
    return (
      <div className='relative h-full w-full mt-[65px]'>
        <div className='absolute right-3 top-3 z-20'>
          <button
            type='button'
            onClick={() => setMarkdownMode('raw')}
            className='px-3 py-1.5 rounded-md bg-background/80 dark:bg-black/40 backdrop-blur border border-border text-foreground text-xs hover:bg-accent transition-colors'
            data-track-category='FileViewer'
            data-track-name='ToggleMarkdownRaw'
            data-track-metadata={JSON.stringify({ fileName })}
          >
            View code
          </button>
        </div>
        <ReadmeViewer source={source} {...(fileName ? { fileName } : {})} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className='pt-[65px] p-4 flex items-center justify-center h-full min-h-[200px]'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-action-primary mx-auto mb-3' />
          <p className='text-muted-foreground dark:text-muted text-sm'>Loading code...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='pt-[65px] p-4 flex items-center justify-center h-full min-h-[200px]'>
        <ErrorDisplay error={error} canRetry onRetry={handleRetry} />
      </div>
    );
  }

  return (
    <div
      className='font-mono text-sm bg-background dark:bg-[#1E1E1E] text-foreground dark:text-gray-100 border border-border dark:border-gray-700 rounded-lg mt-[65px]'
      style={{
        // Subtracts the 65px margin above, which clears the modal's floating
        // top bar. Without this, 100% + margin overflows the scrollable wrapper
        // and clips the bottom of the viewer out of sight — hiding the file's
        // last lines and any match revealed there. (Csv/Excel avoid this by
        // using `pt-[65px]` padding rather than a margin.)
        height: 'calc(100% - 65px)',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header with file info */}
      <div className='flex items-center justify-between p-3 border-b border-border dark:border-gray-700 bg-muted dark:bg-gray-800/50 rounded-t-lg flex-shrink-0'>
        <div className='flex items-center gap-4 min-w-0 flex-1'>
          {language && (
            <span className='text-xs text-muted-foreground dark:text-muted-foreground truncate uppercase'>
              • {language}
            </span>
          )}
          <span className='text-xs text-muted-foreground dark:text-muted-foreground'>
            • {lines.length.toLocaleString()} lines
          </span>
        </div>
        <div className='flex items-center gap-2 flex-shrink-0'>
          <span className='text-xs text-muted-foreground dark:text-muted-foreground'>
            • {fileSizeMB.toFixed(2)}MB
          </span>
          {shouldVirtualize && (
            <span className='text-xs text-action-primary font-medium'>Virtualized</span>
          )}
          {isMarkdown && (
            <button
              type='button'
              onClick={() => setMarkdownMode('rendered')}
              className='ml-2 px-2.5 py-1 rounded-md border border-border bg-background/70 dark:bg-black/20 text-xs text-foreground hover:bg-accent transition-colors'
              data-track-category='FileViewer'
              data-track-name='ToggleMarkdownRendered'
              data-track-metadata={JSON.stringify({ fileName })}
            >
              Preview
            </button>
          )}
        </div>
      </div>

      {/* Code content */}
      <div
        ref={containerRef}
        className='flex-1 overflow-auto p-3'
        style={{
          maxHeight: shouldVirtualize ? '100%' : 'none',
        }}
      >
        {shouldVirtualize ? (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map(virtualRow => (
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
                  <span className='text-muted-foreground dark:text-muted-foreground text-xs w-12 text-right mr-3 flex-shrink-0 select-none leading-5'>
                    {virtualRow.index + 1}
                  </span>
                  <span
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{
                      __html: injectMarks(
                        lines[virtualRow.index] ?? '',
                        matchesByRow.get(virtualRow.index) ?? [],
                      ),
                    }}
                    className='flex-1 whitespace-pre-wrap break-words leading-5'
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            {lines.map((line, index) => (
              <div key={index} className='flex min-h-[20px]'>
                <span className='text-muted-foreground dark:text-muted-foreground text-xs w-12 text-right mr-3 flex-shrink-0 select-none leading-5'>
                  {index + 1}
                </span>
                <span
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{
                    __html: line ? injectMarks(line, matchesByRow.get(index) ?? []) : '\u00A0',
                  }}
                  className='flex-1 whitespace-pre-wrap break-words leading-5'
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

CodeViewer.displayName = 'CodeViewer';

export default CodeViewer;
