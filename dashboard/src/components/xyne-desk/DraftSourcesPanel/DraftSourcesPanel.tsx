import { type ReactElement, useMemo } from 'react';
import { ExternalLink, FileText, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ClawCitation, ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import {
  buildClawCitationUrl,
  getClawCitationLabel,
  findCitationForChunk,
} from '../../Chat/XyneAISidebar/utils/clawCitationUrl';
import { extractClawCitationRefs } from '../../ui/TipTapExtensions/CitationMark';
import { cn } from '../../../utils/classNames';

interface DraftSourcesPanelProps {
  /** Auto-draft citations (from the desk-owner's claw conversation). */
  citations?: ClawCitation[];
  embedded?: boolean;
  loading?: boolean;
  /** Show the "sources are from the auto-generated draft only" info note. */
  showAutoDraftNote?: boolean;
}

function citationKey(c: ClawCitation): string {
  return (
    buildClawCitationUrl(c) ||
    `${c.kind}:${c.channelId ?? ''}:${c.conversationId ?? ''}:${c.ticketId ?? ''}:${c.viewAccessId ?? ''}`
  );
}

/**
 * Resolve the citations the agent actually cited in its FINAL response — i.e.
 * the inline `[clf-<toolCallId>#<chunkIndex>]` tokens in `content`, each mapped
 * to its citation on the matching tool invocation (same `findCitationForChunk`
 * the sidebar uses). NOT every citation from every tool call — only what the
 * answer references. Returned in citation order, deduped.
 */
export function resolveCitedClawCitations(
  content: string | null | undefined,
  toolInvocations: ToolInvocation[] | undefined,
): ClawCitation[] {
  if (!content || !toolInvocations || toolInvocations.length === 0) return [];
  const seen = new Set<string>();
  const out: ClawCitation[] = [];
  for (const ref of extractClawCitationRefs(content)) {
    const c = findCitationForChunk(toolInvocations, ref.toolCallId, ref.chunkIndex);
    if (!c) continue;
    const key = citationKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
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
          </div>
        </li>
      ))}
    </ul>
  );
}

function AutoDraftNote(): ReactElement {
  return (
    <div className='mb-2 flex items-start gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground'>
      <Info size={12} className='mt-0.5 flex-shrink-0 opacity-70' />
      <span>
        Sources shown are from the auto-generated draft only. For rerun / help-me-write sources,
        open them in the AI sidebar.
      </span>
    </div>
  );
}

function CitationRow({ citation, index }: { citation: ClawCitation; index: number }): ReactElement {
  const label = getClawCitationLabel(citation);
  const url = buildClawCitationUrl(citation);

  const rowClass = cn(
    'flex items-start gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-left text-xs transition-colors w-full',
    url && 'hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-950/20',
  );

  const inner = (
    <>
      <span className='mt-0.5 flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-[10px] font-semibold tabular-nums'>
        {index + 1}
      </span>
      <div className='min-w-0 flex-1'>
        <p className='inline-flex items-center gap-1 font-medium text-foreground/90 break-words'>
          {label}
          {url && <ExternalLink size={10} className='flex-shrink-0 opacity-70' />}
        </p>
      </div>
    </>
  );

  if (url) {
    return (
      <li>
        <Link
          to={url}
          className={rowClass}
          aria-label={label}
          data-track-category='AIDraft'
          data-track-name='OpenDraftSource'
        >
          {inner}
        </Link>
      </li>
    );
  }
  return <li className={rowClass}>{inner}</li>;
}

export const DraftSourcesPanel = ({
  citations,
  embedded = false,
  loading = false,
  showAutoDraftNote = false,
}: DraftSourcesPanelProps): ReactElement | null => {
  // Defensive dedupe in case the caller passes raw (non-deduped) citations.
  const visible = useMemo(() => {
    const list = citations ?? [];
    const seen = new Set<string>();
    const out: ClawCitation[] = [];
    for (const c of list) {
      const key = citationKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }, [citations]);

  if (visible.length === 0) {
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
      {visible.map((c, idx) => (
        <CitationRow key={`${buildClawCitationUrl(c) ?? c.kind}-${idx}`} citation={c} index={idx} />
      ))}
    </ul>
  );

  if (embedded) {
    return (
      <>
        {showAutoDraftNote && <AutoDraftNote />}
        {sourceList}
      </>
    );
  }

  return (
    <div className='mb-4 rounded-xl border border-border/60 bg-muted/20'>
      <div className='flex w-full items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold text-muted-foreground'>
        <span className='inline-flex items-center gap-1.5'>AI sources used ({visible.length})</span>
        <span className='text-[10px] font-normal text-muted-foreground/70'>
          Click any source to verify
        </span>
      </div>
      <div className='px-4'>{showAutoDraftNote && <AutoDraftNote />}</div>
      {sourceList}
    </div>
  );
};
