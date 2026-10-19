import { useRouter, type Href } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { PresenceDot } from '@/src/components/ui/presence-dot';
import { useAuth } from '@/src/contexts/AuthContext';
import type { GlobalSearchTab } from '@/src/features/global-search';
import { haptics } from '@/src/utils/haptics';

const AVATAR_SIZE = 32;
const SEARCH_ICON_SIZE = 22;

type ScreenHeaderProps = {
  title: string;
  /** The category search opens on, matching what this screen lists. */
  searchTab: GlobalSearchTab;
};

/**
 * The top of a redesigned tab screen: its title, then search and the profile
 * avatar on the right. Shared by DMs, Channels and Activity so the three match.
 */
export function ScreenHeader({ title, searchTab }: ScreenHeaderProps): ReactElement {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{ paddingTop: insets.top }}
      className='flex-row items-center justify-between bg-spaces-background px-4 py-3'
    >
      <Text className='text-[28px] font-semibold text-spaces-foreground'>{title}</Text>
      <View className='flex-row items-center gap-4'>
        <SearchButton tab={searchTab} />
        <UserProfile />
      </View>
    </View>
  );
}

/** Opens global search, the same pushed screen the classic search bar opens. */
function SearchButton({ tab }: { tab: GlobalSearchTab }): ReactElement {
  const router = useRouter();
  const foreground = useCSSVariable('--color-spaces-foreground') as string;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Search'
      hitSlop={8}
      className='items-center justify-center active:opacity-60'
      onPress={() => {
        void haptics.buttonTap();
        router.push({
          pathname: '/(protected)/global-search',
          params: { initialTab: tab },
        } as unknown as Href);
      }}
    >
      <Search size={SEARCH_ICON_SIZE} color={foreground} strokeWidth={1.8} />
    </Pressable>
  );
}

/** The signed-in user's avatar. Opens Settings. */
function UserProfile(): ReactElement {
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
        <Avatar userIds={userIds} size={AVATAR_SIZE} />
        <PresenceDot userId={userIds[0] ?? ''} />
      </View>
    </Pressable>
  );
}
