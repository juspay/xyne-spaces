import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { cn } from '@/src/utils/cn';

import { useUserProfile } from './user-profile-context';

type IdentityProps = {
  className?: string;
};

const Identity = memo(({ className }: IdentityProps): ReactElement | null => {
  const { user, profile } = useUserProfile();
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  if (!user) return null;

  return (
    <View className={cn('items-center', className)}>
      <Text
        className='max-w-[90%] text-center text-2xl font-bold'
        style={{ color: labelColor }}
        numberOfLines={2}
      >
        {user.name ?? 'Unknown User'}
      </Text>
      {profile?.team ? (
        <Text
          className='mt-1 text-center text-sm'
          style={{ color: descriptionColor }}
          numberOfLines={1}
        >
          {profile.team}
        </Text>
      ) : null}
    </View>
  );
});
Identity.displayName = 'UserProfile.Identity';

export { Identity };
