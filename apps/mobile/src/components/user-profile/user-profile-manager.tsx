import { memo, type ReactElement } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import Avatar from '@/src/components/ui/avatar';
import { ListRow, SectionCard, SectionLabel } from '@/src/components/ui/settings-list';
import { useUser } from '@/src/hooks/useUsers';
import { cn } from '@/src/utils/cn';

import { useUserProfile } from './user-profile-context';

type ManagerProps = {
  className?: string;
};

const Manager = memo(({ className }: ManagerProps): ReactElement | null => {
  const { profile } = useUserProfile();
  const managerId = profile?.manager ?? '';
  const manager = useUser(managerId);
  const router = useRouter();

  if (!manager) return null;

  return (
    <View className={cn(className)}>
      <SectionLabel>Manager</SectionLabel>
      <SectionCard>
        <ListRow
          leading={<Avatar userIds={[manager.id]} size={30} rounded={false} />}
          label={manager.name ?? 'Manager'}
          showChevron
          onPress={() => router.push(`/profile/${manager.id}`)}
        />
      </SectionCard>
    </View>
  );
});
Manager.displayName = 'UserProfile.Manager';

export { Manager };
