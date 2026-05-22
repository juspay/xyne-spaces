import React, { useEffect, useState, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import type { Components } from 'react-markdown';
import { BaseViewerProps } from './utils';

// Loading spinner
const LoadingSpinner: React.FC = () => (
  <div className='absolute inset-0 flex items-center justify-center bg-background/90 dark:bg-[#1E1E1E]/90 z-10'>
    <div className='text-center'>
      <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600 dark:border-input mx-auto mb-4'></div>
      <p className='text-muted-foreground dark:text-muted'>Loading document...</p>
    </div>
  </div>
);

// Error box
const ErrorDisplay: React.FC<{ error: string }> = ({ error }) => (
  <div className='absolute inset-0 flex items-center justify-center bg-background dark:bg-[#1E1E1E] z-10'>
    <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 max-w-md'>
      <p className='text-red-800 dark:text-red-200 font-semibold'>Error loading document</p>
      <p className='text-red-600 dark:text-red-300 text-sm mt-1'>{error}</p>
    </div>
  </div>
);

export const ReadmeViewer: React.FC<BaseViewerProps> = memo(({ source }) => {
  // ----- State (always runs) -----
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string>('');

  // ----- Stable key (always runs) -----
  const sourceKey = useMemo(() => {
    if (source instanceof File) {
      return `file-${source.name}-${source.size}-${source.lastModified}`;
    }
    return 'invalid-source';
  }, [source]);

  // ----- Document Loader (always runs) -----
  useEffect(() => {
    let mounted = true;

    const loadDocument = async (): Promise<void> => {
      try {
        setLoading(true);
        setError(null);

        // If source is a string → unsupported manually
        if (typeof source === 'string') {
          throw new Error('Document content is not supported');
        }

        if (!source) {
          throw new Error('No document source provided');
        }

        if (source.size === 0) {
          throw new Error('File is empty');
        }

        const content = await source.text();

        if (!content || content.length === 0) {
          throw new Error('Document content is empty');
        }

        if (mounted) setMarkdownContent(content);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load document';
        if (mounted) setError(msg);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadDocument();

    return (): void => {
      mounted = false;
    };
  }, [sourceKey, source]);

  // ----- Markdown components (always runs) -----
  const markdownComponents: Components = useMemo(
    () => ({
      h1: ({ children }) => (
        <h1 className='text-4xl font-bold text-foreground dark:text-gray-100 mb-6 pb-2 border-b border-border dark:border-gray-700'>
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className='text-3xl font-semibold text-foreground dark:text-gray-100 mb-5 mt-8 pb-2 border-b border-border dark:border-gray-700'>
          {children}
        </h2>
      ),
      p: ({ children }) => (
        <p className='text-foreground dark:text-gray-200 leading-relaxed mb-4'>{children}</p>
      ),
      a: ({ href, children }) => (
        <a
          href={href}
          className='text-action-primary dark:text-action-primary hover:text-action-primary/80 dark:hover:text-action-primary/80 underline'
          target='_blank'
          rel='noopener noreferrer'
        >
          {children}
        </a>
      ),
      pre: ({ children }) => (
        <pre className='bg-muted dark:bg-gray-900 border border-border dark:border-gray-700 rounded-lg p-4 mb-4 overflow-x-auto'>
          {children}
        </pre>
      ),
      code: ({ children, className, ...props }): React.ReactElement => {
        const isInline = !className?.includes('language-');
        if (isInline) {
          return (
            <code
              className='bg-muted dark:bg-gray-800 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded text-sm font-mono'
              {...props}
            >
              {children}
            </code>
          );
        }
        return (
          <code className={`${className || ''} text-sm`} {...props}>
            {children}
          </code>
        );
      },
    }),
    [],
  );

  // ----- Rendering (safe conditional) -----
  return (
    <div className='relative min-h-full bg-background dark:bg-[#1E1E1E] font-sans'>
      {loading && <LoadingSpinner />}
      {error && !loading && <ErrorDisplay error={error} />}

      {!loading && !error && markdownContent && (
        <div className='min-h-screen px-10 py-10 md:px-15 lg:px-20'>
          <div className='max-w-4xl mx-auto'>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, rehypeRaw]}
              components={markdownComponents}
            >
              {markdownContent}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
});

ReadmeViewer.displayName = 'ReadmeViewer';
export default ReadmeViewer;
