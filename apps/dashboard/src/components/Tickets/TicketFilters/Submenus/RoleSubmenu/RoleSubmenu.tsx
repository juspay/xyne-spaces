import { ReactElement, useState, useEffect, useMemo } from 'react';
import { SearchDefault as Search, CheckTickSingle as Check, ChevronDown } from '@xyne/icons';
import Avatar from '../../../../ui/Avatar/Avatar';
import Input from '../../../../ui/Input/Input';
import { useUsers } from '../../../../../hooks/useUsers';
import { useCachedQuery } from '../../../../../hooks/useCachedQuery';
import { queries } from '../../../../../zero/queries';
import type { User } from '../../../../../machines/stateMachine';
import {
  getUserDisplayName,
  isUserDeactivated,
  matchesUserQuery,
} from '../../../../../utils/userDisplayName';
import { usePlatform } from '../../../../../hooks/usePlatform';

export interface RoleAssignmentValue {
  roleId: string;
  userIds: string[];
}

interface RoleSubmenuProps {
  selectedRoles: RoleAssignmentValue[];
  onChange: (value: RoleAssignmentValue[]) => void;
  availableUsers?: string[];
  className?: string;
}

export const RoleSubmenu = ({
  selectedRoles,
  onChange,
  availableUsers: availableUserIds,
  className = '',
}: RoleSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [openRoleId, setOpenRoleId] = useState<string | null>(null);
  const [userSearchByRole, setUserSearchByRole] = useState<Record<string, string>>({});
  const { isMobile } = usePlatform();

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const [roles] = useCachedQuery(queries.roles({}));
  const users = useUsers();

  const usersMap = useMemo(() => new Map<string, User>(users.map(u => [u.id, u])), [users]);

  const selectedByRoleId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const ra of selectedRoles) {
      map.set(ra.roleId, ra.userIds);
    }
    return map;
  }, [selectedRoles]);

  const normalizedAvailableUserIds = useMemo(() => {
    if (!availableUserIds || availableUserIds.length === 0) return null;
    const ids = new Set<string>();
    for (const id of availableUserIds) {
      const rawId = id.replace(/^(user:|group:|userGroup:)/, '');
      ids.add(rawId);
    }
    return ids;
  }, [availableUserIds]);

  const userPool = useMemo(() => {
    let base: User[] = [];
    if (normalizedAvailableUserIds) {
      for (const rawId of normalizedAvailableUserIds) {
        const user = usersMap.get(rawId);
        if (user) base.push(user);
      }
    } else {
      base = users;
    }
    return base;
  }, [users, usersMap, normalizedAvailableUserIds]);

  const visibleRoles = useMemo(() => {
    const list = roles ?? [];
    const searchLower = searchTerm.toLowerCase().trim();
    if (!searchLower) return list.slice(0, 10);
    return list.filter(r => r.name.toLowerCase().includes(searchLower)).slice(0, 30);
  }, [roles, searchTerm]);

  const handleUserToggle = (roleId: string, userId: string): void => {
    const current = selectedByRoleId.get(roleId) ?? [];
    const isSelected = current.includes(userId);
    const next = selectedRoles.filter(ra => ra.roleId !== roleId);
    if (isSelected) {
      const updated = current.filter(id => id !== userId);
      if (updated.length > 0) next.push({ roleId, userIds: updated });
    } else {
      next.push({ roleId, userIds: [...current, userId] });
    }
    onChange(next);
  };

  const handleRoleToggle = (roleId: string): void => {
    setOpenRoleId(prev => (prev === roleId ? null : roleId));
    setUserSearchByRole(prev => (prev[roleId] ? prev : { ...prev, [roleId]: '' }));
  };

  const filteredUsersForRole = (roleId: string): User[] => {
    const selected = selectedByRoleId.get(roleId) ?? [];
    const selectedSet = new Set(selected);
    const term = (userSearchByRole[roleId] ?? '').toLowerCase().trim();
    const list = term ? userPool.filter(u => matchesUserQuery(u, term)) : userPool;
    return [...list].sort((a, b) => {
      const aSel = selectedSet.has(a.id) ? 1 : 0;
      const bSel = selectedSet.has(b.id) ? 1 : 0;
      return bSel - aSel;
    });
  };

  return (
    <div
      className={`w-96 flex flex-col bg-background overflow-hidden border border-border rounded-lg shadow-lg ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            autoFocus={!isMobile}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search roles...'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div className='max-h-96 overflow-y-auto p-1'>
        {visibleRoles.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>
            {searchQuery ? 'No matches found' : 'No roles available'}
          </div>
        ) : (
          <div className='space-y-1'>
            {visibleRoles.map(role => {
              const selected = selectedByRoleId.get(role.id) ?? [];
              const selectedSet = new Set(selected);
              const isOpen = openRoleId === role.id;
              const orderedUsers = isOpen ? filteredUsersForRole(role.id).slice(0, 20) : [];
              const userTerm = userSearchByRole[role.id] ?? '';
              return (
                <div key={role.id} className='border border-border rounded-md'>
                  <button
                    type='button'
                    onClick={() => handleRoleToggle(role.id)}
                    className='w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md'
                    data-track-category='Tickets'
                    data-track-name='ToggleRoleFilterSection'
                    data-track-metadata={JSON.stringify({
                      roleId: role.id,
                      roleName: role.name,
                      open: !isOpen,
                    })}
                  >
                    <div className='flex-1 min-w-0 text-left'>
                      <p className='text-sm font-medium truncate'>{role.name}</p>
                      {role.description && (
                        <p className='text-xs text-muted-foreground truncate'>{role.description}</p>
                      )}
                      {selected.length > 0 && (
                        <p className='text-xs text-muted-foreground mt-0.5'>
                          {selected.length} {selected.length === 1 ? 'user' : 'users'} selected
                        </p>
                      )}
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {isOpen && (
                    <div className='p-1.5 space-y-1'>
                      <div className='relative px-1'>
                        <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none' />
                        <Input
                          type='text'
                          value={userTerm}
                          onChange={e =>
                            setUserSearchByRole(prev => ({ ...prev, [role.id]: e.target.value }))
                          }
                          placeholder='Search users...'
                          className='pl-8 h-8 text-xs'
                        />
                      </div>
                      <div className='max-h-40 overflow-y-auto'>
                        {orderedUsers.length === 0 ? (
                          <div className='p-3 text-center text-xs text-muted-foreground'>
                            {userTerm ? 'No users match' : 'No users available'}
                          </div>
                        ) : (
                          orderedUsers.map(user => {
                            const isSelected = selectedSet.has(user.id);
                            const displayName = getUserDisplayName(user);
                            const isDeactivated = isUserDeactivated(user);
                            return (
                              <button
                                key={user.id}
                                type='button'
                                onClick={() => handleUserToggle(role.id, user.id)}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all outline-none ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'} focus-visible:ring-2 focus-visible:ring-ring`}
                                data-track-category='Tickets'
                                data-track-name='ToggleRoleUserFilter'
                                data-track-metadata={JSON.stringify({
                                  roleId: role.id,
                                  roleName: role.name,
                                  userId: user.id,
                                  userName: displayName,
                                  selected: !isSelected,
                                })}
                              >
                                <Avatar userId={user.id} size='sm' className='shrink-0' />
                                <div className='flex-1 text-left min-w-0'>
                                  <div className='flex items-center gap-1.5'>
                                    <p
                                      className={`text-xs font-medium truncate ${isDeactivated ? 'text-muted-foreground' : ''}`}
                                    >
                                      {displayName}
                                    </p>
                                    {isDeactivated && (
                                      <span className='text-[10px] text-muted-foreground bg-muted px-1 py-0.5 rounded shrink-0'>
                                        Deactivated
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {isSelected && (
                                  <Check className='w-3.5 h-3.5 text-muted-foreground shrink-0' />
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default RoleSubmenu;
