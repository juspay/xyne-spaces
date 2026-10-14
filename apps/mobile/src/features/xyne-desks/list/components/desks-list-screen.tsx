import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { AppHeader } from '@/src/components/app-header';

import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useDesksListData } from '../hooks';
import { DesksList } from './desks-list';

export default function DesksListScreen() {
  const router = useRouter();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const { items, isEmpty } = useDesksListData();

  return (
    <View className='flex-1 bg-tabs-screen'>
      <AppHeader absolute className='pb-2' backgroundClassName='bg-tabs-screen'>
        <View className='flex-row flex-1 items-center gap-3'>
          <HeaderBackButton
            liquidGlass
            accessibilityLabel='Go back'
            onPress={() => router.back()}
            iconColor={foregroundColor}
          />
          <AppHeader.Title className='text-foreground'>Xyne Desks</AppHeader.Title>
        </View>
      </AppHeader>

      <DesksList items={items} isEmpty={isEmpty} />
    </View>
  );
}
