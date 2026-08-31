import React, { useEffect, useState, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Components } from 'react-markdown';
import { BaseViewerProps } from './utils';

// Sanitize schema for file-provided markdown. Starts from rehype-sanitize's
// safe defaults (scripts / event handlers stripped; img `src` and anchor
// `href` restricted to http(s)/mailto) and additionally preserves the
// `checked` attribute so GFM task-list checkboxes still render their state.
const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    input: [...(defaultSchema.attributes?.['input'] ?? []), 'checked'],
  },
};

// Loading spinner
const LoadingSpinner: React.FC = () => (
  <div className='absolute inset-0 flex items-center justify-center bg-background/90 z-10'>
    <div className='text-center'>
      <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-border mx-auto mb-4'></div>
      <p className='text-muted-foreground'>Loading document...</p>
    </div>
  </div>
);

// Error box
const ErrorDisplay: React.FC<{ error: string }> = ({ error }) => (
  <div className='absolute inset-0 flex items-center justify-center bg-background z-10'>
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
  // NOTE: Colors here use CSS-variable design tokens (text-foreground,
  // text-muted-foreground, border-border, bg-muted). These flip with the
  // active `data-theme`. We deliberately do NOT use Tailwind `dark:` variants
  // for text color: this app themes via `data-theme` + CSS variables and does
  // not consistently drive Tailwind's `.dark` class, so `dark:` text colors
  // can diverge from the surface background and become invisible. Every text
  // node must carry an explicit token color so nothing relies on inherited
  // ambient color.
  const markdownComponents: Components = useMemo(
    () => ({
      h1: ({ children }) => (
        <h1 className='text-4xl font-bold text-foreground mb-6 pb-2 border-b border-border'>
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className='text-3xl font-semibold text-foreground mb-5 mt-8 pb-2 border-b border-border'>
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className='text-2xl font-semibold text-foreground mb-4 mt-6'>{children}</h3>
      ),
      h4: ({ children }) => (
        <h4 className='text-xl font-semibold text-foreground mb-3 mt-5'>{children}</h4>
      ),
      h5: ({ children }) => (
        <h5 className='text-lg font-semibold text-foreground mb-2 mt-4'>{children}</h5>
      ),
      h6: ({ children }) => (
        <h6 className='text-base font-semibold text-muted-foreground mb-2 mt-4'>{children}</h6>
      ),
      p: ({ children }) => <p className='text-foreground leading-relaxed mb-4'>{children}</p>,
      a: ({ href, children }) => (
        <a
          href={href}
          className='text-action-primary hover:text-action-primary/80 underline'
          target='_blank'
          rel='noopener noreferrer'
        >
          {children}
        </a>
      ),
      ul: ({ children }) => (
        <ul className='list-disc pl-6 mb-4 space-y-1 text-foreground'>{children}</ul>
      ),
      ol: ({ children }) => (
        <ol className='list-decimal pl-6 mb-4 space-y-1 text-foreground'>{children}</ol>
      ),
      li: ({ children }) => <li className='text-foreground leading-relaxed'>{children}</li>,
      strong: ({ children }) => (
        <strong className='font-semibold text-foreground'>{children}</strong>
      ),
      em: ({ children }) => <em className='italic text-foreground'>{children}</em>,
      del: ({ children }) => <del className='line-through text-muted-foreground'>{children}</del>,
      blockquote: ({ children }) => (
        <blockquote className='border-l-4 border-border pl-4 italic text-muted-foreground my-4'>
          {children}
        </blockquote>
      ),
      hr: () => <hr className='border-border my-6' />,
      img: ({ src, alt }) => <img src={src} alt={alt} className='max-w-full h-auto rounded my-4' />,
      table: ({ children }) => (
        <div className='overflow-x-auto mb-4'>
          <table className='w-full border-collapse text-foreground'>{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className='bg-muted'>{children}</thead>,
      th: ({ children }) => (
        <th className='border border-border px-3 py-2 text-left font-semibold text-foreground'>
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className='border border-border px-3 py-2 text-foreground align-top'>{children}</td>
      ),
      pre: ({ children }) => (
        <pre className='bg-muted border border-border rounded-lg p-4 mb-4 overflow-x-auto'>
          {children}
        </pre>
      ),
      code: ({ children, className, ...props }): React.ReactElement => {
        const isInline = !className?.includes('language-');
        if (isInline) {
          return (
            <code
              className='bg-muted text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded text-sm font-mono'
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
  // `text-foreground` on the root guarantees a theme-correct base color for any
  // element the component map does not explicitly cover.
  return (
    <div className='relative min-h-full bg-background text-foreground font-sans'>
      {loading && <LoadingSpinner />}
      {error && !loading && <ErrorDisplay error={error} />}

      {!loading && !error && markdownContent && (
        <div className='min-h-screen px-10 py-10 md:px-15 lg:px-20'>
          <div className='max-w-4xl mx-auto'>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeHighlight]}
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
