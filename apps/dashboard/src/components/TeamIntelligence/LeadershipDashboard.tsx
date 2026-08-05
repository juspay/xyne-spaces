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
import { ReactElement, ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LeadershipBullet,
  LeadershipConfidence,
  LeadershipItem,
  OrgLeadershipSummary,
  TeamLeadershipSummary,
  TeamMember,
  TeamMembersResponse,
  UserLeadershipSummary,
} from '@/services/TeamIntelligence/teamIntelligenceService';
import { cn } from '@/utils/classNames';
import { formatReportDate } from '@/utils/teamIntelligenceUtils';

type DashboardScope = 'org' | 'team' | 'member';
type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info' | 'accent';

interface SnapshotShellProps {
  scope: DashboardScope;
  title: string;
  eyebrow: string;
  reportDate?: string;
  completedAt?: string | null;
  confidence?: LeadershipConfidence;
  momentum?: string;
  narrative: string;
  bullets: LeadershipBullet[];
  children: ReactNode;
}

interface SectionProps {
  icon: LucideIcon;
  title: string;
  eyebrow?: string;
  tone?: Tone;
  children: ReactNode;
}

interface Signal {
  label: string;
  value: string;
  description: string;
  tone: Tone;
  icon: LucideIcon;
}

interface TextHeadline {
  title: string;
  text: string;
}

const SECTION_PAGE_SIZE = 12;

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

const leadershipBullets = (bullets: LeadershipBullet[], narrative: string): LeadershipBullet[] => {
  const narrativeText = cleanText(narrative);
  return bullets.filter(bullet => {
    const title = cleanText(bullet.title).toLowerCase();
    const text = cleanText(bullet.text);
    const isSyntheticUpdate = title === 'organization update' || title === 'team update';
    if (!isSyntheticUpdate) {
      return true;
    }
    return text && text !== narrativeText && !isSystemFallbackNarrative(text);
  });
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
  cleanText(item.reason);

const itemDetailNotes = (item: LeadershipItem): string[] =>
  [
    cleanText(item.recommendedAction),
    cleanText(item.expectedOutcome),
    cleanText(item.suggestedOwner ? `Owner: ${item.suggestedOwner}` : ''),
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
  if (item.timeHorizon) badges.push({ label: formatLabel(item.timeHorizon), tone: 'info' });
  return badges.slice(0, 3);
};

const firstNonEmpty = (...values: Array<string | undefined | null>): string =>
  values.map(cleanText).find(Boolean) ?? '';

const flattenRecordItems = (
  record: Record<string, LeadershipItem[] | undefined> | undefined,
  keys: string[],
): LeadershipItem[] => keys.flatMap(key => record?.[key] ?? []);

const buildNextLeapItems = (
  nextLeap:
    | {
        whatNext?: string;
        whatIsWrong?: string;
        theLeap?: string;
        successSignals?: string[];
      }
    | undefined,
): TextHeadline[] => [
  { title: 'What next', text: nextLeap?.whatNext ?? '' },
  { title: 'What is wrong', text: nextLeap?.whatIsWrong ?? '' },
  { title: 'The leap', text: nextLeap?.theLeap ?? '' },
  ...(nextLeap?.successSignals ?? []).map((signal, index) => ({
    title: `Success signal ${index + 1}`,
    text: signal,
  })),
];

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
      'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
      toneClassName[tone],
    )}
  >
    {children}
  </span>
);

const Section = ({
  icon: Icon,
  title,
  eyebrow,
  tone = 'neutral',
  children,
}: SectionProps): ReactElement => {
  const style = sectionToneClassName[tone];

  return (
    <section className={cn('space-y-3 border-t pt-5', style.divider)}>
      <div className='flex items-stretch gap-3'>
        <span className={cn('w-1 rounded-full', style.rail)} />
        <div
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg border',
            style.icon,
          )}
        >
          <Icon className='size-4' />
        </div>
        <div className='min-w-0'>
          {eyebrow ? (
            <p className={cn('text-xs font-medium uppercase tracking-wide', style.eyebrow)}>
              {eyebrow}
            </p>
          ) : null}
          <h3 className='text-base font-medium text-foreground/90'>{title}</h3>
        </div>
      </div>
      {children}
    </section>
  );
};

const SignalStrip = ({ signals }: { signals: Signal[] }): ReactElement => (
  <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
    {signals.map(signal => {
      const Icon = signal.icon;
      return (
        <div
          key={signal.label}
          className='rounded-lg border border-border/70 bg-card px-3.5 py-3 shadow-sm'
        >
          <div className='flex items-center justify-between gap-3'>
            <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              {signal.label}
            </p>
            <span
              className={cn(
                'flex size-7 items-center justify-center rounded-md border',
                toneClassName[signal.tone],
              )}
            >
              <Icon className='size-3.5' />
            </span>
          </div>
          <p className='mt-2 text-base font-semibold text-foreground'>{signal.value}</p>
          <p className='mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground'>
            {signal.description}
          </p>
        </div>
      );
    })}
  </div>
);

const HeadlineItem = ({
  item,
  itemKey,
  isExpanded,
  onToggle,
}: {
  item: LeadershipItem;
  itemKey: string;
  isExpanded: boolean;
  onToggle: () => void;
}): ReactElement => {
  const title = itemTitle(item);
  const badges = itemBadges(item);
  const description = itemDescription(item);
  const notes = itemDetailNotes(item).filter(note => note !== description);

  return (
    <article className='border-b border-border/60 last:border-b-0'>
      <button
        type='button'
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`${itemKey}-details`}
        data-track-category='team-intelligence'
        data-track-name='toggle-leadership-headline'
        data-track-metadata={JSON.stringify({ title, isExpanded: !isExpanded })}
        className='group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30'
      >
        <ChevronDownIcon
          className={cn(
            'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
            isExpanded ? 'rotate-180 text-action-accent' : 'rotate-0',
          )}
        />
        <div className='min-w-0 flex-1'>
          <h4 className='text-[15px] font-medium leading-snug text-foreground/90 sm:text-base'>
            {title}
          </h4>
          {badges.length > 0 ? (
            <div className='mt-2 flex flex-wrap gap-1.5'>
              {badges.map(badge => (
                <Pill key={`${title}-${badge.label}`} tone={badge.tone}>
                  {badge.label}
                </Pill>
              ))}
            </div>
          ) : null}
        </div>
      </button>

      {isExpanded ? (
        <div id={`${itemKey}-details`} className='px-11 pb-4'>
          {description ? (
            <p className='max-w-3xl text-sm leading-6 text-muted-foreground'>{description}</p>
          ) : (
            <p className='text-sm text-muted-foreground'>No additional detail was generated.</p>
          )}
          {notes.length > 0 ? (
            <div className='mt-3 grid gap-2'>
              {notes.map((note, index) => (
                <div
                  key={`${itemKey}-note-${index}`}
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
};

const ItemGrid = ({
  items,
  emptyTitle,
  emptyText,
}: {
  items: LeadershipItem[];
  emptyTitle: string;
  emptyText: string;
}): ReactElement => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} text={emptyText} />;
  }

  const orderedItems = [...items].sort(compareLeadershipItems);
  const pageCount = Math.max(1, Math.ceil(orderedItems.length / SECTION_PAGE_SIZE));
  const pageIndex = Math.min(page, pageCount - 1);
  const visibleItems = orderedItems.slice(
    pageIndex * SECTION_PAGE_SIZE,
    pageIndex * SECTION_PAGE_SIZE + SECTION_PAGE_SIZE,
  );
  const rangeStart = pageIndex * SECTION_PAGE_SIZE + 1;
  const rangeEnd = pageIndex * SECTION_PAGE_SIZE + visibleItems.length;

  const toggleItem = (key: string): void => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className='overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm'>
      {visibleItems.map((item, index) => {
        const itemIndex = pageIndex * SECTION_PAGE_SIZE + index;
        const key = item.id ?? `${itemTitle(item)}-${itemIndex}`;
        return (
          <HeadlineItem
            key={key}
            item={item}
            itemKey={key}
            isExpanded={expandedKeys.has(key)}
            onToggle={() => toggleItem(key)}
          />
        );
      })}
      {pageCount > 1 ? (
        <div className='flex items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-4 py-3'>
          <p className='text-xs text-muted-foreground'>
            Showing {rangeStart}-{rangeEnd} of {orderedItems.length}
          </p>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setPage(current => Math.max(0, current - 1))}
              disabled={pageIndex === 0}
              data-track-category='team-intelligence'
              data-track-name='previous-leadership-headlines-page'
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
              onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))}
              disabled={pageIndex >= pageCount - 1}
              data-track-category='team-intelligence'
              data-track-name='next-leadership-headlines-page'
              data-track-metadata={JSON.stringify({ page: pageIndex + 1, pageCount })}
              className='rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-action-accent/50 disabled:cursor-not-allowed disabled:opacity-40'
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const TextHeadlineList = ({
  items,
  emptyTitle,
  emptyText,
}: {
  items: TextHeadline[];
  emptyTitle: string;
  emptyText: string;
}): ReactElement => {
  const [expandedKeys, setExpandedKeys] = useState<Set<number>>(() => new Set());
  const [page, setPage] = useState(0);
  const cleaned = items
    .map(item => ({ title: cleanText(item.title), text: cleanText(item.text) }))
    .filter(item => item.title && item.text);

  if (cleaned.length === 0) {
    return <EmptyState title={emptyTitle} text={emptyText} />;
  }

  const toggleItem = (index: number): void => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };
  const pageCount = Math.max(1, Math.ceil(cleaned.length / SECTION_PAGE_SIZE));
  const pageIndex = Math.min(page, pageCount - 1);
  const visibleItems = cleaned.slice(
    pageIndex * SECTION_PAGE_SIZE,
    pageIndex * SECTION_PAGE_SIZE + SECTION_PAGE_SIZE,
  );
  const rangeStart = pageIndex * SECTION_PAGE_SIZE + 1;
  const rangeEnd = pageIndex * SECTION_PAGE_SIZE + visibleItems.length;

  return (
    <div className='overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm'>
      {visibleItems.map((item, index) => {
        const itemIndex = pageIndex * SECTION_PAGE_SIZE + index;
        return (
          <article
            key={`${item.title}-${itemIndex}`}
            className='border-b border-border/60 last:border-b-0'
          >
            <button
              type='button'
              onClick={() => toggleItem(itemIndex)}
              aria-expanded={expandedKeys.has(itemIndex)}
              data-track-category='team-intelligence'
              data-track-name='toggle-leadership-text-headline'
              data-track-metadata={JSON.stringify({
                index: itemIndex,
                isExpanded: !expandedKeys.has(itemIndex),
              })}
              className='group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30'
            >
              <ChevronDownIcon
                className={cn(
                  'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                  expandedKeys.has(itemIndex) ? 'rotate-180 text-action-accent' : 'rotate-0',
                )}
              />
              <h4 className='min-w-0 text-[15px] font-medium leading-snug text-foreground/90 sm:text-base'>
                {item.title}
              </h4>
            </button>
            {expandedKeys.has(itemIndex) ? (
              <div className='px-11 pb-4'>
                <p className='max-w-3xl text-sm leading-6 text-muted-foreground'>{item.text}</p>
              </div>
            ) : null}
          </article>
        );
      })}
      {pageCount > 1 ? (
        <div className='flex items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-4 py-3'>
          <p className='text-xs text-muted-foreground'>
            Showing {rangeStart}-{rangeEnd} of {cleaned.length}
          </p>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setPage(current => Math.max(0, current - 1))}
              disabled={pageIndex === 0}
              data-track-category='team-intelligence'
              data-track-name='previous-leadership-text-page'
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
              onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))}
              disabled={pageIndex >= pageCount - 1}
              data-track-category='team-intelligence'
              data-track-name='next-leadership-text-page'
              data-track-metadata={JSON.stringify({ page: pageIndex + 1, pageCount })}
              className='rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-action-accent/50 disabled:cursor-not-allowed disabled:opacity-40'
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const StringList = ({
  items,
  emptyTitle,
  emptyText,
}: {
  items: Array<string | TextHeadline>;
  emptyTitle: string;
  emptyText: string;
}): ReactElement => {
  const cleaned = items
    .map((item, index): TextHeadline => {
      if (typeof item === 'string') {
        const text = cleanText(item);
        return { title: text || `Point ${index + 1}`, text };
      }
      return {
        title: cleanText(item.title),
        text: cleanText(item.text),
      };
    })
    .filter(item => item.title && item.text);
  if (cleaned.length === 0) {
    return <EmptyState title={emptyTitle} text={emptyText} />;
  }
  return <TextHeadlineList items={cleaned} emptyTitle={emptyTitle} emptyText={emptyText} />;
};

const TeamMembersPanel = ({
  teamMembers,
  isLoading = false,
  isError = false,
}: {
  teamMembers?: TeamMembersResponse | undefined;
  isLoading?: boolean;
  isError?: boolean;
}): ReactElement => {
  const [page, setPage] = useState(0);
  const members = (teamMembers?.employee_list ?? [])
    .filter(member => cleanText(member.email) || cleanText(member.name))
    .sort((a, b) => firstNonEmpty(a.name, a.email).localeCompare(firstNonEmpty(b.name, b.email)));
  const pageCount = Math.max(1, Math.ceil(members.length / SECTION_PAGE_SIZE));
  const pageIndex = Math.min(page, pageCount - 1);
  const visibleMembers = members.slice(
    pageIndex * SECTION_PAGE_SIZE,
    pageIndex * SECTION_PAGE_SIZE + SECTION_PAGE_SIZE,
  );
  const rangeStart = members.length === 0 ? 0 : pageIndex * SECTION_PAGE_SIZE + 1;
  const rangeEnd = pageIndex * SECTION_PAGE_SIZE + visibleMembers.length;

  return (
    <Section icon={UsersIcon} title='Know your team' eyebrow='Who is doing what' tone='info'>
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
        <div className='overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm'>
          <div className='grid gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-3'>
            {visibleMembers.map((member, index) => {
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
                `${name}-${index}`,
              );
              const content = (
                <div className='min-h-[116px] bg-card px-4 py-3 transition-colors hover:bg-muted/20'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium text-foreground/90'>{name}</p>
                      {email ? (
                        <p className='mt-1 truncate text-xs text-muted-foreground'>{email}</p>
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
          {pageCount > 1 ? (
            <div className='flex items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-4 py-3'>
              <p className='text-xs text-muted-foreground'>
                Showing {rangeStart}-{rangeEnd} of {members.length}
              </p>
              <div className='flex items-center gap-2'>
                <button
                  type='button'
                  onClick={() => setPage(current => Math.max(0, current - 1))}
                  disabled={pageIndex === 0}
                  data-track-category='team-intelligence'
                  data-track-name='previous-mettle-team-member-page'
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
                  onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))}
                  disabled={pageIndex >= pageCount - 1}
                  data-track-category='team-intelligence'
                  data-track-name='next-mettle-team-member-page'
                  data-track-metadata={JSON.stringify({ page: pageIndex + 1, pageCount })}
                  className='rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-action-accent/50 disabled:cursor-not-allowed disabled:opacity-40'
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
};

const BulletBrief = ({ bullets }: { bullets: LeadershipBullet[] }): ReactElement => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(bullets.length / SECTION_PAGE_SIZE));
  const pageIndex = Math.min(page, pageCount - 1);
  const visibleBullets = bullets.slice(
    pageIndex * SECTION_PAGE_SIZE,
    pageIndex * SECTION_PAGE_SIZE + SECTION_PAGE_SIZE,
  );
  const rangeStart = pageIndex * SECTION_PAGE_SIZE + 1;
  const rangeEnd = pageIndex * SECTION_PAGE_SIZE + visibleBullets.length;

  const toggleBullet = (id: string): void => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className='border-t border-border/70'>
      <div className='divide-y divide-border/60'>
        {visibleBullets.map(bullet => {
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
                    <Pill tone='accent'>{formatLabel(bullet.category)}</Pill>
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
      {pageCount > 1 ? (
        <div className='flex items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-5 py-3 sm:px-6'>
          <p className='text-xs text-muted-foreground'>
            Showing {rangeStart}-{rangeEnd} of {bullets.length}
          </p>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setPage(current => Math.max(0, current - 1))}
              disabled={pageIndex === 0}
              data-track-category='team-intelligence'
              data-track-name='previous-leadership-bullet-page'
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
              onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))}
              disabled={pageIndex >= pageCount - 1}
              data-track-category='team-intelligence'
              data-track-name='next-leadership-bullet-page'
              data-track-metadata={JSON.stringify({ page: pageIndex + 1, pageCount })}
              className='rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-action-accent/50 disabled:cursor-not-allowed disabled:opacity-40'
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const SnapshotShell = ({
  scope,
  title,
  eyebrow,
  reportDate,
  completedAt,
  confidence,
  momentum,
  narrative,
  bullets,
  children,
}: SnapshotShellProps): ReactElement => {
  const scopeLabel =
    scope === 'org' ? 'Founder Brief' : scope === 'team' ? 'Manager Brief' : 'Member Brief';
  const displayNarrative = cleanText(narrative);
  return (
    <div className='flex-1 w-full max-w-7xl mx-auto px-4 py-5 sm:px-6 lg:px-8 space-y-6'>
      <section className='overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm'>
        <div className='bg-muted/20 px-5 py-5 sm:px-6'>
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
            <h2 className='mt-2 text-2xl font-medium leading-tight tracking-normal text-foreground/90 sm:text-3xl'>
              {title}
            </h2>
            {displayNarrative ? (
              <p className='mt-3 w-full text-sm leading-6 text-muted-foreground sm:text-[15px] sm:leading-7'>
                {displayNarrative}
              </p>
            ) : null}
            {completedAt ? (
              <p className='mt-4 text-xs text-muted-foreground'>
                Generated {formatReportDate(completedAt.slice(0, 10))}
              </p>
            ) : null}
          </div>
        </div>
        {bullets.length > 0 ? <BulletBrief bullets={bullets} /> : null}
      </section>
      {children}
    </div>
  );
};

export const OrgLeadershipDashboard = ({
  snapshot,
  isLoading,
  isError,
}: {
  snapshot: { summary: OrgLeadershipSummary; completedAt: string | null } | null;
  isLoading: boolean;
  isError: boolean;
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
  const founder = summary.founderSnapshot;
  const nextLeap = founder.organizationNextLeap;
  const leverage = flattenRecordItems(founder.leadershipLeverage, [
    'budgetsAndApprovals',
    'momentumCorrections',
    'connectionsNeeded',
    'problemShapingNeeds',
    'tradeoffs',
    'alignmentCorrections',
    'peopleOrTeamMoves',
  ]);
  const narrative = executiveNarrative(summary.executiveSummary);
  const bullets = leadershipBullets(summary.managerSummaryBullets, narrative);

  return (
    <SnapshotShell
      scope='org'
      title='Juspay Leadership Brief'
      eyebrow={`${summary.organization.teamCount} teams · ${summary.organization.memberCount} members represented`}
      reportDate={summary.reportDate}
      completedAt={snapshot.completedAt}
      confidence={summary.overallConfidence}
      momentum={summary.executiveSummary.momentum}
      narrative={narrative}
      bullets={bullets}
    >
      <SignalStrip
        signals={[
          {
            label: 'Momentum',
            value: formatLabel(operational.momentumAndDirection.momentum),
            description: operational.momentumAndDirection.assessment,
            tone: momentumTone(operational.momentumAndDirection.momentum),
            icon: ActivityIcon,
          },
          {
            label: 'Critical Work',
            value: `${operational.criticalAndMoving.length} active signals`,
            description: 'Initiatives the organization cannot afford to let drift.',
            tone: operational.criticalAndMoving.length > 0 ? 'accent' : 'neutral',
            icon: FlameIcon,
          },
          {
            label: 'Open Blockers',
            value: `${operational.needsUnblocking.length} require attention`,
            description: 'Cross-team or leadership-level blockers surfaced by the model.',
            tone: operational.needsUnblocking.length > 0 ? 'warn' : 'good',
            icon: ShieldAlertIcon,
          },
          {
            label: 'Coverage',
            value: `${summary.processingCoverage.completedTeamSummaries}/${summary.processingCoverage.expectedTeams} teams`,
            description: 'Completed team summaries included in this brief.',
            tone: summary.processingCoverage.failedTeamSummaries > 0 ? 'warn' : 'good',
            icon: UsersIcon,
          },
        ]}
      />

      <Section icon={TargetIcon} title='Founder Agenda' eyebrow='Immediate leverage' tone='accent'>
        <ItemGrid
          items={summary.recommendedActions}
          emptyTitle='No direct founder asks'
          emptyText='The snapshot did not surface immediate leadership actions.'
        />
      </Section>

      <Section
        icon={SparklesIcon}
        title='Portfolio Of Bets'
        eyebrow='Where the company is moving'
        tone='info'
      >
        <ItemGrid
          items={founder.portfolioOfBets ?? []}
          emptyTitle='No portfolio bets found'
          emptyText='The snapshot did not identify explicit organization-level bets.'
        />
      </Section>

      <Section
        icon={AlertTriangleIcon}
        title='Cannot Deadlock'
        eyebrow='Critical intervention points'
        tone='danger'
      >
        <ItemGrid
          items={[
            ...(founder.cannotDeadlock ?? []),
            ...operational.needsUnblocking,
            ...operational.upcomingAndAtRisk,
          ]}
          emptyTitle='No deadlock risks surfaced'
          emptyText='No critical blockers or upcoming risks were present in the current snapshot.'
        />
      </Section>

      <Section
        icon={NetworkIcon}
        title='Leadership Leverage'
        eyebrow='Where one move can unlock many'
        tone='warn'
      >
        <ItemGrid
          items={leverage}
          emptyTitle='No leverage items'
          emptyText='The snapshot did not find leverage moves for this range.'
        />
      </Section>

      <Section icon={ZapIcon} title='Next Leap' eyebrow='Operating model shift' tone='good'>
        <StringList
          items={buildNextLeapItems(nextLeap)}
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
  teamMembers,
  isMembersLoading = false,
  isMembersError = false,
}: {
  snapshot: { summary: TeamLeadershipSummary | null; completedAt?: string | null } | null;
  isLoading: boolean;
  isError: boolean;
  teamMembers?: TeamMembersResponse | undefined;
  isMembersLoading?: boolean;
  isMembersError?: boolean;
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
        <TeamMembersPanel
          teamMembers={teamMembers}
          isLoading={isMembersLoading}
          isError={isMembersError}
        />
      </div>
    );
  }

  const summary = snapshot.summary;
  const operational = summary.operationalSnapshot;
  const leadership = summary.leadershipSnapshot;
  const nextLeap = leadership.nextLeap;
  const leverage = flattenRecordItems(leadership.leadershipLeverage, [
    'irreversibleDecisions',
    'budgetOrApprovalNeeds',
    'momentumCorrections',
    'connectionsNeeded',
    'problemShapingNeeds',
    'tradeoffs',
    'alignmentCorrections',
  ]);
  const narrative = executiveNarrative(summary.executiveSummary);
  const bullets = leadershipBullets(summary.managerSummaryBullets, narrative);

  return (
    <SnapshotShell
      scope='team'
      title={`${summary.team.name} Manager Brief`}
      eyebrow={`${summary.processingCoverage.completedUserSummaries} completed member summaries`}
      reportDate={summary.reportDate}
      completedAt={snapshot.completedAt ?? null}
      confidence={summary.overallConfidence}
      momentum={summary.executiveSummary.momentum}
      narrative={narrative}
      bullets={bullets}
    >
      <SignalStrip
        signals={[
          {
            label: 'Momentum',
            value: formatLabel(operational.momentumAndDirection.momentum),
            description: operational.momentumAndDirection.assessment,
            tone: momentumTone(operational.momentumAndDirection.momentum),
            icon: ActivityIcon,
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
          },
          {
            label: 'Critical Work',
            value: `${operational.criticalAndMoving.length} high-value threads`,
            description: 'Work that deserves close managerial attention.',
            tone: operational.criticalAndMoving.length > 0 ? 'accent' : 'neutral',
            icon: FlameIcon,
          },
          {
            label: 'Blockers',
            value: `${operational.needsUnblocking.length} visible blockers`,
            description: 'Items that need a decision, person, or dependency cleared.',
            tone: operational.needsUnblocking.length > 0 ? 'warn' : 'good',
            icon: ShieldAlertIcon,
          },
        ]}
      />

      <TeamMembersPanel
        teamMembers={teamMembers}
        isLoading={isMembersLoading}
        isError={isMembersError}
      />

      <Section icon={ListChecksIcon} title='Manager Actions' eyebrow='Do next' tone='accent'>
        <ItemGrid
          items={summary.recommendedActions}
          emptyTitle='No direct manager actions'
          emptyText='The snapshot did not surface manager-level actions.'
        />
      </Section>

      <Section
        icon={CompassIcon}
        title='What The Team Is Actually Doing'
        eyebrow='Visible work'
        tone='info'
      >
        <ItemGrid
          items={[...operational.criticalAndMoving, ...operational.whoIsDoingWhat]}
          emptyTitle='No workstreams found'
          emptyText='The selected range did not produce visible workstream signals.'
        />
      </Section>

      <Section
        icon={BlocksIcon}
        title='Bottlenecks And Load'
        eyebrow='Where management can help'
        tone='danger'
      >
        <ItemGrid
          items={[
            ...operational.needsUnblocking,
            ...(operational.peopleLoadFocusAndGaps.ownershipGaps ?? []),
            ...(operational.peopleLoadFocusAndGaps.supportGaps ?? []),
            ...(leadership.bottlenecks?.peopleOrOwnership ?? []),
            ...(leadership.bottlenecks?.process ?? []),
            ...(leadership.bottlenecks?.platform ?? []),
          ]}
          emptyTitle='No bottlenecks surfaced'
          emptyText='The snapshot did not detect active bottlenecks for this team.'
        />
      </Section>

      <Section icon={BrainIcon} title='Capability And Leverage' eyebrow='Team shape' tone='good'>
        <ItemGrid
          items={[
            ...(leadership.capabilityMix?.observedStrengths ?? []),
            ...(leadership.capabilityMix?.developingCapabilities ?? []),
            ...(leadership.capabilityMix?.missingCapabilities ?? []),
            ...leverage,
          ]}
          emptyTitle='No capability signals'
          emptyText='The snapshot did not produce capability or leverage signals.'
        />
      </Section>

      <Section icon={ZapIcon} title='Next Leap' eyebrow='Manager framing' tone='warn'>
        <StringList
          items={buildNextLeapItems(nextLeap)}
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
}: {
  snapshot: { summary: UserLeadershipSummary; completedAt: string | null } | null;
  member?: TeamMember | undefined;
  isLoading: boolean;
  isError: boolean;
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
      completedAt={snapshot.completedAt}
      confidence={summary.overallConfidence}
      momentum={summary.momentumAndDirection.momentum}
      narrative={summary.executiveSummary}
      bullets={summary.managerSummaryBullets.map((text, index) => ({
        id: `${summary.userIngestionId}-bullet-${index}`,
        title: `Manager note ${index + 1}`,
        text,
        category: 'achievement',
      }))}
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
        <ItemGrid
          items={summary.managerAttention}
          emptyTitle='No manager attention needed'
          emptyText='No person-specific manager actions were surfaced in this range.'
        />
      </Section>

      <Section icon={CompassIcon} title='Work And Movement' eyebrow='Current state' tone='info'>
        <ItemGrid
          items={[...summary.criticalAndMoving, ...summary.whoIsDoingWhat]}
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
        <ItemGrid
          items={[
            ...summary.needsUnblocking,
            ...summary.upcomingAndAtRisk,
            ...summary.peopleLoadFocusAndGaps.gaps,
          ]}
          emptyTitle='No blockers or risks'
          emptyText='No blockers, gaps, or at-risk commitments were detected.'
        />
      </Section>

      <Section icon={LightbulbIcon} title='Decisions And Signals' eyebrow='Direction' tone='warn'>
        <StringList
          items={[
            ...(summary.decisionsAndAlignment.decisions ?? []).map(item =>
              firstNonEmpty(item.decision, item.title, item.description),
            ),
            ...(summary.decisionsAndAlignment.openQuestions ?? []),
            ...summary.teamSignals.directionalSignals.map(item =>
              firstNonEmpty(item.signal, item.title, item.description),
            ),
          ]}
          emptyTitle='No decisions or directional signals'
          emptyText='The snapshot did not surface decisions, open questions, or team direction signals.'
        />
      </Section>
    </SnapshotShell>
  );
};
