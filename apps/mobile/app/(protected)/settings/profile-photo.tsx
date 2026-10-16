import type { ReactElement } from 'react';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import Avatar from '@/src/components/ui/avatar';
import { useUserSnapshot } from '@/src/components/ui/avatar/avatar.utils';
import { useAuth } from '@/src/contexts/AuthContext';
import { useProfilePictureUri } from '@/src/hooks/useProfilePictureUri';
import { useUser } from '@/src/hooks/useUsers';
import { HeaderIconButton } from '@/src/components/ui/header-icon-button';

export default function ProfilePhotoPreviewScreen(): ReactElement {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  // Optional `userId` lets other surfaces (e.g. a DM's conversation info screen)
  // reuse this preview for someone else. Omitted -> the signed-in user, as before.
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const selfUserId = user?.user_id ?? '';
  const userId = userIdParam || selfUserId;
  const isSelf = userId === selfUserId;
  const userData = useUser(userId);
  const avatarUser = useUserSnapshot(userId);
  const picturePath = avatarUser?.picture ?? userData?.picture;
  const pictureUri = useProfilePictureUri(userId, picturePath);
  const previewSize = Math.min(width, 600);

  return (
    <View className='flex-1 bg-black'>
      <Stack.Screen
        options={{ headerShown: false, contentStyle: { backgroundColor: '#000000' } }}
      />

      {pictureUri ? (
        <View pointerEvents='none' style={StyleSheet.absoluteFill}>
          <Image
            source={{ uri: pictureUri }}
            cachePolicy='memory-disk'
            contentFit='cover'
            blurRadius={15}
            transition={180}
            style={[StyleSheet.absoluteFill, styles.reflection]}
          />
          <View style={[StyleSheet.absoluteFill, styles.reflectionScrim]} />
        </View>
      ) : null}

      <View className='absolute inset-0 items-center justify-center'>
        <Avatar userIds={userId ? [userId] : []} size={previewSize} rounded={false} />
      </View>

      <View
        className='absolute left-0 right-0 z-10 min-h-14 flex-row items-center gap-2 px-3'
        style={{ top: insets.top }}
      >
        <HeaderIconButton
          liquidGlass
          accessibilityLabel='Close profile photo'
          onPress={() => router.back()}
        >
          <X size={25} color='#FFFFFF' strokeWidth={2.3} />
        </HeaderIconButton>
        <Text className='flex-1 text-[18px] font-semibold text-white' numberOfLines={1}>
          {userData?.name ?? (isSelf ? user?.name : undefined) ?? 'Profile photo'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  reflection: {
    opacity: 0.64,
    transform: [{ scale: 1.12 }],
  },
  reflectionScrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.40)',
  },
});
