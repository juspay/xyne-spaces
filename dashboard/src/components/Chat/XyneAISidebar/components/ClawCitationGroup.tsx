import { ReactElement } from 'react';
import Popover from '../../../ui/Popover';
import { CitationLink } from './CitationLink';
import {
  findCitationForChunk,
  buildClawCitationUrl,
  getClawCitationLabel,
  citationOpensInNewTab,
  resolveCitationIconUrl,
} from '../utils/clawCitationUrl';
import type { ToolInvocation } from '../utils/XyneAITypes';
import type { ClawCiteGroupRef } from '../../../ui/TipTapExtensions/CitationMark';

interface ResolvedCite {
  url: string | null;
  label: string;
  iconUrl?: string;
  newTab: boolean;
}

const MAX_STACKED_ICONS = 3;

/**
 * Renders a run of adjacent citations as a single stacked "cluster" chip —
 * up to three overlapping source icons + "+N". Clicking opens a popover that
 * lists every source (icon + title, each a link). Falls back to a plain inline
 * chip-link when only one source actually resolves.
 *
 * Self-contained (doesn't reuse the per-surface ClawCitationChip) so it can be
 * shared by every markdown `a` override unchanged.
 */
export function ClawCitationGroup({
  refs,
  toolInvocations,
}: {
  refs: ClawCiteGroupRef[];
  toolInvocations: ToolInvocation[] | undefined;
}): ReactElement | null {
  const items: ResolvedCite[] = [];
  for (const ref of refs) {
    const citation = findCitationForChunk(toolInvocations, ref.toolCallId, ref.chunkIndex);
    if (!citation) continue;
    const iconUrl = resolveCitationIconUrl(citation);
    items.push({
      url: buildClawCitationUrl(citation),
      label: getClawCitationLabel(citation),
      newTab: citationOpensInNewTab(citation),
      ...(iconUrl ? { iconUrl } : {}),
    });
  }

  if (items.length === 0) return null;

  // Single resolvable source — render a normal inline chip-link (no cluster).
  if (items.length === 1) {
    const it = items[0]!;
    const chipClass =
      'claw-citation-chip inline-flex items-center gap-1 align-middle ' +
      'px-1.5 h-[1.25rem] max-w-[180px] mx-[2px] rounded ' +
      'text-[10px] font-medium leading-none ' +
      'bg-muted/60 border border-border/50 hover:bg-accent hover:border-border transition-colors';
    const inner = (
      <>
        {it.iconUrl ? (
          <img src={it.iconUrl} alt='' aria-hidden className='w-3 h-3 shrink-0 object-contain' />
        ) : null}
        <span className='min-w-0 truncate'>{it.label}</span>
      </>
    );
    return it.url ? (
      <CitationLink url={it.url} newTab={it.newTab} className={chipClass} ariaLabel={it.label}>
        {inner}
      </CitationLink>
    ) : (
      <span className={chipClass} aria-label={it.label}>
        {inner}
      </span>
    );
  }

  const stacked = items.slice(0, MAX_STACKED_ICONS);
  const trigger = (
    <button
      type='button'
      aria-label={`${items.length} sources`}
      className={
        'claw-citation-chip inline-flex items-center align-middle gap-0.5 ' +
        'h-[1.25rem] pl-1 pr-1.5 mx-[2px] rounded-full cursor-pointer ' +
        'bg-muted/60 border border-border/50 hover:bg-accent hover:border-border transition-colors'
      }
    >
      <span className='inline-flex items-center'>
        {stacked.map((it, i) => (
          // Overlapping "card stack" for depth: the first icon sits on top at
          // full brightness; each one further back gets a lower z-index and a
          // progressively darker overlay, so the cluster reads as a stack
          // receding into the chip rather than a flat row of circles.
          <span
            key={i}
            className={
              'relative w-3.5 h-3.5 rounded-full overflow-hidden bg-background ' +
              'ring-1 ring-background shadow-[0_1px_1.5px_rgba(0,0,0,0.2)] ' +
              '-ml-1.5 first:ml-0'
            }
            style={{ zIndex: stacked.length - i }}
          >
            {it.iconUrl ? (
              <img src={it.iconUrl} alt='' aria-hidden className='w-full h-full object-contain' />
            ) : (
              <span className='block w-full h-full bg-muted' />
            )}
            {i > 0 ? (
              <span
                aria-hidden
                className='absolute inset-0 rounded-full bg-black pointer-events-none'
                style={{ opacity: Math.min(i * 0.1, 0.5) }}
              />
            ) : null}
          </span>
        ))}
      </span>
      <span className='ml-0.5 text-[10px] font-medium leading-none text-muted-foreground'>
        +{items.length}
      </span>
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      side='top'
      align='start'
      sideOffset={4}
      className='p-1 max-w-[300px]'
    >
      <div className='flex flex-col gap-0.5 max-h-[260px] overflow-y-auto'>
        {items.map((it, i) => {
          const inner = (
            <>
              {it.iconUrl ? (
                <img
                  src={it.iconUrl}
                  alt=''
                  aria-hidden
                  className='w-3.5 h-3.5 shrink-0 object-contain'
                />
              ) : (
                <span className='w-3.5 h-3.5 shrink-0' />
              )}
              <span className='truncate'>{it.label}</span>
            </>
          );
          const rowClass =
            'flex items-center gap-1.5 min-w-0 px-2 py-1 rounded text-[12px] text-foreground ' +
            'hover:bg-accent transition-colors';
          return it.url ? (
            <CitationLink key={i} url={it.url} newTab={it.newTab} className={rowClass}>
              {inner}
            </CitationLink>
          ) : (
            <span key={i} className={rowClass}>
              {inner}
            </span>
          );
        })}
      </div>
    </Popover>
  );
}

export default ClawCitationGroup;
