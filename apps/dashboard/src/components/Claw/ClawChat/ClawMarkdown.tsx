import { useCallback, useMemo, useRef } from 'react';
import type { ReactElement, ReactNode, AnchorHTMLAttributes, HTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { Components } from 'react-markdown';
import type { Element } from 'hast';
import { cn } from '../../../utils/classNames';
import {
  StreamingMarkdownBlocks,
  type MarkdownBlockRenderer,
} from '../../utils/StreamingMarkdownBlocks';
import {
  buildClawCitationToolNumbers,
  linkifyAndGroupClawCitations,
  parseCiteGroupHref,
} from '../../ui/TipTapExtensions/CitationMark';
import { ClawCitationGroup } from '../../Chat/XyneAISidebar/components/ClawCitationGroup';
import {
  buildClawCitationUrl,
  findCitationForChunk,
  getClawCitationLabel,
  resolveCitationIconUrl,
} from '../../Chat/XyneAISidebar/utils/clawCitationUrl';
import type { ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';

interface ExtraProps {
  node?: Element | undefined;
}

function ClawMarkdownLink({
  href,
  children,
}: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps): ReactElement {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    if (href && /^https?:\/\//i.test(href)) {
      window.electronAPI?.openExternal?.(href);
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      data-track-category='CLAW_CHAT'
      data-track-name='MARKDOWN_LINK_CLICK'
      className='underline underline-offset-2 opacity-90 hover:opacity-100'
    >
      {children}
    </a>
  );
}

const components: Components = {
  p: ({ children }: { children?: ReactNode } & ExtraProps): ReactElement => (
    <p className='mb-2 whitespace-pre-wrap break-words last:mb-0'>{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode } & ExtraProps): ReactElement => (
    <ul className='mb-2 list-disc space-y-1 pl-5 last:mb-0'>{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode } & ExtraProps): ReactElement => (
    <ol className='mb-2 list-decimal space-y-1 pl-5 last:mb-0'>{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode } & ExtraProps): ReactElement => (
    <li className='leading-relaxed'>{children}</li>
  ),
  h1: ({ children }: { children?: ReactNode } & ExtraProps): ReactElement => (
    <h1 className='mb-2 mt-3 text-base font-semibold first:mt-0'>{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode } & ExtraProps): ReactElement => (
    <h2 className='mb-1.5 mt-3 text-sm font-semibold first:mt-0'>{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode } & ExtraProps): ReactElement => (
    <h3 className='mb-1 mt-2 text-sm font-medium first:mt-0'>{children}</h3>
  ),
  a: ClawMarkdownLink,

  table: ({ children }: { children?: ReactNode } & ExtraProps): ReactElement => (
    <div className='mb-2 overflow-x-auto last:mb-0'>
      <table className='w-full border-collapse border-current/20 text-xs'>{children}</table>
    </div>
  ),

  code: ({ className, children }: HTMLAttributes<HTMLElement> & ExtraProps): ReactElement => {
    const isBlock = Boolean(className);
    if (!isBlock) {
      return (
        <code className='rounded bg-current/10 px-1 py-0.5 font-mono text-[0.85em]'>
          {children}
        </code>
      );
    }
    return <code className={cn('font-mono text-xs', className)}>{children}</code>;
  },
  pre: ({ children }: { children?: ReactNode } & ExtraProps): ReactElement => (
    <pre className='mb-2 overflow-x-auto rounded-lg border border-current/20 bg-current/10 p-3 text-xs leading-relaxed last:mb-0'>
      {children}
    </pre>
  ),
};

function ClawCitationLink({
  href,
  children,
  toolInvocations,
}: AnchorHTMLAttributes<HTMLAnchorElement> &
  ExtraProps & { toolInvocations: ToolInvocation[] | undefined }): ReactElement {
  if (href?.startsWith('cite-group:')) {
    const refs = parseCiteGroupHref(href);
    if (refs.length > 1) {
      return <ClawCitationGroup refs={refs} toolInvocations={toolInvocations} />;
    }
  }

  if (href?.startsWith('cite:clf-')) {
    const body = href.slice('cite:clf-'.length);
    const hashIndex = body.lastIndexOf('#');
    const toolCallId = body.slice(0, hashIndex);
    const chunkIndex = Number(body.slice(hashIndex + 1));
    const citation = findCitationForChunk(toolInvocations, toolCallId, chunkIndex);
    const url = citation ? buildClawCitationUrl(citation) : null;
    const label = citation ? getClawCitationLabel(citation) : 'Citation';
    const iconUrl = resolveCitationIconUrl(citation);
    const content = (
      <>
        {iconUrl && (
          <img src={iconUrl} alt='' aria-hidden className='size-3 shrink-0 object-contain' />
        )}
        <span className='min-w-0 truncate'>{citation ? label : children}</span>
      </>
    );
    const className =
      'inline-flex h-5 max-w-[180px] items-center gap-1 rounded-xl border border-current/20 px-1.5 align-middle text-[10px] font-medium no-underline transition-colors hover:bg-current/10';

    return url ? (
      <a href={url} title={label} className={className}>
        {content}
      </a>
    ) : (
      <span title={label} className={className}>
        {content}
      </span>
    );
  }

  return <ClawMarkdownLink href={href}>{children}</ClawMarkdownLink>;
}

interface ClawMarkdownProps {
  content: string;
  className?: string;
  toolInvocations?: ToolInvocation[] | undefined;
  isStreaming?: boolean | undefined;
}

export function ClawMarkdown({
  content,
  className,
  toolInvocations,
  isStreaming,
}: ClawMarkdownProps): ReactElement {
  const everStreamedRef = useRef(isStreaming === true);
  if (isStreaming) everStreamedRef.current = true;

  const renderedContent = useMemo(() => {
    const toolNumbers = buildClawCitationToolNumbers(content);
    return linkifyAndGroupClawCitations(content, toolNumbers);
  }, [content]);
  const markdownComponents = useMemo<Components>(
    () => ({
      ...components,
      a: props => <ClawCitationLink {...props} toolInvocations={toolInvocations} />,
    }),
    [toolInvocations],
  );

  const renderBlock = useCallback<MarkdownBlockRenderer>(
    markdown => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={url => url}
        components={markdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    ),
    [markdownComponents],
  );

  return (
    <div className={cn('claw-markdown', className)}>
      {everStreamedRef.current ? (
        <StreamingMarkdownBlocks content={renderedContent} render={renderBlock} />
      ) : (
        renderBlock(renderedContent)
      )}
    </div>
  );
}
