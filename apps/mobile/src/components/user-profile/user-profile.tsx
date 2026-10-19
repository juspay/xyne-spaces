import { useMemo, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';

import { UserProfileContext } from './user-profile-context';
import { useUserProfileData } from './utils/useUserProfileData';
import { Header } from './user-profile-header';
import { Identity } from './user-profile-identity';
import { Status } from './user-profile-status';
import { Actions } from './user-profile-actions';
import { Manager } from './user-profile-manager';
import { Contact } from './user-profile-contact';
import { Dates } from './user-profile-dates';
import { CommonChannels } from './user-profile-common-channels';

export { useUserProfile } from './user-profile-context';

type RootProps = {
  userId: string;
  children: ReactNode;
};

const Root = ({ userId, children }: RootProps): ReactElement => {
  const value = useUserProfileData(userId);
  const memoValue = useMemo(() => value, [value]);
  return (
    <UserProfileContext.Provider value={memoValue}>
      <View>{children}</View>
    </UserProfileContext.Provider>
  );
};
Root.displayName = 'UserProfile.Root';

const UserProfile = {
  Root,
  Header,
  Identity,
  Status,
  Actions,
  Manager,
  Contact,
  Dates,
  CommonChannels,
};

export { UserProfile };
