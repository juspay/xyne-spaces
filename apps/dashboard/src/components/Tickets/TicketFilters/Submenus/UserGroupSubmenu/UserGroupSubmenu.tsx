import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { Search, Check, Users } from 'lucide-react';
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

    // Limit to first 50 results
    return [...filtered]
      .sort((a: UserGroup, b: UserGroup) => a.name.localeCompare(b.name))
      .slice(0, 50);
  }, [allUserGroups, searchTerm]);

  const handleGroupToggle = (groupId: string): void => {
    const isSelected = selectedGroups.includes(groupId);
    onChange(
      isSelected ? selectedGroups.filter(id => id !== groupId) : [...selectedGroups, groupId],
    );
  };

  // Sort selected to top, matching other filter submenus
  const sortedGroups = useMemo(() => {
    const selectedSet = new Set(selectedGroups);
    return [...allGroups].sort((a, b) => {
      const aSel = selectedSet.has(a.id) ? 1 : 0;
      const bSel = selectedSet.has(b.id) ? 1 : 0;
      if (aSel !== bSel) return bSel - aSel;
      return a.name.localeCompare(b.name);
    });
  }, [allGroups, selectedGroups]);

  const allVisibleSelected =
    allGroups.length > 0 && allGroups.every(g => selectedGroups.includes(g.id));

  const handleSelectAllToggle = (): void => {
    if (allVisibleSelected) {
      const visibleIds = new Set(allGroups.map(g => g.id));
      onChange(selectedGroups.filter(id => !visibleIds.has(id)));
    } else {
      const merged = new Set([...selectedGroups, ...allGroups.map(g => g.id)]);
      onChange([...merged]);
    }
  };

  return (
    <div className='w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden'>
      {/* Search Input */}
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={searchInputRef}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search user groups...'
            className='pl-9 h-9'
          />
        </div>
      </div>

      {/* Group List */}
      <div
        className='max-h-80 overflow-y-auto p-1'
        role='listbox'
        aria-multiselectable='true'
        onWheel={e => e.stopPropagation()}
        onTouchMove={e => e.stopPropagation()}
      >
        {!allUserGroups || allUserGroups.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>
            Loading user groups...
          </div>
        ) : allGroups.length > 0 ? (
          <div className='space-y-0.5'>
            {/* Select All Toggle */}
            <button
              type='button'
              onClick={handleSelectAllToggle}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                ${allVisibleSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                focus-visible:ring-2 focus-visible:ring-ring border-b border-border/50
              `}
              data-track-category='Tickets'
              data-track-name='ToggleSelectAllUserGroups'
            >
              <span className='flex-1 text-left text-sm font-medium text-primary'>
                {allVisibleSelected ? 'Deselect all' : 'Select all'}
              </span>
              {allVisibleSelected && (
                <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
              )}
            </button>

            {sortedGroups.map(group => {
              const isSelected = selectedGroups.includes(group.id);
              return (
                <button
                  key={group.id}
                  type='button'
                  onClick={() => handleGroupToggle(group.id)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    focus-visible:ring-2 focus-visible:ring-ring
                  `}
                  data-track-category='Tickets'
                  data-track-name='ToggleUserGroupFilter'
                  data-track-metadata={JSON.stringify({ groupId: group.id, groupName: group.name })}
                >
                  <Users className='w-4 h-4 text-muted-foreground shrink-0' />
                  <div className='flex-1 text-left min-w-0'>
                    <span className='text-sm font-medium truncate block'>{group.name}</span>
                    {group.alias && (
                      <span className='text-xs text-muted-foreground truncate block'>
                        @{group.alias}
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-muted-foreground'>
            {searchQuery.trim()
              ? `No groups found matching "${searchQuery}"`
              : 'No user groups available'}
          </div>
        )}
      </div>

      {/* Selected count footer */}
      {selectedGroups.length > 0 && (
        <div className='p-3 border-t bg-muted'>
          <div className='text-xs text-muted-foreground'>
            {selectedGroups.length} group{selectedGroups.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      )}
    </div>
  );
};
