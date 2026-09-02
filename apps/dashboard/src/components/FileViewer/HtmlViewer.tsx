import React, { useEffect, useState, useCallback, memo } from 'react';
import { BaseViewerProps } from './utils';

const declaresEncoding = async (file: Blob): Promise<boolean> => {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return /<meta[^>]+charset/i.test(new TextDecoder('latin1').decode(head));
};

const HtmlViewer: React.FC<BaseViewerProps> = memo(({ source }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
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

      const type = (await declaresEncoding(source)) ? 'text/html' : 'text/html;charset=utf-8';

      const url = URL.createObjectURL(source.slice(0, source.size, type));
      setBlobUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load HTML file');
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void loadFile();
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!blobUrl) return null;

  return (
    <iframe
      src={blobUrl}
      sandbox='allow-scripts'
      title='HTML Document'
      className='w-full h-full border-0 bg-white'
      style={{ minHeight: '100%' }}
    />
  );
});

HtmlViewer.displayName = 'HtmlViewer';

export default HtmlViewer;
