import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowUpRightIcon,
  BadgeCheckIcon,
  BlocksIcon,
  BrainIcon,
  ChevronDownIcon,
  CompassIcon,
  FlameIcon,
  GaugeIcon,
  LightbulbIcon,
  ListChecksIcon,
  Loader2Icon,
  NetworkIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TargetIcon,
  UsersIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react';
import { ReactElement, ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LeadershipBullet,
  LeadershipConfidence,
  LeadershipItem,
  OrgLeadershipSummary,
  TeamLeadershipSummary,
  TeamMember,
  UserLeadershipSummary,
  LeadershipScope,
} from '@/services/TeamIntelligence/teamIntelligenceService';
import { useLeadershipSection, useTeamMembers } from '@/hooks/useTeamIntelligence';
import { cn } from '@/utils/classNames';
import { formatReportDate } from '@/utils/teamIntelligenceUtils';

type DashboardScope = 'org' | 'team' | 'member';
type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info' | 'accent';

interface SnapshotShellProps {
  scope: DashboardScope;
  title: string;
  eyebrow: string;
  reportDate?: string;
  confidence?: LeadershipConfidence;
  momentum?: string;
  narrative: string;
  sectionRequest: SectionRequest;
  children: ReactNode;
}

interface SectionProps {
  id?: string;
  icon: LucideIcon;
  title: string;
  eyebrow?: string;
  tone?: Tone;
  question?: string;
  children: ReactNode;
}

interface Signal {
  label: string;
  value: string;
  description: string;
  tone: Tone;
  icon: LucideIcon;
  targetId?: string;
}

interface TextHeadline {
  title: string;
  text: string;
}

interface SectionRequest {
  scope: LeadershipScope;
  from: string;
  to: string;
  teamId?: string;
  userEmail?: string;
}

const SECTION_PAGE_SIZE = 12;

interface PaginationState<T> {
  pageIndex: number;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  visibleItems: T[];
}

const toneClassName: Record<Tone, string> = {
  neutral: 'border-border/70 bg-muted/30 text-muted-foreground',
  good: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warn: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  info: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  accent: 'border-action-accent/20 bg-action-accent/10 text-action-accent',
};

const sectionToneClassName: Record<
  Tone,
  { divider: string; rail: string; icon: string; eyebrow: string }
> = {
  neutral: {
    divider: 'border-border/70',
    rail: 'bg-border',
    icon: 'border-border/70 bg-card text-muted-foreground',
    eyebrow: 'text-muted-foreground',
  },
  good: {
    divider: 'border-emerald-500/25',
    rail: 'bg-emerald-500',
    icon: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    eyebrow: 'text-emerald-700 dark:text-emerald-300',
  },
  warn: {
    divider: 'border-amber-500/25',
    rail: 'bg-amber-500',
    icon: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    eyebrow: 'text-amber-700 dark:text-amber-300',
  },
  danger: {
    divider: 'border-rose-500/25',
    rail: 'bg-rose-500',
    icon: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    eyebrow: 'text-rose-700 dark:text-rose-300',
  },
  info: {
    divider: 'border-sky-500/25',
    rail: 'bg-sky-500',
    icon: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    eyebrow: 'text-sky-700 dark:text-sky-300',
  },
  accent: {
    divider: 'border-action-accent/25',
    rail: 'bg-action-accent',
    icon: 'border-action-accent/25 bg-action-accent/10 text-action-accent',
    eyebrow: 'text-action-accent',
  },
};

const formatLabel = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase());

const cleanText = (value: string | null | undefined): string =>
  value?.replace(/\s+/g, ' ').trim() ?? '';

const isSystemFallbackNarrative = (value: string | null | undefined): boolean => {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return (
    /has \d+\/\d+ completed team summaries with \d+ founder-level critical or high-priority initiatives/.test(
      text,
    ) ||
    text.includes(
      'no founder-significant movement or blocker was strongly evidenced beyond the completed team coverage',
    ) ||
    text.includes('no evidence-backed team summary could be produced') ||
    text.includes('no evidence-backed organization summary could be produced') ||
    text.includes('insufficient evidence to assess') ||
    text.includes('insufficient evidence to isolate')
  );
};

const executiveNarrative = (summary: {
  narrative?: string;
  topBets?: string[];
  topSignals?: string[];
  topBlockers?: string[];
  topRisks?: string[];
  immediateLeadershipActions?: string[];
}): string => {
  const narrative = cleanText(summary.narrative);
  if (narrative && !isSystemFallbackNarrative(narrative)) {
    return narrative;
  }
  return (
    [
      ...(summary.topSignals ?? []),
      ...(summary.topBlockers ?? []),
      ...(summary.topRisks ?? []),
      ...(summary.immediateLeadershipActions ?? []),
      ...(summary.topBets ?? []),
    ]
      .map(cleanText)
      .find(Boolean) ?? ''
  );
};

const confidenceTone = (confidence?: LeadershipConfidence): Tone => {
  if (confidence === 'HIGH') return 'good';
  if (confidence === 'MEDIUM') return 'warn';
  if (confidence === 'LOW') return 'danger';
  return 'neutral';
};

const priorityTone = (value?: string): Tone => {
  if (value === 'CRITICAL') return 'danger';
  if (value === 'HIGH') return 'warn';
  if (value === 'MEDIUM') return 'info';
  if (value === 'LOW') return 'neutral';
  return 'neutral';
};

const rankPriority = (value: unknown): number => {
  const normalized = cleanText(typeof value === 'string' ? value : undefined).toUpperCase();
  if (normalized === 'CRITICAL') return 0;
  if (normalized === 'HIGH') return 1;
  if (normalized === 'MEDIUM') return 2;
  if (normalized === 'LOW') return 3;
  return 4;
};

const rankStatus = (value: unknown): number => {
  const normalized = cleanText(typeof value === 'string' ? value : undefined).toUpperCase();
  if (['BLOCKED', 'OPEN', 'PENDING', 'CONFLICTING', 'AT_RISK'].includes(normalized)) return 0;
  if (['STALLED', 'REGRESSING'].includes(normalized)) return 1;
  if (['IN_PROGRESS', 'PLANNED'].includes(normalized)) return 2;
  if (['UNKNOWN', 'UNCLEAR'].includes(normalized)) return 3;
  if (['RESOLVED', 'COMPLETED', 'DECIDED'].includes(normalized)) return 4;
  return 5;
};

const rankMovement = (value: unknown): number => {
  const normalized = cleanText(typeof value === 'string' ? value : undefined).toUpperCase();
  if (['STALLED', 'REGRESSING', 'WEAKENING'].includes(normalized)) return 0;
  if (normalized === 'PROGRESSING_WITH_RISK') return 1;
  if (['PROGRESSING', 'GROWING'].includes(normalized)) return 2;
  if (normalized === 'STABLE') return 3;
  if (['UNCLEAR', 'INSUFFICIENT_BASELINE'].includes(normalized)) return 4;
  return 5;
};

const rankTimeHorizon = (value: unknown): number => {
  const normalized = cleanText(typeof value === 'string' ? value : undefined).toUpperCase();
  if (normalized === 'IMMEDIATE') return 0;
  if (normalized === 'THIS_WEEK') return 1;
  if (normalized === 'NEXT_TWO_WEEKS') return 2;
  if (normalized === 'LONGER_TERM') return 3;
  return 4;
};

const compareLeadershipItems = (a: LeadershipItem, b: LeadershipItem): number => {
  const priorityA = rankPriority(
    a.priority ?? a.severity ?? a.riskLevel ?? a.importance ?? a.deadlockRisk,
  );
  const priorityB = rankPriority(
    b.priority ?? b.severity ?? b.riskLevel ?? b.importance ?? b.deadlockRisk,
  );
  if (priorityA !== priorityB) return priorityA - priorityB;

  const statusA = rankStatus(a.status);
  const statusB = rankStatus(b.status);
  if (statusA !== statusB) return statusA - statusB;

  const movementA = rankMovement(a.movement ?? a.currentMovement ?? a.momentum);
  const movementB = rankMovement(b.movement ?? b.currentMovement ?? b.momentum);
  if (movementA !== movementB) return movementA - movementB;

  return rankTimeHorizon(a.timeHorizon) - rankTimeHorizon(b.timeHorizon);
};

const momentumTone = (value?: string): Tone => {
  if (value === 'FORWARD') return 'good';
  if (value === 'FORWARD_WITH_BLOCKERS' || value === 'MIXED') return 'warn';
  if (value === 'REGRESSING' || value === 'STALLED') return 'danger';
  return 'neutral';
};

const itemTitle = (item: LeadershipItem): string =>
  cleanText(item.title) ||
  cleanText(item.action) ||
  cleanText(item.decision) ||
  cleanText(item.capability) ||
  cleanText(item.initiative) ||
  'Signal';

const itemDescription = (item: LeadershipItem): string =>
  cleanText(item.description) ||
  cleanText(item.text) ||
  cleanText(item.assessment) ||
  cleanText(item.why) ||
  cleanText(item.context) ||
  cleanText(item.impact) ||
  cleanText(item.progressDescription) ||
  cleanText(item.whyCritical) ||
  cleanText(item.summary) ||
  cleanText(item.reason);

const itemDetailNotes = (item: LeadershipItem): string[] =>
  [
    cleanText(item.track ? `Track: ${formatLabel(item.track)}` : ''),
    cleanText(item.matchStrength ? `Match: ${formatLabel(item.matchStrength)}` : ''),
    item.isTeamWorkingTowardsGoal === undefined
      ? ''
      : item.isTeamWorkingTowardsGoal
        ? 'Working toward goal: Yes'
        : 'Working toward goal: No',
    cleanText(item.recommendedAction),
    cleanText(item.expectedOutcome),
    cleanText(item.suggestedOwner ? `Owner: ${item.suggestedOwner}` : ''),
    ...(item.matchedSignals ?? []).map(signal => cleanText(`Signal: ${signal}`)),
    ...(item.evidenceSourceTypes ?? []).map(sourceType =>
      cleanText(`Source: ${formatLabel(sourceType)}`),
    ),
    ...(item.requiredNextSteps ?? []).map(step => cleanText(`Next: ${step}`)),
    ...(item.dependencies ?? []).map(dependency => cleanText(`Dependency: ${dependency}`)),
  ].filter(Boolean);

const itemBadges = (item: LeadershipItem): Array<{ label: string; tone: Tone }> => {
  const badges: Array<{ label: string; tone: Tone }> = [];
  const priority =
    item.priority ?? item.severity ?? item.riskLevel ?? item.importance ?? item.deadlockRisk;
  if (priority) badges.push({ label: formatLabel(priority), tone: priorityTone(priority) });
  if (item.status)
    badges.push({
      label: formatLabel(item.status),
      tone: item.status === 'OPEN' || item.status === 'BLOCKED' ? 'warn' : 'neutral',
    });
  const movement = item.movement ?? item.currentMovement ?? item.momentum;
  if (movement) badges.push({ label: formatLabel(movement), tone: momentumTone(movement) });
  if (item.track) badges.push({ label: formatLabel(item.track), tone: 'accent' });
  if (item.matchStrength) {
    badges.push({
      label: formatLabel(item.matchStrength),
      tone:
        item.matchStrength === 'STRONG'
          ? 'good'
          : item.matchStrength === 'PARTIAL'
            ? 'info'
            : 'neutral',
    });
  }
  if (item.timeHorizon) badges.push({ label: formatLabel(item.timeHorizon), tone: 'info' });
  return badges.slice(0, 3);
};

const firstNonEmpty = (...values: Array<string | undefined | null>): string =>
  values.map(cleanText).find(Boolean) ?? '';

const EmptyState = ({ title, text }: { title: string; text: string }): ReactElement => (
  <div className='rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-5'>
    <p className='text-sm font-medium text-foreground'>{title}</p>
    <p className='mt-1 text-sm text-muted-foreground'>{text}</p>
  </div>
);

const LoadingState = ({ label }: { label: string }): ReactElement => (
  <div className='flex min-h-[420px] items-center justify-center'>
    <div className='flex items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm'>
      <Loader2Icon className='size-4 animate-spin' />
      {label}
    </div>
  </div>
);

const ErrorState = ({ label }: { label: string }): ReactElement => (
  <div className='flex min-h-[420px] items-center justify-center'>
    <div className='max-w-md rounded-lg border border-rose-500/20 bg-rose-500/10 px-5 py-4'>
      <p className='text-sm font-medium text-rose-700 dark:text-rose-300'>{label}</p>
      <p className='mt-1 text-sm text-muted-foreground'>
        The latest leadership snapshot could not be loaded.
      </p>
    </div>
  </div>
);

const Pill = ({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: Tone;
}): ReactElement => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
      toneClassName[tone],
    )}
  >
    {children}
  </span>
);

const PaginationControls = ({
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
const SectionHeading = ({
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
const Zone = ({
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
const SignalCard = ({ signal }: { signal: Signal }): ReactElement => {
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

const SignalStrip = ({ signals }: { signals: Signal[] }): ReactElement => {
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
const ExpandableList = ({
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
                <div className='flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5'>
                  <h4 className='text-[15px] font-medium leading-snug text-foreground/90 sm:text-base'>
                    {title}
                  </h4>
                  {badges.length > 0 ? (
                    <div className='flex flex-wrap items-center gap-1'>
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
const CalloutQuote = ({
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

const ItemGrid = ExpandableList;

const StringList = ({
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

const responsePagination = (response: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  items: unknown[];
}): PaginationState<unknown> => ({
  pageIndex: response.page - 1,
  pageCount: Math.max(1, response.totalPages),
  rangeStart: response.total === 0 ? 0 : (response.page - 1) * response.limit + 1,
  rangeEnd: (response.page - 1) * response.limit + response.items.length,
  total: response.total,
  visibleItems: response.items,
});

const PaginatedItemSection = ({
  request,
  section,
  emptyTitle,
  emptyText,
}: {
  request: SectionRequest;
  section: string;
  emptyTitle: string;
  emptyText: string;
}): ReactElement => {
  const [page, setPage] = useState(1);
  useEffect(
    () => setPage(1),
    [request.from, request.to, request.teamId, request.userEmail, section],
  );
  const { data, isLoading, isError } = useLeadershipSection<LeadershipItem>({
    ...request,
    section,
    page,
    limit: SECTION_PAGE_SIZE,
  });
  if (isLoading && !data) return <LoadingState label='Loading section...' />;
  if (isError || !data) return <ErrorState label='Could not load this section.' />;
  const pagination = responsePagination(data);
  return (
    <>
      <ItemGrid items={data.items} emptyTitle={emptyTitle} emptyText={emptyText} />
      <PaginationControls
        pagination={pagination}
        setPage={nextPage => setPage(nextPage + 1)}
        trackName={section}
        className='mt-3 rounded-xl border border-border/70'
      />
    </>
  );
};

const PaginatedTextSection = ({
  request,
  section,
  emptyTitle,
  emptyText,
}: {
  request: SectionRequest;
  section: string;
  emptyTitle: string;
  emptyText: string;
}): ReactElement => {
  const [page, setPage] = useState(1);
  useEffect(
    () => setPage(1),
    [request.from, request.to, request.teamId, request.userEmail, section],
  );
  const { data, isLoading, isError } = useLeadershipSection<string | TextHeadline>({
    ...request,
    section,
    page,
    limit: SECTION_PAGE_SIZE,
  });
  if (isLoading && !data) return <LoadingState label='Loading section...' />;
  if (isError || !data) return <ErrorState label='Could not load this section.' />;
  const pagination = responsePagination(data);
  return (
    <>
      <StringList items={data.items} emptyTitle={emptyTitle} emptyText={emptyText} />
      <PaginationControls
        pagination={pagination}
        setPage={nextPage => setPage(nextPage + 1)}
        trackName={section}
        className='mt-3 rounded-xl border border-border/70'
      />
    </>
  );
};

const Section = ({
  id,
  icon,
  title,
  eyebrow,
  tone = 'neutral',
  question,
  children,
}: SectionProps): ReactElement => (
  <Zone tone={tone} {...(id ? { id } : {})}>
    <SectionHeading
      icon={icon}
      title={title}
      tone={tone}
      {...((question ?? eyebrow) ? { question: question ?? eyebrow } : {})}
    />
    {children}
  </Zone>
);

/* ── Zone: Team members grid ── */
const TeamMembersPanel = ({ teamId }: { teamId: string }): ReactElement => {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [teamId]);
  const { data: teamMembers, isLoading, isError } = useTeamMembers(teamId, page);
  const members = (teamMembers?.employee_list ?? [])
    .filter(member => cleanText(member.email) || cleanText(member.name))
    .sort((a, b) => firstNonEmpty(a.name, a.email).localeCompare(firstNonEmpty(b.name, b.email)));
  const memberPage = teamMembers?.pagination;
  const pagination = responsePagination({
    page: memberPage?.page ?? page,
    totalPages: memberPage?.totalPages ?? 0,
    total: memberPage?.total ?? 0,
    limit: memberPage?.limit ?? SECTION_PAGE_SIZE,
    items: members,
  });

  return (
    <Zone tone='info'>
      <SectionHeading
        icon={UsersIcon}
        title='Know your team'
        question='Who is doing what?'
        tone='info'
      />
      {isLoading ? (
        <div className='flex items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm'>
          <Loader2Icon className='size-4 animate-spin' />
          Loading team members from Mettle...
        </div>
      ) : isError ? (
        <EmptyState
          title='Could not load team members'
          text='The Mettle team member API did not return a roster for this team.'
        />
      ) : members.length === 0 ? (
        <EmptyState
          title='No team members found'
          text='Mettle did not return employees for this team.'
        />
      ) : (
        <div className='overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm'>
          <div className='grid gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-3'>
            {members.map((member, index) => {
              const name = firstNonEmpty(member.name, member.email, 'Unknown member');
              const email = cleanText(member.email);
              const role = firstNonEmpty(
                member.designation,
                member.role,
                member.category,
                member.employment_type,
              );
              const status = cleanText(member.employee_status);
              const key = firstNonEmpty(
                email,
                member.id,
                member.assigned_emp_id,
                `${name}-${(page - 1) * SECTION_PAGE_SIZE + index}`,
              );
              const content = (
                <div className='group/member min-h-[116px] bg-card px-4 py-3 transition-colors hover:bg-muted/20'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium text-foreground/90 group-hover/member:whitespace-normal group-hover/member:break-words'>
                        {name}
                      </p>
                      {email ? (
                        <p className='mt-1 truncate text-xs text-muted-foreground group-hover/member:whitespace-normal group-hover/member:break-all'>
                          {email}
                        </p>
                      ) : null}
                    </div>
                    {email ? (
                      <ArrowUpRightIcon className='size-4 shrink-0 text-muted-foreground' />
                    ) : null}
                  </div>
                  <div className='mt-3 flex flex-wrap items-center gap-2'>
                    {role ? <Pill tone='neutral'>{role}</Pill> : null}
                    {status ? (
                      <Pill tone={status.toUpperCase() === 'ACTIVE' ? 'good' : 'neutral'}>
                        {formatLabel(status)}
                      </Pill>
                    ) : null}
                  </div>
                </div>
              );
              return email ? (
                <Link
                  key={key}
                  to={`/team-intelligence/member/${encodeURIComponent(email)}`}
                  data-track-category='team-intelligence'
                  data-track-name='open-mettle-team-member'
                  data-track-metadata={JSON.stringify({ email })}
                  className='block focus:outline-none focus-visible:ring-2 focus-visible:ring-action-accent'
                >
                  {content}
                </Link>
              ) : (
                <div key={key}>{content}</div>
              );
            })}
          </div>
          <PaginationControls
            pagination={pagination}
            setPage={nextPage => setPage(nextPage + 1)}
            trackName='mettle-team-member'
          />
        </div>
      )}
    </Zone>
  );
};

/* ── Zone: Bullet brief (key takeaways, click-to-expand) ── */
const BulletBrief = ({ request }: { request: SectionRequest }): ReactElement | null => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [request.from, request.to, request.teamId, request.userEmail]);
  const { data, isLoading, isError } = useLeadershipSection<LeadershipBullet | string>({
    ...request,
    section: 'bullets',
    page,
    limit: SECTION_PAGE_SIZE,
  });
  if (isLoading && !data) return <LoadingState label='Loading summary bullets...' />;
  if (isError || !data) return null;
  const bullets = data.items.map(
    (bullet, index): LeadershipBullet =>
      typeof bullet === 'string'
        ? {
            id: `${data.snapshotId}-bullet-${(data.page - 1) * data.limit + index}`,
            title: `Manager note ${(data.page - 1) * data.limit + index + 1}`,
            text: bullet,
          }
        : bullet,
  );
  const pagination = responsePagination(data);
  const toggleBullet = (id: string): void => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <div className='border-t border-border/70'>
      <div className='divide-y divide-border/60'>
        {bullets.map(bullet => {
          const isExpanded = expandedKeys.has(bullet.id);
          return (
            <article key={bullet.id}>
              <button
                type='button'
                onClick={() => toggleBullet(bullet.id)}
                aria-expanded={isExpanded}
                data-track-category='team-intelligence'
                data-track-name='toggle-leadership-summary-bullet'
                data-track-metadata={JSON.stringify({
                  bulletId: bullet.id,
                  isExpanded: !isExpanded,
                })}
                className='group flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/30 sm:px-6'
              >
                <ChevronDownIcon
                  className={cn(
                    'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                    isExpanded ? 'rotate-180 text-action-accent' : 'rotate-0',
                  )}
                />
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <h4 className='text-sm font-medium leading-snug text-foreground/90 sm:text-[15px]'>
                      {bullet.title}
                    </h4>
                    {bullet.category ? (
                      <Pill tone='accent'>{formatLabel(bullet.category)}</Pill>
                    ) : null}
                  </div>
                  {isExpanded ? (
                    <p className='mt-2 max-w-3xl text-sm leading-6 text-muted-foreground'>
                      {bullet.text}
                    </p>
                  ) : null}
                </div>
              </button>
            </article>
          );
        })}
      </div>
      <PaginationControls
        pagination={pagination}
        setPage={nextPage => setPage(nextPage + 1)}
        trackName='leadership-bullet'
        className='px-5 sm:px-6'
      />
    </div>
  );
};

/* ── Hero shell (title + pills + narrative + bullets) ── */
const SnapshotShell = ({
  scope,
  title,
  eyebrow,
  reportDate,
  confidence,
  momentum,
  narrative,
  sectionRequest,
  children,
}: SnapshotShellProps): ReactElement => {
  const scopeLabel =
    scope === 'org' ? 'Founder Brief' : scope === 'team' ? 'Manager Brief' : 'Member Brief';
  const displayNarrative = cleanText(narrative);
  return (
    <div className='flex-1 w-full max-w-7xl mx-auto px-4 py-5 sm:px-6 lg:px-8 space-y-7'>
      <section className='overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm'>
        <div className='bg-muted/20 px-5 py-6 sm:px-7'>
          <div className='flex flex-wrap items-center gap-2'>
            <Pill tone='accent'>{scopeLabel}</Pill>
            {reportDate ? <Pill tone='info'>{formatReportDate(reportDate)}</Pill> : null}
            {confidence ? (
              <Pill tone={confidenceTone(confidence)}>{formatLabel(confidence)} Confidence</Pill>
            ) : null}
            {momentum ? <Pill tone={momentumTone(momentum)}>{formatLabel(momentum)}</Pill> : null}
          </div>
          <div className='mt-5 w-full'>
            <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              {eyebrow}
            </p>
            <h1 className='mt-2 text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-4xl'>
              {title}
            </h1>
            {displayNarrative ? (
              <p className='mt-4 w-full text-[15px] leading-7 text-muted-foreground sm:text-base sm:leading-8'>
                {displayNarrative}
              </p>
            ) : null}
          </div>
        </div>
        <BulletBrief request={sectionRequest} />
      </section>
      {children}
    </div>
  );
};

export const OrgLeadershipDashboard = ({
  snapshot,
  isLoading,
  isError,
  sectionRequest,
}: {
  snapshot: { summary: OrgLeadershipSummary; completedAt: string | null } | null;
  isLoading: boolean;
  isError: boolean;
  sectionRequest: SectionRequest;
}): ReactElement => {
  if (isLoading) return <LoadingState label='Loading founder brief...' />;
  if (isError) return <ErrorState label='Could not load the organization brief.' />;
  if (!snapshot) {
    return (
      <EmptyState
        title='No organization brief yet'
        text='No completed organization leadership snapshot exists for this range.'
      />
    );
  }

  const { summary } = snapshot;
  const operational = summary.operationalSnapshot;
  const narrative = executiveNarrative(summary.executiveSummary);

  return (
    <SnapshotShell
      scope='org'
      title='Juspay Leadership Brief'
      eyebrow={`${summary.organization.teamCount} teams · ${summary.organization.memberCount} members represented`}
      reportDate={summary.reportDate}
      confidence={summary.overallConfidence}
      momentum={summary.executiveSummary.momentum}
      narrative={narrative}
      sectionRequest={sectionRequest}
    >
      <SignalStrip
        signals={[
          {
            label: 'Momentum',
            value: formatLabel(operational.momentumAndDirection.momentum),
            description: operational.momentumAndDirection.assessment,
            tone: momentumTone(operational.momentumAndDirection.momentum),
            icon: ActivityIcon,
            targetId: 'org-portfolio-of-bets',
          },
          {
            label: 'Critical Work',
            value: `${operational.criticalAndMoving.length} active signals`,
            description: 'Initiatives the organization cannot afford to let drift.',
            tone: operational.criticalAndMoving.length > 0 ? 'accent' : 'neutral',
            icon: FlameIcon,
            targetId: 'org-founder-agenda',
          },
          {
            label: 'Open Blockers',
            value: `${operational.needsUnblocking.length} require attention`,
            description: 'Cross-team or leadership-level blockers surfaced by the model.',
            tone: operational.needsUnblocking.length > 0 ? 'warn' : 'good',
            icon: ShieldAlertIcon,
            targetId: 'org-cannot-deadlock',
          },
          {
            label: 'Coverage',
            value: `${summary.processingCoverage.completedTeamSummaries}/${summary.processingCoverage.expectedTeams} teams`,
            description: 'Completed team summaries included in this brief.',
            tone: summary.processingCoverage.failedTeamSummaries > 0 ? 'warn' : 'good',
            icon: UsersIcon,
            targetId: 'org-leadership-leverage',
          },
        ]}
      />

      <Section
        id='org-founder-agenda'
        icon={TargetIcon}
        title='Founder Agenda'
        eyebrow='Immediate leverage'
        tone='accent'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='founder-agenda'
          emptyTitle='No direct founder asks'
          emptyText='The snapshot did not surface immediate leadership actions.'
        />
      </Section>

      <Section
        id='org-portfolio-of-bets'
        icon={SparklesIcon}
        title='Portfolio Of Bets'
        eyebrow='Where the company is moving'
        tone='info'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='portfolio-of-bets'
          emptyTitle='No portfolio bets found'
          emptyText='The snapshot did not identify explicit organization-level bets.'
        />
      </Section>

      <Section
        id='org-cannot-deadlock'
        icon={AlertTriangleIcon}
        title='Cannot Deadlock'
        eyebrow='Critical intervention points'
        tone='danger'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='cannot-deadlock'
          emptyTitle='No deadlock risks surfaced'
          emptyText='No critical blockers or upcoming risks were present in the current snapshot.'
        />
      </Section>

      <Section
        id='org-leadership-leverage'
        icon={NetworkIcon}
        title='Leadership Leverage'
        eyebrow='Where one move can unlock many'
        tone='warn'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='leadership-leverage'
          emptyTitle='No leverage items'
          emptyText='The snapshot did not find leverage moves for this range.'
        />
      </Section>

      <Section icon={ZapIcon} title='Next Leap' eyebrow='Operating model shift' tone='good'>
        <PaginatedTextSection
          request={sectionRequest}
          section='next-leap'
          emptyTitle='No next leap drafted'
          emptyText='The snapshot did not produce a next-leap narrative.'
        />
      </Section>
    </SnapshotShell>
  );
};

export const TeamLeadershipDashboard = ({
  snapshot,
  isLoading,
  isError,
  sectionRequest,
  teamId,
}: {
  snapshot: { summary: TeamLeadershipSummary | null; completedAt?: string | null } | null;
  isLoading: boolean;
  isError: boolean;
  sectionRequest: SectionRequest;
  teamId: string;
}): ReactElement => {
  if (isLoading) return <LoadingState label='Loading manager brief...' />;
  if (isError) return <ErrorState label='Could not load the team brief.' />;
  if (!snapshot?.summary) {
    return (
      <div className='flex-1 w-full max-w-7xl mx-auto px-4 py-5 sm:px-6 lg:px-8 space-y-6'>
        <EmptyState
          title='No team brief yet'
          text='No completed team leadership snapshot exists for this range.'
        />
        <TeamMembersPanel teamId={teamId} />
      </div>
    );
  }

  const summary = snapshot.summary;
  const operational = summary.operationalSnapshot;
  const leadership = summary.leadershipSnapshot;
  const narrative = executiveNarrative(summary.executiveSummary);

  return (
    <SnapshotShell
      scope='team'
      title={`${summary.team.name} Manager Brief`}
      eyebrow={`${summary.processingCoverage.completedUserSummaries} completed member summaries`}
      reportDate={summary.reportDate}
      confidence={summary.overallConfidence}
      momentum={summary.executiveSummary.momentum}
      narrative={narrative}
      sectionRequest={sectionRequest}
    >
      <SignalStrip
        signals={[
          {
            label: 'Momentum',
            value: formatLabel(operational.momentumAndDirection.momentum),
            description: operational.momentumAndDirection.assessment,
            tone: momentumTone(operational.momentumAndDirection.momentum),
            icon: ActivityIcon,
            targetId: 'team-goal',
          },
          {
            label: 'Leadership Mode',
            value: formatLabel(
              leadership.leadershipTouch?.recommendedMode ?? 'INSUFFICIENT_EVIDENCE',
            ),
            description:
              (leadership.leadershipTouch?.reasons ?? [])[0] ?? 'Recommended manager touch level.',
            tone: leadership.leadershipTouch?.recommendedMode === 'HIGH_TOUCH' ? 'warn' : 'info',
            icon: GaugeIcon,
            targetId: 'team-capability-and-leverage',
          },
          {
            label: 'Critical Work',
            value: `${operational.criticalAndMoving.length} high-value threads`,
            description: 'Work that deserves close managerial attention.',
            tone: operational.criticalAndMoving.length > 0 ? 'accent' : 'neutral',
            icon: FlameIcon,
            targetId: 'team-actual-work',
          },
          {
            label: 'Blockers',
            value: `${operational.needsUnblocking.length} visible blockers`,
            description: 'Items that need a decision, person, or dependency cleared.',
            tone: operational.needsUnblocking.length > 0 ? 'warn' : 'good',
            icon: ShieldAlertIcon,
            targetId: 'team-bottlenecks-and-load',
          },
        ]}
      />

      <TeamMembersPanel teamId={teamId} />

      <Section icon={ListChecksIcon} title='Manager Actions' eyebrow='Do next' tone='accent'>
        <PaginatedItemSection
          request={sectionRequest}
          section='manager-actions'
          emptyTitle='No direct manager actions'
          emptyText='The snapshot did not surface manager-level actions.'
        />
      </Section>

      <Section id='team-goal' icon={TargetIcon} title='Goal' eyebrow='Progress' tone='accent'>
        <PaginatedItemSection
          request={sectionRequest}
          section='goal'
          emptyTitle='No goal alignment found'
          emptyText='No active goal matched the team activity evidence for this summary.'
        />
      </Section>

      <Section
        id='team-actual-work'
        icon={CompassIcon}
        title='What The Team Is Actually Doing'
        eyebrow='Visible work'
        tone='info'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='actual-work'
          emptyTitle='No workstreams found'
          emptyText='The selected range did not produce visible workstream signals.'
        />
      </Section>

      <Section
        id='team-bottlenecks-and-load'
        icon={BlocksIcon}
        title='Bottlenecks And Load'
        eyebrow='Where management can help'
        tone='danger'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='bottlenecks-and-load'
          emptyTitle='No bottlenecks surfaced'
          emptyText='The snapshot did not detect active bottlenecks for this team.'
        />
      </Section>

      <Section
        id='team-capability-and-leverage'
        icon={BrainIcon}
        title='Capability And Leverage'
        eyebrow='Team shape'
        tone='good'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='capability-and-leverage'
          emptyTitle='No capability signals'
          emptyText='The snapshot did not produce capability or leverage signals.'
        />
      </Section>

      <Section icon={ZapIcon} title='Next Leap' eyebrow='Manager framing' tone='warn'>
        <PaginatedTextSection
          request={sectionRequest}
          section='next-leap'
          emptyTitle='No next leap drafted'
          emptyText='The snapshot did not produce a next-leap narrative for this team.'
        />
      </Section>
    </SnapshotShell>
  );
};

export const MemberLeadershipDashboard = ({
  snapshot,
  member,
  isLoading,
  isError,
  sectionRequest,
}: {
  snapshot: { summary: UserLeadershipSummary; completedAt: string | null } | null;
  member?: TeamMember | undefined;
  isLoading: boolean;
  isError: boolean;
  sectionRequest: SectionRequest;
}): ReactElement => {
  if (isLoading) return <LoadingState label='Loading member brief...' />;
  if (isError) return <ErrorState label='Could not load the member brief.' />;
  if (!snapshot) {
    return (
      <EmptyState
        title='No member brief yet'
        text='No completed member leadership summary exists for this range.'
      />
    );
  }

  const summary = snapshot.summary;
  const displayName = member?.name ?? summary.user.name;
  const teamPath = summary.user.teamId
    ? `/team-intelligence/team/${encodeURIComponent(summary.user.teamId)}`
    : null;

  return (
    <SnapshotShell
      scope='member'
      title={`${displayName} Daily Brief`}
      eyebrow={summary.user.teamName ?? member?.team?.name ?? 'Individual contributor signal'}
      reportDate={summary.reportDate}
      confidence={summary.overallConfidence}
      momentum={summary.momentumAndDirection.momentum}
      narrative={summary.executiveSummary}
      sectionRequest={sectionRequest}
    >
      {teamPath ? (
        <div className='flex justify-end'>
          <Link
            to={teamPath}
            className='inline-flex items-center gap-2 rounded-md border border-border/70 bg-card px-3 py-2 text-sm text-foreground transition-colors hover:border-action-accent/50'
          >
            Open team brief
            <ArrowUpRightIcon className='size-4' />
          </Link>
        </div>
      ) : null}

      <SignalStrip
        signals={[
          {
            label: 'Momentum',
            value: formatLabel(summary.momentumAndDirection.momentum),
            description: summary.momentumAndDirection.assessment,
            tone: momentumTone(summary.momentumAndDirection.momentum),
            icon: ActivityIcon,
          },
          {
            label: 'Focus',
            value: formatLabel(summary.peopleLoadFocusAndGaps.focusAssessment),
            description: summary.peopleLoadFocusAndGaps.assessment,
            tone: summary.peopleLoadFocusAndGaps.focusAssessment.includes('FRAGMENTED')
              ? 'warn'
              : 'info',
            icon: TargetIcon,
          },
          {
            label: 'Load',
            value: formatLabel(summary.peopleLoadFocusAndGaps.loadAssessment),
            description: 'Current load reading from the evidence window.',
            tone:
              summary.peopleLoadFocusAndGaps.loadAssessment === 'OVERLOADED' ? 'danger' : 'good',
            icon: GaugeIcon,
          },
          {
            label: 'Manager Attention',
            value: `${summary.managerAttention.length} actions`,
            description: 'Items the manager should notice or clear.',
            tone: summary.managerAttention.length > 0 ? 'accent' : 'neutral',
            icon: BadgeCheckIcon,
          },
        ]}
      />

      <Section
        icon={ListChecksIcon}
        title='Manager Attention'
        eyebrow='Person-specific asks'
        tone='accent'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='manager-attention'
          emptyTitle='No manager attention needed'
          emptyText='No person-specific manager actions were surfaced in this range.'
        />
      </Section>

      <Section icon={CompassIcon} title='Work And Movement' eyebrow='Current state' tone='info'>
        <PaginatedItemSection
          request={sectionRequest}
          section='work-and-movement'
          emptyTitle='No visible workstreams'
          emptyText='The selected range did not produce workstream signals for this person.'
        />
      </Section>

      <Section
        icon={AlertTriangleIcon}
        title='Blockers And Risks'
        eyebrow='Needs clearing'
        tone='danger'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='blockers-and-risks'
          emptyTitle='No blockers or risks'
          emptyText='No blockers, gaps, or at-risk commitments were detected.'
        />
      </Section>

      <Section icon={LightbulbIcon} title='Decisions And Signals' eyebrow='Direction' tone='warn'>
        <PaginatedTextSection
          request={sectionRequest}
          section='decisions-and-signals'
          emptyTitle='No decisions or directional signals'
          emptyText='The snapshot did not surface decisions, open questions, or team direction signals.'
        />
      </Section>
    </SnapshotShell>
  );
};
