import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { Headphones } from 'lucide-react';
import { CallStatus } from '@xyne/shared';
import { usePlatform } from '../../../hooks/usePlatform';
import { roomActor } from '../../../machines/roomMachine';
import { useUsers } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import {
  getActiveParticipants,
  formatParticipantText,
  useCallDuration,
  isUserActiveInCall,
} from '../../../hooks/useCalls';
import { useAutoJoinOnAccept, useCallJoinState } from '../../../hooks/useCallJoinState';
import { CallJoinButton } from '../../Call/CallJoinButton/CallJoinButton';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import { cn } from '../../../utils/classNames';

interface CallLayoutProps {
  callId: string;
}

interface CallData {
  externalId?: string;
  status?: CallStatus;
  startedAt?: number;
  participants?: Array<{ userId: string; response?: string | null }>;
}

export const CallLayout: React.FC<CallLayoutProps> = ({ callId }) => {
  const allUsers = useUsers();
  const { user } = useAuth();
  const { joinCall } = useCallJoinOrInitiate();
  const { isMobile } = usePlatform();
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);

  const callData = useMemo((): CallData | null => {
    if (!activeCalls || !Array.isArray(activeCalls) || !callId) return null;
    return (activeCalls.find(call => (call as CallData).externalId === callId) as CallData) || null;
  }, [activeCalls, callId]);

  const callExternalId = callData?.externalId;
  const isCallActive = callData?.status === CallStatus.ACTIVE;
  const allParticipants = callData?.participants || [];

  const currentCallId = useSelector(roomActor, state => state.context.externalId);
  const isUserInCall = currentCallId === callExternalId;

  // Check if user is active in this call on another device/tab (for "Switch" label)
  const userIsActiveInCall = isUserActiveInCall(allParticipants, user?.id ?? '');

  const callDuration = useCallDuration(callData?.startedAt, isCallActive);

  const activeParticipants = useMemo(
    () => getActiveParticipants(allParticipants),
    [allParticipants],
  );

  const userMap = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);
  const participantUserIds = activeParticipants.map(p => p.userId);

  const callStatusText = useMemo(() => {
    const participantText = formatParticipantText(activeParticipants, userMap);
    return `${participantText} ${activeParticipants.length === 1 ? 'is' : 'are'} on a call`;
  }, [activeParticipants, userMap]);

  // ── Request-to-join + auto-join ──
  useAutoJoinOnAccept({ callId: callExternalId || '', userId: user?.id, isUserInCall });

  const { action, requestToJoin, isRequesting } = useCallJoinState(callExternalId || '', user?.id);

  const handleJoinCall = (): void => {
    if (callExternalId) joinCall({ callId: callExternalId });
  };

  if (!callData || !isCallActive || activeParticipants.length === 0) {
    return null;
  }

  return (
    <div className='mt-2 mr-3 max-w-lg min-[500px]:ml-14 max-[500px]:ml-12'>
      <div
        className={cn(
          'rounded-lg flex items-stretch gap-0.5 ',
          isUserInCall ? 'text-foreground' : 'text-white',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg px-2 py-1.5',
            isUserInCall ? 'bg-green-100 dark:bg-green-900/30' : 'bg-green-700',
          )}
        >
          <Headphones
            className={cn(
              'w-5 h-5',
              isUserInCall ? 'text-green-700 dark:text-green-300' : 'text-white',
            )}
          />
        </div>

        <div
          className={cn(
            'flex items-center justify-between w-full px-2 py-1.5 rounded-lg',
            isUserInCall ? 'bg-green-100 dark:bg-green-900/30' : 'bg-green-700',
          )}
        >
          <div className='flex items-center gap-4'>
            <div className='flex items-center gap-2'>
              <AvatarGroup userIds={participantUserIds} size='sm' count={2} />
              {!isMobile && (
                <span
                  className={cn(
                    'text-sm font-medium',
                    isUserInCall ? 'text-green-800 dark:text-green-200' : '',
                  )}
                >
                  {callStatusText}
                </span>
              )}
            </div>

            {callDuration && (
              <>
                {!isMobile && (
                  <span
                    className={cn(
                      'w-1 h-1 rounded-full',
                      isUserInCall ? 'bg-foreground/50' : 'bg-background/50',
                    )}
                  />
                )}
                <span
                  className={cn(
                    'text-sm',
                    isUserInCall ? 'text-green-800 dark:text-green-200' : 'text-white/90',
                  )}
                >
                  {callDuration}
                </span>
              </>
            )}
          </div>

          {!isUserInCall && (
            <CallJoinButton
              action={action}
              onJoin={handleJoinCall}
              onRequest={requestToJoin}
              isRequesting={isRequesting}
              variant='light'
              joinLabel={userIsActiveInCall ? 'Switch' : 'Join Call'}
              testId={
                action === 'canJoin'
                  ? userIsActiveInCall
                    ? 'switch-call-button'
                    : 'join-button'
                  : action === 'requested'
                    ? 'waiting-to-join-button'
                    : 'request-to-join-button'
              }
              trackCategory='CALL'
              trackJoinName={userIsActiveInCall ? 'SwitchCallFromLayout' : 'JoinCallFromLayout'}
              trackRequestName='RequestToJoinCallFromLayout'
              className='mx-2'
            />
          )}
        </div>
      </div>
    </div>
  );
};
