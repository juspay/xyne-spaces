import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { UnreadCountBadge } from '@/src/components/ui/unread-count-badge';
import { useAuth } from '@/src/contexts/AuthContext';
import { useWorkspaces } from '@/src/hooks/useWorkspaces';
import { useWorkspaceNotificationCounts } from '@/src/hooks/useWorkspaceNotificationCounts';
import type { WorkspaceItem } from '@/src/services/AuthServices';
import { haptics } from '@/src/utils/haptics';

import { WorkspaceAvatar } from './workspace-avatar';

const ROW_AVATAR_SIZE = 40;

function WorkspaceRow({
  workspace,
  isActive,
  isSwitching,
  unreadCount,
  onPress,
}: {
  workspace: WorkspaceItem;
  isActive: boolean;
  isSwitching: boolean;
  unreadCount: number;
  onPress: () => void;
}): ReactElement {
  const activeBg = useCSSVariable('--color-secondary') as string;

  return (
    <Pressable
      className='flex-row items-center gap-3 rounded-xl px-3 py-2.5 active:opacity-60'
      style={isActive ? { backgroundColor: activeBg } : undefined}
      onPress={() => {
        void haptics.selection();
        onPress();
      }}
      disabled={isActive}
      accessibilityRole='button'
      accessibilityState={{ selected: isActive, disabled: isActive }}
      accessibilityLabel={
        isActive
          ? `${workspace.name}, current workspace`
          : `Switch to ${workspace.name}, ${workspace.orgName}`
      }
    >
      <WorkspaceAvatar name={workspace.name} size={ROW_AVATAR_SIZE} isSelected={isActive} />
      <View className='flex-1 min-w-0'>
        <Text className='text-[15px] font-semibold text-foreground' numberOfLines={1}>
          {workspace.name}
        </Text>
        <Text className='text-[13px] capitalize text-secondary-foreground' numberOfLines={1}>
          {workspace.orgName}
        </Text>
      </View>
      {unreadCount > 0 ? <UnreadCountBadge count={unreadCount} size='sm' /> : null}
      {isSwitching ? <ActivityIndicator size='small' /> : null}
    </Pressable>
  );
}

export function WorkspaceListPanel(): ReactElement {
  const router = useRouter();
  const { user, switchWorkspace } = useAuth();
  const { workspaces, isLoading, error, refetch } = useWorkspaces();
  const { countsByWorkspaceId } = useWorkspaceNotificationCounts();
  const foreground = useCSSVariable('--color-foreground') as string;
  // The app's list divider, shared with `ui/settings-list`. `--color-border`
  // is a control outline (#404040 in dark) and reads as a hard rule here.
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  const secondaryBg = useCSSVariable('--color-secondary') as string;

  const currentWorkspaceId = user?.workspaceId ?? '';
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const isSwitching = switchingWorkspaceId !== null;

  const orderedWorkspaces = useMemo(() => {
    // The workspace you are in leads the list, the way Slack pins the active
    // team to the top of its switcher.
    const current = workspaces.filter(workspace => workspace.id === currentWorkspaceId);
    const others = workspaces.filter(workspace => workspace.id !== currentWorkspaceId);
    return [...current, ...others];
  }, [currentWorkspaceId, workspaces]);

  const handleSwitch = useCallback(
    async (workspaceId: string): Promise<void> => {
      if (workspaceId === currentWorkspaceId || isSwitching) {
        return;
      }

      setSwitchingWorkspaceId(workspaceId);
      setSwitchError(null);
      try {
        // Nothing runs after this on success: applying the new session bumps
        // `workspaceSessionKey`, which remounts the shell and brings the drawer
        // back closed on its own. Only the failure path stays on this tree, and
        // it wants the drawer still open so the message below is visible.
        await switchWorkspace(workspaceId);
      } catch (caught: unknown) {
        setSwitchError(caught instanceof Error ? caught.message : 'Failed to switch workspace.');
        setSwitchingWorkspaceId(null);
      }
    },
    [currentWorkspaceId, isSwitching, switchWorkspace],
  );

  const showLoader = isLoading && workspaces.length === 0;
  const showError = !isLoading && !!error;

  return (
    <View className='flex-1'>
      <Text className='px-5 pb-6 text-2xl font-bold text-foreground'>Workspaces</Text>

      <ScrollView
        className='flex-1'
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {switchError ? (
          <Text className='px-3 pb-2 text-sm text-status-danger' accessibilityLiveRegion='polite'>
            {switchError}
          </Text>
        ) : null}

        {showLoader ? (
          <View className='items-center justify-center py-8'>
            <ActivityIndicator size='small' />
          </View>
        ) : null}

        {showError ? (
          <View className='items-center gap-3 px-3 py-8'>
            <Text className='text-center text-[14px] text-secondary-foreground'>
              Could not load workspaces
            </Text>
            <Pressable
              className='rounded-lg px-4 py-2 active:opacity-60'
              style={{ backgroundColor: secondaryBg }}
              onPress={() => {
                void haptics.buttonTap();
                void refetch();
              }}
              accessibilityRole='button'
              accessibilityLabel='Retry loading workspaces'
            >
              <Text className='text-[14px] font-medium text-foreground'>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        <View
          style={{ opacity: isSwitching ? 0.5 : 1 }}
          pointerEvents={isSwitching ? 'none' : 'auto'}
        >
          {orderedWorkspaces.map(workspace => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              isActive={workspace.id === currentWorkspaceId}
              isSwitching={switchingWorkspaceId === workspace.id}
              unreadCount={countsByWorkspaceId.get(workspace.id) ?? 0}
              onPress={() => void handleSwitch(workspace.id)}
            />
          ))}
        </View>
      </ScrollView>

      <View className='h-px' style={{ backgroundColor: dividerColor }} />
      <Pressable
        className='flex-row items-center gap-3 px-5 py-3.5 active:opacity-60'
        style={{ opacity: isSwitching ? 0.5 : 1 }}
        onPress={() => {
          void haptics.buttonTap();
          // A full page rather than a second drawer view, so the drawer stays
          // open underneath and dismissing lands the user right back on it.
          router.push('/create-workspace');
        }}
        disabled={isSwitching}
        accessibilityRole='button'
        accessibilityLabel='Add a workspace'
      >
        <Plus size={20} color={foreground} strokeWidth={2} />
        <Text className='text-[15px] text-foreground'>Add a workspace</Text>
      </Pressable>
    </View>
  );
}
