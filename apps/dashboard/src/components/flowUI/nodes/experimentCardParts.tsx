import React, { useEffect, useState } from 'react';
import { CheckTickSingle, MultipleCrossCancelDefault, Spinner } from '@xyne/icons';
import type { ExecTodoStatus, ExperimentFindingRow, ExperimentLinks } from '@xyne/shared';
import { cn } from '../../../utils/classNames';

export type PillTone = 'live' | 'warn' | 'good' | 'bad' | 'muted';

const PILL_CLASS: Record<PillTone, string> = {
  live: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  bad: 'bg-destructive/10 text-destructive',
  muted: 'bg-foreground/[0.06] text-muted-foreground',
};

export const Pill: React.FC<{ tone: PillTone; pulse?: boolean; children: React.ReactNode }> = ({
  tone,
  pulse,
  children,
}) => (
  <span
    className={cn(
      'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium leading-none',
      PILL_CLASS[tone],
    )}
  >
    {pulse && <span className='size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none' />}
    {children}
  </span>
);

export const CardShell: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties | undefined;
  wide?: boolean;
}> = ({ children, style, wide }) => (
  <div
    className={cn(
      'flex max-w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40',
      wide ? 'w-[560px]' : 'w-[480px]',
    )}
    style={style}
  >
    {children}
  </div>
);

export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className='text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground'>{children}</p>
);

export const ExecDot: React.FC<{ status: ExecTodoStatus }> = ({ status }) => {
  switch (status) {
    case 'running':
      return <Spinner size={16} className='animate-spin text-muted-foreground' />;
    case 'done':
      return (
        <span className='flex size-4 items-center justify-center rounded-full bg-foreground/80'>
          <CheckTickSingle size={12} strokeWidth={1.33} absoluteStrokeWidth className='text-background' />
        </span>
      );
    case 'failed':
      return (
        <span className='flex size-4 items-center justify-center rounded-full bg-destructive'>
          <MultipleCrossCancelDefault size={10} className='text-white' />
        </span>
      );
    default:
      return <span className='size-4 rounded-full border-[1.6px] border-foreground/20' />;
  }
};

const FINDING_TONE: Record<ExperimentFindingRow['status'], PillTone> = {
  proved: 'good',
  refuted: 'muted',
  conjecture: 'warn',
};

const FINDING_LABEL: Record<ExperimentFindingRow['status'], string> = {
  proved: 'Proved',
  refuted: 'Refuted',
  conjecture: 'Open',
};

export const FindingList: React.FC<{ rows: ExperimentFindingRow[]; showEpoch?: boolean }> = ({
  rows,
  showEpoch = true,
}) => (
  <ul className='flex flex-col divide-y divide-border rounded-lg border border-border bg-background'>
    {rows.map((row, index) => (
      <li key={`${row.title}-${index}`} className='flex items-start gap-3 px-3 py-2'>
        <Pill tone={FINDING_TONE[row.status]}>{FINDING_LABEL[row.status]}</Pill>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <p className='text-sm leading-[1.35] text-foreground'>{row.title}</p>
          {(showEpoch || row.proof || row.verdict) && (
            <p className='flex flex-wrap gap-x-2 text-xs text-muted-foreground'>
              {showEpoch && <span>Epoch {row.epoch}</span>}
              {row.proof && <span className='truncate font-mono'>{row.proof}</span>}
              {row.verdict && <span className='text-amber-700 dark:text-amber-300'>Checker: {row.verdict}</span>}
            </p>
          )}
        </div>
      </li>
    ))}
  </ul>
);

export const LinkRow: React.FC<{ links: ExperimentLinks; trackCategory: string }> = ({ links, trackCategory }) => {
  const items: Array<[string, string | undefined, string]> = [
    ['Watch the browser', links.preview, 'OPEN_PREVIEW'],
    ['Code changes', links.code, 'OPEN_CODE'],
    ['Terminal', links.terminal, 'OPEN_TERMINAL'],
  ];
  return (
    <div className='flex flex-wrap items-center gap-2'>
      {items
        .filter((item): item is [string, string, string] => Boolean(item[1]))
        .map(([label, href, track]) => (
          <a
            key={label}
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            className='rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium !text-foreground !no-underline hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
            data-track-category={trackCategory}
            data-track-name={track}
          >
            {label}
          </a>
        ))}
    </div>
  );
};

export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function useNow(active: boolean, everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return (): void => window.clearInterval(timer);
  }, [active, everyMs]);
  return now;
}

export const ProgressBar: React.FC<{ value: number; tone?: 'live' | 'done' }> = ({ value, tone = 'live' }) => (
  <div className='h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]'>
    <div
      className={cn(
        'h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
        tone === 'done' ? 'bg-foreground/40' : 'bg-emerald-500',
      )}
      style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
    />
  </div>
);
