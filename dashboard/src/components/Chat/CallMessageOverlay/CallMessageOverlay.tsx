import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import { useCallActions } from '../../../hooks/useCallActions';
import { useChannel } from '../../../hooks/useChannels';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { CallConfirmationModal } from '../../Call/CallConfirmationModal';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useUsers } from '../../../hooks/useUsers';

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
  const currentCallId = useSelector(roomActor, state => state.context.callId);
  // Get channel info for confirmation logic
  const channel = useChannel(channelId);
  const { displayName } = useChannelDisplayName(channel, context.userID);

  const { handleCallClick, isUserInCurrentChannelCall, hasActiveCallInChannel, isInCall } =
    useCallActions({ channelId, callDisplayName: displayName });

  // Use centralized confirmation logic
  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType: channel?.scopeType,
      channelName: displayName,
      participantCount: channel?.participantCount,
      hasActiveCallInChannel,
      isUserInCurrentChannelCall,
      isInCall,
    });

  // Get all users - must be called before any early returns (Rules of Hooks)
  const allUsers = useUsers();

  // Find the call for this message
  const call = activeCalls.find(c => c.externalId === callId) as ActiveCall | undefined;

  // If call not found or ended, this shouldn't render (ChatBubble will show final message)
  if (!call) {
    return <></>;
  }

  // Check if user is currently in this call (either by callId match or by checking if user is in this channel's call)
  const isUserInCall = currentCallId === callId || isUserInCurrentChannelCall;

  // Get active participants count from call_participants
  const allParticipants = call.participants || [];
  const activeParticipants = allParticipants.filter(
    (p: CallParticipant) => p.response === 'ACCEPTED' && p.leftAt === null,
  );

  const participantCount = activeParticipants.length;

  // Create a map of userId to user for quick lookup
  const userMap = new Map(allUsers.map(u => [u.id, u]));

  // Format participant names for display
  let participantText = '';
  if (participantCount === 1) {
    const participant = activeParticipants[0];
    const user = participant ? userMap.get(participant.userId) : undefined;
    participantText = user?.name || 'Someone';
  } else if (participantCount === 2) {
    const names = activeParticipants
      .map((p: CallParticipant) => {
        const user = userMap.get(p.userId);
        return user?.name || 'Unknown';
      })
      .slice(0, 2);
    participantText = names.join(' and ');
  } else if (participantCount > 2) {
    const firstParticipant = activeParticipants[0];
    const firstUser = firstParticipant ? userMap.get(firstParticipant.userId) : undefined;
    const firstName = firstUser?.name || 'Someone';
    participantText = `${firstName} and ${participantCount - 1} ${participantCount - 1 === 1 ? 'other' : 'others'}`;
  }

  return (
    <>
      <div className='flex items-center gap-2'>
        {/* Call Info */}
        <div className='flex-1 min-w-0'>
          <div className='text-sm text-gray-700'>
            {participantCount > 0 ? (
              <>
                {participantText} {participantCount === 1 ? 'is' : 'are'} in a call
              </>
            ) : (
              'Call started'
            )}
          </div>
        </div>

        {/* Join Button - only show if user is NOT in the call */}
        {!isUserInCall && (
          <div className='flex-shrink-0'>
            <button
              onClick={() => handleCallAction(handleCallClick)}
              className='bg-green-600 hover:bg-green-700 text-white border-green-600 px-3 py-1 rounded-md text-sm font-medium transition-colors'
            >
              Join
            </button>
          </div>
        )}
      </div>

      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={() => handleConfirmCall(handleCallClick)}
        title={modalContent.title}
        subtitle={modalContent.subtitle}
        description={modalContent.description}
      />
    </>
  );
}
