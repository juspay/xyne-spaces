import React, { useEffect, useState, useCallback, memo } from 'react';
import { BaseViewerProps } from './utils';
import { inlineAuthenticatedImages } from '../../utils/inlineAuthenticatedImages';

/**
 * Decode the uploaded bytes using the charset the document declares in a
 * <meta> tag (first 1 KB), falling back to UTF-8. srcdoc needs a string, so the
 * decoding the browser used to do for the blob: URL now happens here.
 */
const decodeHtml = async (file: Blob): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
  const declared = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      // Unknown label — fall through to UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
};

/**
 * Security (bug bounty #35): the document used to be loaded from a blob: URL.
 * A blob: URL carries the app's own origin, so although the frame itself was
 * sandboxed, the same URL opened top-level (new tab, "open frame in new tab")
 * ran the uploaded page's scripts with full access to the app origin. The page
 * is now given as srcdoc, which has no address of its own and always stays in
 * the opaque sandbox origin. Mirrors FilePreview/previewers/HtmlPreview.tsx.
 * Never add allow-same-origin or allow-popups-to-escape-sandbox here.
 */
const SANDBOX = 'allow-scripts';

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

      let html = await decodeHtml(source);

      // The sandboxed frame runs from an opaque origin — its <img> loads send
      // no cookies, so authenticated-origin images would 401 (broken render,
      // and in Electron a session-killing 401). Inline them first.
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

  return (
    <iframe
      srcDoc={page}
      sandbox={SANDBOX}
      referrerPolicy='no-referrer'
      title='HTML Document'
      className='w-full h-full border-0 bg-white'
      style={{ minHeight: '100%' }}
    />
  );
});

HtmlViewer.displayName = 'HtmlViewer';

export default HtmlViewer;
