import type { ReactElement } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppHeader } from '@/src/components/app-header';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { overflowTabRoute } from '@/src/navigation/routes';

type GuideScreenHeaderProps = {
  title?: string;
  /**
   * Show the Home button. Off on the hub, where a single back press already
   * leaves the guide; on for topic and guide screens, which sit deeper.
   */
  showHome?: boolean;
};

/**
 * The header the guide screens share: back button, optional title, a Home
 * button that pops the whole guide stack, and the profile avatar. Matches the other pushed screens reachable from More (Bookmarks,
 * Threads), so the guide reads as part of the same family.
 */
export const GuideScreenHeader = ({
  title,
  showHome = true,
}: GuideScreenHeaderProps): ReactElement => {
  const router = useRouter();

  return (
    <AppHeader absolute={false} className='pb-1'>
      <View className='flex-1 flex-row items-center gap-3'>
        <HeaderBackButton
          liquidGlass
          accessibilityLabel='Go back'
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace(overflowTabRoute());
            }
          }}
        />
        {title ? <AppHeader.Title className='text-foreground'>{title}</AppHeader.Title> : null}
      </View>
      <View className='flex-row items-center gap-4'>
        {showHome ? <AppHeader.Home /> : null}
        <AppHeader.UserProfile />
      </View>
    </AppHeader>
  );
};
