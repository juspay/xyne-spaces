import { ReactElement, useMemo } from 'react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import type { UserGroup, User } from '@xyne/shared';
import { useUsers } from '../../../hooks/useUsers';
import { useNavigate } from 'react-router-dom';

interface UserGroupListItemProps {
  userGroup: UserGroup;
  onEdit: (userGroup: UserGroup) => void;
  onDelete: (userGroupId: string) => void;
}

export const UserGroupListItem = ({
  userGroup,
  onEdit,
  onDelete,
}: UserGroupListItemProps): ReactElement => {
  const [userGroupMembers] = useCachedQuery(
    queries.getUserGroupMembers({ userGroupId: userGroup.id }),
  );
  const navigate = useNavigate();

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
    <div className='bg-white border rounded-lg p-4 hover:bg-gray-50 transition-colors'>
      <div className='flex items-center justify-between'>
        <div className='flex-1'>
          <div className='flex items-center space-x-3'>
            <div className='flex items-center justify-center w-10 h-10 bg-gray-100 rounded-lg'>
              <span className='text-gray-600 font-medium'>👥</span>
            </div>
            <div>
              <h3 className='font-medium text-gray-900'>{userGroup.name}</h3>
              {userGroup.description && (
                <p className='text-sm text-gray-600 line-clamp-1'>{userGroup.description}</p>
              )}
              {userGroup.alias && <p className='text-xs text-gray-500'>Alias: {userGroup.alias}</p>}
            </div>
          </div>

          <div className='mt-2 flex items-center space-x-4'>
            <div className='flex items-center text-sm text-gray-600'>
              <span className='font-medium'>{memberCount}</span>
              <span className='ml-1'>{memberCount === 1 ? 'member' : 'members'}</span>
            </div>

            {memberCount > 0 && (
              <div className='flex items-center -space-x-2 z-0'>
                {/* Show up to 3 member avatars */}
                {members.slice(0, 3).map((member, index) => (
                  <div
                    key={member.id}
                    className='relative flex items-center'
                    style={{ zIndex: 3 - index }}
                  >
                    <Avatar userId={member.id} size='sm' showActiveStatus={false} />
                  </div>
                ))}

                {/* Show overflow indicator */}
                {memberCount > 3 && (
                  <div
                    className='relative flex items-center justify-center w-5 h-5 bg-gray-100 border border-white rounded-full text-xs font-medium text-gray-600'
                    style={{ zIndex: 0 }}
                  >
                    +{memberCount - 3}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className='flex items-center space-x-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void navigate(`/user-groups/${userGroup.id}/assignment-config`)}
            data-track-category='UserGroups'
            data-track-name='OpenAssignmentConfig'
            data-track-metadata={JSON.stringify({
              groupId: userGroup.id,
              groupName: userGroup.name,
            })}
          >
            Auto Assignment
          </Button>
          <Button
            variant='outline'
            size='sm'
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
            size='sm'
            onClick={() => onDelete(userGroup.id)}
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
