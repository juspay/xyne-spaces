import React, { useState, useMemo } from 'react';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { AvatarShape, AvatarSize } from '../../UserAvatar/UserAvatar';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { useActiveUsers, useUser, useSelf } from '../../../hooks/useUsers';
import { getUserDisplayName, withYouLabel, matchesUserQuery } from '../../../utils/userDisplayName';
import { useChannelAssignGate } from '../../../hooks/useChannelAssignGate';
import { channelMembersFirst, currentUserFirst } from '../../../utils/channelMembersFirst';

/**
 * Props for UserSelector component
 */
interface UserSelectorProps {
  /** Currently selected user ID (null if no user selected) */
  selectedUserId: string | null;

  /** Callback when user selection changes */
  onUserSelect: (userId: string | null) => void;
  channelId?: string | undefined;

  noBorder?: boolean;
}

/**
 * UserSelector - A specialized selector for choosing a single user
 *
 * Features:
 * - Searches users by name and email
 * - Displays user avatar, name, and email
 * - Built on top of the generic EntitySelector
 *
 * @example
 * <UserSelector
 *   selectedUserId={formData.assignedTo}
 *   onUserSelect={(userId) => form.setFieldValue('assignedTo', userId)}
 * />
 */
export const UserSelector: React.FC<UserSelectorProps> = ({
  selectedUserId,
  onUserSelect,
  channelId,
  noBorder,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const { shouldGate, memberIds, gatedAssign } = useChannelAssignGate(channelId);

  // ==================== DATA FETCHING ====================

  // Full active-user list (in-memory Zero cache). We filter and rank it
  // ourselves below so channel members are actually present to float to the
  // top — a pre-sliced search (top-N) would drop them before we could rank.
  const activeUsers = useActiveUsers();
  const selfId = useSelf()?.id;

  /**
   * Fetch the selected user's details (for displaying in the button)
   * Only fetch if a user is selected
   */
  const selectedUserData = useUser(selectedUserId || '');
  // ==================== DATA TRANSFORMATION ====================

  /**
   * Transform users from Zero query into SelectorOption format
   * This is the "adapter" pattern - converting one data shape to another
   */
  const userOptions: SelectorOption[] = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    const matched = !query
      ? activeUsers
      : activeUsers.filter(user => matchesUserQuery(user, searchValue));
    // You first, then channel members, then everyone else; cap the rendered
    // rows since this list isn't virtualized.
    const membersFirst = channelMembersFirst(matched, user => user.id, memberIds);
    const ordered = currentUserFirst(membersFirst, user => user.id, selfId);
    return ordered.slice(0, 25).map(user => ({
      value: user.id,
      label: withYouLabel(getUserDisplayName(user), user.id === selfId),
      subtitle: user.email,
      icon: <UserAvatar userId={user.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
      badge: shouldGate && !memberIds.has(user.id) ? 'Not in channel' : undefined,
    }));
  }, [activeUsers, searchValue, shouldGate, memberIds, selfId]);

  /**
   * If a user is selected but not in the search results,
   * add them to the options so they appear in the button
   */
  const optionsWithSelected = useMemo(() => {
    // If no user is selected, just return the search results
    if (!selectedUserId || !selectedUserData) {
      return userOptions;
    }

    const selectedUser = selectedUserData;
    if (!selectedUser) {
      return userOptions;
    }

    // Check if selected user is already in the options
    const isSelectedInOptions = userOptions.some(opt => opt.value === selectedUserId);

    // If selected user is already in options, return as-is
    if (isSelectedInOptions) {
      return userOptions;
    }

    // Otherwise, add selected user to the beginning of the list
    const selectedOption: SelectorOption = {
      value: selectedUser.id,
      label: getUserDisplayName(selectedUser),
      subtitle: selectedUser.email,
      icon: (
        <UserAvatar userId={selectedUser.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />
      ),
      badge: shouldGate && !memberIds.has(selectedUser.id) ? 'Not in channel' : undefined,
    };

    return [selectedOption, ...userOptions];
  }, [selectedUserId, selectedUserData, userOptions, shouldGate, memberIds]);
  const handleSelect = (userId: string | null): void => {
    if (!userId) {
      onUserSelect(null);
      return;
    }
    const name = optionsWithSelected.find(o => o.value === userId)?.label ?? 'This user';
    gatedAssign({ userId, userName: name, assign: () => onUserSelect(userId) });
  };

  // ==================== RENDER ====================

  return (
    <EntitySelector
      options={optionsWithSelected}
      selectedValue={selectedUserId}
      onSelect={handleSelect}
      placeholder='Assign User'
      searchPlaceholder='Search users...'
      isLoading={false}
      width='auto'
      onSearchChange={setSearchValue}
      disableClientFiltering={true}
      noBorder={noBorder || false}
      showUnassignOption={true}
    />
  );
};
