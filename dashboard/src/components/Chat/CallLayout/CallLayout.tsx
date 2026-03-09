import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { Headphones } from 'lucide-react';
import { CallStatus, InvitationResponse } from '@xyne/shared';
import { usePlatform } from '../../../hooks/usePlatform';
import { roomActor } from '../../../machines/roomMachine';
import { useUsers } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import {
  getActiveParticipants,
  formatParticipantText,
  useCallDuration,
} from '../../../hooks/useCalls';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import { cn } from '../../../utils/classNames';

interface CallLayoutProps {
  callId: string;
}

interface CallParticipant {
  userId: string;
  response?: InvitationResponse | null;
}

interface CallData {
  externalId?: string;
  status?: CallStatus;
  startedAt?: number;
  participants?: readonly CallParticipant[];
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

  const isUserCallParticipant = useMemo(() => {
    if (!user) return false;
    return allParticipants.some(p => p.userId === user.id);
  }, [user, allParticipants]);

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

  const handleJoinCall = (): void => {
    if (!callExternalId) return;
    joinCall({ callId: callExternalId });
  };

  if (!callData || !isCallActive) {
    return null;
  }

  if (activeParticipants.length === 0) {
    return null;
  }

  return (
    <div className='mt-2 mr-3 max-w-lg min-[500px]:ml-14 max-[500px]:ml-12'>
      <div
        className={cn(
          'rounded-lg flex items-stretch gap-0.5 ',
          isUserInCall ? 'text-black' : 'text-white',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 bg-green-50 rounded-lg px-2 py-1.5',
            isUserInCall ? 'bg-green-50' : 'bg-[#2D881F]',
          )}
        >
          <Headphones className={cn('w-5 h-5', isUserInCall ? 'text-[#2D881F]' : 'text-white')} />
        </div>

        <div
          className={cn(
            'flex items-center bg-green-50 justify-between w-full px-2 py-1.5 rounded-lg',
            isUserInCall ? 'bg-green-50' : 'bg-[#2D881F]',
          )}
        >
          <div className='flex items-center gap-4'>
            <div className='flex items-center gap-2'>
              <AvatarGroup userIds={participantUserIds} size='sm' count={2} />
              {!isMobile && <span className='text-sm font-medium '>{callStatusText}</span>}
            </div>

            {callDuration && (
              <>
                {!isMobile && (
                  <span
                    className={cn(
                      'w-1 h-1 rounded-full',
                      isUserInCall ? 'bg-black/50' : 'bg-background/50',
                    )}
                  />
                )}
                <span className={cn('text-sm', isUserInCall ? 'text-black/90' : 'text-white/90')}>
                  {callDuration}
                </span>
              </>
            )}
          </div>

          {isUserCallParticipant && !isUserInCall && (
            <button
              onClick={handleJoinCall}
              className={cn(
                'text-sm font-medium hover:underline transition-all cursor-pointer mx-2',
                isUserInCall ? 'text-black' : 'text-white',
              )}
              type='button'
              data-track-category='CALL'
              data-track-name='JoinCallFromLayout'
            >
              Join Call
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
