import { ReactElement, useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { type User } from '@xyne/shared';
import { useUserSearch } from '../../../hooks/useUsers';
import Avatar from '../../ui/Avatar/Avatar';
import { type ApproverSelectorProps } from './ApproverSelector.types';

export const ApproverSelector = ({
  selectedApprovers,
  onApproversChange,
}: ApproverSelectorProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');

  // Get users matching search query
  const searchResults = useUserSearch(searchQuery, 10);

  // Filter out already selected users from search results
  const availableUsers = useMemo(() => {
    if (!searchResults) return [];
    return searchResults.filter(
      user => !selectedApprovers.some(selected => selected.id === user.id),
    );
  }, [searchResults, selectedApprovers]);

  const handleUserClick = (user: User): void => {
    onApproversChange([...selectedApprovers, user]);
    setSearchQuery(''); // Clear search after selection
  };

  const handleRemoveUser = (userId: string): void => {
    onApproversChange(selectedApprovers.filter(u => u.id !== userId));
  };

  return (
    <div className='flex flex-col gap-3 max-h-[400px]'>
      {/* Search Input */}
      <div className='relative flex-shrink-0'>
        <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
        <input
          type='text'
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder='Search User'
          className='w-full h-10 pl-10 pr-3 border border-border rounded-lg text-[14px] text-foreground placeholder:text-muted-foreground/50 bg-background focus:outline-none focus:ring-1 focus:ring-[#6276be]'
          data-track-category='board_config'
          data-track-name='search_user'
        />
      </div>

      {/* Scrollable Content Area */}
      <div className='flex flex-col gap-3 overflow-y-auto flex-1 min-h-0'>
        {/* Selected Users List */}
        {selectedApprovers.length > 0 && (
          <div className='flex flex-col gap-1'>
            {selectedApprovers.map(user => (
              <div
                key={user.id}
                className='flex items-center justify-between px-3 py-2 hover:bg-muted rounded-lg transition-colors group'
              >
                <div className='flex items-center gap-2.5 flex-1 min-w-0'>
                  <Avatar userId={user.id} size='sm' />
                  <div className='flex flex-col min-w-0'>
                    <span className='text-sm font-medium text-foreground truncate'>
                      {user.name}
                    </span>
                    <span className='text-xs text-muted-foreground truncate'>{user.email}</span>
                  </div>
                </div>
                <button
                  type='button'
                  onClick={() => handleRemoveUser(user.id)}
                  className='shrink-0 p-1 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100'
                  data-track-category='board_config'
                  data-track-name='remove_approver'
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* User Search Results List */}
        {searchQuery.trim() && (
          <div className='flex flex-col'>
            {availableUsers.length > 0 ? (
              availableUsers.map(user => (
                <button
                  key={user.id}
                  onClick={() => handleUserClick(user)}
                  className='flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors cursor-pointer text-left'
                  data-track-category='board_config'
                  data-track-name='select_approver'
                >
                  <Avatar userId={user.id} size='sm' />
                  <div className='flex flex-col'>
                    <span className='text-[14px] font-medium text-foreground'>{user.name}</span>
                    <span className='text-[12px] text-muted-foreground'>{user.email}</span>
                  </div>
                </button>
              ))
            ) : (
              <div className='px-3 py-4 text-center text-[13px] text-muted-foreground'>
                No users found
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ApproverSelector;
