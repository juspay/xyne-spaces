import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Element } from 'hast';
import type { Components } from 'react-markdown';
import { MermaidBlock } from '../components/Markdown/MermaidBlock';
import { FilesystemBlock } from '../components/Markdown/FilesystemBlock';

// ─── Code Block ──────────────────────────────────────────────────────────────

interface CodeProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
  // Must match react-markdown's ExtraProps exactly (with exactOptionalPropertyTypes)
  node?: Element | undefined;
}

const CodeBlock = ({
  className,
  children,
  node: _node,
  ...props
}: CodeProps & { messageId: string }): React.ReactElement => {
  const [copied, setCopied] = useState(false);

  const match = /language-(\w+)/.exec(String(className ?? ''));
  const language = match ? match[1] : '';

  const codeString = Array.isArray(children)
    ? children.join('')
    : typeof children === 'string'
      ? children.replace(/\n$/, '')
      : '';

  // ── Mermaid ──
  if (language === 'mermaid') {
    return (
      <MermaidBlock chart={codeString} messageId={(props as { messageId: string }).messageId} />
    );
  }

  // ── Filesystem interactive graph ──
  if (language === 'filesystem') {
    return (
      <FilesystemBlock
        jsonSource={codeString}
        messageId={(props as { messageId: string }).messageId}
      />
    );
  }

  // ── Inline code — no className means no language fence ──
  // react-markdown passes inline <code> without a language- class
  const isBlock = Boolean(className);
  if (!isBlock) {
    return (
      <code
        className='bg-muted text-foreground font-mono text-[0.8em] px-1.5 py-0.5 rounded'
        {...props}
      >
        {children}
      </code>
    );
  }

  // ── Fenced code block ──
  const handleCopy = (): void => {
    void navigator.clipboard.writeText(codeString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className='xyne-code-block my-3 rounded-lg overflow-hidden border border-border'>
      {/* Header bar */}
      <div className='flex items-center justify-between px-4 py-2 bg-muted border-b border-border'>
        <span className='text-xs font-mono text-muted-foreground select-none'>
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
          title='Copy code'
          data-track-category='xyne-ai'
          data-track-name='copy-code-block'
        >
          {copied ? (
            <>
              <Check size={12} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className='overflow-x-auto p-4 bg-[#f6f8fa] m-0 text-sm leading-6 text-[#1d1e1f]'>
        <code className={className} style={{ color: 'inherit' }} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
};

// ─── createMarkdownComponents ─────────────────────────────────────────────────

/**
 * Creates markdown components configuration with:
 * - Fenced code blocks rendered as styled snippets with language label + copy button
 * - Inline code rendered with a subtle background pill
 * - Mermaid diagram support
 * - External link handling
 */
export const createMarkdownComponents = (messageId: string): Components => ({
  // Override <code> — handles both inline and block (via className presence)
  code: (props: CodeProps): React.ReactElement => <CodeBlock {...props} messageId={messageId} />,

  // Override <pre> to render a plain fragment — CodeBlock renders its own <pre>
  // internally, so we don't want a double-wrapped <pre><pre>.
  pre: ({
    children,
  }: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }): React.ReactElement => (
    <>{children}</>
  ),

  a: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: React.ReactNode;
  }): React.ReactElement => {
    const isExternal = ((): boolean => {
      if (!href) return false;
      try {
        const urlObj = new URL(href, window.location.origin);
        return urlObj.origin !== window.location.origin;
      } catch {
        return true;
      }
    })();

    if (isExternal) {
      return (
        <a href={href} target='_blank' rel='noopener noreferrer' {...props}>
          {children}
        </a>
      );
    }

    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
});
