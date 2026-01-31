import { ReactElement, useState, useEffect, useMemo } from 'react';
import { Search, Check } from 'lucide-react';
import Avatar from '../../../../ui/Avatar/Avatar';
import Input from '../../../../ui/Input/Input';
import { useUsers, useUserSearch } from '../../../../../hooks/useUsers';

interface UserSubmenuProps {
  selectedUsers: string[];
  onChange: (userIds: string[]) => void;
  label: string;
  availableUsers?: string[];
  className?: string;
}

export const UserSubmenu = ({
  selectedUsers,
  onChange,
  label,
  availableUsers: availableUserIds,
  className = '',
}: UserSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // 1. Debounced Search
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const users = useUsers();
  const searchedUsers = useUserSearch(searchTerm, 20);

  const availableUsersData = useMemo(() => {
    if (availableUserIds && availableUserIds.length > 0) {
      const idSet = new Set(availableUserIds.slice(0, 100));
      return users.filter(v => idSet.has(v.id));
    }
    return searchedUsers;
  }, [availableUserIds, users, searchedUsers]);

  const finalResults = useMemo(() => {
    if (!availableUsersData) return [];

    let list = [...availableUsersData];
    if (availableUserIds && availableUserIds.length > 0 && searchTerm.trim()) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(
        u => u.name.toLowerCase().includes(lower) || u.email?.toLowerCase().includes(lower),
      );
    }

    const selectedSet = new Set(selectedUsers);
    return list
      .sort((a, b) => {
        const aSel = selectedSet.has(a.id) ? 1 : 0;
        const bSel = selectedSet.has(b.id) ? 1 : 0;
        return bSel - aSel;
      })
      .slice(0, 40);
  }, [availableUsersData, availableUserIds, searchTerm, selectedUsers]);

  const handleUserToggle = (userId: string) => {
    const isSelected = selectedUsers.includes(userId);
    onChange(isSelected ? selectedUsers.filter(id => id !== userId) : [...selectedUsers, userId]);
  };

  return (
    <div
      className={`w-80 flex flex-col bg-white overflow-hidden border border-gray-200 rounded-lg shadow-lg ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-white z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none' />
          <Input
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}...`}
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div className='max-h-80 overflow-y-auto p-1' role='listbox' aria-multiselectable='true'>
        {!availableUsersData ? (
          <div className='p-8 text-center text-sm text-gray-400'>Loading users...</div>
        ) : finalResults.length > 0 ? (
          <div className='space-y-0.5'>
            {finalResults.map(user => {
              const isSelected = selectedUsers.includes(user.id);
              return (
                <button
                  key={user.id}
                  type='button'
                  onClick={() => handleUserToggle(user.id)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-[#F2F2F3] text-black' : 'hover:bg-gray-50 text-gray-700'}
                    focus-visible:ring-2 focus-visible:ring-[#F2F2F3]
                  `}
                >
                  <Avatar userId={user.id} size='sm' className='shrink-0' />
                  <div className='flex-1 text-left min-w-0'>
                    <p className='text-sm font-medium truncate'>{user.name}</p>
                  </div>
                  {isSelected && <Check className='w-4 h-4 text-gray-400 shrink-0' />}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-gray-500'>
            {searchQuery ? 'No matches found' : 'No users available'}
          </div>
        )}
      </div>
    </div>
  );
};
