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

  const { action, requestToJoin, cancelJoinRequest, isRequesting, isCancellingRequest } =
    useCallJoinState(callExternalId || '', user?.id);

  const handleJoinCall = (): void => {
    if (callExternalId) joinCall({ callId: callExternalId });
  };

  if (!callData || !isCallActive || activeParticipants.length === 0) {
    return null;
  }

  return (
    <div className='mt-2 mr-3 max-w-xl min-[500px]:ml-14 max-[500px]:ml-12'>
      {/* Use a single solid green for every theme; the Join / Request button alone
          signals join state. Fixed height, one-line text truncation, and a stable
          tabular-numeral duration slot keep the pill from resizing as data updates. */}
      <div className='rounded-lg inline-flex items-center h-10 gap-0.5 text-white'>
        <div className='flex items-center h-full gap-2 rounded-lg px-2 bg-green-700'>
          <Headphones className='w-5 h-5 text-white' />
        </div>

        <div className='flex items-center justify-between h-full gap-2 pl-2 pr-3 rounded-lg bg-green-700'>
          <div className='flex items-center gap-4 min-w-0'>
            <div className='flex items-center gap-2 min-w-0'>
              <AvatarGroup userIds={participantUserIds} size='sm' count={2} />
              {!isMobile && (
                <span className='text-sm font-medium truncate whitespace-nowrap min-w-0'>
                  {callStatusText}
                </span>
              )}
            </div>

            {callDuration && (
              <>
                {!isMobile && <span className='w-1 h-1 rounded-full shrink-0 bg-background/50' />}
                <span className='text-sm shrink-0 tabular-nums min-w-[4.5rem] text-right text-white/90'>
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
              onCancelRequest={cancelJoinRequest}
              isRequesting={isRequesting}
              isCancellingRequest={isCancellingRequest}
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
              trackCategory='CALLS'
              trackJoinName={userIsActiveInCall ? 'SwitchCallFromLayout' : 'JoinCallFromLayout'}
              trackRequestName='RequestToJoinCallFromLayout'
              className='mx-2 shrink-0'
            />
          )}
        </div>
      </div>
    </div>
  );
};
