import { useState } from 'react';
import { useZero } from '../../../hooks/useZero';
import { SearchUser } from '../../ui/SearchUser/SearchUser';
import { User } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import { useAuth } from '../../../hooks/useAuth';
import { Dialog } from '../../ui/Dialog/Dialog';
import Button from '../../ui/Button';
import { v4 as uuidv4 } from 'uuid';

interface InviteToCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  callId: string;
}

export function InviteToCallModal({
  isOpen,
  onClose,
  callId,
}: InviteToCallModalProps): React.ReactElement | null {
  const { user } = useAuth();
  const zero = useZero();
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isInviting, setIsInviting] = useState(false);

  const handleInvite = (): void => {
    if (selectedUsers.length === 0) return;

    setIsInviting(true);

    const userIds = selectedUsers.map(u => u.id);
    const participantIds = userIds.reduce(
      (acc, userId) => {
        acc[userId] = uuidv4();
        return acc;
      },
      {} as Record<string, string>,
    );
    // Call the invite mutator with internal call ID
    void zero.mutate(
      mutators.calls.invite({ callId, userIds, timestamp: Date.now(), participantIds }),
    );

    // Reset and close
    setSelectedUsers([]);
    onClose();
    setIsInviting(false);
  };

  const handleClose = (): void => {
    setSelectedUsers([]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose} title='Invite to Call'>
      <div className='p-4 space-y-6' data-testid='invite-to-call-modal'>
        <div>
          <h2 className='text-lg font-semibold text-foreground mb-1'>Invite to Call</h2>
          <p className='text-sm text-muted-foreground'>
            Select users to invite to this call. They will receive a notification to join.
          </p>
        </div>

        <div>
          <SearchUser
            excludeUserIds={[user?.id || '']}
            selectedUsers={selectedUsers}
            onUsersChange={setSelectedUsers}
            placeholder='Search users to invite...'
            label='Select Users'
            hintText='Search by name or email to find users to invite'
            data-testid='search-user-invite'
          />
        </div>

        <div className='flex justify-end gap-3 pt-4 border-t border-border'>
          <Button
            variant='ghost'
            size='default'
            onClick={handleClose}
            disabled={isInviting}
            data-track-category='CALLS'
            data-track-name='Close_Invite_To_Call_Modal'
            data-track-metadata={JSON.stringify({ callId })}
          >
            Cancel
          </Button>
          <Button
            variant='default'
            size='default'
            onClick={handleInvite}
            disabled={selectedUsers.length === 0 || isInviting}
            loading={isInviting}
            data-testid='invite-button'
            data-track-category='CALLS'
            data-track-name='Submit_Invite_To_Call_Modal'
            data-track-metadata={JSON.stringify({ callId, userCount: selectedUsers.length })}
          >
            {isInviting
              ? 'Inviting...'
              : `Invite${selectedUsers.length > 0 ? ` (${selectedUsers.length})` : ''}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
