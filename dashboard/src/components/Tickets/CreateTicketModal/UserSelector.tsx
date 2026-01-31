import React, { useState, useMemo } from 'react';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { AvatarShape, AvatarSize } from '@juspay/blend-design-system';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { useUserSearch, useUser } from '../../../hooks/useUsers';

/**
 * Props for UserSelector component
 */
interface UserSelectorProps {
  /** Currently selected user ID (null if no user selected) */
  selectedUserId: string | null;

  /** Callback when user selection changes */
  onUserSelect: (userId: string | null) => void;

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
  noBorder,
}) => {
  const [searchValue, setSearchValue] = useState('');

  // ==================== DATA FETCHING ====================

  /**
   * Fetch users based on search value (server-side search)
   * - searchValue is updated by EntitySelector via onSearchChange callback
   * - Database searches ALL users and returns top 15 matches
   * - This enables searching through thousands of users efficiently
   */
  const users = useUserSearch(searchValue, 15);

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
    if (!users) return [];

    return users.map(user => ({
      value: user.id,
      label: user.name || 'Unnamed User',
      subtitle: user.email,
      icon: <UserAvatar userId={user.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
    }));
  }, [users]);

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
      label: selectedUser.name || 'Unnamed User',
      subtitle: selectedUser.email,
      icon: (
        <UserAvatar userId={selectedUser.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />
      ),
    };

    return [selectedOption, ...userOptions];
  }, [selectedUserId, selectedUserData, userOptions]);

  // ==================== RENDER ====================

  return (
    <EntitySelector
      options={optionsWithSelected}
      selectedValue={selectedUserId}
      onSelect={onUserSelect}
      placeholder='Assign User'
      searchPlaceholder='Search users...'
      isLoading={false}
      width='auto'
      onSearchChange={setSearchValue}
      disableClientFiltering={true}
      noBorder={noBorder || false}
    />
  );
};
