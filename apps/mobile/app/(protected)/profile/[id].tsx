import type { ReactElement } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { UserProfileScreen } from '@/src/components/user-profile';

const ProfileByIdScreen = (): ReactElement => {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <UserProfileScreen userId={id ?? ''} />;
};

export default ProfileByIdScreen;
