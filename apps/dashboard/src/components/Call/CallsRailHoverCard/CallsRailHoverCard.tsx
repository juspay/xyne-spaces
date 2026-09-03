import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useSelector } from '@xstate/react';
import { ArrowRight, PhoneDefault } from '@xyne/icons';
import { roomActor } from '../../../machines/roomMachine';
import {
  formatParticipantText,
  getActiveParticipants,
  getUserCallAccessLevel,
  useActiveCalls,
  useCallDuration,
  type ActiveCallWithRelations,
} from '../../../hooks/useCalls';
import { useAuth } from '../../../hooks/useAuth';
import { useUsersById } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { usePlatform } from '../../../hooks/usePlatform';
import { HoverCard } from '../../ui/HoverCard';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import Avatar from '../../ui/Avatar/Avatar';
import Button from '../../ui/Button';
import { cn } from '../../../utils/classNames';

const MAX_AVATARS = 3;
const MAX_JOINABLE_CALLS = 3;

export const useRailActiveCalls = (): ActiveCallWithRelations[] => {
  const { user } = useAuth();
  const activeCalls = useActiveCalls() as ActiveCallWithRelations[];
  const currentCallId = useSelector(roomActor, state => state.context.externalId);
  const isInCall = useSelector(
    roomActor,
    state =>
      state.matches('initiating') ||
      state.matches('joining') ||
      state.matches('connecting') ||
      state.matches('connected'),
  );

  return useMemo(() => {
    const currentCall =
      isInCall && currentCallId
        ? activeCalls.find(call => call.externalId === currentCallId)
        : undefined;
    if (currentCall) return [currentCall];
    if (isInCall) return [];

    return activeCalls
      .filter(call => getUserCallAccessLevel(call.participants, user?.id) === 'canJoin')
      .slice(0, MAX_JOINABLE_CALLS);
  }, [activeCalls, currentCallId, isInCall, user?.id]);
};

interface ActiveCallEntryProps {
  call: ActiveCallWithRelations;
  isCurrent: boolean;
}

const ActiveCallEntry = ({ call, isCurrent }: ActiveCallEntryProps): ReactElement => {
  const zero = useZero();
  const { isMobile } = usePlatform();
  const userMap = useUsersById();
  const viewMode = useSelector(roomActor, state => state.context.viewMode);
  const duration = useCallDuration(call.startedAt, true);

  const participants = getActiveParticipants(call.participants);
  const participantText = formatParticipantText(participants, userMap, participants.length);
  const visibleParticipants = participants.slice(0, MAX_AVATARS);
  const overflowCount = participants.length - visibleParticipants.length;

  const handleAction = (): void => {
    if (isCurrent) {
      if (viewMode === 'mini') {
        roomActor.send({ type: 'TOGGLE_VIEW' });
      }
      return;
    }
    roomActor.send({
      type: 'JOIN_CALL',
      callId: call.externalId,
      zero,
      viewMode: isMobile ? 'full' : 'mini',
    });
  };

  return (
    <div className='flex flex-col gap-2.5 px-3.5 py-3'>
      <div className='flex items-center gap-2'>
        <span aria-hidden='true' className='relative flex size-1.5 shrink-0'>
          <span className='absolute inline-flex size-full rounded-full bg-status-success opacity-60 animate-live-ping motion-reduce:hidden' />
          <span className='relative inline-flex size-full rounded-full bg-status-success animate-live-pulse motion-reduce:animate-none' />
        </span>
        <p className='min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight tracking-[-0.011em] text-foreground'>
          {call.title?.trim() || 'Ongoing call'}
        </p>
        {duration && (
          <span className='shrink-0 rounded-full bg-muted px-1.5 py-[3px] text-[10px] font-medium leading-none tabular-nums text-muted-foreground'>
            {duration}
          </span>
        )}
      </div>

      {participants.length > 0 && (
        <div className='flex items-center gap-2'>
          <div className='flex -space-x-1.5'>
            {visibleParticipants.map(participant => (
              <Avatar
                key={participant.id}
                userId={participant.userId}
                size='sm'
                className='ring-2 ring-popover'
              />
            ))}
            {overflowCount > 0 && (
              <span className='flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-popover'>
                +{overflowCount}
              </span>
            )}
          </div>
          <p className='min-w-0 flex-1 truncate text-[11px] leading-none text-muted-foreground'>
            {participantText}
          </p>
        </div>
      )}

      <Button
        variant='outline'
        size='sm'
        onClick={handleAction}
        className={cn(
          'group/cta h-8 w-full justify-center gap-1.5 rounded-lg text-xs font-medium',
          'text-status-success duration-200 active:scale-[0.985]',
          'border-[color-mix(in_srgb,var(--status-success)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] shadow-none',
          'hover:border-[color-mix(in_srgb,var(--status-success)_48%,transparent)] hover:bg-[color-mix(in_srgb,var(--status-success)_20%,transparent)] hover:text-status-success',
        )}
        data-track-category='App_Sidebar'
        data-track-name={isCurrent ? 'Rail_Return_To_Call' : 'Rail_Join_Call'}
        data-track-metadata={JSON.stringify({ callId: call.externalId })}
      >
        {isCurrent ? (
          <>
            Return to call
            <ArrowRight
              size={13}
              className='transition-transform duration-200 group-hover/cta:translate-x-0.5'
            />
          </>
        ) : (
          <>
            <PhoneDefault size={13} variant='Solid' />
            Join call
          </>
        )}
      </Button>
    </div>
  );
};

interface CallsRailHoverCardProps {
  tooltip: ReactNode;
  children: ReactElement;
}

export const CallsRailHoverCard = ({
  tooltip,
  children,
}: CallsRailHoverCardProps): ReactElement => {
  const calls = useRailActiveCalls();
  const currentCallId = useSelector(roomActor, state => state.context.externalId);

  if (calls.length === 0) {
    return (
      <Tooltip content={tooltip} side='right' delayDuration={0}>
        {children}
      </Tooltip>
    );
  }

  return (
    <HoverCard
      trigger={children}
      side='right'
      align='center'
      sideOffset={10}
      openDelay={0}
      closeDelay={140}
      className='w-[264px] overflow-hidden rounded-xl p-0 shadow-[0_20px_48px_-20px_rgba(0,0,0,0.6)]'
    >
      <div className='flex flex-col divide-y divide-border'>
        {calls.map(call => (
          <ActiveCallEntry
            key={call.externalId}
            call={call}
            isCurrent={call.externalId === currentCallId}
          />
        ))}
      </div>
    </HoverCard>
  );
};

export default CallsRailHoverCard;
