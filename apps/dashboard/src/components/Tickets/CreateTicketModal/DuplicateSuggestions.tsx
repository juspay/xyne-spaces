import { useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Check, ChevronRight } from 'lucide-react';

import type { DuplicateSuggestion } from '../../../hooks/useDuplicateTicketCheck';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { cn } from '../../../utils/classNames';
import { formatElapsedTime } from '../../../utils/dateUtils';
import { plain } from '../../Chat/ChatInput/relatedContextDisplay';
import { HoverCard } from '../../ui/HoverCard';

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

const STATUS_LABELS: Record<string, string> = {
  TODO: 'To do',
  STARTED: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
};

const metaOf = (suggestion: DuplicateSuggestion): string => {
  const { status, createdAt } = suggestion.candidate;
  const at = Date.parse(createdAt ?? '');
  return [
    status ? (STATUS_LABELS[status] ?? status) : '',
    Number.isFinite(at) ? formatElapsedTime(at) : '',
  ]
    .filter(Boolean)
    .join(' · ');
};

const trackMetadata = (
  suggestion: DuplicateSuggestion,
  checkId: string | null,
  rank: number,
  bulk = false,
): string =>
  JSON.stringify({
    checkId,
    ticketId: suggestion.candidate.id,
    tier: suggestion.tier,
    score: Math.round(suggestion.score * 100) / 100,
    relation: suggestion.relation ?? null,
    rank,
    ...(bulk ? { bulk: true } : {}),
  });

function SuggestionPreview({
  suggestion,
  checkId,
  rank,
}: {
  suggestion: DuplicateSuggestion;
  checkId: string | null;
  rank: number;
}): ReactElement {
  const origin = useShareableOrigin();
  const { candidate, link } = suggestion;
  const meta = metaOf(suggestion);
  return (
    <div className='space-y-1.5 text-left'>
      <p className='text-[13px] font-medium leading-snug text-foreground'>
        {plain(candidate.title)}
      </p>
      {candidate.description ? (
        <p className='line-clamp-4 whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground'>
          {plain(candidate.description)}
        </p>
      ) : (
        <p className='text-[12px] italic text-muted-foreground'>No description</p>
      )}
      {meta && (
        <p className='text-[11px] tabular-nums text-muted-foreground'>{meta}</p>
      )}
      {link && (
        <a
          href={`${origin}${link}`}
          target='_blank'
          rel='noreferrer'
          className='inline-flex items-center gap-1 rounded-sm text-[12px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          aria-label={`Open ${candidate.xyneId ?? 'ticket'} ${plain(candidate.title)} in a new tab`}
          data-track-category='Tickets'
          data-track-name='DUPLICATE_SUGGESTION_OPEN'
          data-track-label={suggestion.tier}
          data-track-metadata={trackMetadata(suggestion, checkId, rank)}
          onClick={event => {
            // App.tsx's document-level click handler preventDefaults every
            // same-origin anchor and SPA-navigates THIS tab, which would
            // unmount the Create Ticket form and discard the draft. Honor the
            // new-tab intent here instead; the capture-phase analytics
            // tracker (services/Analytics/globalClickTracker.ts) has already
            // recorded the click by the time this runs.
            event.preventDefault();
            window.open(`${origin}${link}`, '_blank', 'noopener,noreferrer');
          }}
        >
          Open full page
          <ArrowUpRight aria-hidden className='size-3' />
        </a>
      )}
    </div>
  );
}

type RowState = 'open' | 'pinned' | 'dismissed';

function SuggestionRow({
  suggestion,
  checkId,
  rank,
  state,
  emphasis,
  showSame,
  checking,
  previewPinned,
  onTogglePreview,
  onSame,
  onNotSame,
  onUndoSame,
  onUndoNotSame,
}: {
  suggestion: DuplicateSuggestion;
  checkId: string | null;
  rank: number;
  state: RowState;
  emphasis: boolean;
  showSame: boolean;
  checking: boolean;
  previewPinned: boolean;
  onTogglePreview: (candidateId: string) => void;
  onSame: (suggestion: DuplicateSuggestion) => void;
  onNotSame: (suggestion: DuplicateSuggestion) => void;
  onUndoSame: () => void;
  onUndoNotSame: (candidateId: string) => void;
}): ReactElement {
  const reduceMotion = useReducedMotion();
  const { candidate, link } = suggestion;
  const meta = metaOf(suggestion);
  const transition = reduceMotion
    ? { duration: 0.12 }
    : {
        height: { type: 'spring' as const, duration: 0.32, bounce: 0 },
        opacity: { duration: 0.18, ease: EASE_OUT },
      };
  const rowButton = (
    <button
      type='button'
      onClick={() => onTogglePreview(candidate.id)}
      aria-expanded={previewPinned}
      className='flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      {candidate.xyneId && (
        <span className='shrink-0 font-mono text-[12px] text-muted-foreground'>
          {candidate.xyneId}
        </span>
      )}
      <span
        className={cn(
          'min-w-0 truncate text-[13px]',
          emphasis && state !== 'dismissed' ? 'font-medium text-foreground' : 'text-foreground/90',
          state === 'dismissed' && 'text-muted-foreground line-through',
        )}
      >
        {plain(candidate.title)}
      </span>
      {meta && (
        <span className='shrink-0 text-[12px] tabular-nums text-muted-foreground'>{meta}</span>
      )}
      {link && (
        <ChevronRight
          aria-hidden
          className={cn(
            'ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            previewPinned && 'rotate-90',
          )}
        />
      )}
    </button>
  );
  return (
    <li className='relative'>
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1.5 left-0 w-[2px] rounded-full',
          state === 'pinned' ? 'bg-status-success' : emphasis ? 'bg-status-pending' : 'bg-transparent',
        )}
      />
      <div className='flex min-w-0 items-center gap-1'>
        {state === 'dismissed' ? (
          <div className='flex h-7 min-w-0 flex-1 items-center gap-2 px-2'>
            {candidate.xyneId && (
              <span className='shrink-0 font-mono text-[12px] text-muted-foreground'>
                {candidate.xyneId}
              </span>
            )}
            <span className='min-w-0 truncate text-[13px] text-muted-foreground line-through'>
              {plain(candidate.title)}
            </span>
            {meta && (
              <span className='ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground'>
                {meta}
              </span>
            )}
          </div>
        ) : link ? (
          <HoverCard
            trigger={rowButton}
            openDelay={300}
            closeDelay={100}
            side='bottom'
            align='start'
            sideOffset={4}
            className='w-80'
          >
            <SuggestionPreview suggestion={suggestion} checkId={checkId} rank={rank} />
          </HoverCard>
        ) : (
          rowButton
        )}
        {state === 'open' && (
          <>
            {showSame && (
              <button
                type='button'
                disabled={checking}
                onClick={() => onSame(suggestion)}
                className='flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]'
                data-track-category='Tickets'
                data-track-name='DUPLICATE_SUGGESTION_SAME'
                data-track-label={suggestion.tier}
                data-track-metadata={trackMetadata(suggestion, checkId, rank)}
              >
                <Check aria-hidden className='size-3' strokeWidth={2.5} />
                Same issue
              </button>
            )}
            <button
              type='button'
              disabled={checking}
              onClick={() => onNotSame(suggestion)}
              className='flex h-6 shrink-0 items-center rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              data-track-category='Tickets'
              data-track-name='DUPLICATE_SUGGESTION_NOT_SAME'
              data-track-label={suggestion.tier}
              data-track-metadata={trackMetadata(suggestion, checkId, rank)}
            >
              Not the same
            </button>
          </>
        )}
        {state === 'pinned' && (
          <button
            type='button'
            onClick={onUndoSame}
            className='flex h-6 shrink-0 items-center rounded-md px-1.5 text-[12px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            data-track-category='Tickets'
            data-track-name='DUPLICATE_SUGGESTION_UNDO'
            data-track-label={suggestion.tier}
            data-track-metadata={trackMetadata(suggestion, checkId, rank)}
          >
            Undo
          </button>
        )}
        {state === 'dismissed' && (
          <button
            type='button'
            disabled={checking}
            onClick={() => onUndoNotSame(candidate.id)}
            className='flex h-6 shrink-0 items-center rounded-md px-1.5 text-[12px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            data-track-category='Tickets'
            data-track-name='DUPLICATE_SUGGESTION_UNDO'
            data-track-label={suggestion.tier}
            data-track-metadata={trackMetadata(suggestion, checkId, rank)}
          >
            Undo
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {state !== 'dismissed' && previewPinned && link && (
          <motion.div
            key='suggestion-preview'
            className='overflow-hidden'
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition}
          >
            <div className='mb-1 ml-3 mr-1 rounded-md border bg-muted/40 p-2.5'>
              <SuggestionPreview suggestion={suggestion} checkId={checkId} rank={rank} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

interface DuplicateSuggestionsProps {
  likely: DuplicateSuggestion[];
  similar: DuplicateSuggestion[];
  checkId: string | null;
  checking: boolean;
  sameAs: DuplicateSuggestion | null;
  notSame: ReadonlySet<string>;
  onSame: (suggestion: DuplicateSuggestion) => void;
  onUndoSame: () => void;
  onNotSame: (suggestion: DuplicateSuggestion) => void;
  onUndoNotSame: (candidateId: string) => void;
}

export function DuplicateSuggestions({
  likely,
  similar,
  checkId,
  checking,
  sameAs,
  notSame,
  onSame,
  onUndoSame,
  onNotSame,
  onUndoNotSame,
}: DuplicateSuggestionsProps): ReactElement {
  const reduceMotion = useReducedMotion();
  const [pinnedPreviewId, setPinnedPreviewId] = useState<string | null>(null);
  const [bulkIds, setBulkIds] = useState<string[] | null>(null);
  const transition = reduceMotion
    ? { duration: 0.12 }
    : {
        height: { type: 'spring' as const, duration: 0.32, bounce: 0 },
        opacity: { duration: 0.18, ease: EASE_OUT },
      };

  const ranked = [...likely, ...similar];
  const open = (suggestion: DuplicateSuggestion): boolean =>
    !notSame.has(suggestion.candidate.id) && suggestion.candidate.id !== sameAs?.candidate.id;
  const visible = ranked.filter(open);
  const dismissed = ranked.filter(
    suggestion => notSame.has(suggestion.candidate.id) && suggestion.candidate.id !== sameAs?.candidate.id,
  );
  const rankOf = (suggestion: DuplicateSuggestion): number =>
    ranked.findIndex(item => item.candidate.id === suggestion.candidate.id) + 1;
  const emphasisId = visible[0]?.candidate.id ?? null;
  const regression =
    visible[0]?.relation === 'regression' && visible[0].candidate.status === 'COMPLETED';
  const bulkUndoAvailable =
    bulkIds !== null && bulkIds.length > 0 && bulkIds.every(id => notSame.has(id));

  const togglePreview = (candidateId: string): void =>
    setPinnedPreviewId(current => (current === candidateId ? null : candidateId));

  const bulkDismiss = (): void => {
    const ids = visible.map(suggestion => suggestion.candidate.id);
    setBulkIds(ids);
    setPinnedPreviewId(null);
    ids.forEach(id => {
      const suggestion = ranked.find(item => item.candidate.id === id);
      if (suggestion) onNotSame(suggestion);
    });
  };

  const undoBulk = (): void => {
    if (!bulkIds) return;
    bulkIds.forEach(id => onUndoNotSame(id));
    setBulkIds(null);
  };

  return (
    <AnimatePresence initial={false}>
      {ranked.length > 0 && (
        <motion.div
          key='duplicate-suggestions'
          className='overflow-hidden'
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={transition}
        >
          <section
            aria-label='Possible duplicate tickets'
            aria-busy={checking}
            className={cn(
              'space-y-1 pb-2 pt-1.5 transition-opacity duration-150',
              checking && 'opacity-60',
            )}
          >
            <div className='flex min-w-0 items-center gap-2 pl-3 pr-1'>
              <p
                className={cn(
                  'px-2 text-[12px] font-medium',
                  sameAs ? 'text-status-success' : 'text-status-pending',
                )}
                aria-live='polite'
              >
                {sameAs
                  ? 'Will be linked as a duplicate when you create this ticket'
                  : regression
                    ? 'This was fixed before — it may be back'
                    : 'Looks like this was already reported'}
              </p>
              <span className='ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground'>
                {ranked.length} {ranked.length === 1 ? 'candidate' : 'candidates'}
              </span>
            </div>

            <div className='-mr-1 max-h-[152px] space-y-0.5 overflow-y-auto pr-1'>
              <ul className='space-y-0.5'>
                {sameAs && (
                  <SuggestionRow
                    suggestion={sameAs}
                    checkId={checkId}
                    rank={rankOf(sameAs)}
                    state='pinned'
                    emphasis={false}
                    showSame={false}
                    checking={checking}
                    previewPinned={pinnedPreviewId === sameAs.candidate.id}
                    onTogglePreview={togglePreview}
                    onSame={onSame}
                    onNotSame={onNotSame}
                    onUndoSame={onUndoSame}
                    onUndoNotSame={onUndoNotSame}
                  />
                )}
                {visible.map(suggestion => (
                  <SuggestionRow
                    key={suggestion.candidate.id}
                    suggestion={suggestion}
                    checkId={checkId}
                    rank={rankOf(suggestion)}
                    state='open'
                    emphasis={suggestion.candidate.id === emphasisId && suggestion.tier === 'likely'}
                    showSame={!sameAs}
                    checking={checking}
                    previewPinned={pinnedPreviewId === suggestion.candidate.id}
                    onTogglePreview={togglePreview}
                    onSame={onSame}
                    onNotSame={onNotSame}
                    onUndoSame={onUndoSame}
                    onUndoNotSame={onUndoNotSame}
                  />
                ))}
                {dismissed.map(suggestion => (
                  <SuggestionRow
                    key={suggestion.candidate.id}
                    suggestion={suggestion}
                    checkId={checkId}
                    rank={rankOf(suggestion)}
                    state='dismissed'
                    emphasis={false}
                    showSame={false}
                    checking={checking}
                    previewPinned={false}
                    onTogglePreview={togglePreview}
                    onSame={onSame}
                    onNotSame={onNotSame}
                    onUndoSame={onUndoSame}
                    onUndoNotSame={onUndoNotSame}
                  />
                ))}
              </ul>
            </div>

            {(visible.length > 0 || bulkUndoAvailable) && (
              <div className='flex items-center gap-1 pl-4'>
                {bulkUndoAvailable ? (
                  <button
                    type='button'
                    disabled={checking}
                    aria-label='Undo all dismissed'
                    onClick={undoBulk}
                    className='flex h-6 items-center rounded-md px-1.5 text-[12px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    data-track-category='Tickets'
                    data-track-name='DUPLICATE_SUGGESTION_UNDO'
                    data-track-label='bulk'
                    data-track-metadata={JSON.stringify({
                      checkId,
                      bulk: true,
                      count: bulkIds?.length ?? 0,
                    })}
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    type='button'
                    disabled={checking}
                    onClick={bulkDismiss}
                    className='flex h-6 items-center rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    data-track-category='Tickets'
                    data-track-name='DUPLICATE_SUGGESTION_NOT_SAME'
                    data-track-label='bulk'
                    data-track-metadata={JSON.stringify({
                      checkId,
                      bulk: true,
                      count: visible.length,
                      ticketIds: visible.map(suggestion => suggestion.candidate.id),
                    })}
                  >
                    None of these
                  </button>
                )}
              </div>
            )}
          </section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
