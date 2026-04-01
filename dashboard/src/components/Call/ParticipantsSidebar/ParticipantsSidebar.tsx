import { useState, useMemo, useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { X, UserPlus, Users, ChevronUp, ChevronDown, MicOff, Mic } from 'lucide-react';
import { useIsSpeaking } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { roomActor, type ParticipantInfo } from '../../../machines/roomMachine';
import { useUser } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { InvitationResponse } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import { InviteToCallModal } from '../CallModals/InviteToCallModal';
import { callService } from '../../../services/Call/callService';
import { getUserDisplayName } from '../../../utils/userDisplayName';

// Speaking indicator component (animated bars like Google Meet)
function SpeakingIndicator(): React.ReactElement {
  return (
    <div className='flex items-center gap-[2px] h-4'>
      <span className='w-[3px] h-2 bg-green-500 rounded-full animate-[speaking_0.5s_ease-in-out_infinite]' />
      <span className='w-[3px] h-3 bg-green-500 rounded-full animate-[speaking_0.5s_ease-in-out_infinite_0.1s]' />
      <span className='w-[3px] h-2 bg-green-500 rounded-full animate-[speaking_0.5s_ease-in-out_infinite_0.2s]' />
    </div>
  );
}

interface ParticipantsSidebarProps {
  callId: string;
  onClose: () => void;
}

interface CallParticipant {
  id: string;
  callId: string;
  userId: string;
  invitedBy: string;
  invitedAt: number;
  response: string | null;
  respondedAt: number | null;
  joinedAt: number | null;
  leftAt: number | null;
  metadata: unknown;
}

interface ActiveCall {
  externalId: string;
  createdByUserId?: string;
  participants?: CallParticipant[];
}

export function ParticipantsSidebar({
  callId,
  onClose,
}: ParticipantsSidebarProps): React.ReactElement {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [isAttendeesExpanded, setIsAttendeesExpanded] = useState(true);
  const [isAlsoInvitedExpanded, setIsAlsoInvitedExpanded] = useState(true);
  const [isMuting, setIsMuting] = useState(false);
  const [mutingParticipantId, setMutingParticipantId] = useState<string | null>(null);

  const { user } = useAuth();

  // Get active calls and find current call
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCall = useMemo(
    () => (activeCalls as ActiveCall[] | undefined)?.find(call => call.externalId === callId),
    [activeCalls, callId],
  );

  // Get LiveKit participants from room state (for speaking detection)
  const livekitParticipants = useSelector(roomActor, state => state.context.participants);

  // Create a map of userId -> LiveKit participant for quick lookup
  const livekitParticipantMap = useMemo(() => {
    const map = new Map<string, ParticipantInfo>();
    livekitParticipants.forEach(p => {
      map.set(p.identity, p);
    });
    return map;
  }, [livekitParticipants]);

  // Check if current user is the host
  const isHost = currentCall?.createdByUserId === user?.id;

  // Get participants from the call
  const participants = currentCall?.participants || [];

  // Handle mute all participants
  const handleMuteAll = useCallback(async () => {
    if (isMuting) return;

    setIsMuting(true);
    try {
      await callService.muteAllParticipants(callId);
    } catch (error) {
      console.error('[ParticipantsSidebar] Failed to mute all participants:', error);
    } finally {
      setIsMuting(false);
    }
  }, [callId, isMuting]);

  // Handle mute individual participant
  const handleMuteParticipant = useCallback(
    async (participantUserId: string) => {
      if (mutingParticipantId) return;

      setMutingParticipantId(participantUserId);
      try {
        await callService.muteParticipant(callId, participantUserId);
      } catch (error) {
        console.error('[ParticipantsSidebar] Failed to mute participant:', error);
      } finally {
        setMutingParticipantId(null);
      }
    },
    [callId, mutingParticipantId],
  );

  // Split participants into Contributors (ACCEPTED and still in call) and Also Invited (others or left)
  const { contributors, alsoInvited } = useMemo(() => {
    const contributors: CallParticipant[] = [];
    const alsoInvited: CallParticipant[] = [];

    participants.forEach(participant => {
      // Only show in Contributors if ACCEPTED and hasn't left the call
      if (participant.response === InvitationResponse.ACCEPTED) {
        contributors.push(participant);
      } else {
        alsoInvited.push(participant);
      }
    });

    return { contributors, alsoInvited };
  }, [participants]);

  // Inner component for speaking detection (needs to be separate to use hooks conditionally)
  const SpeakingStatus = ({
    livekitParticipant,
  }: {
    livekitParticipant: Participant | undefined;
  }): React.ReactElement | null => {
    const isSpeaking = useIsSpeaking(livekitParticipant);
    if (!isSpeaking) return null;
    return <SpeakingIndicator />;
  };

  // ParticipantItem component that uses useUser hook internally
  const ParticipantItem = ({
    participant,
    showMuteButton = false,
    currentUserId,
  }: {
    participant: CallParticipant;
    showMuteButton?: boolean;
    currentUserId?: string | null;
  }): React.ReactElement => {
    const { response, userId } = participant;
    const participantUser = useUser(userId);
    const isInCall = response === InvitationResponse.ACCEPTED;
    const isMutingThis = mutingParticipantId === userId;

    // Get LiveKit participant for speaking detection and mute status
    const livekitParticipant = livekitParticipantMap.get(userId);
    const livekitParticipantObj = livekitParticipant?.participant;
    const isMicrophoneEnabled = livekitParticipant?.isMicrophoneEnabled ?? true;

    // Determine if mute button should be shown for this participant
    // Show only if: host, participant is in call, not the current user (self), not an agent
    const canMute =
      showMuteButton && isInCall && userId !== currentUserId && !userId.startsWith('agent-');

    return (
      <div className='flex items-center gap-3 py-2 px-3 hover:bg-muted rounded-lg transition-colors'>
        <div className='relative'>
          <Avatar userId={userId} size='sm' />
          {isInCall && (
            <span className='absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white' />
          )}
        </div>
        <div className='flex-1 min-w-0'>
          <p className='text-sm font-medium text-foreground truncate'>
            {getUserDisplayName(participantUser)}
          </p>
          {response === InvitationResponse.LEFT && (
            <p className='text-xs text-muted-foreground'>Left the call</p>
          )}
          {response === InvitationResponse.INVITED && (
            <p className='text-xs text-yellow-600'>Invited</p>
          )}
          {response === InvitationResponse.DECLINED && (
            <p className='text-xs text-red-500'>Declined</p>
          )}
        </div>
        {/* Speaking indicator - only show when mic is enabled */}
        {isInCall && livekitParticipantObj && isMicrophoneEnabled && (
          <SpeakingStatus livekitParticipant={livekitParticipantObj} />
        )}
        {/* Mute status indicator (for non-host or when participant is muted) */}
        {isInCall && !isMicrophoneEnabled && !canMute && (
          <div className='p-1.5 text-red-500' title='Muted'>
            <MicOff size={16} />
          </div>
        )}
        {/* Mute/Unmute button - always visible for host */}
        {canMute && (
          <button
            onClick={() => void handleMuteParticipant(userId)}
            disabled={isMutingThis || !isMicrophoneEnabled}
            className={`p-1.5 rounded-md transition-colors disabled:cursor-not-allowed ${
              !isMicrophoneEnabled
                ? 'text-red-500 bg-red-50'
                : 'hover:bg-gray-200 text-muted-foreground hover:text-foreground'
            }`}
            data-track-category='CALLS'
            data-track-name='MUTE_PARTICIPANT'
            data-track-metadata={JSON.stringify({ callId, participantUserId: userId })}
            title={
              !isMicrophoneEnabled
                ? `${getUserDisplayName(participantUser)} is muted`
                : `Mute ${getUserDisplayName(participantUser)}`
            }
          >
            {isMutingThis ? (
              <div className='w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin' />
            ) : !isMicrophoneEnabled ? (
              <MicOff size={16} />
            ) : (
              <Mic size={16} />
            )}
          </button>
        )}
      </div>
    );
  };

  const SectionHeader = ({
    title,
    count,
    isExpanded,
    onToggle,
  }: {
    title: string;
    count: number;
    isExpanded: boolean;
    onToggle: () => void;
  }): React.ReactElement => (
    <button
      onClick={onToggle}
      className='flex items-center justify-between w-full px-3 py-2.5 hover:bg-muted transition-colors'
      data-track-category='CALLS'
      data-track-name='Toggle_Participants_Section'
      data-track-metadata={JSON.stringify({ section: title, isExpanded: !isExpanded })}
    >
      <span className='text-sm font-medium text-foreground'>{title}</span>
      <div className='flex items-center gap-4'>
        <span className='text-sm text-muted-foreground'>{count}</span>
        {isExpanded ? (
          <ChevronUp size={16} className='text-muted-foreground' />
        ) : (
          <ChevronDown size={16} className='text-muted-foreground' />
        )}
      </div>
    </button>
  );

  return (
    <>
      <div className='flex flex-col h-full bg-background text-foreground'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
          <div className='flex items-center gap-2'>
            <Users size={20} className='text-muted-foreground' />
            <h2 className='text-lg font-semibold'>Participants</h2>
          </div>
          <div className='flex items-center gap-2'>
            {isHost && contributors.length > 1 && (
              <button
                onClick={() => void handleMuteAll()}
                disabled={isMuting}
                className='flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white hover:bg-gray-100 text-black border border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                title='Mute all participants'
                data-testid='mute-all-button'
                data-track-category='CALLS'
                data-track-name='MUTE_ALL_PARTICIPANTS'
                data-track-metadata={JSON.stringify({ callId })}
              >
                <MicOff size={16} />
                <span className='text-sm font-medium'>{isMuting ? 'Muting...' : 'Mute All'}</span>
              </button>
            )}
            <button
              onClick={() => setShowInviteModal(true)}
              className='flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background hover:bg-muted text-black border border-input transition-colors'
              title='Add People'
              data-testid='add-people-button'
              data-track-category='CALLS'
              data-track-name='ADD_PEOPLE_TO_CALL'
              data-track-metadata={JSON.stringify({ callId })}
            >
              <UserPlus size={16} />
              <span className='text-sm font-medium'>Add People</span>
            </button>
            <button
              onClick={onClose}
              className='p-1 hover:bg-muted rounded-full transition-colors'
              title='Close'
              data-track-category='CALLS'
              data-track-name='Close_Participants_Sidebar'
            >
              <X size={20} className='text-muted-foreground' />
            </button>
          </div>
        </div>

        {/* Participants List */}
        <div className='flex-1 overflow-y-auto p-3 space-y-3'>
          {/* Attendees Section */}
          {contributors.length > 0 && (
            <div
              className='border border-border rounded-lg overflow-hidden'
              data-testid='attendees-section'
            >
              <SectionHeader
                title='Attendees'
                count={contributors.length}
                isExpanded={isAttendeesExpanded}
                onToggle={() => setIsAttendeesExpanded(!isAttendeesExpanded)}
              />
              {isAttendeesExpanded && (
                <div className='border-t border-border'>
                  {contributors.map(participant => (
                    <ParticipantItem
                      key={participant.id}
                      participant={participant}
                      showMuteButton={isHost}
                      currentUserId={user?.id ?? null}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Also Invited Section */}
          {alsoInvited.length > 0 && (
            <div
              className='border border-border rounded-lg overflow-hidden'
              data-testid='invited-section'
            >
              <SectionHeader
                title='Also invited'
                count={alsoInvited.length}
                isExpanded={isAlsoInvitedExpanded}
                onToggle={() => setIsAlsoInvitedExpanded(!isAlsoInvitedExpanded)}
              />
              {isAlsoInvitedExpanded && (
                <div className='border-t border-border'>
                  {alsoInvited.map(participant => (
                    <ParticipantItem
                      key={participant.id}
                      participant={participant}
                      currentUserId={user?.id ?? null}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {participants.length === 0 && (
            <div className='flex flex-col items-center justify-center py-12 text-muted-foreground'>
              <Users size={48} className='mb-3 opacity-50' />
              <p className='text-sm'>No participants yet</p>
              <p className='text-xs mt-1'>Invite people to join this call</p>
            </div>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      <InviteToCallModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        callId={callId}
      />
    </>
  );
}
