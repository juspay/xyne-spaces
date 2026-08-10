import React from 'react';
import type { FlowComponent, TicketProps } from '@xyne/shared';
import { cn } from '../../../utils/classNames';

const STATUS_META: Record<TicketProps['status'], { label: string; className: string }> = {
  TODO: { label: 'Todo', className: 'bg-orange-500/15 text-orange-600' },
  STARTED: { label: 'Started', className: 'bg-blue-500/15 text-blue-600' },
  PAUSED: { label: 'Paused', className: 'bg-teal-500/15 text-teal-600' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-500/15 text-red-600' },
  COMPLETED: { label: 'Completed', className: 'bg-green-500/15 text-green-600' },
};

const PRIORITY_META: Record<TicketProps['priority'], { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'text-muted-foreground' },
  MEDIUM: { label: 'Medium', className: 'text-[var(--status-pending)]' },
  HIGH: { label: 'High', className: 'text-[var(--diff-stat-del-fg)]' },
  CRITICAL: { label: 'Critical', className: 'text-destructive' },
};

function formatEta(eta: string): string | null {
  const parsed = new Date(eta);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const TicketNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as TicketProps | undefined;
  if (!props?.xyneId || !props.title) return null;

  const status = STATUS_META[props.status];
  const priority = PRIORITY_META[props.priority];
  const eta = props.eta ? formatEta(props.eta) : null;

  return (
    <section
      className='flow-artifact-wide flex w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
      style={node.style}
    >
      <div className='flex flex-col gap-2 px-4 pb-3 pt-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-foreground'>
            {props.xyneId}
          </span>
          <span
            className={cn(
              'rounded px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px]',
              status.className,
            )}
          >
            {status.label}
          </span>
          <span className={cn('text-xs font-semibold leading-[18px]', priority.className)}>
            {priority.label}
          </span>
          {eta && (
            <span className='ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground'>
              {eta}
            </span>
          )}
        </div>
        <p className='text-sm leading-[1.35] text-foreground'>{props.title}</p>
      </div>

      <div className='flex items-center gap-2 border-t border-border bg-foreground/[0.03] px-4 py-3'>
        <a
          href={props.url}
          className='rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-medium leading-[1.2] !text-foreground !no-underline hover:bg-muted'
          data-track-category='TICKET_ARTIFACT'
          data-track-name='OPEN_TICKET'
        >
          Open in tracker
        </a>
      </div>
    </section>
  );
};
