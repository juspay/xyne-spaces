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
  findUserParticipant,
  isUserActiveInCall,
  getActiveParticipants,
  formatParticipantText,
} from '../../../hooks/useCalls';

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

/**
 * CallMessageOverlay displays a live overlay for active calls.
 * It subscribes to roomMachine for real-time call data.
 * When the call ends, this component is not rendered - only the final message text is shown.
 */
export function CallMessageOverlay({
  callId,
  channelId,
}: CallMessageOverlayProps): React.ReactElement {
  const context = useAuthContextValues();

  // Subscribe to roomMachine for live call data
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCallId = useSelector(roomActor, state => state.context.externalId);
  // Get channel info for confirmation modal text
  const channel = useChannel(channelId);
  const { displayName } = useChannelDisplayName(channel, context.userID);

  // Use joinCall to join this specific callId
  const { joinCall, isInCall } = useCallJoinOrInitiate();

  // Find the call for this message
  const call = activeCalls.find(c => c.externalId === callId) as ActiveCall | undefined;

  // Get all participants before early return (Rules of Hooks)
  const allParticipants: CallParticipant[] = call?.participants || [];

  // Find the current user's own participant record
  const userParticipant = findUserParticipant(allParticipants, context.userID);

  // User is actively in the call (ACCEPTED response)
  const userIsActiveInCall = isUserActiveInCall(allParticipants, context.userID);

  // User is in the call on this specific device/instance
  const isUserInThisDevice = currentCallId === callId;

  // Use centralized confirmation logic
  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType: channel?.scopeType,
      channelName: displayName,
      hasActiveCallInChannel: true,
      isUserInCurrentChannelCall: isUserInThisDevice,
      isInCall,
      onlyShowSwitchModal: true,
    });

  // Get all users - must be called before any early returns (Rules of Hooks)
  const allUsers = useUsers();

  // If call not found or ended, this shouldn't render (ChatBubble will show final message)
  if (!call) {
    return <></>;
  }

  const activeParticipants = getActiveParticipants(allParticipants);
  const participantCount = activeParticipants.length;

  const handleJoinClick = () => {
    handleCallAction(() => joinCall({ callId }));
  };

  const handleConfirmJoin = () => {
    handleConfirmCall(() => joinCall({ callId }));
  };

  const userMap = new Map(allUsers.map(u => [u.id, u]));
  const participantText = formatParticipantText(activeParticipants, userMap);

  return (
    <>
      <div className='flex items-center gap-2'>
        {/* Call Info */}
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

        {/* Show Switch if user is active in the call on another device/tab,
             Show Join if user is a participant but not currently in the call,
             Show nothing if already in this call on this device */}
        {!isUserInThisDevice && userParticipant && (
          <div className='flex-shrink-0'>
            <button
              onClick={handleJoinClick}
              className='bg-status-success hover:opacity-90 text-background px-3 py-1 rounded-md text-sm font-medium transition-colors'
              data-testid={userIsActiveInCall ? 'switch-call-button' : 'join-button'}
              data-track-category='CALLS'
              data-track-name={
                userIsActiveInCall ? 'SWITCH_CALL_FROM_MESSAGE' : 'JOIN_CALL_FROM_MESSAGE'
              }
              data-track-metadata={JSON.stringify({
                callId: call.externalId,
                isUserActiveInCall: userIsActiveInCall,
              })}
            >
              {userIsActiveInCall ? 'Switch' : 'Join'}
            </button>
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
