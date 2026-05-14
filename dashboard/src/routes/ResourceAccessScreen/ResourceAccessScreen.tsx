import { ReactElement, useState, useMemo, useRef, useEffect } from 'react';
import { UserListView } from '../../components/ResourceAccess';
import { ResourceAccessModal } from '../../components/ResourceAccess';
import { useUsers, searchUsers } from '../../hooks/useUsers';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import Input from '../../components/ui/Input/Input';
import { Search } from 'lucide-react';
import type { User } from '../../machines/stateMachine';
import { usePlatform } from '../../hooks/usePlatform';

/**
 * ResourceAccessScreen - Admin screen for managing user resource access
 *
 * This screen provides an interface to manage resource access for all users.
 * - Lists all users in card format similar to ProjectsListView
 * - Search functionality to filter users
 * - Clicking "Edit Resource" opens the modal showing all resources
 * - Each resource has a dropdown to set access level (None, Read, Write, Admin)
 * - Only admins of a resource can grant admin access to others
 */
export const ResourceAccessScreen = (): ReactElement => {
  const users = useUsers();
  const [searchQuery, setSearchQuery] = useState('');
  const { isMobile } = usePlatform();
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter users based on debounced search query
  const filteredUsers = useMemo(() => {
    if (debouncedSearchQuery === '' || !debouncedSearchQuery.trim()) return users;
    return searchUsers(users, debouncedSearchQuery, users.length);
  }, [users, debouncedSearchQuery]);

  const loading = users === undefined;

  useEffect(() => {
    if (isMobile || editingUser) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile, editingUser]);

  return (
    <div
      data-testid='user-management-page'
      className='h-full bg-background flex flex-col md:rounded-2xl overflow-hidden shadow-md'
    >
      <div className='flex-1 overflow-y-auto p-4'>
        {/* Header */}
        <div className='mb-6'>
          <div className='flex items-center justify-between mb-2'>
            <h2 className='text-lg font-bold text-foreground'>User Management</h2>
          </div>
          <p className='text-xs text-muted-foreground'>Manage resource access for users</p>
        </div>

        {/* Search Bar */}
        <div className='mb-6'>
          <div className='relative max-w-md'>
            <div className='absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none'>
              <Search size={18} className='text-muted-foreground' />
            </div>
            <Input
              ref={searchInputRef}
              type='text'
              placeholder='Search users by name or email...'
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              className='pl-10 w-full'
            />
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className='h-64 flex items-center justify-center'>
            <p className='text-muted-foreground'>Loading users...</p>
          </div>
        )}

        {/* Users List */}
        {!loading && filteredUsers.length > 0 && (
          <UserListView users={filteredUsers} onEditResource={setEditingUser} />
        )}

        {/* Empty State - No users at all */}
        {!loading && users.length === 0 && (
          <div className='text-center py-8'>
            <div className='text-muted-foreground text-3xl mb-3'>👥</div>
            <h3 className='text-sm font-semibold text-foreground mb-1'>No users found</h3>
            <p className='text-xs text-muted-foreground'>There are no users in the system</p>
          </div>
        )}

        {/* Empty State - Search returned no results */}
        {!loading && users.length > 0 && filteredUsers.length === 0 && (
          <div className='text-center py-8'>
            <div className='text-muted-foreground text-3xl mb-3'>🔍</div>
            <h3 className='text-sm font-semibold text-foreground mb-1'>No users match</h3>
            <p className='text-xs text-muted-foreground'>Try adjusting your search query</p>
          </div>
        )}
      </div>

      {/* Edit Resource Modal */}
      {editingUser && (
        <ResourceAccessModal
          userId={editingUser.id}
          isOpen={true}
          onClose={() => setEditingUser(null)}
        />
      )}
    </div>
  );
};
