import { ReactElement, useMemo } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import Avatar from '../../components/ui/Avatar/Avatar';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { queries } from '../../zero/queries';
import { useUsers } from '../../hooks/useUsers';

type Call = QueryResultType<typeof queries.userCallHistory>[number];

interface CallParticipantsContentProps {
  call: Call;
  currentUserId: string | undefined;
  onClose: () => void;
}

function CallParticipantsContent({
  call,
  currentUserId,
  onClose,
}: CallParticipantsContentProps): ReactElement {
  const allParticipants = call.participants || [];

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
            <Avatar userId={participant.userId ?? null} size='md' />
            <div className='flex-1 min-w-0'>
              <h4 className='text-sm font-medium text-foreground truncate'>
                {usersById.get(participant.userId)?.name ?? 'Unknown User'}
                {participant.userId === currentUserId && (
                  <span className='text-muted-foreground font-normal'> (you)</span>
                )}
              </h4>
              <p className='text-xs text-muted-foreground truncate'>
                {usersById.get(participant.userId)?.email ?? ''}
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
      <CallParticipantsContent call={call} currentUserId={currentUserId} onClose={onClose} />
    </Dialog>
  );
}
