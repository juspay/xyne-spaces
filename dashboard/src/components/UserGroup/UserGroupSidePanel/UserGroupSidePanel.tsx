import { ReactElement, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Users } from 'lucide-react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUsers } from '../../../hooks/useUsers';
import { useUserGroupById } from '../../../hooks/useUserGroup';
import type { User } from '@xyne/shared';
import { UserResponsibility, UserStatus } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { getUserDisplayName } from '../../../utils/userDisplayName';

export const UserGroupSidePanel = (): ReactElement | null => {
  const navigate = useNavigate();
  const { channelId, groupId } = useParams<{ channelId?: string; groupId: string }>();
  const { baseRoute } = useRouteContext();
  const userGroup = useUserGroupById(groupId || '');

  const [userGroupMembers] = useCachedQuery(
    queries.getUserGroupMembers({ userGroupId: groupId ?? '' }),
    { enabled: !!groupId },
  );

  const handleClose = (): void => {
    if (channelId) {
      void navigate(`${baseRoute}/${channelId}`);
    } else {
      void navigate(baseRoute);
    }
  };

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  // Get member details with their responsibilities
  const membersWithRoles = useMemo(() => {
    if (!userGroupMembers) return [];
    return userGroupMembers
      .map(mapping => ({
        user: usersById.get(mapping.userId),
        responsibility: mapping.responsibility,
      }))
      .filter((item): item is { user: User; responsibility: UserResponsibility } =>
        Boolean(item.user),
      )
      .sort((a, b) => {
        // Sort by responsibility: MANAGER > TEAM_LEAD > others
        const priority = {
          [UserResponsibility.MANAGER]: 0,
          [UserResponsibility.TEAM_LEAD]: 1,
          [UserResponsibility.MEMBER]: 2,
          [UserResponsibility.PR_REVIEWER]: 3,
          [UserResponsibility.QA]: 4,
        };
        return priority[a.responsibility] - priority[b.responsibility];
      });
  }, [userGroupMembers, usersById]);

  const memberCount = membersWithRoles.length;

  if (!groupId || !userGroup) return null;

  return (
    <div className='h-full w-full bg-background flex flex-col'>
      {/* Header - Slack-like design */}
      <div className='flex items-center justify-between px-6 py-4 border-b border-border bg-background flex-shrink-0'>
        <div className='flex items-center gap-3 min-w-0 flex-1'>
          <div className='flex items-center justify-center w-9 h-9 bg-blue-500 rounded-md flex-shrink-0'>
            <Users className='w-5 h-5 text-white' />
          </div>
          <div className='min-w-0 flex-1'>
            <h2 className='text-[15px] font-bold text-foreground truncate'>{userGroup.name}</h2>
            <p className='text-[13px] text-muted-foreground'>
              {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </p>
          </div>
        </div>
        <button
          onClick={handleClose}
          data-track-category='USER_GROUP_SIDEPANEL'
          data-track-name='CLOSE_SIDEPANEL'
          className='p-1.5 hover:bg-muted rounded transition-colors flex-shrink-0 ml-2'
          aria-label='Close'
        >
          <X className='w-5 h-5 text-muted-foreground' />
        </button>
      </div>

      {/* Content */}
      <div className='flex-1 overflow-y-auto bg-background'>
        {/* Description */}
        {userGroup.description && (
          <div className='px-6 py-4 border-b border-border'>
            <h3 className='text-[13px] font-semibold text-foreground mb-2'>About</h3>
            <p className='text-[15px] text-foreground leading-relaxed'>{userGroup.description}</p>
          </div>
        )}

        {/* Members Section */}
        <div className='px-6 py-4'>
          <h3 className='text-[13px] font-semibold text-foreground mb-3'>Members</h3>
          <div className='divide-y divide-border'>
            {membersWithRoles.map(({ user, responsibility }) => {
              const isDeactivated = user.status === UserStatus.INACTIVE;
              return (
                <div
                  key={user.id}
                  className='flex items-center gap-3 py-2.5 px-2 -mx-2 rounded hover:bg-muted transition-colors cursor-pointer'
                >
                  <Avatar userId={user.id} size='md' showActiveStatus={true} />
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-1.5'>
                      <p
                        className={`text-[14px] font-medium truncate ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
                      >
                        {getUserDisplayName(user)}
                      </p>
                      {isDeactivated && (
                        <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
                          Deactivated
                        </span>
                      )}
                    </div>
                    <p className='text-[12px] text-muted-foreground truncate'>{user.email}</p>
                  </div>
                  <span
                    className={`text-[12px] px-2 py-0.5 rounded font-medium flex-shrink-0 ${
                      responsibility === UserResponsibility.MANAGER
                        ? 'bg-purple-100 text-purple-700'
                        : responsibility === UserResponsibility.TEAM_LEAD
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {responsibility === UserResponsibility.MANAGER
                      ? 'Manager'
                      : responsibility === UserResponsibility.TEAM_LEAD
                        ? 'Team Lead'
                        : responsibility === UserResponsibility.PR_REVIEWER
                          ? 'Reviewer'
                          : responsibility === UserResponsibility.QA
                            ? 'QA'
                            : 'Member'}
                  </span>
                </div>
              );
            })}
          </div>

          {memberCount === 0 && (
            <div className='text-center py-12'>
              <Users className='w-12 h-12 text-muted mx-auto mb-3' />
              <p className='text-[15px] text-muted-foreground'>No members in this group</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserGroupSidePanel;
