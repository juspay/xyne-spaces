import { useRouter, type Href } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useMemo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { AppHeader } from '@/src/components/app-header';
import Avatar from '@/src/components/ui/avatar';
import { PresenceDot } from '@/src/components/ui/presence-dot';
import { useAuth } from '@/src/contexts/AuthContext';
import type { GlobalSearchTab } from '@/src/features/global-search';
import { ChromeBlur } from '@/src/ui/chrome-blur';
import { haptics } from '@/src/utils/haptics';

import { LiveSyncStatus } from './live-sync-status';

/**
 * The title row's height, below the status bar.
 *
 * Fixed rather than measured, because the list under the header needs it on
 * its first frame: a measured height would arrive a frame late and the list
 * would jump by it.
 */
export const SCREEN_HEADER_BAR_HEIGHT = 58;

/** The header's full height, status bar included — what a list pads its top by. */
export function useScreenHeaderHeight(): number {
  return useSafeAreaInsets().top + SCREEN_HEADER_BAR_HEIGHT;
}

const AVATAR_SIZE = 32;
const SEARCH_ICON_SIZE = 22;

type ScreenHeaderProps = {
  title: string;
  /** The category search opens on, matching what this screen lists. */
  searchTab: GlobalSearchTab;
};

/**
 * The top of a redesigned tab screen: the workspace switcher and its title on
 * the left, then live sync, search and the profile avatar on the right. The
 * switcher opens the same workspace drawer the classic header does. Shared by
 * DMs, Channels and Activity so the three match.
 *
 * Floats over the screen's list rather than sitting above it, so rows scroll
 * up under it and show through its frosted background. The list keeps its
 * first row clear of it by padding its top with `useScreenHeaderHeight`, and
 * the screen wraps the list — not the header — in a `BlurTarget`.
 */
export function ScreenHeader({ title, searchTab }: ScreenHeaderProps): ReactElement {
  const insets = useSafeAreaInsets();
  const background = useCSSVariable('--color-spaces-background') as string;

  return (
    // Takes its own touches: rows scroll under it now, and a tap on an empty
    // stretch of header must not land on the row hidden beneath.
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ChromeBlur variant='header' color={background} />
      <View
        pointerEvents='box-none'
        className='flex-row items-center justify-between px-4'
        style={styles.bar}
      >
        <View className='flex-1 flex-row items-center gap-3'>
          <AppHeader.WorkspaceSwitcher />
          <Text
            numberOfLines={1}
            className='shrink text-[28px] font-semibold text-spaces-foreground'
          >
            {title}
          </Text>
        </View>
        <View className='flex-row items-center gap-4'>
          <LiveSyncStatus />
          <SearchButton tab={searchTab} />
          <UserProfile />
        </View>
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

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  bar: {
    height: SCREEN_HEADER_BAR_HEIGHT,
  },
});
