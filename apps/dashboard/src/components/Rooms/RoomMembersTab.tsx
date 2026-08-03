import { ReactElement, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { RoomMemberStatus, RoomRole, type RoomMember, type User } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import Avatar from '../ui/Avatar/Avatar';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { SearchUser } from '../ui/SearchUser/SearchUser';

const ROLE_LABELS: Partial<Record<RoomRole, string>> = {
  [RoomRole.OWNER]: 'Owner',
  [RoomRole.MEMBER]: 'Member',
};

interface RoomMemberRowProps {
  member: RoomMember;
  selfUserId: string | undefined;
  canManage: boolean;
}

function RoomMemberRow({ member, selfUserId, canManage }: RoomMemberRowProps): ReactElement {
  const zero = useZero();
  const user = useUser(member.userId);
  const isSelf = member.userId === selfUserId;
  const isPending = member.status === RoomMemberStatus.PENDING;

  const handleApprove = async (): Promise<void> => {
    const result = zero.mutate(
      mutators.room.approveMember({ memberId: member.id, timestamp: Date.now() }),
    );
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Could not approve member', { description: res.error.message });
    }
  };

  const handleRemove = async (): Promise<void> => {
    const result = zero.mutate(mutators.room.removeMember({ memberId: member.id }));
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Could not remove member', { description: res.error.message });
    }
  };

  return (
    <div
      data-testid={`room-member-row-${member.userId}`}
      className='flex items-center gap-3 py-2.5 border-t border-border first:border-t-0'
    >
      <Avatar userId={member.userId} size='md' />
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-medium text-foreground truncate'>
          {user ? getUserDisplayName(user) : member.userId}
          {isSelf && <span className='text-muted-foreground font-normal'> (you)</span>}
        </p>
        <p className='text-xs text-muted-foreground'>
          {isPending ? 'Waiting for approval' : (ROLE_LABELS[member.role] ?? 'Member')}
        </p>
      </div>
      {canManage && isPending && (
        <Button
          variant='outline'
          size='sm'
          onClick={() => void handleApprove()}
          data-testid='approve-member'
        >
          Approve
        </Button>
      )}
      {(canManage || isSelf) && member.role !== RoomRole.OWNER && (
        <Button
          variant='ghost'
          size='sm'
          onClick={() => void handleRemove()}
          data-testid='remove-member'
        >
          {isSelf ? (isPending ? 'Withdraw' : 'Leave') : 'Remove'}
        </Button>
      )}
    </div>
  );
}

interface RoomMembersTabProps {
  roomId: string;
  members: readonly RoomMember[];
  selfUserId: string | undefined;
  canManage: boolean;
}

export function RoomMembersTab({
  roomId,
  members,
  selfUserId,
  canManage,
}: RoomMembersTabProps): ReactElement {
  const zero = useZero();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [usersToAdd, setUsersToAdd] = useState<User[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  const approved = useMemo(
    () => members.filter(m => m.status === RoomMemberStatus.APPROVED),
    [members],
  );
  const pending = useMemo(
    () => members.filter(m => m.status === RoomMemberStatus.PENDING),
    [members],
  );
  const memberUserIds = useMemo(() => members.map(m => m.userId), [members]);

  const handleOpenAddDialog = (): void => {
    setShowAddDialog(true);
  };

  const handleAddMembers = async (): Promise<void> => {
    if (usersToAdd.length === 0 || isAdding) return;
    setIsAdding(true);
    for (const user of usersToAdd) {
      const result = zero.mutate(
        mutators.room.addMember({
          roomId,
          memberId: uuidv4(),
          userId: user.id,
          timestamp: Date.now(),
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error(`Could not add ${getUserDisplayName(user)}`, {
          description: res.error.message,
        });
      }
    }
    setIsAdding(false);
    setUsersToAdd([]);
    setShowAddDialog(false);
  };

  const handleCloseAddDialog = (): void => {
    setShowAddDialog(false);
    setUsersToAdd([]);
  };

  return (
    <div data-slot='room-members-tab' className='flex flex-col gap-6'>
      <div className='flex items-center justify-between'>
        <p className='text-sm text-muted-foreground [text-wrap:pretty]'>
          Approved members can view the room. Others wait for owner approval.
        </p>
        {canManage && (
          <Button
            onClick={handleOpenAddDialog}
            data-track-category='Rooms'
            data-track-name='AddRoomMember'
            data-testid='add-room-member'
          >
            <UserPlus size={16} />
            Add member
          </Button>
        )}
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-2 gap-6 items-start'>
        <section className='rounded-2xl border border-border bg-background p-4'>
          <div className='flex items-center justify-between mb-3'>
            <h3 className='text-sm font-semibold text-foreground'>Approved</h3>
            <span className='text-xs tabular-nums text-muted-foreground'>{approved.length}</span>
          </div>
          <div data-testid='approved-members'>
            {approved.map(member => (
              <RoomMemberRow
                key={member.id}
                member={member}
                selfUserId={selfUserId}
                canManage={canManage}
              />
            ))}
            {approved.length === 0 && (
              <p className='text-sm text-muted-foreground py-2'>No approved members yet.</p>
            )}
          </div>
        </section>

        <section className='rounded-2xl border border-border bg-background p-4'>
          <div className='flex items-center justify-between mb-3'>
            <h3 className='text-sm font-semibold text-foreground'>Waiting for approval</h3>
            <span className='text-xs tabular-nums text-muted-foreground'>{pending.length}</span>
          </div>
          <div data-testid='pending-members'>
            {pending.map(member => (
              <RoomMemberRow
                key={member.id}
                member={member}
                selfUserId={selfUserId}
                canManage={canManage}
              />
            ))}
            {pending.length === 0 && (
              <p className='text-sm text-muted-foreground py-2'>No pending requests.</p>
            )}
          </div>
        </section>
      </div>

      <Dialog
        open={showAddDialog}
        onOpenChange={handleCloseAddDialog}
        title='Add members'
        description='Added members are approved immediately.'
        testId='add-room-member-dialog'
      >
        <header className='border-b border-border px-5 py-4'>
          <h2 className='text-base font-semibold text-foreground'>Add members</h2>
          <p className='mt-0.5 text-xs text-muted-foreground [text-wrap:pretty]'>
            Added members are approved immediately — they can see the room right away.
          </p>
        </header>
        <div className='flex flex-col gap-4 p-5'>
          <SearchUser
            excludeUserIds={memberUserIds}
            selectedUsers={usersToAdd}
            onUsersChange={setUsersToAdd}
            placeholder='Search users to add...'
          />
          <div className='flex items-center justify-end gap-2'>
            <Button variant='ghost' onClick={handleCloseAddDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAddMembers()}
              disabled={usersToAdd.length === 0 || isAdding}
              data-testid='confirm-add-members'
            >
              {isAdding ? 'Adding…' : `Add ${usersToAdd.length || ''}`.trim()}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
