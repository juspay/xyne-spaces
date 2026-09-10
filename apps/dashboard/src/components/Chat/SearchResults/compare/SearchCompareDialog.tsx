/* eslint-disable local-rules/require-tracking-on-click */
import { Fragment, ReactElement, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Star, CheckCircle2, TriangleAlert, Sparkles } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import type { DisplaySearchResult } from '../../../../types/search';
import { buildFeatureSections, buildVerdict, formatValue, barFraction } from './rankingFeatures';

interface SearchCompareDialogProps {
  open: boolean;
  query: string;
  results: DisplaySearchResult[];
  relevantIds: Set<string>;
  onToggleRelevant: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

const SPRING = { type: 'spring' as const, duration: 0.3, bounce: 0 };

export function SearchCompareDialog({
  open,
  query,
  results,
  relevantIds,
  onToggleRelevant,
  onRemove,
  onClose,
}: SearchCompareDialogProps): ReactElement {
  // Columns ordered by the ranker (so #1 is leftmost); the matrix is built from
  // the same ordered array so winner indices line up with the columns.
  const ordered = useMemo(
    () => [...results].sort((a, b) => b.relevanceScore - a.relevanceScore),
    [results],
  );
  const sections = useMemo(() => buildFeatureSections(ordered), [ordered]);
  const verdict = useMemo(() => buildVerdict(ordered, relevantIds), [ordered, relevantIds]);
  const n = ordered.length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const gridStyle = { gridTemplateColumns: `200px repeat(${n}, minmax(168px, 1fr))` };

  const VerdictIcon =
    verdict.agree === true ? CheckCircle2 : verdict.agree === false ? TriangleAlert : Sparkles;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className='fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 antialiased'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Backdrop */}
          <div
            className='absolute inset-0 bg-background/70 backdrop-blur-sm'
            onClick={onClose}
            data-track-category='SEARCH_COMPARE'
            data-track-name='CLOSE_COMPARE_BACKDROP'
            aria-hidden
          />

          {/* Panel */}
          <motion.div
            role='dialog'
            aria-modal
            aria-label='Compare search ranking'
            className='relative flex flex-col w-[min(1120px,96vw)] h-[min(86vh,820px)] rounded-2xl border border-border bg-background shadow-2xl overflow-hidden'
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={SPRING}
          >
            {/* Header */}
            <div className='shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-border'>
              <div className='min-w-0'>
                <h2 className='text-sm font-semibold text-foreground'>Compare ranking</h2>
                <p className='text-xs text-muted-foreground truncate'>
                  {n} result{n === 1 ? '' : 's'}
                  {query && (
                    <>
                      {' · '}
                      <span className='text-foreground'>“{query}”</span>
                    </>
                  )}
                  {' · why the ranker ordered them this way'}
                </p>
              </div>
              <button
                onClick={onClose}
                data-track-category='SEARCH_COMPARE'
                data-track-name='CLOSE_COMPARE_DIALOG'
                title='Close'
                className='ml-auto shrink-0 p-2 rounded-md text-muted-foreground hover:bg-muted active:scale-[0.96] transition'
              >
                <X size={16} />
              </button>
            </div>

            {/* Verdict */}
            {verdict.text && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING, delay: 0.05 }}
                className={cn(
                  'shrink-0 mx-5 mt-4 rounded-xl border px-4 py-3 flex items-start gap-2.5',
                  verdict.agree === true &&
                    'border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300',
                  verdict.agree === false &&
                    'border-amber-500/30 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300',
                  verdict.agree === null && 'border-border bg-muted/40 text-muted-foreground',
                )}
              >
                <VerdictIcon size={16} className='mt-0.5 shrink-0' />
                <p className='text-[13px] leading-relaxed text-pretty'>{verdict.text}</p>
              </motion.div>
            )}

            {/* Matrix */}
            <div className='flex-1 min-h-0 overflow-auto px-5 py-4'>
              {n < 2 ? (
                <div className='h-full flex items-center justify-center text-sm text-muted-foreground'>
                  Select at least two results to compare.
                </div>
              ) : (
                <div
                  className='grid text-sm rounded-xl border border-border overflow-hidden'
                  style={gridStyle}
                >
                  {/* Header row: corner + column headers */}
                  <div className='sticky top-0 left-0 z-30 bg-background border-b border-border px-3 py-3'>
                    <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                      Signal
                    </span>
                  </div>
                  {ordered.map((r, i) => {
                    const isRelevant = relevantIds.has(r.id);
                    return (
                      <div
                        key={r.id}
                        className={cn(
                          'sticky top-0 z-20 bg-background border-b border-l border-border px-3 pt-2.5 pb-3',
                          isRelevant && 'shadow-[inset_0_2px_0_0_rgb(245_158_11)]',
                        )}
                      >
                        <div className='flex items-center gap-2'>
                          <span className='text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded bg-muted text-muted-foreground'>
                            #{i + 1}
                          </span>
                          <button
                            onClick={() => onToggleRelevant(r.id)}
                            data-track-category='SEARCH_COMPARE'
                            data-track-name='TOGGLE_RESULT_RELEVANT'
                            title={
                              isRelevant ? 'Unmark relevant' : 'Mark as a correct / relevant result'
                            }
                            className='shrink-0 p-1 rounded hover:bg-muted active:scale-[0.96] transition'
                          >
                            <Star
                              size={14}
                              className={cn(
                                isRelevant
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'text-muted-foreground',
                              )}
                            />
                          </button>
                          <button
                            onClick={() => onRemove(r.id)}
                            data-track-category='SEARCH_COMPARE'
                            data-track-name='REMOVE_FROM_COMPARISON'
                            title='Remove from comparison'
                            className='ml-auto shrink-0 p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.96] transition'
                          >
                            <X size={13} />
                          </button>
                        </div>
                        <p
                          className='mt-1.5 text-[13px] font-medium text-foreground truncate'
                          title={r.title}
                        >
                          {r.title || 'Untitled'}
                        </p>
                        <p className='text-[11px] text-muted-foreground truncate'>{r.subtitle}</p>
                        <p className='mt-1.5 text-lg font-semibold tabular-nums text-foreground leading-none'>
                          {r.relevanceScore.toFixed(4)}
                        </p>
                      </div>
                    );
                  })}

                  {/* Sections */}
                  {sections.map(section => (
                    <Fragment key={section.group}>
                      <div className='sticky left-0 z-10 col-span-full bg-muted/40 border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                        {section.group}
                      </div>
                      {section.rows.map(row => (
                        <Fragment key={row.key}>
                          <div
                            className='sticky left-0 z-10 bg-background border-b border-border/60 px-3 py-2 font-mono text-[11px] text-muted-foreground truncate'
                            title={row.key}
                          >
                            {row.label}
                          </div>
                          {row.values.map((v, i) => {
                            const winner = row.winnerIndex === i;
                            return (
                              <div
                                key={ordered[i]?.id ?? i}
                                className={cn(
                                  'border-b border-l border-border/40 px-3 py-2 flex flex-col gap-1.5 justify-center',
                                  winner && 'bg-emerald-500/[0.06]',
                                )}
                              >
                                <div className='flex items-baseline justify-between gap-2'>
                                  <span
                                    className={cn(
                                      'text-[12px] tabular-nums',
                                      v === undefined
                                        ? 'text-muted-foreground/50'
                                        : winner
                                          ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                                          : 'text-foreground',
                                    )}
                                  >
                                    {formatValue(v)}
                                  </span>
                                  {winner && (
                                    <span className='text-[9px] font-semibold uppercase tracking-wide text-emerald-600/70 dark:text-emerald-400/70'>
                                      top
                                    </span>
                                  )}
                                </div>
                                <div className='h-1 rounded-full bg-muted/70 overflow-hidden'>
                                  <div
                                    className={cn(
                                      'h-full rounded-full',
                                      winner ? 'bg-emerald-500' : 'bg-primary/40',
                                    )}
                                    style={{ width: `${barFraction(v, row.max) * 100}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </div>
              )}

              <p className='mt-3 text-[11px] text-muted-foreground'>
                Bars are scaled per row (relative to the per-row maximum). Higher is better for
                every signal here. Mark the results you consider correct with the star to see why
                the ranker agreed or disagreed.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
