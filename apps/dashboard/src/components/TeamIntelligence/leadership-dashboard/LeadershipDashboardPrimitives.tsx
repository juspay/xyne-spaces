import { ArrowUpRightIcon, ChevronDownIcon, Loader2Icon, type LucideIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';
import type { LeadershipItem } from '@/services/TeamIntelligence/teamIntelligenceService';
import { cn } from '@/utils/classNames';
import type { PaginationState, Signal, TextHeadline, Tone } from './leadershipDashboardTypes';
import {
  cleanText,
  compareLeadershipItems,
  itemBadges,
  itemDescription,
  itemDetailNotes,
  itemTitle,
  sectionToneClassName,
  toneClassName,
} from './leadershipDashboardUtils';

export const EmptyState = ({ title, text }: { title: string; text: string }): ReactElement => (
  <div className='rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-5'>
    <p className='text-sm font-medium text-foreground'>{title}</p>
    <p className='mt-1 text-sm text-muted-foreground'>{text}</p>
  </div>
);

export const LoadingState = ({ label }: { label: string }): ReactElement => (
  <div className='flex min-h-[420px] items-center justify-center'>
    <div className='flex items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm'>
      <Loader2Icon className='size-4 animate-spin' />
      {label}
    </div>
  </div>
);

export const ErrorState = ({ label }: { label: string }): ReactElement => (
  <div className='flex min-h-[420px] items-center justify-center'>
    <div className='max-w-md rounded-lg border border-rose-500/20 bg-rose-500/10 px-5 py-4'>
      <p className='text-sm font-medium text-rose-700 dark:text-rose-300'>{label}</p>
      <p className='mt-1 text-sm text-muted-foreground'>
        The latest leadership snapshot could not be loaded.
      </p>
    </div>
  </div>
);

export const Pill = ({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: Tone;
}): ReactElement => (
  <span
    className={cn(
      'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium',
      toneClassName[tone],
    )}
  >
    {children}
  </span>
);

export const PaginationControls = ({
  pagination,
  setPage,
  trackName,
  className,
}: {
  pagination: Pick<
    PaginationState<unknown>,
    'pageIndex' | 'pageCount' | 'rangeStart' | 'rangeEnd' | 'total'
  >;
  setPage: (page: number) => void;
  trackName: string;
  className?: string;
}): ReactElement | null => {
  if (pagination.pageCount <= 1) return null;

  const { pageIndex, pageCount, rangeStart, rangeEnd, total } = pagination;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-t border-border/70 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <p className='text-xs text-muted-foreground'>
        Showing {rangeStart}-{rangeEnd} of {total}
      </p>
      <div className='flex items-center gap-2'>
        <button
          type='button'
          onClick={() => setPage(Math.max(0, pageIndex - 1))}
          disabled={pageIndex === 0}
          data-track-category='team-intelligence'
          data-track-name={`previous-${trackName}-page`}
          data-track-metadata={JSON.stringify({ page: pageIndex + 1, pageCount })}
          className='rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-action-accent/50 disabled:cursor-not-allowed disabled:opacity-40'
        >
          Previous
        </button>
        <span className='text-xs text-muted-foreground'>
          {pageIndex + 1}/{pageCount}
        </span>
        <button
          type='button'
          onClick={() => setPage(Math.min(pageCount - 1, pageIndex + 1))}
          disabled={pageIndex >= pageCount - 1}
          data-track-category='team-intelligence'
          data-track-name={`next-${trackName}-page`}
          data-track-metadata={JSON.stringify({ page: pageIndex + 1, pageCount })}
          className='rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-action-accent/50 disabled:cursor-not-allowed disabled:opacity-40'
        >
          Next
        </button>
      </div>
    </div>
  );
};

/* ── Zone: Section heading (shared header for every zone below) ── */
export const SectionHeading = ({
  icon: Icon,
  title,
  question,
  tone = 'neutral',
  count,
}: {
  icon: LucideIcon;
  title: string;
  question?: string;
  tone?: Tone;
  count?: number;
}): ReactElement => {
  const style = sectionToneClassName[tone];
  return (
    <div className='flex items-center gap-3'>
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl border',
          style.icon,
        )}
      >
        <Icon className='size-4' />
      </span>
      <div className='min-w-0 flex-1'>
        {question ? (
          <p className={cn('text-[13px] font-semibold leading-snug', style.eyebrow)}>{question}</p>
        ) : null}
        <div className='mt-0.5 flex items-baseline gap-2'>
          <h3 className='text-base font-semibold tracking-tight text-foreground/90 sm:text-lg'>
            {title}
          </h3>
          {count !== undefined ? (
            <span className='text-xs font-medium text-muted-foreground'>({count})</span>
          ) : null}
        </div>
      </div>
    </div>
  );
};

/* ── Zone wrapper: consistent spacing + divider for each zone ── */
export const Zone = ({
  id,
  children,
  tone = 'neutral',
  className,
}: {
  id?: string;
  children: ReactNode;
  tone?: Tone;
  className?: string;
}): ReactElement => {
  const style = sectionToneClassName[tone];
  return (
    <section
      id={id}
      className={cn('scroll-mt-6 space-y-4 border-t pt-6', style.divider, className)}
    >
      {children}
    </section>
  );
};

/* ── Zone: Stat tiles (full-width stack, click Read more to expand one card) ── */
export const SignalCard = ({ signal }: { signal: Signal }): ReactElement => {
  const [open, setOpen] = useState(false);
  const Icon = signal.icon;
  const style = sectionToneClassName[signal.tone];
  const description = cleanText(signal.description);
  const scrollToSection = (): void => {
    if (!signal.targetId) return;
    document
      .getElementById(signal.targetId)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <div
      role={signal.targetId ? 'button' : undefined}
      tabIndex={signal.targetId ? 0 : undefined}
      aria-label={signal.targetId ? `Go to ${signal.label} section` : undefined}
      onClick={scrollToSection}
      onKeyDown={event => {
        if (signal.targetId && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          scrollToSection();
        }
      }}
      data-track-category='team-intelligence'
      data-track-name={signal.targetId ? 'navigate-signal-card' : undefined}
      data-track-metadata={
        signal.targetId
          ? JSON.stringify({ label: signal.label, targetId: signal.targetId })
          : undefined
      }
      className={cn(
        'rounded-xl border bg-card p-4 shadow-sm transition-all',
        style.divider,
        signal.targetId &&
          'cursor-pointer hover:-translate-y-0.5 hover:border-action-accent/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent focus-visible:ring-offset-2',
      )}
    >
      <div className='flex items-center justify-between gap-2'>
        <p className='text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground'>
          {signal.label}
        </p>
        <span
          className={cn('flex size-7 items-center justify-center rounded-lg border', style.icon)}
        >
          <Icon className='size-3.5' />
        </span>
      </div>
      <p className='mt-2 text-xl font-bold tracking-tight text-foreground'>{signal.value}</p>
      {description ? (
        <>
          <p
            className={cn(
              'mt-1 text-xs leading-relaxed text-muted-foreground',
              !open && 'line-clamp-2',
            )}
          >
            {description}
          </p>
          <button
            type='button'
            onClick={event => {
              event.stopPropagation();
              setOpen(prev => !prev);
            }}
            onKeyDown={event => event.stopPropagation()}
            aria-expanded={open}
            data-track-category='team-intelligence'
            data-track-name='toggle-signal-card'
            data-track-metadata={JSON.stringify({ label: signal.label, isExpanded: !open })}
            className='mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-action-accent transition-colors hover:text-action-accent/80'
          >
            {open ? 'Read less' : 'Read more'}
            <ChevronDownIcon
              className={cn('size-3 transition-transform', open ? 'rotate-180' : 'rotate-0')}
            />
          </button>
        </>
      ) : null}
    </div>
  );
};

export const SignalStrip = ({ signals }: { signals: Signal[] }): ReactElement => {
  return (
    <div className='overflow-hidden rounded-xl'>
      <div className='grid gap-2.5'>
        {signals.map(signal => (
          <SignalCard key={signal.label} signal={signal} />
        ))}
      </div>
    </div>
  );
};

/* ── Zone: Expandable list (click-to-expand, stable) ── */
export const ExpandableList = ({
  items,
  emptyTitle,
  emptyText,
}: {
  items: LeadershipItem[];
  emptyTitle: string;
  emptyText: string;
}): ReactElement => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  if (items.length === 0) return <EmptyState title={emptyTitle} text={emptyText} />;
  const orderedItems = [...items].sort(compareLeadershipItems);
  const toggleItem = (key: string): void => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
    <div className='overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm'>
      {orderedItems.map((item, index) => {
        const itemIndex = index;
        const key = item.id ?? `${itemTitle(item)}-${itemIndex}`;
        const isExpanded = expandedKeys.has(key);
        const title = itemTitle(item);
        const badges = itemBadges(item);
        const description = itemDescription(item);
        const notes = itemDetailNotes(item).filter(note => note !== description);
        return (
          <article key={key} className='border-b border-border/60 last:border-b-0'>
            <button
              type='button'
              onClick={() => toggleItem(key)}
              aria-expanded={isExpanded}
              data-track-category='team-intelligence'
              data-track-name='toggle-leadership-headline'
              data-track-metadata={JSON.stringify({ title, isExpanded: !isExpanded })}
              className='flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/30'
            >
              <ChevronDownIcon
                className={cn(
                  'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                  isExpanded ? 'rotate-180 text-action-accent' : 'rotate-0',
                )}
              />
              <div className='min-w-0 flex-1'>
                <div className='flex items-start justify-between gap-3'>
                  <h4 className='min-w-0 flex-1 text-[15px] font-medium leading-snug text-foreground/90 sm:text-base'>
                    {title}
                  </h4>
                  {badges.length > 0 ? (
                    <div className='ml-auto flex max-w-[55%] shrink-0 flex-nowrap items-center justify-end gap-1 overflow-x-auto'>
                      {badges.map(badge => (
                        <Pill key={`${title}-${badge.label}`} tone={badge.tone}>
                          {badge.label}
                        </Pill>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </button>
            {isExpanded ? (
              <div className='px-11 pb-4'>
                {description ? (
                  <p className='max-w-3xl text-sm leading-6 text-muted-foreground'>{description}</p>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    No additional detail was generated.
                  </p>
                )}
                {notes.length > 0 ? (
                  <div className='mt-3 grid gap-2'>
                    {notes.map((note, noteIndex) => (
                      <div
                        key={`${key}-note-${noteIndex}`}
                        className='flex items-start gap-2 text-xs leading-5 text-foreground'
                      >
                        <ArrowUpRightIcon className='mt-0.5 size-3.5 shrink-0 text-action-accent' />
                        <span>{note}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
};

/* ── Zone: Callout quote (narrative sections, no expand) ── */
export const CalloutQuote = ({
  items,
  emptyTitle,
  emptyText,
}: {
  items: TextHeadline[];
  emptyTitle: string;
  emptyText: string;
}): ReactElement => {
  const cleaned = items
    .map(item => ({ title: cleanText(item.title), text: cleanText(item.text) }))
    .filter(item => item.title && item.text);
  if (cleaned.length === 0) return <EmptyState title={emptyTitle} text={emptyText} />;
  return (
    <div className='overflow-hidden rounded-xl border border-action-accent/25 bg-action-accent/5'>
      <div className='space-y-4 px-5 py-4 sm:px-6'>
        {cleaned.map((item, index) => (
          <div
            key={`${item.title}-${index}`}
            className={index > 0 ? 'border-t border-action-accent/15 pt-4' : ''}
          >
            <p className='text-[11px] font-semibold uppercase tracking-[0.14em] text-action-accent'>
              {item.title}
            </p>
            <p className='mt-1.5 max-w-3xl text-sm leading-7 text-foreground/80 sm:text-[15px] sm:leading-8'>
              {item.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ItemGrid = ExpandableList;

export const bulletCategoryTone = (category: string): Tone => {
  const normalized = category.trim().toUpperCase();
  if (normalized.includes('ACHIEVEMENT') || normalized.includes('SUCCESS')) return 'good';
  if (normalized.includes('MILESTONE') || normalized.includes('PROGRESS')) return 'info';
  if (normalized.includes('LEARNED') || normalized.includes('INSIGHT')) return 'accent';
  if (normalized.includes('BLOCKER') || normalized.includes('WARNING')) return 'warn';
  if (normalized.includes('RISK') || normalized.includes('FAILURE')) return 'danger';

  const fallbackTones: Tone[] = ['accent', 'info', 'good', 'warn', 'danger'];
  const hash = [...normalized].reduce((value, character) => value + character.charCodeAt(0), 0);
  return fallbackTones[hash % fallbackTones.length]!;
};

export const StringList = ({
  items,
  emptyTitle,
  emptyText,
}: {
  items: Array<string | TextHeadline>;
  emptyTitle: string;
  emptyText: string;
}): ReactElement => {
  const normalized = items.map((item, index): TextHeadline => {
    if (typeof item === 'string') {
      const text = cleanText(item);
      return { title: text || `Point ${index + 1}`, text };
    }
    return {
      title: cleanText(item.title),
      text: cleanText(item.text),
    };
  });

  return <CalloutQuote items={normalized} emptyTitle={emptyTitle} emptyText={emptyText} />;
};
