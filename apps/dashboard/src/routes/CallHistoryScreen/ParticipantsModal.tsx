import { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import Avatar from '../../components/ui/Avatar/Avatar';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { useCallParticipantRoster } from '../../hooks/useCallParticipantRoster';
import { type Call } from './callHistoryItem.utils';

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
  const { participants, isLoading } = useCallParticipantRoster(call, isOpen, currentUserId);

  return (
    <div className='p-6'>
      <h2 className='text-xl font-semibold text-foreground mb-6'>Call Participants</h2>

      <div className='space-y-3 max-h-[500px] overflow-y-auto'>
        {participants.map(participant => (
          <div
            key={participant.userId}
            className='flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors'
          >
            <Avatar userId={participant.isExternal ? null : participant.userId} size='md' />
            <div className='flex-1 min-w-0'>
              <h4 className='text-sm font-medium text-foreground truncate'>
                {participant.name}
                {participant.isCurrentUser && (
                  <span className='text-muted-foreground font-normal'> (you)</span>
                )}
                {participant.isExternal && (
                  <span className='ml-1.5 text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded'>
                    External
                  </span>
                )}
              </h4>
              <p className='text-xs text-muted-foreground truncate'>{participant.email}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className='flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground'>
            <Loader2 className='size-4 animate-spin' />
            Loading full participant list...
          </div>
        )}
      </div>

      <Button
        onClick={onClose}
        variant='secondary'
        className='mt-4 w-full'
        data-track-category='CALLS'
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
