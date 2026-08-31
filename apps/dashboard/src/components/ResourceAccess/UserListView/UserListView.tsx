import { ReactElement, useMemo, useState } from 'react';
import { Button } from '../../ui/Button';
import Avatar from '../../ui/Avatar/Avatar';
import type { User as UserType } from '../../../machines/stateMachine';
import { useUsers } from '../../../hooks/useUsers';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import { queries } from '../../../zero/queries';
import type { QueryResultType } from '@rocicorp/zero';

type UserProfile = QueryResultType<typeof queries.getUserProfile>;
type UserWithProfile = UserType & { userProfile?: UserProfile };

interface UserListViewProps {
  users: UserType[];
  onEditResource: (user: UserType) => void;
}

// Single user row component that uses related profile data
const UserRow = ({
  user,
  onEditResource,
}: {
  user: UserWithProfile;
  onEditResource: (user: UserType) => void;
}): ReactElement => {
  const userProfile = user.userProfile;
  const allUsers = useUsers();
  const isDeactivated = isUserDeactivated(user);

  const manager = useMemo(() => {
    if (!userProfile?.manager) return null;
    return allUsers.find(u => u.id === userProfile.manager);
  }, [userProfile?.manager, allUsers]);

  const handleEditClick = (): void => {
    onEditResource(user as UserType);
  };

  return (
    <div className='flex items-center px-6 py-4 hover:bg-muted transition-colors border-b border-border last:border-b-0'>
      {/* User Column */}
      <div className='flex items-center gap-3 flex-1 min-w-0'>
        <Avatar userId={user.id} size='sm' />
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <span
              className={`text-sm font-medium truncate ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
            >
              {getUserDisplayName(user)}
            </span>
            {isDeactivated && (
              <span className='text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0'>
                Deactivated
              </span>
            )}
          </div>
          <div className='text-xs text-muted-foreground truncate'>{user.email}</div>
        </div>
      </div>

      {/* Team Column */}
      <div className='flex-1 min-w-0 px-4'>
        <div className='text-sm text-foreground truncate'>{userProfile?.team || '-'}</div>
      </div>

      {/* Manager Column */}
      <div className='flex-1 min-w-0 px-4'>
        {manager ? (
          <div className='flex items-center gap-2'>
            <Avatar userId={manager.id} size='sm' />
            <span className='text-sm text-foreground truncate'>{manager.name}</span>
          </div>
        ) : (
          <span className='text-sm text-muted-foreground'>-</span>
        )}
      </div>

      {/* Role Column */}
      <div className='flex-1 min-w-0 px-4'>
        <div className='text-sm text-foreground truncate'>{userProfile?.role || '-'}</div>
      </div>

      {/* Actions Column */}
      <div className='w-32 flex justify-end'>
        <Button
          variant='secondary'
          size='sm'
          onClick={handleEditClick}
          data-track-category='RESOURCE_ACCESS'
          data-track-name='EDIT_USER_ACCESS'
        >
          Edit
        </Button>
      </div>
    </div>
  );
};

const ITEMS_PER_PAGE = 10;

export const UserListView = ({ users, onEditResource }: UserListViewProps): ReactElement => {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(users.length / ITEMS_PER_PAGE);

  const paginatedUsers = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return users.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [users, currentPage]);

  const visibleUserIds = useMemo(() => paginatedUsers.map(u => u.id), [paginatedUsers]);
  const [profiles] = useCachedQuery(queries.getUserProfilesByIds({ userIds: visibleUserIds }));

  const usersWithProfiles = useMemo(() => {
    if (!profiles) return paginatedUsers as UserWithProfile[];
    return paginatedUsers.map(user => ({
      ...user,
      userProfile: profiles.find(p => p.userId === user.id),
    })) as UserWithProfile[];
  }, [paginatedUsers, profiles]);

  const handlePrevPage = (): void => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  };

  const handleNextPage = (): void => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
  };

  return (
    <div className='bg-background rounded-lg border border-border overflow-hidden'>
      {/* Header */}
      <div className='flex items-center px-6 py-3 bg-muted border-b border-border'>
        <div className='flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
          User
        </div>
        <div className='flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4'>
          Team
        </div>
        <div className='flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4'>
          Manager
        </div>
        <div className='flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4'>
          Role
        </div>
        <div className='w-32 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
          Actions
        </div>
      </div>

      {/* User Rows */}
      <div className='divide-y divide-border'>
        {usersWithProfiles.map(user => (
          <UserRow key={user.id} user={user} onEditResource={onEditResource} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className='flex items-center justify-between px-6 py-3 bg-muted border-t border-border'>
          <div className='text-sm text-muted-foreground'>
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} -{' '}
            {Math.min(currentPage * ITEMS_PER_PAGE, users.length)} of {users.length} users
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={handlePrevPage}
              data-track-category='RESOURCE_ACCESS'
              data-track-name='USER_LIST_PREV_PAGE'
              disabled={currentPage === 1}
              className='h-8 w-8 p-0'
            >
              <ChevronLeft className='w-4 h-4' />
            </Button>
            <span className='text-sm text-foreground'>
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant='ghost'
              size='sm'
              onClick={handleNextPage}
              data-track-category='RESOURCE_ACCESS'
              data-track-name='USER_LIST_NEXT_PAGE'
              disabled={currentPage === totalPages}
              className='h-8 w-8 p-0'
            >
              <ChevronRight className='w-4 h-4' />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
