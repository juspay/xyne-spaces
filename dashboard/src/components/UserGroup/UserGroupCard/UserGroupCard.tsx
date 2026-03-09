import { ReactElement, useMemo } from 'react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import type { UserGroup } from '@xyne/shared';
import { useUsers } from '../../../hooks/useUsers';
import type { User } from '../../../machines/stateMachine';

interface UserGroupCardProps {
  userGroup: UserGroup;
  onEdit: (userGroup: UserGroup) => void;
  onDelete: (userGroupId: string) => void;
}

export const UserGroupCard = ({
  userGroup,
  onEdit,
  onDelete,
}: UserGroupCardProps): ReactElement => {
  const [userGroupMembers] = useCachedQuery(
    queries.getUserGroupMembers({ userGroupId: userGroup.id }),
  );

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  // Extract users from mappings using userId and XState user store
  const members =
    userGroupMembers
      ?.map(mapping => usersById.get(mapping.userId))
      .filter((user): user is User => Boolean(user)) || [];
  const memberCount = members.length;

  return (
    <div className='bg-background rounded-lg shadow-sm border border-border p-6 hover:shadow-md transition-shadow'>
      <div className='flex items-start justify-between mb-4'>
        <div className='flex-1'>
          <h3 className='text-lg font-semibold text-foreground mb-2'>{userGroup.name}</h3>
          {userGroup.description && (
            <p className='text-sm text-muted-foreground line-clamp-2'>{userGroup.description}</p>
          )}
          {userGroup.alias && (
            <p className='text-xs text-muted-foreground mt-1'>Alias: {userGroup.alias}</p>
          )}
        </div>
      </div>

      {/* Members Section */}
      <div className='mb-4'>
        <div className='flex items-center justify-between mb-2'>
          <span className='text-sm font-medium text-foreground'>
            {memberCount} {memberCount === 1 ? 'Member' : 'Members'}
          </span>
        </div>

        {memberCount > 0 ? (
          <div className='flex items-center -space-x-2'>
            {/* Show up to 5 member avatars */}
            {members.slice(0, 5).map((member, index) => (
              <div key={member.id} className='relative' style={{ zIndex: 5 - index }}>
                <Avatar userId={member.id} size='sm' showActiveStatus={false} />
              </div>
            ))}

            {/* Show overflow indicator */}
            {memberCount > 5 && (
              <div
                className='relative flex items-center justify-center w-8 h-8 bg-muted border-2 border-white rounded-full text-xs font-medium text-muted-foreground'
                style={{ zIndex: 0 }}
              >
                +{memberCount - 5}
              </div>
            )}
          </div>
        ) : (
          <p className='text-sm text-muted-foreground italic'>No members yet</p>
        )}
      </div>

      <div className='border-t border-border pt-4 mt-4'>
        <div className='text-xs text-muted-foreground mb-3'>
          <p>Created: {new Date(userGroup.createdAt).toLocaleDateString()}</p>
        </div>

        <div className='flex gap-2'>
          <Button
            variant='outline'
            onClick={() => onEdit(userGroup)}
            data-track-category='UserGroups'
            data-track-name='EditUserGroup'
            data-track-metadata={JSON.stringify({
              groupId: userGroup.id,
              groupName: userGroup.name,
            })}
          >
            Edit
          </Button>
          <Button
            variant='destructive'
            onClick={() => void onDelete(userGroup.id)}
            data-track-category='UserGroups'
            data-track-name='DeleteUserGroup'
            data-track-metadata={JSON.stringify({
              groupId: userGroup.id,
              groupName: userGroup.name,
            })}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
};
