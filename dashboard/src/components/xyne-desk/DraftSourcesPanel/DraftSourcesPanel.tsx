import { type ReactElement, useMemo } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import type { DraftSource } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import type { InlineCitation } from '../../ui/TipTapExtensions/CitationMark';
import { cn } from '../../../utils/classNames';

interface DraftSourcesPanelProps {
  sources?: DraftSource[];
  inlineCitations?: InlineCitation[];
  embedded?: boolean;
  highlightedRef?: string | null;
  loading?: boolean;
}

export function filterUsefulSources(sources: DraftSource[] | undefined): DraftSource[] {
  if (!sources || sources.length === 0) return [];
  const seen = new Set<string>();
  const out: DraftSource[] = [];
  for (const s of sources) {
    if (!s.prefixedRef || seen.has(s.prefixedRef)) continue;
    seen.add(s.prefixedRef);
    out.push(s);
  }
  return out;
}

function parseCitationUrl(url: string | null | undefined): URL | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  try {
    const parsed = trimmed.startsWith('/')
      ? new URL(trimmed, window.location.origin)
      : new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

export function isOpenableCitationUrl(url: string | null | undefined): boolean {
  const parsed = parseCitationUrl(url);
  if (!parsed) return false;

  if (parsed.origin !== window.location.origin) return true;

  const workspaceId = window.location.pathname.split('/').filter(Boolean)[0];
  if (!workspaceId) return false;
  return parsed.pathname === `/${workspaceId}` || parsed.pathname.startsWith(`/${workspaceId}/`);
}

function SourcesSkeleton(): ReactElement {
  return (
    <ul className='flex flex-col gap-1.5 pb-1' aria-label='Loading sources'>
      {[0, 1, 2].map(i => (
        <li
          key={i}
          className='flex items-start gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5'
        >
          <div className='mt-0.5 h-[18px] w-[18px] flex-shrink-0 rounded-md bg-muted animate-pulse' />
          <div className='min-w-0 flex-1 space-y-1.5 py-0.5'>
            <div className='h-2.5 w-24 rounded bg-muted animate-pulse' />
            <div className='h-2.5 w-full rounded bg-muted animate-pulse' />
            <div className='h-2.5 w-2/3 rounded bg-muted animate-pulse' />
          </div>
        </li>
      ))}
    </ul>
  );
}

function CitationRow({
  citation,
  index,
}: {
  citation: InlineCitation;
  index: number;
}): ReactElement {
  return (
    <li className='flex items-start gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-left text-xs w-full'>
      <span className='mt-0.5 flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-[10px] font-semibold tabular-nums'>
        {index + 1}
      </span>
      <div className='min-w-0 flex-1'>
        <p className='text-foreground/90 line-clamp-2 break-words'>{citation.point}</p>
        {citation.url ? (
          <a
            href={citation.url}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-1 mt-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300 hover:underline'
            data-track-category='AIDraft'
            data-track-name='OpenInlineCitation'
          >
            {citation.label}
            <ExternalLink size={10} />
          </a>
        ) : (
          <span className='text-[10px] font-semibold text-muted-foreground mt-0.5'>
            {citation.label}
          </span>
        )}
      </div>
    </li>
  );
}

export const DraftSourcesPanel = ({
  sources,
  inlineCitations,
  embedded = false,
  highlightedRef = null,
  loading = false,
}: DraftSourcesPanelProps): ReactElement | null => {
  const dedupedSources = useMemo(() => filterUsefulSources(sources), [sources]);
  const visibleSources = dedupedSources;
  const visibleInlineCitations = useMemo(
    () => (inlineCitations ?? []).filter(citation => isOpenableCitationUrl(citation.url)),
    [inlineCitations],
  );
  const hasInlineCitations = visibleInlineCitations.length > 0;

  if (!hasInlineCitations && visibleSources.length === 0) {
    if (!embedded) return null;
    if (loading) return <SourcesSkeleton />;
    return (
      <div className='flex flex-col items-center justify-center py-12 text-center text-xs text-muted-foreground'>
        <FileText size={20} className='mb-2 opacity-40' />
        No sources found for this draft&apos;s citations.
      </div>
    );
  }

  const sourceList = (
    <ul
      className={cn(
        'flex flex-col gap-1.5',
        embedded ? 'pb-1' : 'px-4 pb-3 max-h-72 overflow-y-auto',
      )}
    >
      {visibleInlineCitations.map((c, idx) => (
        <CitationRow key={`cite-${idx}`} citation={c} index={idx} />
      ))}
      {visibleSources.map((source, idx) => (
        <DraftSourceRow
          key={`${source.prefixedRef}-${source.entityId ?? source.messageId ?? source.canvasId ?? ''}`}
          source={source}
          isHighlighted={source.prefixedRef === highlightedRef}
          displayNumber={hasInlineCitations ? undefined : idx + 1}
        />
      ))}
    </ul>
  );

  if (embedded) return sourceList;

  return (
    <div className='mb-4 rounded-xl border border-border/60 bg-muted/20'>
      <button
        type='button'
        onClick={() => {}}
        className='flex w-full items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors'
        data-track-category='AIDraft'
        data-track-name='ToggleSources'
      >
        <span className='inline-flex items-center gap-1.5'>
          AI sources used ({visibleInlineCitations.length + visibleSources.length})
        </span>
        <span className='text-[10px] font-normal text-muted-foreground/70'>
          Click any source to verify
        </span>
      </button>
      {sourceList}
    </div>
  );
};

function DraftSourceRow({
  source,
  isHighlighted = false,
  displayNumber,
}: {
  source: DraftSource;
  isHighlighted?: boolean;
  displayNumber?: number | undefined;
}): ReactElement {
  const preview = source.chunkText?.trim()
    ? source.chunkText
        .replace(/<\/?hi\b[^>]*>/gi, '')
        .replace(/<\/?[a-z][^>]*>/gi, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&/gi, '&')
        .replace(/</gi, '<')
        .replace(/>/gi, '>')
        .replace(/"/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140)
    : source.fileName || source.externalUrl || source.entityId || source.prefixedRef;

  return (
    <li
      className={cn(
        'flex items-start gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-left text-xs transition-colors w-full',
        isHighlighted && 'border-red-400 bg-red-50 dark:bg-red-950/40 ring-1 ring-red-300',
      )}
    >
      {displayNumber !== undefined ? (
        <span className='mt-0.5 flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-[10px] font-semibold tabular-nums'>
          {displayNumber}
        </span>
      ) : (
        <FileText size={13} className='mt-0.5 flex-shrink-0 text-muted-foreground' />
      )}
      <div className='min-w-0 flex-1'>
        <p className='text-foreground/90 line-clamp-2 break-words'>{preview}</p>
      </div>
    </li>
  );
}
