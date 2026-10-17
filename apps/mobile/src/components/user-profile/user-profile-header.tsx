import { memo, type ReactElement } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import Avatar from '@/src/components/ui/avatar';
import { haptics } from '@/src/utils/haptics';

import { useUserProfile } from './user-profile-context';

type HeaderProps = {
  size?: 96 | 124 | 128 | 160;
};

// Matches the account settings avatar (app/(protected)/settings/index.tsx) so a
// profile looks the same whether it is your own or someone else's.
const DEFAULT_AVATAR_SIZE = 124;
const DOT_SIZE = 24;

const Header = memo(({ size = DEFAULT_AVATAR_SIZE }: HeaderProps): ReactElement | null => {
  const { userId, user, isOnline } = useUserProfile();
  const router = useRouter();
  if (!user) return null;

  // The avatar is a circle, so its bottom-right bounding-box corner sits outside
  // the photo. Inset the dot so its centre lands on the rim at 45 degrees.
  const dotInset = Math.round((size / 2) * (1 - 1 / Math.SQRT2) - DOT_SIZE / 2);

  // Same full-screen preview the account settings avatar opens, scoped to the
  // profile being viewed rather than defaulting to the signed-in user.
  const openPhotoPreview = (): void => {
    if (!userId) return;
    router.push({ pathname: '/(protected)/settings/profile-photo', params: { userId } });
  };

  return (
    <View className='items-center'>
      <Pressable
        onPress={() => {
          void haptics.buttonTap();
          openPhotoPreview();
        }}
        accessibilityRole='button'
        accessibilityLabel='Preview profile photo'
        className='relative rounded-full active:opacity-80'
      >
        <Avatar userIds={[userId]} size={size} />
        <View
          style={{ bottom: dotInset, right: dotInset, width: DOT_SIZE, height: DOT_SIZE }}
          className={`absolute rounded-full border-[3px] border-background ${isOnline ? 'bg-green-500' : 'bg-muted'}`}
        />
      </Pressable>
    </View>
  );
});
Header.displayName = 'UserProfile.Header';

export { Header };
