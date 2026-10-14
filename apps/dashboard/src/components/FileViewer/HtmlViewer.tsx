import React, { useEffect, useState, useCallback, memo } from 'react';
import { BaseViewerProps } from './utils';
import { inlineAuthenticatedImages } from '../../utils/inlineAuthenticatedImages';

// Decode to a string (for srcDoc), honouring a declared charset so non-UTF-8 files render right.
const readHtml = async (file: Blob): Promise<string> => {
  const head = new TextDecoder('latin1').decode(await file.slice(0, 1024).arrayBuffer());
  const charset = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(await file.arrayBuffer());
  } catch {
    return file.text(); // Unsupported charset label: fall back to UTF-8.
  }
};

const HtmlViewer: React.FC<BaseViewerProps> = memo(({ source }) => {
  const [page, setPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFile = useCallback(async (): Promise<void> => {
    if (!source) {
      setError('No file source provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (source.size === 0) throw new Error('File is empty');

      // Sandboxed frame sends no cookies, so inline authenticated-origin images first.
      let html = await readHtml(source);
      try {
        html = (await inlineAuthenticatedImages(html)).html;
      } catch {
        // Fall back to the original document.
      }

      setPage(html);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load HTML file');
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  if (loading) {
    return (
      <div className='flex items-center justify-center h-full min-h-[200px]'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-action-primary mx-auto mb-3'></div>
          <p className='text-muted-foreground dark:text-muted text-sm'>Loading HTML file...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center h-full min-h-[200px]'>
        <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 max-w-md text-center'>
          <p className='text-red-800 dark:text-red-200 font-semibold mb-2'>
            Unable to display file
          </p>
          <p className='text-red-600 dark:text-red-300 text-sm mb-3'>{error}</p>
          <button
            onClick={() => void loadFile()}
            className='px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors'
            data-track-category='FileViewer'
            data-track-name='RetryLoadHtml'
            data-ph-capture-attribute-track-id='retry_load_html'
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (page === null) return null;

  // srcDoc, not a blob: URL: an opaque origin with no standalone address to open
  // outside the sandbox (XYNE-66491).
  return (
    <iframe
      srcDoc={page}
      sandbox='allow-scripts'
      referrerPolicy='no-referrer'
      title='HTML Document'
      className='w-full h-full border-0 bg-white'
      style={{ minHeight: '100%' }}
    />
  );
});

HtmlViewer.displayName = 'HtmlViewer';

export default HtmlViewer;
