import { useState, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { X, UserPlus, Users, ChevronUp, ChevronDown } from 'lucide-react';
import { roomActor } from '../../../machines/roomMachine';
import { useUser } from '../../../hooks/useUsers';
import { InvitationResponse } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import { InviteToCallModal } from '../CallModals/InviteToCallModal';

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
  participants?: CallParticipant[];
}

export function ParticipantsSidebar({
  callId,
  onClose,
}: ParticipantsSidebarProps): React.ReactElement {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [isAttendeesExpanded, setIsAttendeesExpanded] = useState(true);
  const [isAlsoInvitedExpanded, setIsAlsoInvitedExpanded] = useState(true);

  // Get active calls and find current call
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCall = useMemo(
    () => (activeCalls as ActiveCall[] | undefined)?.find(call => call.externalId === callId),
    [activeCalls, callId],
  );

  // Get participants from the call
  const participants = currentCall?.participants || [];

  // Split participants into Contributors (ACCEPTED and still in call) and Also Invited (others or left)
  const { contributors, alsoInvited } = useMemo(() => {
    const contributors: CallParticipant[] = [];
    const alsoInvited: CallParticipant[] = [];

    participants.forEach(participant => {
      // Only show in Contributors if ACCEPTED and hasn't left the call
      if (participant.response === InvitationResponse.ACCEPTED && !participant.leftAt) {
        contributors.push(participant);
      } else {
        alsoInvited.push(participant);
      }
    });

    return { contributors, alsoInvited };
  }, [participants]);

  // ParticipantItem component that uses useUser hook internally
  const ParticipantItem = ({
    participant,
  }: {
    participant: CallParticipant;
  }): React.ReactElement => {
    const { response, leftAt, userId } = participant;
    const user = useUser(userId);
    const isInCall = response === InvitationResponse.ACCEPTED && !leftAt;

    return (
      <div className='flex items-center gap-3 py-2 px-3 hover:bg-gray-100 rounded-lg transition-colors'>
        <div className='relative'>
          <Avatar userId={userId} size='sm' />
          {isInCall && (
            <span className='absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white' />
          )}
        </div>
        <div className='flex-1 min-w-0'>
          <p className='text-sm font-medium text-foreground truncate'>
            {user?.name || 'Unknown User'}
          </p>
          {leftAt && <p className='text-xs text-muted-foreground'>Left the call</p>}
          {!leftAt && response === InvitationResponse.INVITED && (
            <p className='text-xs text-yellow-600'>Invited</p>
          )}
          {!leftAt && response === InvitationResponse.DECLINED && (
            <p className='text-xs text-red-500'>Declined</p>
          )}
        </div>
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
      className='flex items-center justify-between w-full px-3 py-2.5 hover:bg-gray-50 transition-colors'
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
      <div className='flex flex-col h-full bg-white text-foreground'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
          <div className='flex items-center gap-2'>
            <Users size={20} className='text-muted-foreground' />
            <h2 className='text-lg font-semibold'>Participants</h2>
          </div>
          <div className='flex items-center gap-2'>
            <button
              onClick={() => setShowInviteModal(true)}
              className='flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white hover:bg-gray-100 text-black border border-gray-300 transition-colors'
              title='Add People'
              data-testid='add-people-button'
            >
              <UserPlus size={16} />
              <span className='text-sm font-medium'>Add People</span>
            </button>
            <button
              onClick={onClose}
              className='p-1 hover:bg-gray-100 rounded-full transition-colors'
              title='Close'
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
                    <ParticipantItem key={participant.id} participant={participant} />
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
                    <ParticipantItem key={participant.id} participant={participant} />
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
