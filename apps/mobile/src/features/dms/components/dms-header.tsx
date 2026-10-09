import { useMemo, type ReactElement } from 'react';
import {
  Pressable,
  //  Pressable,
  Text,
  View,
} from 'react-native';
// import { useRouter } from 'expo-router';
// import { Search } from 'lucide-react-native';
// import { useCSSVariable } from 'uniwind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/contexts/AuthContext';
import { haptics } from '@/src/utils/haptics';
import { useRouter } from 'expo-router';
import Avatar from '@/src/components/ui/avatar';
import { PresenceDot } from '@/src/components/ui/presence-dot';
// import { tabRoute } from '@/src/navigation/routes';
// import { haptics } from '@/src/utils/haptics';

export function DmsHeader(): ReactElement {
  const insets = useSafeAreaInsets();
  // const router = useRouter();
  // const iconColor = useCSSVariable('--color-spaces-foreground') as string;

  return (
    <View
      style={{
        paddingTop: insets.top,
      }}
      className='flex-row items-center justify-between px-4 py-3 bg-spaces-background'
    >
      <Text className='text-[28px] font-semibold text-spaces-foreground'>DMs</Text>
      <View className='flex-row items-center gap-3'>
        {/* <Pressable
          accessibilityRole='button'
          accessibilityLabel='Search'
          hitSlop={8}
          onPress={() => {
            void haptics.buttonTap();
            router.push(tabRoute('search'));
          }}
        >
          <Search size={22} color={iconColor} strokeWidth={2} />
        </Pressable> */}
        <UserProfile />
      </View>
    </View>
  );
}

function UserProfile() {
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
