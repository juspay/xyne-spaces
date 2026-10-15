import { useMemo, useRef, useState, type ReactElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '../../../utils/classNames';
import { PreviewControls, PreviewSegmented, PreviewSkeletonView, usePreviewFind } from '../chrome';
import { createDomFinder } from '../find';
import { useFileText } from '../content';
import type { PreviewerProps } from '../types';
import { CodeLines } from './code/CodeLines';
import { CodeFontSizeControls } from './code/codeFontSize';

type View = 'rendered' | 'source';
const VIEWS = [
  { value: 'rendered', label: 'Preview' },
  { value: 'source', label: 'Source' },
] as const;

/**
 * GitHub's Markdown, in the app's colours: its sizes, spacing and rules — headings
 * ruled under, code in a tinted block, tables with banded rows, blue links — drawn
 * with the theme's own tokens, so it reads right in light and dark alike. Code is
 * coloured by the app's highlight theme, which has both.
 */
const MARKDOWN: Components = {
  h1: ({ node: _node, children, ...props }) => (
    <h1
      className='mb-4 mt-6 border-b border-border pb-[0.3em] text-[2em] font-semibold leading-tight first:mt-0'
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ node: _node, children, ...props }) => (
    <h2
      className='mb-4 mt-6 border-b border-border pb-[0.3em] text-[1.5em] font-semibold leading-tight first:mt-0'
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ node: _node, children, ...props }) => (
    <h3 className='mb-4 mt-6 text-[1.25em] font-semibold leading-tight first:mt-0' {...props}>
      {children}
    </h3>
  ),
  h4: ({ node: _node, children, ...props }) => (
    <h4 className='mb-4 mt-6 text-[1em] font-semibold leading-tight first:mt-0' {...props}>
      {children}
    </h4>
  ),
  h5: ({ node: _node, children, ...props }) => (
    <h5 className='mb-4 mt-6 text-[0.875em] font-semibold leading-tight first:mt-0' {...props}>
      {children}
    </h5>
  ),
  h6: ({ node: _node, children, ...props }) => (
    <h6
      className='mb-4 mt-6 text-[0.85em] font-semibold leading-tight text-muted-foreground first:mt-0'
      {...props}
    >
      {children}
    </h6>
  ),
  p: ({ node: _node, ...props }) => <p className='mb-4 mt-0' {...props} />,
  a: ({ node: _node, children, ...props }) => (
    <a
      className='outline-none text-[color:var(--link-color)] underline-offset-2 hover:text-[color:var(--link-hover-color)] focus-visible:text-[color:var(--link-hover-color)] hover:underline focus-visible:underline'
      target='_blank'
      rel='noopener noreferrer'
      {...props}
    >
      {children}
    </a>
  ),
  strong: ({ node: _node, ...props }) => <strong className='font-semibold' {...props} />,
  ul: ({ node: _node, ...props }) => (
    <ul
      className='mb-4 mt-0 list-disc pl-[2em] [&_ol]:mb-0 [&_ul]:mb-0 [&_ul]:list-[circle]'
      {...props}
    />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className='mb-4 mt-0 list-decimal pl-[2em] [&_ol]:mb-0 [&_ul]:mb-0' {...props} />
  ),
  // A task list's items carry their checkbox in place of the bullet, as on GitHub.
  li: ({ node: _node, ...props }) => (
    <li
      className='mt-1 has-[>input]:-ml-[1.4em] has-[>input]:list-none [&>input]:mr-2 [&>input]:align-middle [&>p]:mb-2'
      {...props}
    />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className='mb-4 mt-0 border-l-[0.25em] border-border px-[1em] text-muted-foreground [&>:last-child]:mb-0'
      {...props}
    />
  ),
  hr: ({ node: _node, ...props }) => (
    <hr className='my-6 h-[0.25em] rounded-sm border-0 bg-border' {...props} />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      className='mb-4 mt-0 overflow-x-auto rounded-md bg-muted/60 p-4 font-code text-[85%] leading-[1.45] [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[100%]'
      {...props}
    />
  ),
  // Code in a block is coloured, and is the block's: no chip of its own. The app's
  // dark highlight theme paints a background on it that only an inline style outranks.
  code: ({ node: _node, className, style, ...props }) =>
    className?.includes('hljs') ? (
      <code
        className={cn(className, 'font-code')}
        style={{ ...style, background: 'transparent', padding: 0 }}
        {...props}
      />
    ) : (
      <code
        className={cn(
          'whitespace-break-spaces rounded-md bg-muted/80 px-[0.4em] py-[0.2em] font-code text-[85%]',
          className,
        )}
        style={style}
        {...props}
      />
    ),
  table: ({ node: _node, ...props }) => (
    <div className='mb-4 mt-0 max-w-full overflow-x-auto'>
      <table
        className='w-max max-w-full border-collapse [&_tr:nth-child(2n)]:bg-muted/40'
        {...props}
      />
    </div>
  ),
  tr: ({ node: _node, ...props }) => <tr className='border-t border-border' {...props} />,
  th: ({ node: _node, ...props }) => (
    <th className='border border-border px-[13px] py-1.5 text-left font-semibold' {...props} />
  ),
  td: ({ node: _node, ...props }) => (
    <td className='border border-border px-[13px] py-1.5 align-top' {...props} />
  ),
  // Code's coloured tokens keep the monospace: the app sets its sans font on every
  // element directly, so they can't inherit it from the block.
  span: ({ node: _node, className, ...props }) => (
    <span className={cn(className, className?.includes('hljs-') && 'font-code')} {...props} />
  ),
  img: ({ node: _node, ...props }) => (
    <img className='max-w-full rounded-md bg-background' alt='' {...props} />
  ),
};

/** A Markdown file as the page it describes, or as its source. */
export default function MarkdownPreview(props: PreviewerProps): ReactElement {
  const text = useFileText(props.content);
  const [view, setView] = useState<View>('rendered');
  if (text === null) return <PreviewSkeletonView shape='document' />;

  return (
    <>
      <PreviewControls>
        {view === 'source' && <CodeFontSizeControls />}
        <PreviewSegmented label='View' value={view} options={VIEWS} onChange={setView} />
      </PreviewControls>
      {view === 'source' ? (
        <CodeLines text={text} language='markdown' wrap />
      ) : (
        <RenderedMarkdown text={text} />
      )}
    </>
  );
}

/** The page the Markdown describes, its text searchable from the frame's find. */
function RenderedMarkdown(props: { text: string }): ReactElement {
  const articleRef = useRef<HTMLElement | null>(null);
  const finder = useMemo(() => createDomFinder(() => articleRef.current), []);
  usePreviewFind(finder);
  return (
    <div className='h-full overflow-y-auto'>
      <article
        ref={articleRef}
        className='mx-auto max-w-[880px] break-words px-8 pb-16 pt-8 text-[15px] leading-normal text-foreground'
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          // Sanitised before it is coloured, so the colours' classes survive.
          rehypePlugins={[rehypeRaw, rehypeSanitize, [rehypeHighlight, { detect: false }]]}
          components={MARKDOWN}
        >
          {props.text}
        </ReactMarkdown>
      </article>
    </div>
  );
}
