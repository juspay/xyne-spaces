import React, { useMemo } from 'react';
import { MultiSelect } from '../../ui/MultiSelect';
import { useUsers } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import Avatar from '../../ui/Avatar/Avatar';

interface UserMultiSelectProps {
  label?: string;
  placeholder?: string;
  selectedValues: string[];
  onChange: (values: string[]) => void;
  error?: string;
}

/**
 * UserMultiSelect - A multi-select component for selecting multiple users
 *
 * Features:
 * - Searches users by name and email
 * - Displays user avatar, name, and email
 * - Uses custom MultiSelect with integrated search
 */
export const UserMultiSelect: React.FC<UserMultiSelectProps> = ({
  label,
  placeholder,
  selectedValues,
  onChange,
  error,
}) => {
  // Fetch all users for the dropdown
  const users = useUsers();

  // Transform users to MultiSelect options format with avatar and email
  const userOptions = useMemo(() => {
    if (!users) return [];

    return users.map(user => ({
      value: user.id,
      label: getUserDisplayName(user),
      icon: <Avatar userId={user.id} size='sm' showActiveStatus={false} />,
      subtitle: user.email ?? '',
    }));
  }, [users]);

  return (
    <MultiSelect
      placeholder={placeholder || 'Select users'}
      options={userOptions}
      selectedValues={selectedValues}
      onChange={onChange}
      {...(label && { label })}
      error={error || ''}
    />
  );
};
