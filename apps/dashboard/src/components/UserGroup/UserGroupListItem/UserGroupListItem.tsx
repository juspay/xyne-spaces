import { ReactElement, useMemo, useState } from 'react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { Button } from '../../ui/Button/Button';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import { Tooltip } from '../../ui/Tooltip';
import type { UserGroup, User } from '@xyne/shared';
import { useUsers } from '../../../hooks/useUsers';
import { useNavigate } from 'react-router-dom';
import { CopyCopied, CopyDefault, DeleteDustbin02, PencilEditBox, Refresh } from '@xyne/icons';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';

const VISIBLE_AVATARS = 3;

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
  const allUsers = useUsers();
  const [copied, setCopied] = useState(false);

  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  const memberIds = useMemo(
    () =>
      (userGroupMembers ?? [])
        .map(mapping => usersById.get(mapping.userId)?.id)
        .filter((id): id is string => Boolean(id)),
    [userGroupMembers, usersById],
  );

  const memberCount = memberIds.length;
  const isActive = userGroup.isActive !== false;

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

  return (
    <div
      data-testid='user-group-list-item'
      className={cn(
        'flex h-full flex-col justify-between gap-8 rounded-2xl border border-border bg-card p-4',
        !isActive && 'opacity-60',
      )}
    >
      <div className='flex flex-col gap-0.5'>
        <div className='flex flex-col gap-1'>
          <div className='flex items-center justify-between gap-3'>
            <div className='flex min-w-0 items-center gap-2'>
              <h3 className='truncate text-base font-semibold text-foreground'>{userGroup.name}</h3>
              {!isActive && (
                <span className='shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'>
                  Deactivated
                </span>
              )}
            </div>
            {memberCount > 0 && (
              <Tooltip content={`${memberCount} ${memberCount === 1 ? 'member' : 'members'}`}>
                <span className='flex h-5 shrink-0 items-center'>
                  <AvatarGroup userIds={memberIds} size='sm' count={VISIBLE_AVATARS} />
                </span>
              </Tooltip>
            )}
          </div>
          {userGroup.description && (
            <p className='line-clamp-2 text-[13px] leading-[1.4] text-muted-foreground'>
              {userGroup.description}
            </p>
          )}
        </div>

        {userGroup.alias && (
          <p className='truncate text-xs text-muted-foreground'>Alias: {userGroup.alias}</p>
        )}

        <div className='flex items-center gap-[3px]'>
          <span className='font-mono text-[10px] text-muted-foreground'>ID:</span>
          <code className='max-w-[160px] truncate rounded-lg bg-muted p-1 font-mono text-[10px] text-muted-foreground'>
            {userGroup.id}
          </code>
          <Button
            variant='ghost'
            size='iconSm'
            className='size-5 p-0 text-muted-foreground hover:text-foreground'
            onClick={handleCopyId}
            data-track-category='UserGroups'
            data-track-name='COPY_USER_GROUP_ID'
            title='Copy user group ID'
            aria-label='Copy user group ID'
          >
            {copied ? <CopyCopied size={14} /> : <CopyDefault size={14} />}
          </Button>
        </div>
      </div>

      <div className='flex items-center gap-2'>
        {isActive ? (
          <>
            <Button
              variant='outline'
              className='h-[26px] rounded-[10px] px-3 text-xs'
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
            <Tooltip content='Edit'>
              <Button
                variant='ghost'
                size='iconSm'
                className='size-6 rounded-md p-1 text-muted-foreground hover:text-foreground'
                onClick={() => onEdit(userGroup)}
                aria-label='Edit user group'
                data-track-category='UserGroups'
                data-track-name='EditUserGroup'
                data-track-metadata={JSON.stringify({
                  groupId: userGroup.id,
                  groupName: userGroup.name,
                })}
              >
                <PencilEditBox size={16} />
              </Button>
            </Tooltip>
            <Tooltip content='Deactivate'>
              <Button
                variant='ghost'
                size='iconSm'
                className='size-6 rounded-md p-1 text-muted-foreground hover:text-destructive'
                onClick={() => void onDeactivate(userGroup.id)}
                aria-label='Deactivate user group'
                data-track-category='UserGroups'
                data-track-name='DeactivateUserGroup'
                data-track-metadata={JSON.stringify({
                  groupId: userGroup.id,
                  groupName: userGroup.name,
                })}
              >
                <DeleteDustbin02 size={16} />
              </Button>
            </Tooltip>
          </>
        ) : (
          <Button
            variant='outline'
            className='h-[26px] gap-1.5 rounded-[10px] px-3 text-xs'
            onClick={() => void onReactivate(userGroup.id)}
            data-track-category='UserGroups'
            data-track-name='ReactivateUserGroup'
            data-track-metadata={JSON.stringify({
              groupId: userGroup.id,
              groupName: userGroup.name,
            })}
          >
            <Refresh size={14} />
            Reactivate
          </Button>
        )}
      </div>
    </div>
  );
};
