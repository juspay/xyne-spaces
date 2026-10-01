import React, { useEffect, useRef, useState } from 'react';
import { Download, Maximize2, Sheet } from 'lucide-react';
import { createPreviewUrl } from '../../../services/clients/fileFetchService';
import { downloadAttachment, formatFileSize, truncateFileName } from './utils';
import { useWindowWidth } from '../../../hooks/useWindowWidth';
import {
  CSV_PREVIEW_BYTES,
  CSV_PREVIEW_MAX_FILE_BYTES,
  parseCsvPreview,
  type CsvPreview,
} from './csvPreview';

const useNearViewport = <T extends Element>(): [React.RefObject<T | null>, boolean] => {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return (): void => observer.disconnect();
  }, [visible]);
  return [ref, visible];
};

export const InlineCsvFile: React.FC<{
  attachmentId: string;
  fileName: string;
  fileSize?: number;
  metadata?: Record<string, unknown>;
  onOpen: () => void;
  extraActions?: React.ReactNode;
}> = ({ attachmentId, fileName, fileSize, metadata, onOpen, extraActions }) => {
  const [containerRef, isNearViewport] = useNearViewport<HTMLDivElement>();
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const windowWidth = useWindowWidth();
  const displayName = windowWidth < 500 ? truncateFileName(fileName, 28) : fileName;
  const oversizedBytes =
    fileSize !== undefined && fileSize > CSV_PREVIEW_MAX_FILE_BYTES ? fileSize : null;

  const meta = metadata as { type?: string; version?: number } | undefined;
  const prevVersionRef = useRef(meta?.version ?? 0);

  useEffect(() => {
    const currentVersion = meta?.version;
    const prevVersion = prevVersionRef.current;
    if (currentVersion !== undefined && currentVersion > prevVersion) {
      setRefetchTrigger(prev => prev + 1);
    }
    prevVersionRef.current = currentVersion ?? 0;
  }, [meta?.version, meta?.type]);

  useEffect(() => {
    if (!isNearViewport || oversizedBytes !== null) return undefined;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const blob = await createPreviewUrl(attachmentId, { forceRefresh: refetchTrigger > 0 });
        const byteTruncated = blob.size > CSV_PREVIEW_BYTES;
        const text = await (byteTruncated ? blob.slice(0, CSV_PREVIEW_BYTES) : blob).text();
        if (cancelled) return;
        setPreview(parseCsvPreview(text, byteTruncated));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file');
      }
    };
    void load();
    return (): void => {
      cancelled = true;
    };
  }, [attachmentId, isNearViewport, oversizedBytes, refetchTrigger]);

  const columns = preview ? Array.from({ length: preview.colCount }, (_, i) => i) : [];
  const hiddenCols = preview ? Math.max(0, preview.totalCols - preview.colCount) : 0;
  const isEmpty = preview !== null && preview.colCount === 0;

  return (
    <div ref={containerRef} className='w-full max-w-2xl' data-testid='inline-csv-preview'>
      <div className='flex items-center gap-2 mb-1'>
        <button
          type='button'
          onClick={() => setIsExpanded(v => !v)}
          className='flex items-center gap-1 p-2 rounded-md transition-colors duration-150 text-muted-foreground hover:bg-accent hover:text-foreground min-w-0'
          aria-expanded={isExpanded}
          data-track-category='MESSAGE'
          data-track-name='TOGGLE_CSV_PREVIEW'
          data-track-metadata={JSON.stringify({ fileName, attachmentId, isExpanded })}
        >
          <Sheet className='h-4 w-4 shrink-0' />
          <span className='truncate max-w-md'>{displayName}</span>
          <span className='ml-1 text-xs text-muted-foreground shrink-0'>
            {isExpanded ? '[Hide]' : '[View]'}
          </span>
        </button>
        <button
          type='button'
          onClick={onOpen}
          className='p-2 hover:bg-accent rounded-lg transition-colors'
          title='Open full view'
          aria-label='Open full view'
          data-track-category='MESSAGE'
          data-track-name='OPEN_CSV_FILE'
          data-track-metadata={JSON.stringify({ fileName, attachmentId })}
        >
          <Maximize2 className='h-4 w-4 text-muted-foreground' />
        </button>
        <button
          type='button'
          onClick={e => {
            e.stopPropagation();
            void downloadAttachment(attachmentId, fileName);
          }}
          className='p-2 hover:bg-accent rounded-lg transition-colors'
          title='Download file'
          aria-label='Download file'
          data-track-category='MESSAGE'
          data-track-name='DOWNLOAD_CSV_FILE_INLINE'
          data-track-metadata={JSON.stringify({ fileName, attachmentId, fileSize })}
        >
          <Download className='h-4 w-4 text-muted-foreground' />
        </button>
        {extraActions}
      </div>

      {isExpanded && (
        <>
          {oversizedBytes !== null ? (
            <button
              type='button'
              onClick={onOpen}
              className='w-full p-3 bg-muted rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent hover:text-foreground text-left'
              data-track-category='MESSAGE'
              data-track-name='OPEN_CSV_FILE_TOO_LARGE'
              data-track-metadata={JSON.stringify({ fileName, attachmentId, fileSize })}
            >
              {formatFileSize(oversizedBytes)} CSV — too big to preview inline, open full view
            </button>
          ) : error ? (
            <div className='p-3 bg-destructive/10 rounded-lg border border-destructive/30 text-xs text-destructive'>
              Could not load preview: {error}
            </div>
          ) : !preview ? (
            <div className='p-3 bg-muted rounded-lg border border-border animate-pulse space-y-2 h-[120px]'>
              <div className='h-3 bg-accent rounded w-full' />
              <div className='h-3 bg-accent rounded w-full' />
              <div className='h-3 bg-accent rounded w-4/5' />
            </div>
          ) : isEmpty ? (
            <div className='p-3 bg-muted rounded-lg border border-border text-xs text-muted-foreground'>
              This CSV file is empty.
            </div>
          ) : (
            <div className='rounded-lg border border-border overflow-hidden'>
              <div className='max-h-80 overflow-auto'>
                <table className='min-w-full text-xs border-collapse'>
                  <thead className='sticky top-0 bg-muted z-10'>
                    <tr>
                      {columns.map(c => (
                        <th
                          key={c}
                          scope='col'
                          className='px-2 py-1.5 text-left font-semibold text-foreground border-b border-border'
                        >
                          <div className='max-w-[220px] truncate' title={preview.header[c] ?? ''}>
                            {preview.header[c] ?? ''}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, r) => (
                      <tr key={r} className='odd:bg-background even:bg-muted/30'>
                        {columns.map(c => (
                          <td
                            key={c}
                            className='px-2 py-1 text-foreground border-b border-border/60'
                          >
                            <div className='max-w-[220px] truncate' title={row[c] ?? ''}>
                              {row[c] ?? ''}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(preview.hasMoreRows || hiddenCols > 0) && (
                <button
                  type='button'
                  onClick={onOpen}
                  data-track-category='MESSAGE'
                  data-track-name='OPEN_CSV_FILE_FROM_OVERFLOW'
                  data-track-metadata={JSON.stringify({ fileName, attachmentId })}
                  className='w-full px-2 py-1.5 text-xs text-muted-foreground bg-muted/50 hover:bg-accent hover:text-foreground border-t border-border text-left'
                >
                  Showing first {preview.rows.length} rows
                  {hiddenCols > 0
                    ? ` and ${preview.colCount} of ${preview.totalCols} columns`
                    : ''}{' '}
                  — open full view
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default InlineCsvFile;
