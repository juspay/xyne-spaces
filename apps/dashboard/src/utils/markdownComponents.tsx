import React, { useState } from 'react';
import { logger, Event } from './logger';
import { openLink } from './openLink';
import { Check, Copy } from 'lucide-react';
import type { Element } from 'hast';
import type { Components } from 'react-markdown';
import { MermaidBlock } from '../components/Markdown/MermaidBlock';
import { FilesystemBlock } from '../components/Markdown/FilesystemBlock';
import { D2Block } from '../components/Markdown/D2Block';
import { ClawCitationGroup } from '../components/Chat/XyneAISidebar/components/ClawCitationGroup';
import { ThreadCitationChip } from '../components/ui/MessageBubble/ThreadCitationChip';
import { parseCiteGroupHref } from '../components/ui/TipTapExtensions/CitationMark';
import { InternalXyneLink } from '../components/Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import {
  getAnchorTargetProps,
  parseInternalXyneLink,
} from '../components/Chat/RenderMessageWithHTML/internalLinkUtils';
import type { ToolInvocation } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

/**
 * Optional claw-citation context. When passed, the `a` override intercepts the
 * synthetic `cite:` / `cite-group:` hrefs produced by `linkifyAndGroupClawCitations`
 * and substitutes clickable citation chips. Absent for every non-agent markdown
 * surface, which keeps the default link behavior untouched.
 */
export interface ClawCitationContext {
  /** Slimmed toolInvocations (toolCallId + Citation[]) baked into the message. */
  toolInvocations: ToolInvocation[];
  /** Stable `toolCallId → display number` map (from buildClawCitationToolNumbers). */
  toolNumbers: ReadonlyMap<string, number>;
}

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

  if (language === 'filesystem') {
    return (
      <FilesystemBlock
        jsonSource={codeString}
        messageId={(props as { messageId: string }).messageId}
      />
    );
  }

  if (language === 'd2') {
    const looksLikeFilesystemJson = codeString.trimStart().startsWith('{');
    return looksLikeFilesystemJson ? (
      <FilesystemBlock
        jsonSource={codeString}
        messageId={(props as { messageId: string }).messageId}
      />
    ) : (
      <D2Block source={codeString} messageId={(props as { messageId: string }).messageId} />
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
    <div className='xyne-code-block my-3 rounded-lg overflow-hidden border border-border max-w-full'>
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
export const createMarkdownComponents = (
  messageId: string,
  citationCtx?: ClawCitationContext,
): Components => ({
  // Override <code> — handles both inline and block (via className presence)
  code: (props: CodeProps): React.ReactElement => <CodeBlock {...props} messageId={messageId} />,

  // Override <pre> to render a plain fragment — CodeBlock renders its own <pre>
  // internally, so we don't want a double-wrapped <pre><pre>.
  pre: ({
    children,
  }: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }): React.ReactElement => (
    <>{children}</>
  ),

  // Override <table> — wrap in a scrollable container so wide tables scroll
  // horizontally instead of overflowing the message bubble or entire view.
  table: ({
    children,
    ...props
  }: React.TableHTMLAttributes<HTMLTableElement> & {
    children?: React.ReactNode;
  }): React.ReactElement => (
    <div style={{ overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}>
      <table {...props}>{children}</table>
    </div>
  ),

  a: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: React.ReactNode;
  }): React.ReactElement => {
    // Claw inline citations: `linkifyAndGroupClawCitations` rewrites
    // `[clf-<toolCallId>#<N>]` tokens into synthetic `cite:` / `cite-group:`
    // hrefs. Intercept them here and substitute a chip that resolves against the
    // citation metadata baked into the message. Only runs on agent surfaces that
    // pass `citationCtx`; every other markdown message falls through unchanged.
    if (citationCtx) {
      if (href && href.startsWith('cite-group:')) {
        const groupRefs = parseCiteGroupHref(href);
        if (groupRefs.length >= 2) {
          return (
            <ClawCitationGroup refs={groupRefs} toolInvocations={citationCtx.toolInvocations} />
          );
        }
      }
      if (href && href.startsWith('cite:clf-')) {
        const body = href.slice('cite:clf-'.length);
        const hashIdx = body.lastIndexOf('#');
        if (hashIdx > 0) {
          const toolCallId = body.slice(0, hashIdx);
          const chunkIndex = Number(body.slice(hashIdx + 1));
          const toolNumber = citationCtx.toolNumbers.get(toolCallId) ?? 0;
          if (toolNumber > 0 && Number.isFinite(chunkIndex)) {
            return (
              <ThreadCitationChip
                toolCallId={toolCallId}
                chunkIndex={chunkIndex}
                toolNumber={toolNumber}
                toolInvocations={citationCtx.toolInvocations}
              />
            );
          }
        }
      }
    }

    // Keep Markdown messages consistent with the regular HTML message path.
    // Automation SEND_MESSAGE stores content as Markdown, so without this
    // branch internal Xyne links render as unstyled browser anchors even
    // though they are valid clickable links.
    if (href && parseInternalXyneLink(href)) {
      return (
        <InternalXyneLink
          href={href}
          {...props}
          {...getAnchorTargetProps(href)}
          className={props.className ?? 'text-primary'}
        >
          {children}
        </InternalXyneLink>
      );
    }

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
      const handleClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
        if (!href) return;
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) {
          logger.info(Event.BROWSER_LINK_CMD_CLICK, { url: href });
        }
        openLink(href, event);
      };
      return (
        <a
          href={href}
          target='_blank'
          rel='noopener noreferrer'
          onClick={handleClick}
          data-track-category='MESSAGE'
          data-track-name='OPEN_EXTERNAL_LINK'
          {...props}
          className={props.className ?? 'text-primary hover:underline'}
        >
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
