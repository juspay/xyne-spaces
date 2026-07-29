import React, { useState, useMemo } from 'react';
import { Users } from 'lucide-react';
import { useUserGroups } from '../../../hooks/useUserGroup';
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
 * - Displays active user groups (deactivated groups are hidden)
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
   * Get all user groups from x-state
   * Only show active groups for ticket assignment
   */
  const allGroups = useUserGroups();

  // ==================== DATA TRANSFORMATION ====================

  /**
   * Filter groups client-side based on search value
   * Then transform to SelectorOption format
   * Only show active groups (isActive !== false)
   */
  const groupOptions: SelectorOption[] = useMemo(() => {
    if (!allGroups) return [];

    // Filter out deactivated groups
    const activeGroups = allGroups.filter(group => group.isActive !== false);

    // Filter groups by search value (case-insensitive)
    const filteredGroups = searchValue.trim()
      ? activeGroups.filter(group => group.name.toLowerCase().includes(searchValue.toLowerCase()))
      : activeGroups;

    // Transform to SelectorOption format
    return filteredGroups.map(group => ({
      value: group.id,
      label: group.name,
      // No subtitle for groups (unlike users who have email)
      icon: <Users className='w-4 h-4 text-muted-foreground' />,
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
