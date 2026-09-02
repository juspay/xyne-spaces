import React, { useState, useMemo } from 'react';
import { UserTwo as Users } from '@xyne/icons';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';

const NO_ONE_AVAILABLE = 'No one available for assignment';

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
 * - Flags groups that currently have nobody available to receive tickets
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

  const activeGroups = useMemo(
    () => (allGroups ?? []).filter(group => group.isActive !== false),
    [allGroups],
  );

  const groupIds = useMemo(() => activeGroups.map(group => group.id), [activeGroups]);

  const [groupMembers, groupMembersDetails] = useCachedQuery(
    queries.getUserGroupMembersByGroupIds({ userGroupIds: groupIds }),
  );
  const [assignmentStates, assignmentStatesDetails] = useCachedQuery(
    queries.getUserAssignmentStatesByGroupIds({ userGroupIds: groupIds }),
  );

  // ==================== DATA TRANSFORMATION ====================

  const unavailableGroupIds = useMemo(() => {
    if (groupMembersDetails.type !== 'complete' || assignmentStatesDetails.type !== 'complete') {
      return new Set<string>();
    }

    const activeMemberKeys = new Set(
      (assignmentStates ?? [])
        .filter(state => state.isActiveForAssignment === true)
        .map(state => `${state.userGroupId}#${state.userId}`),
    );

    const groupsWithSomeoneActive = new Set(
      (groupMembers ?? [])
        .filter(member => activeMemberKeys.has(`${member.userGroupId}#${member.userId}`))
        .map(member => member.userGroupId),
    );

    // An empty group has nobody active either, so it lands here too.
    return new Set(groupIds.filter(id => !groupsWithSomeoneActive.has(id)));
  }, [
    groupIds,
    groupMembers,
    groupMembersDetails.type,
    assignmentStates,
    assignmentStatesDetails.type,
  ]);

  /**
   * Filter groups client-side based on search value
   * Then transform to SelectorOption format
   * Only show active groups (isActive !== false)
   */
  const groupOptions: SelectorOption[] = useMemo(() => {
    // Filter groups by search value (case-insensitive)
    const filteredGroups = searchValue.trim()
      ? activeGroups.filter(group => group.name.toLowerCase().includes(searchValue.toLowerCase()))
      : activeGroups;

    // Transform to SelectorOption format
    return filteredGroups.map(group => ({
      value: group.id,
      label: group.name,
      // Groups have no email-style subtitle, so the slot is free for the availability hint
      subtitle: unavailableGroupIds.has(group.id) ? NO_ONE_AVAILABLE : null,
      icon: <Users className='w-4 h-4 text-muted-foreground' />,
    }));
  }, [activeGroups, searchValue, unavailableGroupIds]);

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
