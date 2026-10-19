import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Stack, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCSSVariable } from 'uniwind';

import { HeaderBackButton, HEADER_ICON_BUTTON_SIZE } from '@/src/components/ui/header-icon-button';
import { UserProfile, useUserProfile } from './user-profile';
import { UserProfileSkeleton } from './user-profile-skeleton';

const HEADER_BUTTON_SIZE = HEADER_ICON_BUTTON_SIZE;
const HEADER_VERTICAL_PADDING = 8;
const HEADER_GRADIENT_EXTRA = 16;
const KEYBOARD_BOTTOM_OFFSET = 16;

type UserProfileScreenProps = {
  userId: string;
};

const Body = ({ topInset }: { topInset: number }): ReactElement => {
  const { user, isOwnProfile } = useUserProfile();
  const labelColor = useCSSVariable('--color-settings-label') as string;
  if (!user) return <UserProfileSkeleton />;

  return (
    <KeyboardAwareScrollView
      bottomOffset={KEYBOARD_BOTTOM_OFFSET}
      keyboardShouldPersistTaps='handled'
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: 96, paddingHorizontal: 16 }}
    >
      {isOwnProfile ? (
        <Text className='px-4 pb-2 pt-2 text-2xl font-bold' style={{ color: labelColor }}>
          Profile details
        </Text>
      ) : (
        <View className='items-center px-4 pb-7 pt-2'>
          <UserProfile.Header />
          <UserProfile.Identity className='mt-4' />
          <UserProfile.Status className='mt-2' />
          <UserProfile.Actions className='mt-6 w-full' />
        </View>
      )}

      <UserProfile.Manager />
      <UserProfile.Contact className='mt-7' />
      <UserProfile.Dates className='mt-7' />
      <UserProfile.CommonChannels className='mt-7' />
    </KeyboardAwareScrollView>
  );
};

const UserProfileScreen = ({ userId }: UserProfileScreenProps): ReactElement => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Single surface colour for every profile page, own or otherwise, matching the
  // conversation info / account settings screens.
  const backgroundColor = useCSSVariable('--color-settings-bg') as string;

  const headerHeight = HEADER_BUTTON_SIZE + 2 * HEADER_VERTICAL_PADDING;
  const gradientHeight = insets.top + headerHeight + HEADER_GRADIENT_EXTRA;
  const bodyTopInset = insets.top + headerHeight;

  return (
    <View style={{ flex: 1, backgroundColor }}>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor } }} />
      <UserProfile.Root userId={userId}>
        <Body topInset={bodyTopInset} />

        {/* Floating header — fades the surface behind the back button as content scrolls under it */}
        <LinearGradient
          colors={[backgroundColor, 'transparent']}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: gradientHeight,
          }}
          pointerEvents='none'
        />
        <View
          className='absolute left-0 right-0 flex-row items-center px-2'
          style={{ top: insets.top, paddingVertical: HEADER_VERTICAL_PADDING }}
          pointerEvents='box-none'
        >
          <HeaderBackButton liquidGlass onPress={() => router.back()} />
        </View>
      </UserProfile.Root>
    </View>
  );
};
UserProfileScreen.displayName = 'UserProfileScreen';

export { UserProfileScreen };
