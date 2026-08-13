import React from 'react';
import { CircleCheck, CircleDashed, CircleDot, CirclePause, CircleX } from 'lucide-react';
import type { FlowComponent, TicketProps } from '@xyne/shared';
import { TicketPriority } from '@xyne/shared';
import { formatEta, getPriorityIcon } from '../../Tickets/TicketCard/TicketCard.utils';
import { cn } from '../../../utils/classNames';

const STATUS_META: Record<
  TicketProps['status'],
  { label: string; color: string; Icon: React.FC<{ size?: number; color?: string }> }
> = {
  TODO: { label: 'Todo', color: 'var(--status-pending)', Icon: CircleDashed },
  STARTED: { label: 'Started', color: 'var(--status-scheduled)', Icon: CircleDot },
  PAUSED: { label: 'Paused', color: 'var(--status-paused)', Icon: CirclePause },
  CANCELLED: { label: 'Cancelled', color: 'var(--status-failure)', Icon: CircleX },
  COMPLETED: { label: 'Completed', color: 'var(--status-success)', Icon: CircleCheck },
};

const PRIORITY_LABEL: Record<TicketProps['priority'], string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

const TERMINAL_STATUSES: ReadonlyArray<TicketProps['status']> = ['COMPLETED', 'CANCELLED'];

export const TicketNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as TicketProps | undefined;
  if (!props?.xyneId || !props.title) return null;

  const status = STATUS_META[props.status];
  const etaMs = props.eta ? new Date(props.eta).getTime() : NaN;
  const eta = Number.isNaN(etaMs) ? null : formatEta(etaMs);
  const etaOverdue =
    !!eta && etaMs < new Date().setHours(0, 0, 0, 0) && !TERMINAL_STATUSES.includes(props.status);

  return (
    <a
      href={props.url}
      style={node.style}
      className='flow-artifact-wide block w-full overflow-hidden rounded-xl border border-border bg-background !no-underline transition-colors hover:bg-muted/40'
      data-track-category='TICKET_ARTIFACT'
      data-track-name='OPEN_TICKET'
    >
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5'>
        <span className='font-mono text-sm text-muted-foreground'>{props.xyneId}</span>

        <div className='ml-auto flex items-center gap-4'>
          <span className='flex items-center gap-1.5 text-sm text-foreground'>
            <status.Icon size={14} color={status.color} />
            {status.label}
          </span>

          <span className='flex items-center gap-1 text-sm text-foreground'>
            {getPriorityIcon(props.priority as TicketPriority)}
            {PRIORITY_LABEL[props.priority]}
          </span>

          {eta && (
            <span className='flex items-center gap-1.5 text-sm tabular-nums text-foreground'>
              <span
                className='size-3 shrink-0 rounded-[3px]'
                style={{
                  background: etaOverdue ? 'var(--status-failure)' : 'var(--status-success)',
                }}
              />
              {eta}
            </span>
          )}
        </div>
      </div>

      <p
        className={cn(
          'border-t border-border px-4 py-3 text-sm leading-[1.35] text-foreground',
          props.status === 'COMPLETED' && 'line-through decoration-muted-foreground',
        )}
      >
        {props.title}
      </p>
    </a>
  );
};
