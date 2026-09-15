import React, { useEffect, useRef, useState } from 'react';
import { logger, Event } from './logger';
import { openLink } from './openLink';
import type { Element } from 'hast';
import type { Components } from 'react-markdown';
import { CopyCopied, CopyDefault, MaximizeTwoArrow } from '@xyne/icons';
import { copyTextToClipboard } from './clipboardUtils';
import { MermaidBlock } from '../components/Markdown/MermaidBlock';
import { FilesystemBlock } from '../components/Markdown/FilesystemBlock';
import { D2Block } from '../components/Markdown/D2Block';
import { ChartBlock } from '../components/Markdown/ChartBlock';
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

const CODE_BLOCK_COLLAPSE_THRESHOLD = 50;
const CODE_BLOCK_PREVIEW_MAX_HEIGHT = 20 * 20 + 16;

const FencedCodeBlock = ({
  children,
  codeText,
}: {
  children: React.ReactNode;
  codeText: string;
}): React.ReactElement => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const resetTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => (): void => {
      if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const handleCopy = (): void => {
    void copyTextToClipboard(codeText)
      .then(() => {
        setCopied(true);
        resetTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
      })
      .catch((error: unknown) => {
        logger.error(Event.FRONTEND_ERROR, {
          message: 'Failed to copy code snippet to clipboard',
          error,
        });
      });
  };

  const lines = codeText.length > 0 ? codeText.replace(/\n$/, '').split('\n').length : 0;
  const collapsible = lines > CODE_BLOCK_COLLAPSE_THRESHOLD;

  return (
    <div className='xyne-code-block group/code-block relative my-3 max-w-full overflow-hidden rounded-[10px] border border-border bg-muted'>
      <div
        className='relative overflow-hidden'
        style={
          collapsible && !isExpanded
            ? { maxHeight: `${CODE_BLOCK_PREVIEW_MAX_HEIGHT}px` }
            : undefined
        }
      >
        {children}
        {collapsible && (
          <div
            className={
              isExpanded
                ? 'flex justify-center pb-2'
                : 'pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pt-8 pb-3'
            }
            style={
              isExpanded
                ? undefined
                : {
                    backgroundImage: 'linear-gradient(to bottom, transparent, hsl(var(--muted)))',
                  }
            }
          >
            <button
              type='button'
              onClick={() => setIsExpanded(prev => !prev)}
              className='expand-toggle-pill pointer-events-auto flex items-center gap-1 rounded-full bg-background px-2.5 py-1.5 text-[13px] leading-none text-foreground transition-colors hover:bg-muted cursor-pointer'
              data-track-category='MESSAGE'
              data-track-name='TOGGLE_CODE_BLOCK'
              data-track-metadata={JSON.stringify({ isExpanded, lineCount: lines })}
            >
              <MaximizeTwoArrow size={16} className={isExpanded ? 'rotate-180' : undefined} />
              <span>{isExpanded ? 'Show less' : `Show more (${lines} lines)`}</span>
            </button>
          </div>
        )}
      </div>

      <button
        type='button'
        onClick={handleCopy}
        className='absolute right-2 top-2 z-10 flex items-center rounded-md border border-border bg-background p-0.5 text-muted-foreground opacity-100 shadow-sm transition-opacity hover:text-foreground md:opacity-0 group-hover/code-block:opacity-100 focus-visible:opacity-100'
        aria-label='Copy code snippet'
        title='Copy code snippet'
        data-track-category='MESSAGE'
        data-track-name='COPY_CODE_SNIPPET'
      >
        <span className='flex items-center justify-center p-1'>
          {copied ? (
            <CopyCopied size={16} className='text-status-success' />
          ) : (
            <CopyDefault size={16} />
          )}
        </span>
      </button>
      <span aria-live='polite' className='sr-only'>
        {copied ? 'Code snippet copied to clipboard' : ''}
      </span>
    </div>
  );
};

const CodeBlock = ({
  className,
  children,
  node: _node,
  messageId,
  ...props
}: CodeProps & { messageId: string }): React.ReactElement => {
  const match = /language-(\w+)/.exec(String(className ?? ''));
  const language = match ? match[1] : '';

  const codeString = Array.isArray(children)
    ? children.join('')
    : typeof children === 'string'
      ? children.replace(/\n$/, '')
      : '';

  // ── Mermaid ──
  if (language === 'mermaid') {
    return <MermaidBlock chart={codeString} messageId={messageId} />;
  }

  if (language === 'filesystem') {
    return <FilesystemBlock jsonSource={codeString} messageId={messageId} />;
  }

  if (language === 'd2') {
    const looksLikeFilesystemJson = codeString.trimStart().startsWith('{');
    return looksLikeFilesystemJson ? (
      <FilesystemBlock jsonSource={codeString} messageId={messageId} />
    ) : (
      <D2Block source={codeString} messageId={messageId} />
    );
  }

  // ── Chart (visualize tool output) ──
  if (language === 'chart') {
    return <ChartBlock jsonSource={codeString} messageId={messageId} />;
  }

  // ── Inline code — no className means no language fence ──
  // react-markdown passes inline <code> without a language- class
  const isBlock = Boolean(className);
  if (!isBlock) {
    return (
      <code
        className='bg-muted border border-border rounded-md px-1 py-0.5 text-[0.85em] font-mono font-medium text-primary'
        {...props}
      >
        {children}
      </code>
    );
  }

  // ── Fenced code block ──
  return (
    <FencedCodeBlock codeText={codeString}>
      <pre className='bg-muted m-0 px-4 py-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[0.875rem] leading-5 text-foreground'>
        <code className={className} style={{ color: 'inherit' }} {...props}>
          {children}
        </code>
      </pre>
    </FencedCodeBlock>
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
    <div className='overflow-x-auto max-w-full'>
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
