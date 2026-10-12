import { useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Check, ChevronRight } from 'lucide-react';

import type { DuplicateSuggestion } from '../../../hooks/useDuplicateTicketCheck';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { cn } from '../../../utils/classNames';
import { formatElapsedTime } from '../../../utils/dateUtils';
import { plain } from '../../Chat/ChatInput/relatedContextDisplay';

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

const STATUS_LABELS: Record<string, string> = {
  TODO: 'To do',
  STARTED: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
};

const MAX_OTHERS = 3;

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
): string =>
  JSON.stringify({
    checkId,
    ticketId: suggestion.candidate.id,
    tier: suggestion.tier,
    score: Math.round(suggestion.score * 100) / 100,
    relation: suggestion.relation ?? null,
    rank,
  });

function TicketRow({
  suggestion,
  checkId,
  rank,
  emphasis,
}: {
  suggestion: DuplicateSuggestion;
  checkId: string | null;
  rank: number;
  emphasis: boolean;
}): ReactElement {
  const origin = useShareableOrigin();
  const { candidate, link } = suggestion;
  const meta = metaOf(suggestion);
  const body = (
    <>
      {candidate.xyneId && (
        <span className='shrink-0 font-mono text-[12px] text-muted-foreground'>
          {candidate.xyneId}
        </span>
      )}
      <span
        className={cn(
          'min-w-0 truncate text-[13px]',
          emphasis ? 'font-medium text-foreground' : 'text-foreground/90',
        )}
      >
        {plain(candidate.title)}
      </span>
      {meta && (
        <span className='shrink-0 text-[12px] tabular-nums text-muted-foreground'>{meta}</span>
      )}
      {link && (
        <ArrowUpRight
          aria-hidden
          className='ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-visible/row:opacity-100'
        />
      )}
    </>
  );
  const rowClass =
    'group/row flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return link ? (
    <a
      href={`${origin}${link}`}
      target='_blank'
      rel='noreferrer'
      className={rowClass}
      aria-label={`Open ${candidate.xyneId ?? 'ticket'} ${plain(candidate.title)} in a new tab`}
      data-track-category='Tickets'
      data-track-name='DUPLICATE_SUGGESTION_OPEN'
      data-track-label={suggestion.tier}
      data-track-metadata={trackMetadata(suggestion, checkId, rank)}
    >
      {body}
    </a>
  ) : (
    <div className={rowClass}>{body}</div>
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
}: DuplicateSuggestionsProps): ReactElement {
  const reduceMotion = useReducedMotion();
  const [similarOpen, setSimilarOpen] = useState(false);
  const open = (suggestion: DuplicateSuggestion): boolean =>
    !notSame.has(suggestion.candidate.id) && suggestion.candidate.id !== sameAs?.candidate.id;
  const lead = sameAs ?? likely.find(open) ?? null;
  const others = [...likely, ...similar]
    .filter(suggestion => open(suggestion) && suggestion.candidate.id !== lead?.candidate.id)
    .slice(0, MAX_OTHERS);
  const regression = lead?.relation === 'regression' && lead.candidate.status === 'COMPLETED';
  const transition = reduceMotion
    ? { duration: 0.12 }
    : {
        height: { type: 'spring' as const, duration: 0.32, bounce: 0 },
        opacity: { duration: 0.18, ease: EASE_OUT },
      };

  return (
    <AnimatePresence initial={false}>
      {(lead || others.length > 0) && (
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
            {lead && (
              <div className='relative space-y-0.5 pl-3'>
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-y-1 left-0 w-[2px] rounded-full',
                    sameAs ? 'bg-status-success' : 'bg-status-pending',
                  )}
                />
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
                <TicketRow suggestion={lead} checkId={checkId} rank={1} emphasis />
                <div className='flex items-center gap-1 px-1'>
                  {sameAs ? (
                    <button
                      type='button'
                      onClick={onUndoSame}
                      className='flex h-6 items-center rounded-md px-1.5 text-[12px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      data-track-category='Tickets'
                      data-track-name='DUPLICATE_SUGGESTION_UNDO'
                      data-track-label={lead.tier}
                      data-track-metadata={trackMetadata(lead, checkId, 1)}
                    >
                      Undo
                    </button>
                  ) : (
                    <>
                      <button
                        type='button'
                        disabled={checking}
                        onClick={() => onSame(lead)}
                        className='flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]'
                        data-track-category='Tickets'
                        data-track-name='DUPLICATE_SUGGESTION_SAME'
                        data-track-label={lead.tier}
                        data-track-metadata={trackMetadata(lead, checkId, 1)}
                      >
                        <Check aria-hidden className='size-3' strokeWidth={2.5} />
                        Same issue
                      </button>
                      <button
                        type='button'
                        disabled={checking}
                        onClick={() => onNotSame(lead)}
                        className='flex h-6 items-center rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        data-track-category='Tickets'
                        data-track-name='DUPLICATE_SUGGESTION_NOT_SAME'
                        data-track-label={lead.tier}
                        data-track-metadata={trackMetadata(lead, checkId, 1)}
                      >
                        Not the same
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {others.length > 0 && (
              <div className='pl-3'>
                <button
                  type='button'
                  onClick={() => setSimilarOpen(value => !value)}
                  aria-expanded={similarOpen}
                  className='flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  data-track-category='Tickets'
                  data-track-name='DUPLICATE_SIMILAR_TOGGLE'
                  data-track-label={similarOpen ? 'close' : 'open'}
                  data-track-metadata={JSON.stringify({ checkId, count: others.length })}
                >
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      'size-3 transition-transform duration-150',
                      similarOpen && 'rotate-90',
                    )}
                    strokeWidth={2.25}
                  />
                  {others.length} similar {others.length === 1 ? 'ticket' : 'tickets'}
                </button>
                <AnimatePresence initial={false}>
                  {similarOpen && (
                    <motion.div
                      key='similar-list'
                      className='overflow-hidden'
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={transition}
                    >
                      <div className='pb-0.5 pl-3'>
                        {others.map((suggestion, index) => (
                          <div
                            key={suggestion.candidate.id}
                            className='group/similar flex items-center gap-1'
                          >
                            <div className='min-w-0 flex-1'>
                              <TicketRow
                                suggestion={suggestion}
                                checkId={checkId}
                                rank={index + 2}
                                emphasis={false}
                              />
                            </div>
                            {!sameAs && (
                              <button
                                type='button'
                                disabled={checking}
                                onClick={() => onSame(suggestion)}
                                className='flex h-6 shrink-0 items-center rounded-md px-1.5 text-[12px] text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/similar:opacity-100 [@media(hover:none)]:opacity-100'
                                data-track-category='Tickets'
                                data-track-name='DUPLICATE_SUGGESTION_SAME'
                                data-track-label={suggestion.tier}
                                data-track-metadata={trackMetadata(suggestion, checkId, index + 2)}
                              >
                                Same issue
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
