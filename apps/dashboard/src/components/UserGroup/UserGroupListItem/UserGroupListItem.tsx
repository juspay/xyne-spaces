import { ReactElement, useMemo, useState } from 'react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import type { UserGroup, User } from '@xyne/shared';
import { useUsers } from '../../../hooks/useUsers';
import { useNavigate } from 'react-router-dom';
import { Copy, Check } from 'lucide-react';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { toast } from 'sonner';

interface UserGroupListItemProps {
  userGroup: UserGroup;
  onEdit: (userGroup: UserGroup) => void;
  onDeactivate: (userGroupId: string) => void | Promise<void>;
  onReactivate: (userGroupId: string) => void | Promise<void>;
}

export const UserGroupListItem = ({
  userGroup,
  onEdit,
  onDeactivate,
  onReactivate,
}: UserGroupListItemProps): ReactElement => {
  const [userGroupMembers] = useCachedQuery(
    queries.getUserGroupMembers({ userGroupId: userGroup.id }),
  );
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleCopyId = (e: React.MouseEvent): void => {
    e.stopPropagation();
    copyTextToClipboard(userGroup.id)
      .then(() => {
        toast.success('User Group ID copied to clipboard');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        toast.error('Failed to copy user group ID');
      });
  };

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  const members =
    userGroupMembers
      ?.map(mapping => usersById.get(mapping.userId))
      .filter((user): user is User => Boolean(user)) || [];
  const memberCount = members.length;

  const isActive = userGroup.isActive !== false;

  return (
    <div
      data-testid='user-group-list-item'
      className={`bg-background border rounded-lg p-4 hover:bg-muted transition-colors ${
        !isActive ? 'opacity-60' : ''
      }`}
    >
      <div className='flex items-center justify-between'>
        <div className='flex-1'>
          <div className='flex items-center space-x-3'>
            <div className='flex items-center justify-center w-10 h-10 bg-muted rounded-lg'>
              <span className='text-muted-foreground font-medium'>👥</span>
            </div>
            <div>
              <div className='flex items-center gap-2'>
                <h3 className='font-medium text-foreground'>{userGroup.name}</h3>
                {!isActive && (
                  <span className='px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded'>
                    Deactivated
                  </span>
                )}
              </div>
              {userGroup.description && (
                <p className='text-sm text-muted-foreground line-clamp-1'>
                  {userGroup.description}
                </p>
              )}
              {userGroup.alias && (
                <p className='text-xs text-muted-foreground'>Alias: {userGroup.alias}</p>
              )}
              <div className='flex items-center gap-1 mt-0.5'>
                <span className='text-xs text-muted-foreground'>ID:</span>
                <code className='text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[160px]'>
                  {userGroup.id}
                </code>
                <Button
                  variant='ghost'
                  size='iconSm'
                  className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
                  onClick={handleCopyId}
                  title='Copy user group ID'
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </Button>
              </div>
            </div>
          </div>

          <div className='mt-2 flex items-center space-x-4'>
            <div className='flex items-center text-sm text-muted-foreground'>
              <span className='font-medium'>{memberCount}</span>
              <span className='ml-1'>{memberCount === 1 ? 'member' : 'members'}</span>
            </div>

            {memberCount > 0 && (
              <div className='flex items-center -space-x-2 z-0'>
                {members.slice(0, 3).map((member, index) => (
                  <div
                    key={member.id}
                    className='relative flex items-center'
                    style={{ zIndex: 3 - index }}
                  >
                    <Avatar userId={member.id} size='sm' showActiveStatus={false} />
                  </div>
                ))}
                {memberCount > 3 && (
                  <div
                    className='relative flex items-center justify-center w-5 h-5 bg-muted border border-white rounded-full text-xs font-medium text-muted-foreground'
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
          {isActive ? (
            <>
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
                onClick={() => void onDeactivate(userGroup.id)}
                data-track-category='UserGroups'
                data-track-name='DeactivateUserGroup'
                data-track-metadata={JSON.stringify({
                  groupId: userGroup.id,
                  groupName: userGroup.name,
                })}
              >
                Deactivate
              </Button>
            </>
          ) : (
            <>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void onReactivate(userGroup.id)}
                data-track-category='UserGroups'
                data-track-name='ReactivateUserGroup'
                data-track-metadata={JSON.stringify({
                  groupId: userGroup.id,
                  groupName: userGroup.name,
                })}
              >
                Reactivate
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
