import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from './cn.js';
import { JsonView, tryParseJson } from './JsonView.js';
import { MarkdownCitation } from './MarkdownCitation.js';
import { remarkCitationDirective, citationSanitizeSchema } from './markdown-citation-directive.js';

export interface MarkdownViewProps {
  /** Raw markdown source. */
  children: string;
  className?: string | undefined;
  /**
   * Drop the default body typography (`text-[13px] text-[var(--wui-fg)]`) so the
   * caller's `className` fully controls size/colour — used when embedding
   * markdown into an existing styled slot (a label, reason line, theme vars).
   */
  bare?: boolean | undefined;
}

/**
 * Renders markdown (GitHub-flavored) to safe React nodes — no
 * `dangerouslySetInnerHTML`. Used for the workflow summary in both the builder
 * preview and the run view. Styling is intentionally compact/self-contained so
 * it works without a Tailwind typography plugin.
 */
export function MarkdownView({ children, className, bare }: MarkdownViewProps) {
  return (
    <div className={cn('wui-markdown min-w-0 max-w-full', !bare && 'text-[13px] leading-relaxed text-[var(--wui-fg)]', className)}>
      <ReactMarkdown
        // remarkDirective must precede remarkCitationDirective (the nodes have to
        // exist before we map them). rehypeRaw stays ahead of rehypeSanitize so
        // raw HTML is still sanitized — our <citation> survives the round-trip
        // because the schema below admits it.
        remarkPlugins={[remarkGfm, remarkDirective, remarkCitationDirective]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, citationSanitizeSchema]]}
        // `citation` isn't an intrinsic element, so the map needs the cast;
        // hast-util-to-jsx-runtime dispatches any tag present here by name.
        components={{
          h1: ({ node: _n, ...p }) => <h1 className="mb-2.5 mt-4 border-b border-[var(--wui-border)] pb-1.5 text-[15px] font-semibold text-[var(--wui-fg)] first:mt-0" {...p} />,
          h2: ({ node: _n, ...p }) => <h2 className="mb-2 mt-4 border-b border-[var(--wui-border)] pb-1 text-[13.5px] font-semibold text-[var(--wui-fg)] first:mt-0" {...p} />,
          h3: ({ node: _n, ...p }) => <h3 className="mb-1.5 mt-3 text-[12.5px] font-semibold text-[var(--wui-fg)] first:mt-0" {...p} />,
          p: ({ node: _n, ...p }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...p} />,
          ul: ({ node: _n, ...p }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-[var(--wui-fg-muted)]" {...p} />,
          ol: ({ node: _n, ...p }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-[var(--wui-fg-muted)]" {...p} />,
          li: ({ node: _n, ...p }) => <li className="pl-0.5 leading-relaxed" {...p} />,
          a: ({ node: _n, ...p }) => <a className="font-medium text-[var(--wui-primary)] underline underline-offset-2 hover:text-[var(--wui-primary-hover)]" target="_blank" rel="noreferrer noopener" {...p} />,
          code: ({ node: _n, className: c, ...p }) =>
            c?.includes('language-') ? (
              <code className={cn('font-mono text-[12px]', c)} {...p} />
            ) : (
              <code className="rounded-[4px] border border-[var(--wui-border)] bg-[var(--wui-bg-muted)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--wui-fg)]" {...p} />
            ),
          // Block code: the <pre> owns the styling and neutralizes the inline-code
          // chrome on its <code> child (an indented/no-language block otherwise gets
          // the inline-code background, leaving boxes inside the block).
          pre: ({ node: _n, children, ...p }) => {
            // A fenced block whose body is JSON renders as a collapsible tree.
            const child = Array.isArray(children) ? children[0] : children;
            const raw = child && typeof child === 'object' && 'props' in child
              ? (child as { props?: { children?: unknown } }).props?.children
              : undefined;
            const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map(String).join('') : '';
            const json = tryParseJson(text);
            if (json !== undefined) {
              return (
                <div className="my-2.5 overflow-x-auto rounded-lg border border-[var(--wui-border)] bg-[var(--wui-bg-muted)] p-3">
                  <JsonView data={json} />
                </div>
              );
            }
            return <pre className="my-2.5 overflow-x-auto rounded-lg border border-[var(--wui-border)] bg-[var(--wui-bg-muted)] p-3.5 text-[12px] leading-relaxed text-[var(--wui-fg)] [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit [&_code]:ring-0" {...p}>{children}</pre>;
          },
          blockquote: ({ node: _n, ...p }) => <blockquote className="my-2.5 border-l-[3px] border-[var(--wui-border-strong)] pl-3.5 text-[var(--wui-fg-muted)]" {...p} />,
          // GitHub-style tables: rounded bordered frame, header fill, zebra rows,
          // and cell separators — scrolls horizontally inside the frame when wide.
          table: ({ node: _n, ...p }) => (
            <div className="my-3 max-w-full overflow-hidden rounded-lg border border-[var(--wui-border)]">
              <div className="max-w-full overflow-x-auto">
                <table className="w-full border-collapse text-[12px] [&_tbody_tr:nth-child(2n)]:bg-[color-mix(in_srgb,var(--wui-fg)_4%,transparent)] [&_tbody_tr:last-child_td]:border-b-0" {...p} />
              </div>
            </div>
          ),
          th: ({ node: _n, ...p }) => <th className="border-b border-[var(--wui-border)] bg-[var(--wui-bg-muted)] px-3 py-2 text-left font-semibold text-[var(--wui-fg)] [&:not(:last-child)]:border-r [&:not(:last-child)]:border-[var(--wui-border)]" {...p} />,
          td: ({ node: _n, ...p }) => <td className="border-b border-[var(--wui-border)] px-3 py-2 align-top text-[var(--wui-fg)] [&:not(:last-child)]:border-r [&:not(:last-child)]:border-[var(--wui-border)]" {...p} />,
          hr: ({ node: _n, ...p }) => <hr className="my-4 border-t border-[var(--wui-border)]" {...p} />,
          citation: MarkdownCitation,
        } as Components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
