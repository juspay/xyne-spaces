import { ReactElement, useState, useMemo } from 'react';
import { Search, ShieldCheck, Check } from 'lucide-react';
import { SegmentedToggle } from '../../ui/SegmentedToggle/SegmentedToggle';
import Avatar from '../../ui/Avatar/Avatar';
import { useActiveUserSearch, useUsers } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import type { ApproverEntry, ApproverSelectorProps } from './ApproverSelector.types';

type Tab = 'USERS' | 'ROLES';

export const ApproverSelector = ({
  selectedApprovers,
  onApproversChange,
}: ApproverSelectorProps): ReactElement => {
  const [tab, setTab] = useState<Tab>('USERS');
  const [searchQuery, setSearchQuery] = useState('');

  const handleTabChange = (next: Tab): void => {
    setTab(next);
    setSearchQuery('');
  };

  const [allRoles] = useCachedQuery(queries.roles({}));
  const searchResults = useActiveUserSearch(searchQuery, 10);

  const rolesPool = allRoles ?? [];

  const allUsers = useUsers();
  const usersMap = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  const availableUsersForSearch = useMemo(() => {
    const base = searchResults ?? [];
    const searchLower = searchQuery.toLowerCase().trim();
    if (searchLower) return base;
    // No search query: show selected users (with tick) so they're visible on reopen.
    return selectedApprovers
      .filter(a => a.approverType === 'USER')
      .map(a => usersMap.get(a.approverId))
      .filter((u): u is NonNullable<typeof u> => !!u);
  }, [searchResults, searchQuery, selectedApprovers, usersMap]);

  const availableRolesForSearch = useMemo(() => {
    const searchLower = searchQuery.toLowerCase().trim();
    return rolesPool
      .filter(r => !searchLower || r.name.toLowerCase().includes(searchLower))
      .slice(0, 20);
  }, [rolesPool, searchQuery]);

  const handleAddUser = (userId: string): void => {
    onApproversChange([...selectedApprovers, { approverId: userId, approverType: 'USER' }]);
  };

  const handleToggleUser = (userId: string): void => {
    const existing = selectedApprovers.find(
      s => s.approverType === 'USER' && s.approverId === userId,
    );
    if (existing) {
      handleRemove(existing);
    } else {
      handleAddUser(userId);
    }
  };

  const handleAddRole = (roleId: string): void => {
    onApproversChange([...selectedApprovers, { approverId: roleId, approverType: 'ROLE' }]);
  };

  const handleToggleRole = (roleId: string): void => {
    const existing = selectedApprovers.find(
      s => s.approverType === 'ROLE' && s.approverId === roleId,
    );
    if (existing) {
      handleRemove(existing);
    } else {
      handleAddRole(roleId);
    }
  };

  const handleRemove = (entry: ApproverEntry): void => {
    onApproversChange(
      selectedApprovers.filter(
        s => !(s.approverId === entry.approverId && s.approverType === entry.approverType),
      ),
    );
  };

  return (
    <div className='flex flex-col gap-3 max-h-[400px]'>
      <SegmentedToggle<Tab>
        options={[
          { value: 'USERS', label: 'Users' },
          { value: 'ROLES', label: 'Roles' },
        ]}
        value={tab}
        onChange={handleTabChange}
        className='self-start'
      />

      <div className='relative flex-shrink-0'>
        <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
        <input
          type='text'
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={tab === 'USERS' ? 'Search User' : 'Search Role'}
          className='w-full h-10 pl-10 pr-3 border border-border rounded-lg text-[14px] text-foreground placeholder:text-muted-foreground/50 bg-background focus:outline-none focus:ring-1 focus:ring-[#6276be]'
          data-track-category='board_config'
          data-track-name={tab === 'USERS' ? 'search_user' : 'search_role'}
        />
      </div>

      <div className='flex flex-col gap-3 overflow-y-auto flex-1 min-h-0'>
        {tab === 'USERS' && (
          <div className='flex flex-col'>
            {availableUsersForSearch.length > 0 ? (
              availableUsersForSearch.map(user => {
                const isSelected = selectedApprovers.some(
                  s => s.approverType === 'USER' && s.approverId === user.id,
                );
                return (
                  <button
                    key={user.id}
                    onClick={() => handleToggleUser(user.id)}
                    className='flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors cursor-pointer text-left'
                    data-track-category='board_config'
                    data-track-name='select_approver'
                  >
                    <Avatar userId={user.id} size='sm' />
                    <div className='flex flex-col flex-1 min-w-0'>
                      <span className='text-[14px] font-medium text-foreground'>
                        {getUserDisplayName(user)}
                      </span>
                      <span className='text-[12px] text-muted-foreground truncate'>
                        {user.email}
                      </span>
                    </div>
                    {isSelected && <Check className='w-4 h-4 text-action-primary shrink-0' />}
                  </button>
                );
              })
            ) : (
              <div className='px-3 py-4 text-center text-[13px] text-muted-foreground'>
                {searchQuery.trim() ? 'No users found' : 'Search to add users'}
              </div>
            )}
          </div>
        )}

        {tab === 'ROLES' && (
          <div className='flex flex-col'>
            {availableRolesForSearch.length > 0 ? (
              availableRolesForSearch.map(role => {
                const isSelected = selectedApprovers.some(
                  s => s.approverType === 'ROLE' && s.approverId === role.id,
                );
                return (
                  <button
                    key={role.id}
                    onClick={() => handleToggleRole(role.id)}
                    className='flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors cursor-pointer text-left'
                    data-track-category='board_config'
                    data-track-name='select_approver_role'
                  >
                    <div className='flex items-center justify-center w-8 h-8 rounded-full bg-action-primary/10 text-action-primary shrink-0'>
                      <ShieldCheck className='w-4 h-4' />
                    </div>
                    <div className='flex flex-col min-w-0 flex-1'>
                      <span className='text-[14px] font-medium text-foreground truncate'>
                        {role.name}
                      </span>
                      {role.description && (
                        <span className='text-[12px] text-muted-foreground truncate'>
                          {role.description}
                        </span>
                      )}
                    </div>
                    {isSelected && <Check className='w-4 h-4 text-action-primary shrink-0' />}
                  </button>
                );
              })
            ) : (
              <div className='px-3 py-4 text-center text-[13px] text-muted-foreground'>
                {searchQuery.trim() ? 'No roles found' : 'No roles available'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ApproverSelector;
