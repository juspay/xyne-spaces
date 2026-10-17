import { useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/contexts/AuthContext';
import { haptics } from '@/src/utils/haptics';
import { useRouter } from 'expo-router';
import Avatar from '@/src/components/ui/avatar';
import { PresenceDot } from '@/src/components/ui/presence-dot';

export function DmsHeader(): ReactElement {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: insets.top,
      }}
      className='flex-row items-center justify-between px-4 py-3 bg-spaces-background'
    >
      <Text className='text-[28px] font-semibold text-spaces-foreground'>DMs</Text>
      <View className='flex-row items-center gap-3'>
        <UserProfile />
      </View>
    </View>
  );
}

/** The profile avatar. Shared with the Channels header so the two match. */
export function UserProfile(): ReactElement {
  const { user } = useAuth();
  const router = useRouter();

  const userIds = useMemo(() => (user?.user_id ? [user.user_id] : []), [user?.user_id]);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Your profile'
      hitSlop={8}
      className='items-center justify-center'
      onPress={() => {
        void haptics.buttonTap();
        router.navigate('/settings');
      }}
    >
      <View className='relative'>
        <Avatar userIds={userIds} size={32} />
        <PresenceDot userId={userIds[0] ?? ''} />
      </View>
    </Pressable>
  );
}
