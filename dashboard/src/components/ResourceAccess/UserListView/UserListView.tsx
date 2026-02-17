import { ReactElement, useMemo, useState } from 'react';
import { Button } from '../../ui/Button';
import Avatar from '../../ui/Avatar/Avatar';
import type { User as UserType } from '../../../machines/stateMachine';
import { useUsers } from '../../../hooks/useUsers';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
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

  const manager = useMemo(() => {
    if (!userProfile?.manager) return null;
    return allUsers.find(u => u.id === userProfile.manager);
  }, [userProfile?.manager, allUsers]);

  const handleEditClick = (): void => {
    onEditResource(user as UserType);
  };

  return (
    <div className='flex items-center px-6 py-4 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0'>
      {/* User Column */}
      <div className='flex items-center gap-3 flex-1 min-w-0'>
        <Avatar userId={user.id} size='sm' />
        <div className='min-w-0'>
          <div className='text-sm font-medium text-gray-900 truncate'>{user.name}</div>
          <div className='text-xs text-gray-500 truncate'>{user.email}</div>
        </div>
      </div>

      {/* Team Column */}
      <div className='flex-1 min-w-0 px-4'>
        <div className='text-sm text-gray-700 truncate'>{userProfile?.team || '-'}</div>
      </div>

      {/* Manager Column */}
      <div className='flex-1 min-w-0 px-4'>
        {manager ? (
          <div className='flex items-center gap-2'>
            <Avatar userId={manager.id} size='sm' />
            <span className='text-sm text-gray-700 truncate'>{manager.name}</span>
          </div>
        ) : (
          <span className='text-sm text-gray-400'>-</span>
        )}
      </div>

      {/* Role Column */}
      <div className='flex-1 min-w-0 px-4'>
        <div className='text-sm text-gray-700 truncate'>{userProfile?.role || '-'}</div>
      </div>

      {/* Actions Column */}
      <div className='w-32 flex justify-end'>
        <Button variant='secondary' size='sm' onClick={handleEditClick}>
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
    <div className='bg-white rounded-lg border border-gray-200 overflow-hidden'>
      {/* Header */}
      <div className='flex items-center px-6 py-3 bg-gray-50 border-b border-gray-200'>
        <div className='flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wider'>
          User
        </div>
        <div className='flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wider px-4'>
          Team
        </div>
        <div className='flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wider px-4'>
          Manager
        </div>
        <div className='flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wider px-4'>
          Role
        </div>
        <div className='w-32 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider'>
          Actions
        </div>
      </div>

      {/* User Rows */}
      <div className='divide-y divide-gray-100'>
        {usersWithProfiles.map(user => (
          <UserRow key={user.id} user={user} onEditResource={onEditResource} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className='flex items-center justify-between px-6 py-3 bg-gray-50 border-t border-gray-200'>
          <div className='text-sm text-gray-500'>
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} -{' '}
            {Math.min(currentPage * ITEMS_PER_PAGE, users.length)} of {users.length} users
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className='h-8 w-8 p-0'
            >
              <ChevronLeft className='w-4 h-4' />
            </Button>
            <span className='text-sm text-gray-700'>
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant='ghost'
              size='sm'
              onClick={handleNextPage}
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
