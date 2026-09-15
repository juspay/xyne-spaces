import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import SearchUser from '../../../ui/SearchUser/SearchUser';
import { User } from '@xyne/shared';
import { UserFilterProps } from '../types';
import { useUsers } from '../../../../hooks/useUsers';

export const UserFilter = ({
  selectedUsers,
  onChange,
  placeholder,
  className = '',
}: UserFilterProps): ReactElement => {
  const { t } = useTranslation('placeholders');
  // Get selected users data by their IDs (only fetches the selected users, not all users)
  const users = useUsers();
  const selectedUsersData = users.filter(u => selectedUsers.some(v => v === u.id));

  const handleUsersChange = (users: User[]): void => {
    onChange(users.map(user => user.id));
  };

  return (
    <div className={className}>
      <SearchUser
        excludeUserIds={[]}
        selectedUsers={selectedUsersData}
        onUsersChange={handleUsersChange}
        placeholder={placeholder ?? t('tickets.filters.searchUsers')}
        label=''
        hintText=''
        width='280px'
      />
    </div>
  );
};
