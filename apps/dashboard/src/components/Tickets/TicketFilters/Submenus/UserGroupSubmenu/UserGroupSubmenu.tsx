import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import {
  SearchDefault as Search,
  MultipleCrossCancelDefault as X,
  UserTwo as Users,
} from '@xyne/icons';
import { Button } from '../../../../ui/Button';
import Input from '../../../../ui/Input/Input';
import { useUserGroups } from '../../../../../hooks/useUserGroup';
import type { UserGroup } from '../../../../../machines/stateMachine';

interface UserGroupSubmenuProps {
  selectedGroups: string[];
  onChange: (groupIds: string[]) => void;
  onClose: () => void;
}

export const UserGroupSubmenu = ({
  selectedGroups,
  onChange,
}: UserGroupSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const allUserGroups = useUserGroups();

  // Focus search input when component mounts
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Debounced search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchQuery);
    }, 300);

    return (): void => clearTimeout(timer);
  }, [searchQuery]);

  // Filter groups based on search term
  const allGroups = useMemo(() => {
    if (!allUserGroups || allUserGroups.length === 0) return [];

    let filtered = allUserGroups;

    // Filter by search term
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (group: UserGroup) =>
          group.name.toLowerCase().includes(searchLower) ||
          group.alias?.toLowerCase().includes(searchLower),
      );
    }

    // Limit to first 20 results
    return [...filtered]
      .sort((a: UserGroup, b: UserGroup) => a.name.localeCompare(b.name))
      .slice(0, 20);
  }, [allUserGroups, searchTerm]);

  const searchResults = allGroups;

  const handleGroupToggle = (groupId: string): void => {
    const isSelected = selectedGroups.includes(groupId);

    if (isSelected) {
      onChange(selectedGroups.filter(id => id !== groupId));
    } else {
      onChange([...selectedGroups, groupId]);
    }
  };

  const handleRemoveGroup = (groupId: string): void => {
    onChange(selectedGroups.filter(id => id !== groupId));
  };

  // Get selected groups data from all groups, not just search results
  const selectedGroupsData = (allUserGroups || []).filter((group: UserGroup) =>
    selectedGroups.includes(group.id),
  );

  // Available groups from search results
  const availableGroups = searchResults.filter(
    (group: UserGroup) => !selectedGroups.includes(group.id),
  );

  return (
    <div className='w-80 bg-background border border-border rounded-lg shadow-lg'>
      {/* Search Input */}
      <div className='p-3 border-b border-border'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={searchInputRef}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search user groups...'
            className='pl-10'
          />
        </div>
      </div>

      {/* Selected Groups */}
      {selectedGroupsData.length > 0 && (
        <div
          className='p-3 border-b border-border max-h-40 overflow-y-auto'
          onWheel={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
        >
          <div className='text-xs font-medium text-muted-foreground mb-2'>Selected</div>
          <div className='space-y-1'>
            {selectedGroupsData.map((group: UserGroup) => (
              <div
                key={group.id}
                className='flex items-center justify-between p-2 bg-blue-50 border border-blue-200 rounded'
              >
                <div className='flex items-center gap-2 min-w-0 flex-1'>
                  <Users className='w-4 h-4 text-blue-600 flex-shrink-0' />
                  <div className='min-w-0 flex-1'>
                    <div className='text-sm font-medium text-blue-900 truncate'>{group.name}</div>
                    {group.alias && (
                      <div className='text-xs text-blue-700 truncate'>@{group.alias}</div>
                    )}
                  </div>
                </div>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => handleRemoveGroup(group.id)}
                  className='p-1 hover:bg-blue-100 rounded transition-colors flex-shrink-0'
                  title={`Remove ${group.name}`}
                  data-track-category='Tickets'
                  data-track-name='RemoveUserGroupFilter'
                  data-track-metadata={JSON.stringify({ groupId: group.id, groupName: group.name })}
                >
                  <X className='w-3 h-3 text-blue-600' />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available Groups */}
      <div
        className='max-h-64 overflow-y-auto'
        onWheel={e => e.stopPropagation()}
        onTouchMove={e => e.stopPropagation()}
      >
        {!allUserGroups || allUserGroups.length === 0 ? (
          <div className='p-4 text-center text-sm text-muted-foreground'>
            Loading user groups...
          </div>
        ) : availableGroups.length > 0 ? (
          <div className='p-2'>
            <div className='space-y-1'>
              {availableGroups.map((group: UserGroup) => (
                <Button
                  key={group.id}
                  onClick={() => handleGroupToggle(group.id)}
                  variant='ghost'
                  className='flex items-center gap-3 p-2 hover:bg-muted rounded transition-colors w-full justify-start h-auto'
                  type='button'
                  data-track-category='Tickets'
                  data-track-name='ToggleUserGroupFilter'
                  data-track-metadata={JSON.stringify({ groupId: group.id, groupName: group.name })}
                >
                  <Users className='w-4 h-4 text-muted-foreground flex-shrink-0' />
                  <div className='min-w-0 flex-1 text-left'>
                    <div className='text-sm font-medium text-foreground truncate'>{group.name}</div>
                    {group.alias && (
                      <div className='text-xs text-muted-foreground truncate'>@{group.alias}</div>
                    )}
                  </div>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className='p-4 text-center text-sm text-muted-foreground'>
            {searchQuery.trim()
              ? `No groups found matching "${searchQuery}"`
              : 'All groups have been selected'}
          </div>
        )}
      </div>
    </div>
  );
};
