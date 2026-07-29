import { ReactElement, useMemo } from 'react';
import Avatar from '../../components/ui/Avatar/Avatar';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { queries } from '../../zero/queries';
import { useUsers } from '../../hooks/useUsers';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { type Call } from './callHistoryItem.utils';
import { CallStatus } from '@xyne/shared';

interface CallParticipantsContentProps {
  call: Call;
  isOpen: boolean;
  currentUserId: string | undefined;
  onClose: () => void;
}

function CallParticipantsContent({
  call,
  isOpen,
  currentUserId,
  onClose,
}: CallParticipantsContentProps): ReactElement {
  const hasFullParticipants =
    call.status === CallStatus.ACTIVE ||
    (call.participantCount !== null &&
      call.participantCount !== undefined &&
      call.participantCount <= (call.participants?.length ?? 0));
  const [fullParticipants] = useCachedQuery(queries.callParticipantsByCallId({ callId: call.id }), {
    enabled: isOpen && !hasFullParticipants,
  });
  const allParticipants = fullParticipants ?? call.participants ?? [];

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    for (const u of allUsers) {
      map.set(u.id, { name: u.name, email: u.email });
    }
    return map;
  }, [allUsers]);

  return (
    <div className='p-6'>
      <h2 className='text-xl font-semibold text-foreground mb-6'>Call Participants</h2>

      <div className='space-y-3 max-h-[500px] overflow-y-auto'>
        {allParticipants.map(participant => (
          <div
            key={participant.userId}
            className='flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors'
          >
            <Avatar
              userId={participant.isExternal ? null : (participant.userId ?? null)}
              size='md'
            />
            <div className='flex-1 min-w-0'>
              <h4 className='text-sm font-medium text-foreground truncate'>
                {participant.isExternal
                  ? participant.displayName || 'Guest'
                  : (usersById.get(participant.userId)?.name ?? 'Unknown User')}
                {participant.userId === currentUserId && (
                  <span className='text-muted-foreground font-normal'> (you)</span>
                )}
                {participant.isExternal && (
                  <span className='ml-1.5 text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded'>
                    External
                  </span>
                )}
              </h4>
              <p className='text-xs text-muted-foreground truncate'>
                {participant.isExternal
                  ? (participant.email ?? '')
                  : (usersById.get(participant.userId)?.email ?? '')}
              </p>
            </div>
          </div>
        ))}
      </div>

      <Button
        onClick={onClose}
        variant='secondary'
        className='mt-4 w-full'
        data-track-category='Calls'
        data-track-name='CloseParticipantsModal'
      >
        Close
      </Button>
    </div>
  );
}

interface ParticipantsModalProps {
  isOpen: boolean;
  onClose: () => void;
  call: Call | null;
  currentUserId: string | undefined;
}

export function ParticipantsModal({
  isOpen,
  onClose,
  call,
  currentUserId,
}: ParticipantsModalProps): ReactElement | null {
  if (!call) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <CallParticipantsContent
        call={call}
        isOpen={isOpen}
        currentUserId={currentUserId}
        onClose={onClose}
      />
    </Dialog>
  );
}
