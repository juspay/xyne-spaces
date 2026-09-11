import React, { useEffect, useRef, useState } from 'react';
import {
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CirclePause,
  CircleSlash,
  NotebookText,
  User,
} from 'lucide-react';
import type { FlowAction, FlowComponent, TicketProps } from '@xyne/shared';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { useFlow } from '../FlowContext';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import Tooltip from '../../ui/Tooltip';
import { getPriorityIcon } from '../../Tickets/TicketCard/TicketCard.utils';
import { TicketCardV2 } from '../../Tickets/TicketCardV2/TicketCardV2';
import { useNavigate } from '../../../hooks/useWorkspaceNavigate';
import { cn } from '../../../utils/classNames';

const ACCENT = '#EB5F3A';
const CALENDAR_GREEN = '#4F9E7F';
const CORNER_RADIUS = 10;
const NOTCH_RADIUS = 8;

const STATUS_META: Record<
  TicketProps['status'],
  { label: string; icon: React.ElementType; className?: string; color?: string }
> = {
  TODO: { label: 'Todo', icon: CircleDashed, color: ACCENT },
  STARTED: { label: 'Started', icon: CircleDotDashed, className: 'text-blue-500' },
  PAUSED: { label: 'Paused', icon: CirclePause, className: 'text-teal-500' },
  CANCELLED: { label: 'Cancelled', icon: CircleSlash, className: 'text-destructive' },
  COMPLETED: { label: 'Completed', icon: CircleCheck, className: 'text-green-600' },
};

const PRIORITY_LABEL: Record<TicketProps['priority'], string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

function formatEta(eta: string): string | null {
  const parsed = new Date(eta);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function outlinePath(w: number, h: number): string {
  const inset = 0.75;
  const left = inset;
  const top = inset;
  const right = w - inset;
  const bottom = h - inset;
  const mid = h / 2;
  const r = CORNER_RADIUS;
  const n = NOTCH_RADIUS;
  return [
    `M ${left + r} ${top}`,
    `H ${right - r}`,
    `A ${r} ${r} 0 0 1 ${right} ${top + r}`,
    `V ${mid - n}`,
    `A ${n} ${n} 0 0 0 ${right} ${mid + n}`,
    `V ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `H ${left + r}`,
    `A ${r} ${r} 0 0 1 ${left} ${bottom - r}`,
    `V ${mid + n}`,
    `A ${n} ${n} 0 0 0 ${left} ${mid - n}`,
    `V ${top + r}`,
    `A ${r} ${r} 0 0 1 ${left + r} ${top}`,
    'Z',
  ].join(' ');
}

const CalendarGlyph: React.FC = () => (
  <svg viewBox='0 0 24 24' className='size-4 shrink-0' fill='none' aria-hidden='true'>
    <path
      d='M8 2.4v3.2M16 2.4v3.2'
      stroke={CALENDAR_GREEN}
      strokeWidth='2.6'
      strokeLinecap='round'
    />
    <rect x='2.5' y='4' width='19' height='17.6' rx='5.5' fill={CALENDAR_GREEN} />
    <rect x='2.5' y='9.4' width='19' height='2.2' fill='#fff' />
  </svg>
);

export const TicketNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as TicketProps | undefined;
  const { executeAction, isSubmitting } = useFlow();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setBox({ w: el.offsetWidth, h: el.offsetHeight }));
    observer.observe(el);
    return (): void => observer.disconnect();
  }, []);

  if (!props?.title) return null;

  const proposed = props.phase === 'proposed';

  if (!proposed) {
    const etaMs = props.eta ? Date.parse(props.eta) : Number.NaN;
    const ticketUrl = props.url;
    return (
      <section className='flow-artifact-wide flex w-full flex-col'>
        <TicketCardV2
          isConversation
          ticket={{
            id: props.ticketId ?? props.xyneId ?? '',
            xyneId: props.xyneId ?? null,
            title: props.title,
            statusV2: props.status as TicketStatusV2,
            priority: props.priority as TicketPriority,
            stageName: props.stageName ?? null,
            assignedTo: props.assigneeId ?? null,
            eta: Number.isNaN(etaMs) ? null : etaMs,
            channelId: props.channelId ?? null,
            conversationId: props.conversationId ?? null,
          }}
          {...(ticketUrl
            ? {
                onClick: (): void => {
                  void navigate(ticketUrl);
                },
              }
            : {})}
        />
      </section>
    );
  }

  const status = STATUS_META[props.status];
  const StatusIcon = status.icon;
  const eta = props.eta ? formatEta(props.eta) : null;

  const run = (action: TicketProps['approveAction'], key: string): void => {
    if (!action) return;
    setPending(key);
    void executeAction(action as FlowAction).finally(() => setPending(null));
  };

  const card = (
    <div
      ref={cardRef}
      className='relative flex w-full flex-col gap-3.5 rounded-[10px] bg-background px-4 py-3.5'
      style={node.style}
    >
      {box.w > 0 && (
        <svg
          className='pointer-events-none absolute inset-0 text-muted-foreground/45'
          width={box.w}
          height={box.h}
          viewBox={`0 0 ${box.w} ${box.h}`}
          fill='none'
          aria-hidden='true'
        >
          <path
            d={outlinePath(box.w, box.h)}
            stroke='currentColor'
            strokeWidth={1.5}
            strokeDasharray='4 4'
          />
        </svg>
      )}

      <div className='flex flex-wrap items-center justify-between gap-x-6 gap-y-2'>
        <span className='flex items-center gap-2 font-mono text-[13px] tracking-[0.6px] text-foreground/80'>
          <NotebookText className='size-4 shrink-0 text-muted-foreground' strokeWidth={1.75} />
          {props.xyneId ?? 'Draft'}
        </span>

        <span className='flex items-center gap-6'>
          <span className='flex items-center gap-2 text-sm text-foreground'>
            <StatusIcon
              className={cn('size-4 shrink-0', status.className)}
              {...(status.color ? { color: status.color } : {})}
              strokeWidth={2}
            />
            {status.label}
          </span>

          <span className='flex items-center gap-2 text-sm text-foreground'>
            {getPriorityIcon(props.priority as TicketPriority)}
            {PRIORITY_LABEL[props.priority]}
          </span>

          {eta && (
            <span className='flex items-center gap-2 text-sm tabular-nums text-foreground'>
              <CalendarGlyph />
              {eta}
            </span>
          )}

          {props.assigneeId ? (
            <Avatar userId={props.assigneeId} size='sm' showActiveStatus={false} />
          ) : (
            <Tooltip content='Unassigned'>
              <span className='flex size-5 items-center justify-center rounded-full border border-dashed border-muted-foreground'>
                <User className='size-3 text-muted-foreground' strokeWidth={1.5} />
              </span>
            </Tooltip>
          )}
        </span>
      </div>

      <p className='text-[15px] leading-[1.4] text-foreground'>{props.title}</p>
    </div>
  );

  return (
    <section className='flow-artifact-wide flex w-full flex-col'>
      {card}

      {(props.approveAction || props.approveContinueAction || props.declineAction) && (
        <div className='flex items-center justify-end gap-2 pt-3'>
          {props.declineAction && (
            <Button
              variant='ghost'
              size='sm'
              disabled={isSubmitting}
              loading={pending === 'decline'}
              onClick={() => run(props.declineAction, 'decline')}
              data-track-category='TICKET_ARTIFACT'
              data-track-name='DECLINE_TICKET'
            >
              Decline
            </Button>
          )}
          {props.approveAction && (
            <Button
              variant='outline'
              size='sm'
              disabled={isSubmitting}
              loading={pending === 'approve'}
              onClick={() => run(props.approveAction, 'approve')}
              data-track-category='TICKET_ARTIFACT'
              data-track-name='APPROVE_TICKET'
            >
              Approve
            </Button>
          )}
          {props.approveContinueAction && (
            <Button
              size='sm'
              style={{ backgroundColor: ACCENT }}
              className='text-white hover:brightness-95'
              disabled={isSubmitting}
              loading={pending === 'approve-continue'}
              onClick={() => run(props.approveContinueAction, 'approve-continue')}
              data-track-category='TICKET_ARTIFACT'
              data-track-name='APPROVE_TICKET_AND_CONTINUE'
            >
              Accept &amp; start task
            </Button>
          )}
        </div>
      )}
    </section>
  );
};
