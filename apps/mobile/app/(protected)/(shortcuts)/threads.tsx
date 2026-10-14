import { AppHeader } from '@/src/components/app-header';
import { AllThreadsList } from '@/src/components/chat/all-threads-list';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { HeaderBackButton } from '@/src/components/ui/header-icon-button';

export default function ThreadsScreen() {
  const router = useRouter();

  return (
    <View className='flex-1 bg-primary-bg'>
      <AppHeader>
        <View className='flex-row flex-1 items-center gap-3'>
          <HeaderBackButton
            liquidGlass
            accessibilityLabel='Go back'
            onPress={() => router.back()}
          />
          <AppHeader.Title>Threads</AppHeader.Title>
        </View>
        <View className='flex-row items-center gap-4'>
          <AppHeader.UserGuide />
          <AppHeader.UserProfile />
        </View>
      </AppHeader>

      <AllThreadsList />
    </View>
  );
}
