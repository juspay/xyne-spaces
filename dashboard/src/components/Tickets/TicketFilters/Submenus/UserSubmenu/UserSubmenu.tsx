import { ReactElement, useState, useEffect, useMemo } from 'react';
import { Search, Check } from 'lucide-react';
import Avatar from '../../../../ui/Avatar/Avatar';
import Input from '../../../../ui/Input/Input';
import { useUsers } from '../../../../../hooks/useUsers';
import type { User } from '../../../../../machines/stateMachine';
import { getUserDisplayName, isUserDeactivated } from '../../../../../utils/userDisplayName';
import { usePlatform } from '../../../../../hooks/usePlatform';

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
  const { isMobile } = usePlatform();

  // 1. Debounced Search
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const users = useUsers();

  const usersMap = useMemo(() => {
    return new Map<string, User>(users.map((u: User) => [u.id, u]));
  }, [users]);

  const normalizedAvailableUserIds = useMemo(() => {
    if (!availableUserIds || availableUserIds.length === 0) return null;
    const ids = new Set<string>();
    for (const id of availableUserIds) {
      const rawId = id.replace(/^(user:|group:|userGroup:)/, '');
      ids.add(rawId);
    }
    return ids;
  }, [availableUserIds]);

  const finalResults = useMemo(() => {
    const selectedSet = new Set(selectedUsers);
    const searchLower = searchTerm.toLowerCase().trim();

    let baseUsers: User[] = [];

    if (searchLower) {
      baseUsers = users.filter((user: User) => {
        const displayName = getUserDisplayName(user).toLowerCase();
        return (
          displayName.includes(searchLower) ||
          user.name.toLowerCase().includes(searchLower) ||
          user.email?.toLowerCase().includes(searchLower)
        );
      });
    } else {
      const idSet = new Set<string>();
      const list: User[] = [];

      for (const userId of selectedUsers) {
        if (idSet.has(userId)) continue;
        const user = usersMap.get(userId);
        if (user) {
          idSet.add(userId);
          list.push(user);
        }
      }

      if (normalizedAvailableUserIds) {
        let addedCount = 0;
        for (const rawId of normalizedAvailableUserIds) {
          if (idSet.has(rawId)) continue;
          const user = usersMap.get(rawId);
          if (user) {
            idSet.add(rawId);
            list.push(user);
            addedCount++;
            if (addedCount >= 100) break;
          }
        }
      } else {
        let addedCount = 0;
        for (const user of users) {
          if (idSet.has(user.id)) continue;
          idSet.add(user.id);
          list.push(user);
          addedCount++;
          if (addedCount >= 20) break;
        }
      }
      baseUsers = list;
    }

    return baseUsers
      .sort((a, b) => {
        const aSel = selectedSet.has(a.id) ? 1 : 0;
        const bSel = selectedSet.has(b.id) ? 1 : 0;
        return bSel - aSel;
      })
      .slice(0, 40);
  }, [users, usersMap, normalizedAvailableUserIds, selectedUsers, searchTerm]);

  const availableUsersData = finalResults;

  const handleUserToggle = (userId: string) => {
    const isSelected = selectedUsers.includes(userId);
    onChange(isSelected ? selectedUsers.filter(id => id !== userId) : [...selectedUsers, userId]);
  };

  return (
    <div
      className={`w-80 flex flex-col bg-background overflow-hidden border border-border rounded-lg shadow-lg ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            autoFocus={!isMobile}
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
          <div className='p-8 text-center text-sm text-muted-foreground'>Loading users...</div>
        ) : finalResults.length > 0 ? (
          <div className='space-y-0.5'>
            {finalResults.map(user => {
              const isSelected = selectedUsers.includes(user.id);
              const displayName = getUserDisplayName(user);
              const isDeactivated = isUserDeactivated(user);
              return (
                <button
                  key={user.id}
                  type='button'
                  onClick={() => handleUserToggle(user.id)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    focus-visible:ring-2 focus-visible:ring-ring
                  `}
                  data-track-category='Tickets'
                  data-track-name='ToggleUserFilter'
                  data-track-metadata={JSON.stringify({
                    userId: user.id,
                    userName: displayName,
                    selected: !isSelected,
                  })}
                >
                  <Avatar userId={user.id} size='sm' className='shrink-0' />
                  <div className='flex-1 text-left min-w-0'>
                    <div className='flex items-center gap-2'>
                      <p
                        className={`text-sm font-medium truncate ${isDeactivated ? 'text-muted-foreground' : ''}`}
                      >
                        {displayName}
                      </p>
                      {isDeactivated && (
                        <span className='text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0'>
                          Deactivated
                        </span>
                      )}
                    </div>
                  </div>
                  {isSelected && <Check className='w-4 h-4 text-muted-foreground shrink-0' />}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-muted-foreground'>
            {searchQuery ? 'No matches found' : 'No users available'}
          </div>
        )}
      </div>
    </div>
  );
};
