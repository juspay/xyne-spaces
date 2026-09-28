import { type ReactElement } from 'react';
import { format } from 'date-fns';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import Button from '../../components/ui/Button';
import Avatar from '../../components/ui/Avatar/Avatar';
import { AvatarStackItem } from '../../components/ui/Avatar/AvatarGroup';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { MAX_AVATARS_TO_SHOW } from './CalenderViewUtils';
import type { PendingCallChange } from './useDragReschedule';

export interface RecurringRescheduleDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  pendingChange: PendingCallChange | null;
  isRecurring: boolean;
  confirmLabel: string;
}

const formatDateLabel = (ms: number): string => format(new Date(ms), 'EEE d MMM');

const formatTimeOnly = (ms: number): string => format(new Date(ms), 'h:mm a');

const formatDurationLabel = (startMs: number, endMs: number): string => {
  const minutes = Math.max(0, Math.round((endMs - startMs) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
};

const RecurringRescheduleDialog = ({
  isOpen,
  onConfirm,
  onCancel,
  pendingChange,
  isRecurring,
  confirmLabel,
}: RecurringRescheduleDialogProps): ReactElement => {
  const call = pendingChange?.call ?? null;

  const [participantRows] = useCachedQuery(
    queries.callParticipantsByCallId({ callId: call?.id ?? '' }),
    { enabled: isOpen && !!call },
  );
  const participantUserIds = (
    participantRows?.length ? participantRows : (call?.participants ?? [])
  ).map(participant => participant.userId);

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onCancel()} className='rounded-xl'>
      {pendingChange && (
        <div className='max-w-full p-4'>
          <h2 className='text-base font-semibold text-foreground'>Confirm new time</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            {isRecurring
              ? 'You dragged this call to a new slot. Only this occurrence changes — the rest of the series stays as scheduled.'
              : 'You dragged this call to a new slot.'}
          </p>

          <div className='mt-4 overflow-hidden rounded-xl border border-border'>
            <div className='flex items-start gap-3 border-b border-border p-3'>
              <span
                aria-hidden='true'
                className='mt-0.5 h-8 w-1 shrink-0 rounded-full bg-primary'
              />
              <div className='min-w-0 flex-1'>
                <p
                  className='truncate text-sm font-semibold text-foreground'
                  title={call?.title ?? 'Call'}
                >
                  {call?.title ?? 'Call'}
                </p>
                <p className='text-xs text-muted-foreground'>
                  {formatDurationLabel(pendingChange.currentStartsAt, pendingChange.currentEndsAt)}
                  {isRecurring ? ' · Recurring' : ''}
                </p>
              </div>
              <div className='flex items-center -space-x-1.5'>
                {participantUserIds.slice(0, MAX_AVATARS_TO_SHOW).map((userId, index) => (
                  <AvatarStackItem
                    key={`${userId}-${index}`}
                    size={24}
                    className='rounded-full flex items-center justify-center ring-2 ring-background group-hover:ring-accent z-10'
                  >
                    <Avatar userId={userId} size='rg' showActiveStatus={false} />
                  </AvatarStackItem>
                ))}
              </div>
              {participantUserIds.length > MAX_AVATARS_TO_SHOW && (
                <span className='text-xs font-medium text-muted-foreground tabular-nums rounded-full bg-border px-1.5 -ml-4 py-1 z-10 ring-2 ring-background group-hover:ring-accent'>
                  +{participantUserIds.length - MAX_AVATARS_TO_SHOW}
                </span>
              )}
            </div>

            <div className='grid grid-cols-2 divide-x divide-border'>
              {(
                [
                  {
                    label: 'Current',
                    startsAt: pendingChange.currentStartsAt,
                    endsAt: pendingChange.currentEndsAt,
                    wrapperClassName: 'p-3',
                    labelClassName: 'text-xs font-bold uppercase text-muted-foreground font-mono',
                    dateClassName: 'mt-1 text-sm font-medium text-muted-foreground',
                    timeClassName:
                      'font-mono text-sm font-medium text-foreground/60 tracking-tighter',
                  },
                  {
                    label: 'New',
                    startsAt: pendingChange.newStartsAt,
                    endsAt: pendingChange.newEndsAt,
                    wrapperClassName: 'bg-destructive/5 p-3',
                    labelClassName: 'text-xs font-bold uppercase text-primary font-mono',
                    dateClassName: 'mt-1 text-sm font-semibold text-primary',
                    timeClassName: 'font-mono text-sm font-medium text-primary tracking-tighter',
                  },
                ] as const
              ).map(column => (
                <div key={column.label} className={column.wrapperClassName}>
                  <p className={column.labelClassName}>{column.label}</p>
                  <p className={column.dateClassName}>{formatDateLabel(column.startsAt)}</p>
                  <p className={column.timeClassName}>
                    {formatTimeOnly(column.startsAt)} – {formatTimeOnly(column.endsAt)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className='mt-4 flex justify-end gap-2'>
            <Button
              variant='outline'
              onClick={onCancel}
              data-track-category='CALLS'
              data-track-name='recurring-reschedule-cancel'
            >
              Keep original
            </Button>
            <Button
              onClick={onConfirm}
              data-track-category='CALLS'
              data-track-name='recurring-reschedule-confirm'
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
};

export default RecurringRescheduleDialog;
