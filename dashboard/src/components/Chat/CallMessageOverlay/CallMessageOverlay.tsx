import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import { useChannel } from '../../../hooks/useChannels';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { CallConfirmationModal } from '../../Call/CallConfirmationModal';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useUsers } from '../../../hooks/useUsers';
import {
  isUserActiveInCall,
  getActiveParticipants,
  formatParticipantText,
} from '../../../hooks/useCalls';
import { useAutoJoinOnAccept, useCallJoinState } from '../../../hooks/useCallJoinState';
import { CallJoinButton } from '../../Call/CallJoinButton/CallJoinButton';

interface CallParticipant {
  response: string;
  leftAt: number | null;
  userId: string;
}

interface ActiveCall {
  externalId: string;
  participants?: CallParticipant[];
}

interface CallMessageOverlayProps {
  callId: string;
  channelId: string;
}

export function CallMessageOverlay({
  callId,
  channelId,
}: CallMessageOverlayProps): React.ReactElement {
  const context = useAuthContextValues();

  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCallId = useSelector(roomActor, state => state.context.externalId);

  const call = activeCalls.find(c => c.externalId === callId) as ActiveCall | undefined;
  const allParticipants: CallParticipant[] = call?.participants || [];

  const userIsActiveInCall = isUserActiveInCall(allParticipants, context.userID);
  const isUserInThisDevice = currentCallId === callId;

  // ── Auto-join on approval ──
  useAutoJoinOnAccept({ callId, userId: context.userID, isUserInCall: isUserInThisDevice });

  // ── Join state ──
  const { action, requestToJoin, isRequesting } = useCallJoinState(callId, context.userID);

  // ── Confirmation modal for switching calls ──
  const channel = useChannel(channelId);
  const { displayName } = useChannelDisplayName(channel, context.userID);
  const { joinCall, isInCall } = useCallJoinOrInitiate();

  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType: channel?.scopeType,
      channelName: displayName,
      hasActiveCallInChannel: true,
      isUserInCurrentChannelCall: isUserInThisDevice,
      isInCall,
      onlyShowSwitchModal: true,
    });

  const allUsers = useUsers();

  if (!call) return <></>;

  const activeParticipants = getActiveParticipants(allParticipants);
  const participantCount = activeParticipants.length;

  const handleJoinClick = () => handleCallAction(() => joinCall({ callId }));
  const handleConfirmJoin = () => handleConfirmCall(() => joinCall({ callId }));

  const userMap = new Map(allUsers.map(u => [u.id, u]));
  const participantText = formatParticipantText(activeParticipants, userMap);

  return (
    <>
      <div className='flex items-center gap-2'>
        <div className='flex-1 min-w-0'>
          <div className='text-sm text-foreground'>
            {participantCount > 0 ? (
              <>
                {participantText} {participantCount === 1 ? 'is' : 'are'} in a call
              </>
            ) : (
              'Call started'
            )}
          </div>
        </div>

        {!isUserInThisDevice && (
          <div className='flex-shrink-0'>
            <CallJoinButton
              action={action}
              onJoin={handleJoinClick}
              onRequest={requestToJoin}
              isRequesting={isRequesting}
              variant='solid'
              joinLabel={userIsActiveInCall ? 'Switch' : 'Join'}
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
              trackJoinName={
                userIsActiveInCall ? 'SWITCH_CALL_FROM_MESSAGE' : 'JOIN_CALL_FROM_MESSAGE'
              }
              trackRequestName='REQUEST_TO_JOIN_FROM_MESSAGE'
              trackMetadata={{
                callId: call.externalId,
                isUserActiveInCall: userIsActiveInCall,
              }}
            />
          </div>
        )}
      </div>

      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={handleConfirmJoin}
        title={modalContent.title}
        subtitle={modalContent.subtitle}
        description={modalContent.description}
      />
    </>
  );
}
