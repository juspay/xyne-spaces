import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, Users } from 'lucide-react';
import { createBuilder } from '@rocicorp/zero';
import { schema } from '@xyne/shared';
import { Button } from '../../../../ui/Button';
import Input from '../../../../ui/Input/Input';
import { useRawQuery } from '../../../../../hooks/useQuery';

const builder = createBuilder(schema);

interface UserGroupSubmenuProps {
  selectedGroups: string[];
  onChange: (groupIds: string[]) => void;
  onClose: () => void;
  availableUserGroups?: string[] | undefined;
}

export const UserGroupSubmenu = ({
  selectedGroups,
  onChange,
  availableUserGroups: availableGroupIds,
}: UserGroupSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // When availableGroupIds is provided, fetch those groups directly (with a reasonable limit)
  // Otherwise, use search term to filter server-side with limit
  const [allGroupsRaw] = useRawQuery(
    availableGroupIds && availableGroupIds.length > 0
      ? builder.user_groups.where('id', 'IN', availableGroupIds.slice(0, 10)).orderBy('name', 'asc')
      : searchTerm.trim()
        ? builder.user_groups
            .where('name', 'ILIKE', `%${searchTerm}%`)
            .orderBy('name', 'asc')
            .limit(20)
        : builder.user_groups.orderBy('name', 'asc').limit(10),
    'user_groups_submenu',
  );

  // Filter groups based on search term client-side when using availableGroupIds
  const allGroups = useMemo(() => {
    if (!allGroupsRaw) return [];

    // If we have availableGroupIds, filter by search term client-side
    if (availableGroupIds && availableGroupIds.length > 0) {
      if (searchTerm.trim()) {
        const searchLower = searchTerm.toLowerCase();
        return allGroupsRaw.filter(
          group =>
            group.name.toLowerCase().includes(searchLower) ||
            group.alias?.toLowerCase().includes(searchLower),
        );
      }
      // Limit to first 20 results when no search term to avoid rendering too many items
      return allGroupsRaw.slice(0, 20);
    }

    // Otherwise, return query results as-is (already filtered server-side with limit)
    return allGroupsRaw;
  }, [allGroupsRaw, availableGroupIds, searchTerm]);

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
  const selectedGroupsData = (allGroups || []).filter(group => selectedGroups.includes(group.id));

  // Available groups from search results
  const availableGroups = searchResults.filter(group => !selectedGroups.includes(group.id));

  return (
    <div className='w-80 bg-white border border-gray-200 rounded-lg shadow-lg'>
      {/* Search Input */}
      <div className='p-3 border-b border-gray-100'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none' />
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
        <div className='p-3 border-b border-gray-100 max-h-40 overflow-y-auto'>
          <div className='text-xs font-medium text-gray-500 mb-2'>Selected</div>
          <div className='space-y-1'>
            {selectedGroupsData.map(group => (
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
                >
                  <X className='w-3 h-3 text-blue-600' />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available Groups */}
      <div className='max-h-64 overflow-y-auto'>
        {!allGroups || (allGroups.length === 0 && selectedGroups.length === 0) ? (
          <div className='p-4 text-center text-sm text-gray-500'>Loading user groups...</div>
        ) : availableGroups.length > 0 ? (
          <div className='p-2'>
            <div className='space-y-1'>
              {availableGroups.map(group => (
                <Button
                  key={group.id}
                  onClick={() => handleGroupToggle(group.id)}
                  variant='ghost'
                  className='flex items-center gap-3 p-2 hover:bg-gray-50 rounded transition-colors w-full justify-start h-auto'
                  type='button'
                >
                  <Users className='w-4 h-4 text-gray-600 flex-shrink-0' />
                  <div className='min-w-0 flex-1 text-left'>
                    <div className='text-sm font-medium text-gray-900 truncate'>{group.name}</div>
                    {group.alias && (
                      <div className='text-xs text-gray-500 truncate'>@{group.alias}</div>
                    )}
                  </div>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className='p-4 text-center text-sm text-gray-500'>
            {searchQuery.trim()
              ? `No groups found matching "${searchQuery}"`
              : 'All groups have been selected'}
          </div>
        )}
      </div>
    </div>
  );
};
