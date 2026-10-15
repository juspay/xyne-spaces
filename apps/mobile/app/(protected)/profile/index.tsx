import type { ReactElement } from 'react';

import { useSelf } from '@/src/hooks/useUsers';
import { UserProfileScreen, UserProfileSkeleton } from '@/src/components/user-profile';

const ProfileIndexScreen = (): ReactElement => {
  const me = useSelf();

  if (!me) {
    return <UserProfileSkeleton />;
  }

  return <UserProfileScreen userId={me.id} />;
};

export default ProfileIndexScreen;
