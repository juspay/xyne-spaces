import { ReactElement, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import Avatar from '../../components/ui/Avatar/Avatar';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { queries } from '../../zero/queries';
import { useUsers } from '../../hooks/useUsers';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { type Call } from './callHistoryItem.utils';
import { CallStatus } from '@xyne/shared';
import { getPreviewParticipantUserIds } from './callHistoryItem.utils';

type CallParticipant = NonNullable<Call['participants']>[number];
type ParticipantRow = Partial<CallParticipant> & {
  userId: string;
  isCurrentUser?: boolean;
};

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
  const [fullParticipants, fullParticipantsDetails] = useCachedQuery(
    queries.callParticipantsByCallId({ callId: call.id }),
    {
      enabled: isOpen && !hasFullParticipants,
    },
  );

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    for (const u of allUsers) {
      map.set(u.id, { name: u.name, email: u.email });
    }
    return map;
  }, [allUsers]);

  const previewParticipantUserIds = useMemo(
    () => getPreviewParticipantUserIds(call.participantPreviewUserIds, currentUserId).slice(0, 3),
    [call.participantPreviewUserIds, currentUserId],
  );

  const previewParticipants = useMemo(() => {
    const nextParticipants: ParticipantRow[] = [];
    const seen = new Set<string>();

    for (const participant of call.participants ?? []) {
      if (participant.userId && !seen.has(participant.userId)) {
        nextParticipants.push({
          ...participant,
          userId: participant.userId,
          isCurrentUser: participant.userId === currentUserId,
        });
        seen.add(participant.userId);
      }
    }

    for (const userId of previewParticipantUserIds) {
      if (!seen.has(userId)) {
        nextParticipants.push({ userId, isCurrentUser: userId === currentUserId });
        seen.add(userId);
      }
    }

    return nextParticipants;
  }, [call.participants, currentUserId, previewParticipantUserIds]);

  const allParticipants = useMemo(() => {
    const merged = [...previewParticipants];
    const seen = new Set(merged.map(participant => participant.userId));

    for (const participant of fullParticipants ?? []) {
      if (participant.userId && !seen.has(participant.userId)) {
        merged.push({ ...participant, isCurrentUser: participant.userId === currentUserId });
        seen.add(participant.userId);
      }
    }

    return merged;
  }, [currentUserId, fullParticipants, previewParticipants]);

  const isLoadingParticipants =
    isOpen && !hasFullParticipants && fullParticipantsDetails.type !== 'complete';

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
                {participant.isCurrentUser && (
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
        {isLoadingParticipants && (
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
