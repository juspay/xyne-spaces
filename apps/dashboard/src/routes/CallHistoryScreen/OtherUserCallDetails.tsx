import { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CallStatus } from '@xyne/shared';
import { formatTime } from './CalenderViewUtils';
import type { OtherUserBusySlot } from '../../hooks/useOtherUserCalls';
import { useUsersById } from '../../hooks/useUsers';
import Avatar from '../../components/ui/Avatar/Avatar';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { callService } from '../../services/Call/callService';

/** Popover body for another user's call on a public calendar: when it is and who is on it. */
export function OtherUserCallDetails({ details }: { details: OtherUserBusySlot }): ReactElement {
  const usersById = useUsersById();
  // Mounted only while the popover is open, so participants load on click, not with the calendar.
  const { data: participantIds = [] } = useQuery({
    queryKey: ['other-user-call-participants', details.userId, details.id],
    queryFn: () => callService.getOtherUserCallParticipants(details.userId!, details.id!),
    enabled: Boolean(details.userId && details.id),
    staleTime: 60_000,
  });
  const hasEnded = details.status === CallStatus.ENDED;
  const timeLabel = details.endsAt
    ? `${formatTime(details.startsAt)} - ${formatTime(details.endsAt)}`
    : formatTime(details.startsAt);

  return (
    <div className='flex w-72 flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <span className='text-sm font-semibold text-foreground'>{details.title}</span>
        <span className='text-xs text-muted-foreground'>
          {format(details.startsAt, 'EEE, MMM d')} · {timeLabel}
        </span>
        <div className='flex flex-wrap gap-1.5'>
          <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
            {hasEnded ? 'Ended' : 'Upcoming'}
          </span>
          {details.isRecurring && (
            <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
              Recurring
            </span>
          )}
        </div>
      </div>

      {participantIds.length > 0 && (
        <div className='flex flex-col gap-1.5'>
          <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70'>
            {participantIds.length === 1
              ? '1 participant'
              : `${participantIds.length} participants`}
          </span>
          <ul className='flex max-h-48 flex-col gap-1.5 overflow-y-auto'>
            {participantIds.map(participantId => {
              const participant = usersById.get(participantId);
              const name =
                (participant && getUserDisplayName(participant)) ?? participant?.email ?? 'Unknown';
              return (
                <li key={participantId} className='flex min-w-0 items-center gap-2'>
                  <Avatar userId={participantId} size='sm' className='shrink-0' />
                  <span className='truncate text-sm text-foreground'>{name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
