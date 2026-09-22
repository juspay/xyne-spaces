import { ReactElement, ReactNode } from 'react';
import { format, subDays } from 'date-fns';
import { CalendarFilled, ChevronBigRight, File02Default } from '@xyne/icons';
import { cn } from '../../utils/classNames';

/** Chrome (border/bg/shadow/radius) belongs to the animated container in
 *  BriefFeaturesDialog — a view that drew its own would snap to size while an
 *  invisible box animated around it. Views declare width and padding only. */
export const CARD_CHROME =
  'border border-border bg-background shadow-[0px_3px_6px_0px_rgba(0,0,0,0.04)]';
const BRIEF_BODY = 'w-[380px] px-5 pb-6 pt-5';
const LABEL = 'w-[80px] shrink-0 text-[8px] font-semibold leading-[1.5] text-foreground';
const BODY = 'text-[8px] leading-[1.5] text-muted-foreground';

const Em = ({ children }: { children: ReactNode }): ReactElement => (
  <b className='font-semibold text-foreground'>{children}</b>
);
const Mention = ({ children }: { children: ReactNode }): ReactElement => (
  <span className='text-[color:var(--mention-color)]'>{children}</span>
);

interface MiniSectionSpec {
  label: string;
  lines: ReactNode[];
  dotted?: boolean;
  /** Wrapped visual rows this section occupies — the skeleton mirrors it so the
   *  card does not change height when the real content resolves into place. */
  rows: number;
}

const SECTIONS: MiniSectionSpec[] = [
  {
    label: 'What needs you',
    rows: 3,
    lines: [
      <>
        Today is about closing the outage confirmation loop, deciding the product solution, and
        clearing two stage-approval requests in your Tickets feed.
      </>,
    ],
  },
  {
    label: 'Overdue',
    dotted: true,
    rows: 3,
    lines: [
      <>
        <Em>Outage handoff, verify</Em>: approved 1:38pm, related request routed to{' '}
        <Mention>@Maya Mehta</Mention>
      </>,
      <>
        <Em>2 stage-approvals pending</Em>: check Tickets → Approvals.
      </>,
    ],
  },
  {
    label: 'Waiting on others',
    dotted: true,
    rows: 2,
    lines: [
      <>
        <Em>Cashfree error-description PR</Em> CC&apos;d you at 1:29pm, waiting on merge.{' '}
        <Mention>@Maya Chen</Mention>
      </>,
    ],
  },
  {
    label: 'Assigned to you',
    dotted: true,
    rows: 2,
    lines: [
      <>
        <Em>Auth flow refactor</Em> HIGH priority, no update since 2 Jul, flagged stale.
      </>,
    ],
  },
];

function MiniSection({ label, lines, dotted }: MiniSectionSpec): ReactElement {
  return (
    <div className='flex w-full items-start gap-2.5'>
      <p className={LABEL}>{label}</p>
      <div className='flex min-w-0 flex-1 flex-col gap-[4px]'>
        {lines.map((line, i) => (
          <div key={i} className='flex items-start gap-1'>
            {dotted && (
              <span className='mt-[4px] size-[3px] shrink-0 rounded-full bg-muted-foreground' />
            )}
            <p className={cn('min-w-0 flex-1', BODY)}>{line}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The dummy brief card, dated relative to today so the mock never looks stale. */
export function MiniBriefCard({ regenerated = false }: { regenerated?: boolean }): ReactElement {
  return (
    <div className={BRIEF_BODY} aria-hidden>
      <div className='mb-3 flex items-center justify-center gap-1.5'>
        <p className='text-center font-serif text-[14px] font-bold italic text-foreground'>
          Brief // {format(new Date(), 'MMM d')}
        </p>
        {regenerated && (
          <span className='inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-[2px] text-[8px] font-semibold leading-none text-primary'>
            <span className='size-[4px] rounded-full bg-primary' />
            Regenerated
          </span>
        )}
      </div>
      <div className='flex flex-col gap-3'>
        {SECTIONS.map(s => (
          <MiniSection key={s.label} {...s} />
        ))}
        <div className='flex w-full items-start gap-2'>
          <p className={LABEL}>Today&apos;s schedule</p>
          <div className='min-w-0 flex-1 border-l-2 border-xyne-orange-500 pl-2'>
            <p className='text-[8px] font-semibold leading-[1.5] text-foreground'>
              Auth flow design review, 10:00 AM
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Placeholder for the regenerate demo. Row counts come from SECTIONS, so it
 * occupies the same height as the card it resolves into — without that the
 * crossfade also animates a height change and reads as a jump.
 */
export function MiniBriefSkeleton(): ReactElement {
  return (
    <div className={BRIEF_BODY} aria-hidden>
      <div className='mx-auto mb-3 h-[11px] w-[88px] animate-pulse rounded-full bg-muted' />
      <div className='flex flex-col gap-3'>
        {[...SECTIONS.map(s => s.rows), 1].map((rows, i) => (
          <div key={i} className='flex w-full items-start gap-2'>
            <div className='h-[8px] w-[58px] shrink-0 animate-pulse rounded-full bg-muted' />
            <div className='flex min-w-0 flex-1 flex-col gap-[5px]'>
              {Array.from({ length: rows }).map((_, r) => (
                <div
                  key={r}
                  className='h-[6px] animate-pulse rounded-full bg-muted'
                  style={{ width: `${100 - r * 14}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact mirror of BriefSettingsDialog — the parts worth showing, nothing more. */
export function MiniSettingsCard(): ReactElement {
  return (
    <div className='w-[404px] p-4' aria-hidden>
      <p className='text-[12px] font-semibold text-foreground'>Brief settings</p>
      <p className={cn('mt-1', BODY)}>
        Add your own instructions to shape how the brief is written. The five sections always stay
        the same.
      </p>
      <p className='mt-3 text-[9px] font-semibold text-foreground'>Your instructions</p>
      <div className='mt-1 rounded-[6px] border border-border bg-muted/30 p-2'>
        <p className='text-[9px] leading-[1.6] text-muted-foreground'>
          Keep each section short and skimmable. Lead the Overdue section with the highest-risk item
          first, and always call out who I&apos;m blocked on.
        </p>
      </div>
      <div className='mt-3 flex items-center justify-between'>
        <span className='rounded-[6px] border border-border px-3 py-1.5 text-[9px] font-semibold text-foreground'>
          Cancel
        </span>
        <div className='flex items-center gap-1.5'>
          <span className='rounded-[6px] border border-border px-3 py-1.5 text-[9px] font-semibold text-foreground'>
            Save &amp; regenerate
          </span>
          <span className='rounded-[6px] bg-primary px-3 py-1.5 text-[9px] font-semibold text-primary-foreground'>
            Save
          </span>
        </div>
      </div>
    </div>
  );
}

/** Mirror of BriefListView — past briefs plus the calendar entry point. */
export function MiniHistoryCard(): ReactElement {
  const today = new Date();
  const rows = [1, 2, 3].map(back => format(subDays(today, back), 'd MMM'));
  return (
    <div className='w-[348px] p-3' aria-hidden>
      <ul className='flex flex-col gap-px'>
        {rows.map((label, i) => (
          <li key={label}>
            <div
              className={cn(
                'flex items-center gap-3 rounded-[10px] px-3 py-3 text-[14px] tracking-[-0.1px]',
                i === 1
                  ? 'bg-accent font-medium text-foreground'
                  : 'font-normal text-muted-foreground',
              )}
            >
              <File02Default size={18} className='shrink-0 text-muted-foreground' />
              <span className='truncate'>Morning Brief {label}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className='mt-1 border-t border-border pt-1'>
        <div className='flex items-center gap-3 rounded-[10px] px-3 py-3 text-[14px] font-normal tracking-[-0.1px] text-muted-foreground'>
          <CalendarFilled size={18} className='shrink-0' />
          <span className='flex-1 truncate text-left'>Find a Brief</span>
          <ChevronBigRight size={16} className='shrink-0' />
        </div>
      </div>
    </div>
  );
}
