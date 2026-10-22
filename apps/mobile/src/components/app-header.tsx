import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Pressable, Text, View } from 'react-native';

import { useWorkspaceDrawer, WorkspaceAvatar } from '@/src/components/workspace-drawer';
import Avatar from '@/src/components/ui/avatar';
import { PresenceDot } from '@/src/components/ui/presence-dot';
import { haptics } from '@/src/utils/haptics';
import { useAuth } from '@/src/contexts/AuthContext';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { useWorkspaces } from '@/src/hooks/useWorkspaces';
import { cn } from '@/src/utils/cn';
import { useRouter } from 'expo-router';
import { House, type LucideIcon } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { XyneAIStarIcon } from '@/src/components/icons';
import { ConnectionStatusSheet } from '@/src/components/connection-status-sheet';
import { ConnectingSpinner } from '@/src/components/connection-status-sheet/connecting-spinner';
import { useLiveSyncStatus } from '@/src/components/connection-status-sheet/use-live-sync-status';
import { tabRoute } from '@/src/navigation/routes';

const HEADER_AVATAR_SIZE = 32;

type AppHeaderContextValue = {
  openProfileSheet: () => void;
};

const AppHeaderContext = createContext<AppHeaderContextValue | null>(null);

type AppHeaderProps = {
  children: ReactNode;
  /** When true, overlays content with safe-area padding. Default true. */
  absolute?: boolean;
  backgroundClassName?: string;
  className?: string;
};

/** Provides profile/workspace actions without rendering the header bar. */
function AppHeaderHost({ children }: { children: ReactNode }): ReactElement {
  const router = useRouter();

  const openProfileSheet = useCallback(() => {
    router.push('/settings');
  }, [router]);

  const contextValue = useMemo(() => ({ openProfileSheet }), [openProfileSheet]);

  return <AppHeaderContext.Provider value={contextValue}>{children}</AppHeaderContext.Provider>;
}

const AppHeaderRoot = ({
  children,
  absolute = true,
  backgroundClassName,
  className,
}: AppHeaderProps): ReactElement => {
  const { topSafeHeight, headerHeight } = useHeaderHeight();

  const bar = (
    <View
      style={{ height: headerHeight }}
      className={cn('flex-row items-center justify-between px-4', className)}
    >
      {children}
    </View>
  );

  if (absolute) {
    return (
      <AppHeaderHost>
        <View
          className={cn('absolute left-0 right-0', backgroundClassName ?? 'bg-primary-bg')}
          style={{ paddingTop: topSafeHeight, zIndex: 1000 }}
        >
          {bar}
        </View>
      </AppHeaderHost>
    );
  }

  return <AppHeaderHost>{bar}</AppHeaderHost>;
};

type TitleProps = {
  children: ReactNode;
  className?: string | undefined;
};

const Title = memo(function AppHeaderTitle({ children, className }: TitleProps) {
  return <Text className={cn('text-primary-text text-lg font-bold', className)}>{children}</Text>;
});

const UserProfile = memo(function AppHeaderUserProfile() {
  const { user } = useAuth();
  const context = useContext(AppHeaderContext);
  const userIds = useMemo(() => (user?.user_id ? [user.user_id] : []), [user?.user_id]);
  const [primaryUserId] = userIds;

  if (primaryUserId === undefined) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Your profile'
      hitSlop={8}
      className='items-center justify-center'
      onPress={() => {
        void haptics.buttonTap();
        context?.openProfileSheet();
      }}
    >
      <View className='relative'>
        <Avatar userIds={userIds} size={HEADER_AVATAR_SIZE} />
        <PresenceDot userId={primaryUserId} />
      </View>
    </Pressable>
  );
});

const WorkspaceSwitcher = memo(function AppHeaderWorkspaceSwitcher() {
  const { user } = useAuth();
  const { workspaces } = useWorkspaces();
  // The drawer wraps the tab navigator, above this header but around it, so the
  // control reaches it directly rather than through the header's own context.
  const drawer = useWorkspaceDrawer();
  const currentWorkspace = useMemo(
    () => workspaces.find(workspace => workspace.id === user?.workspaceId),
    [user?.workspaceId, workspaces],
  );
  const workspaceName = currentWorkspace?.name ?? 'Workspace';

  if (!user?.workspaceId) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Current workspace: ${workspaceName}`}
      hitSlop={8}
      className='items-center justify-center'
      onPress={() => {
        void haptics.buttonTap();
        drawer?.open();
      }}
    >
      <WorkspaceAvatar name={workspaceName} size={HEADER_AVATAR_SIZE} />
    </Pressable>
  );
});

const HOME_HREF = tabRoute('dms');

type RoundButtonProps = {
  icon: LucideIcon;
  accessibilityLabel: string;
  accessibilityHint: string;
  onPress: () => void;
};

/**
 * A circular header control with the avatar's footprint and a faint fill so it
 * reads as pressable rather than a loose glyph. Icon and fill both derive from
 * the header title colour, so they stay subtle on the light and dark header.
 */
const RoundButton = ({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: RoundButtonProps): ReactElement => {
  const Icon = icon;
  const iconColor = useCSSVariable('--color-primary-text') as string;
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={8}
      className='items-center justify-center rounded-full bg-primary-text/10 active:bg-primary-text/20'
      style={({ pressed }) => ({
        width: HEADER_AVATAR_SIZE,
        height: HEADER_AVATAR_SIZE,
        opacity: pressed ? 0.85 : 1,
      })}
      onPress={() => {
        void haptics.buttonTap();
        onPress();
      }}
    >
      <Icon size={20} color={iconColor} strokeWidth={2.2} />
    </Pressable>
  );
};

/** Opens Xyne AI, like the dashboard's Ask AI button: the gradient star on its own. */
const XyneAI = memo(function AppHeaderXyneAI() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Ask AI'
      accessibilityHint='Ask anything about your workspace'
      hitSlop={8}
      className='items-center justify-center active:opacity-60'
      style={{ width: HEADER_AVATAR_SIZE, height: HEADER_AVATAR_SIZE }}
      onPress={() => {
        void haptics.buttonTap();
        router.push('/xyne-ai');
      }}
    >
      <XyneAIStarIcon size={24} />
    </Pressable>
  );
});

/**
 * Home button for screens that can sit several levels deep (the User Guide).
 * Pops everything above the tabs in one tap instead of one back press per
 * level; falls back to a replace when there is nothing to dismiss.
 */
const Home = memo(function AppHeaderHome() {
  const router = useRouter();
  return (
    <RoundButton
      icon={House}
      accessibilityLabel='Home'
      accessibilityHint='Returns to the main tabs'
      onPress={() => {
        if (router.canDismiss()) {
          router.dismissAll();
        } else {
          router.replace(HOME_HREF);
        }
      }}
    />
  );
});

/**
 * Zero live-sync indicator for the header, mirroring the dashboard's
 * `ZeroConnectionStatus`: a coloured dot for every state, with the state's
 * label and a spinning glyph while connecting. Tapping it opens a sheet that
 * explains what the state means and offers "Refresh connection" (which kicks
 * the state machine to reconnect, exactly as the dashboard does).
 */
const ConnectionStatus = memo(function AppHeaderConnectionStatus() {
  const { stateName, current, reason, refresh } = useLiveSyncStatus();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const isConnecting = stateName === 'connecting';
  const isConnected = stateName === 'connected';
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const { dotColor, label } = current;

  const openSheet = useCallback(() => {
    void haptics.buttonTap();
    setIsSheetOpen(true);
  }, []);

  return (
    <>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`Live sync: ${label}`}
        accessibilityHint='Shows what the connection status means'
        hitSlop={8}
        onPress={openSheet}
        className='flex-row items-center gap-1.5'
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <View className='rounded-full' style={{ width: 8, height: 8, backgroundColor: dotColor }} />
        {/* Connected: just the dot, no text — keeps the header uncluttered. */}
        {!isConnected ? (
          <Text
            className='font-normal'
            style={{ color: foregroundColor, fontSize: 11, lineHeight: 14 }}
          >
            {label}
          </Text>
        ) : null}
        {isConnecting ? <ConnectingSpinner color={foregroundColor} /> : null}
      </Pressable>
      <ConnectionStatusSheet
        isOpen={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        stateName={stateName}
        reason={reason}
        onRefresh={refresh}
      />
    </>
  );
});

export const AppHeader = Object.assign(AppHeaderRoot, {
  Host: AppHeaderHost,
  Title,
  UserProfile,
  XyneAI,
  Home,
  WorkspaceSwitcher,
  ConnectionStatus,
});
