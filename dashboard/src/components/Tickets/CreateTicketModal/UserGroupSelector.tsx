import React, { useState, useMemo } from 'react';
import { Users } from 'lucide-react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';

/**
 * Props for UserGroupSelector component
 */
interface UserGroupSelectorProps {
  /** Currently selected user group ID (null if no group selected) */
  selectedGroupId: string | null;

  /** Callback when group selection changes */
  onGroupSelect: (groupId: string | null) => void;
}

/**
 * UserGroupSelector - A specialized selector for choosing a single user group
 *
 * Features:
 * - Displays all user groups
 * - Client-side search by group name
 * - Built on top of the generic EntitySelector
 *
 * @example
 * <UserGroupSelector
 *   selectedGroupId={formData.userGroupId}
 *   onGroupSelect={(groupId) => form.setFieldValue('userGroupId', groupId)}
 * />
 */
export const UserGroupSelector: React.FC<UserGroupSelectorProps> = ({
  selectedGroupId,
  onGroupSelect,
}) => {
  const [searchValue, setSearchValue] = useState('');

  // ==================== DATA FETCHING ====================

  /**
   * Fetch all user groups
   * Unlike users, we fetch all groups upfront since:
   * 1. The number of groups is typically small (10-50)
   * 2. No server-side search query available for groups
   * 3. Client-side filtering is performant for small datasets
   */
  const [allGroups] = useCachedQuery(queries.getAllUserGroups());

  // ==================== DATA TRANSFORMATION ====================

  /**
   * Filter groups client-side based on search value
   * Then transform to SelectorOption format
   */
  const groupOptions: SelectorOption[] = useMemo(() => {
    if (!allGroups) return [];

    // Filter groups by search value (case-insensitive)
    const filteredGroups = searchValue.trim()
      ? allGroups.filter(group => group.name.toLowerCase().includes(searchValue.toLowerCase()))
      : allGroups;

    // Transform to SelectorOption format
    return filteredGroups.map(group => ({
      value: group.id,
      label: group.name,
      // No subtitle for groups (unlike users who have email)
      icon: <Users className='w-4 h-4 text-gray-600' />,
    }));
  }, [allGroups, searchValue]);

  // ==================== RENDER ====================

  return (
    <EntitySelector
      options={groupOptions}
      selectedValue={selectedGroupId}
      onSelect={onGroupSelect}
      placeholder='Assign Group'
      searchPlaceholder='Search groups...'
      isLoading={false}
      width='auto'
      onSearchChange={setSearchValue}
      disableClientFiltering={true}
    />
  );
};
