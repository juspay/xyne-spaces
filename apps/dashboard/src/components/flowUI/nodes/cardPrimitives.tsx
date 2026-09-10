import React from 'react';
import { MaximizeFourArrow } from '@xyne/icons';
import { cn } from '../../../utils/classNames';

/**
 * Shell + chrome for the agent artifact, and for artifact cards added after it.
 *
 * The measurements and tokens deliberately match the plan card so the two read
 * as one visual system (same 450px shell, same chip treatment, same audit
 * footer). PlanNode keeps its own copy of these on purpose — it is live and
 * working, and rewiring it to a shared module would be a refactor of a shipped
 * artifact for a new one's benefit. If a third card arrives, folding PlanNode
 * in here is the natural moment; it is not this change's job.
 */

export const CardShell: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties | undefined;
}> = ({ children, style }) => (
  <div
    // Same fixed 450px as the plan card (PlanNode's own CardShell), so the two
    // artifacts sit at one width in the thread instead of the agent card running
    // ~250px wider. `max-w-full` caps it on containers narrower than 450px
    // (mobile). Height stays auto — it grows with content. Border, fill and
    // radius already matched the plan card; now the width does too.
    className='flex w-[450px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
    style={style}
  >
    {children}
  </div>
);

/** Card header: the artifact's kind on the left, optional chip, optional expand. */
export const CardHeader: React.FC<{
  label: string;
  chip?: React.ReactNode;
  onExpand?: (() => void) | undefined;
  expandAriaLabel?: string;
  trackCategory?: string;
}> = ({ label, chip, onExpand, expandAriaLabel = 'Expand', trackCategory = 'ARTIFACT_CARD' }) => (
  <div className='flex items-center justify-between'>
    <div className='flex items-center gap-2'>
      <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
        {label}
      </span>
      {chip}
    </div>
    {/* Omitted when the card is rendered inside its own preview panel — that
        would stack a second full-screen preview on top of the first. */}
    {onExpand && (
      <button
        type='button'
        onClick={onExpand}
        aria-label={expandAriaLabel}
        className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        data-track-category={trackCategory}
        data-track-name='EXPAND_ARTIFACT'
      >
        <MaximizeFourArrow size={16} className='shrink-0' />
      </button>
    )}
  </div>
);

export type StatusChipTone = 'approved' | 'muted' | 'rejected';

export const StatusChip: React.FC<{ label: string; tone?: StatusChipTone }> = ({
  label,
  tone = 'approved',
}) => (
  <span className='flex h-[18px] items-center'>
    <span
      className={cn(
        'rounded px-1 py-px text-xs font-medium leading-[18px] tracking-[0.2px]',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'rejected' && 'bg-destructive/10 text-destructive',
        tone === 'approved' &&
          'bg-[var(--plan-chip-approved-bg)] text-[var(--plan-chip-approved-fg)]',
      )}
    >
      {label}
    </span>
  </span>
);

/**
 * Small muted audit line for a card footer — "Created by @name · 2 mins ago".
 *
 * Takes children rather than a string so the actor can render as a mention
 * (styled `@handle`) inside otherwise-muted prose. `truncate` keeps a long name
 * on one line instead of wrapping the footer.
 */
export const AuditLine: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className='truncate text-xs leading-[1.2] text-muted-foreground'>{children}</span>
);

/** An `@handle` in the mention colour — the same treatment the agent's slug gets. */
export const Mention: React.FC<{ handle: string }> = ({ handle }) => (
  <span className='text-blue-500 dark:text-blue-400'>@{handle.replace(/^@+/, '')}</span>
);

export const TitleBlock: React.FC<{ title: string; desc?: string | undefined }> = ({
  title,
  desc,
}) => (
  <div className='flex flex-col'>
    <p className='text-lg font-medium leading-[1.2] text-foreground'>{title}</p>
    {desc && <p className='text-sm leading-[1.5] tracking-[-0.15px] text-foreground/80'>{desc}</p>}
  </div>
);

/**
 * Format an ISO decision timestamp for an audit footer. Relative within the
 * first day ("just now", "5 mins ago", "1 hr ago"); absolute after 24h, e.g.
 * "Jul 26, 2:34 PM". Returns null for a missing/invalid value so callers omit
 * the "· <time>" suffix.
 */
export const formatDecisionTime = (iso?: string): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  // Relative for the first day; a future timestamp (clock skew) falls through
  // to the absolute format rather than showing a negative "ago".
  const diffMs = Date.now() - d.getTime();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (diffMs >= 0 && diffMs < ONE_DAY_MS) {
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} ${mins === 1 ? 'min' : 'mins'} ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'} ago`;
  }

  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

/** Join an audit label with its (optional) decision time. */
export const withDecisionTime = (label: string, iso?: string): string => {
  const t = formatDecisionTime(iso);
  return t ? `${label} · ${t}` : label;
};
