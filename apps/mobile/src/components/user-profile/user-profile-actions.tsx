import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Headphones, MessageSquare } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';
import { CallType } from '@xyne/shared';

import { useAuth } from '@/src/contexts/AuthContext';
import { haptics } from '@/src/utils/haptics';
import { useCallActions, useIsInCall } from '@/src/hooks/useRoomMachine';
import { useZero } from '@/src/hooks/useZero';
import { ChannelService } from '@/src/services/ChannelService';
import { cn } from '@/src/utils/cn';

import { useUserProfile } from './user-profile-context';

type ActionsProps = {
  className?: string;
  onMessage?: (channelId: string) => void;
};

const Actions = memo(({ className, onMessage }: ActionsProps): ReactElement | null => {
  const { user, isOwnProfile } = useUserProfile();
  const { token } = useAuth();
  const router = useRouter();
  const zero = useZero();
  const { initiateCall } = useCallActions();
  const isInCall = useIsInCall();
  const channelService = useMemo(() => new ChannelService(token), [token]);
  const [busy, setBusy] = useState<'message' | 'huddle' | null>(null);
  const labelColor = useCSSVariable('--color-settings-label') as string;

  const handleMessage = useCallback(async (): Promise<void> => {
    if (!user || isOwnProfile || busy) return;
    setBusy('message');
    try {
      const dm = await channelService.createDm({ participantIds: [user.id] });
      if (onMessage) {
        onMessage(dm.id);
      } else {
        router.push(`/(protected)/chat/${dm.id}`);
      }
    } finally {
      setBusy(null);
    }
  }, [user, isOwnProfile, busy, channelService, onMessage, router]);

  const handleHuddle = useCallback((): void => {
    if (!user || isOwnProfile || busy) return;
    if (isInCall) {
      Alert.alert('Already in a call', 'Please leave your current call first.');
      return;
    }
    initiateCall({ callType: CallType.AUDIO, targetUserIds: [user.id], zero });
  }, [user, isOwnProfile, busy, initiateCall, zero, isInCall]);

  if (!user || isOwnProfile) return null;

  return (
    <View className={cn('flex-row items-center gap-3', className)}>
      <Pressable
        onPress={() => {
          void haptics.buttonTap();
          handleMessage();
        }}
        disabled={busy !== null}
        className='flex-1 items-center justify-center gap-2 rounded-xl border border-settings-row-divider bg-settings-section-bg py-3 active:bg-secondary'
        accessibilityRole='button'
        accessibilityLabel='Send a direct message'
      >
        <MessageSquare size={22} color={labelColor} />
        <Text className='text-xs font-medium' style={{ color: labelColor }}>
          Message
        </Text>
      </Pressable>
      <Pressable
        onPress={() => {
          void haptics.buttonTap();
          handleHuddle();
        }}
        disabled={busy !== null}
        className='flex-1 items-center justify-center gap-2 rounded-xl border border-settings-row-divider bg-settings-section-bg py-3 active:bg-secondary'
        accessibilityRole='button'
        accessibilityLabel='Start a huddle'
      >
        <Headphones size={22} color={labelColor} />
        <Text className='text-xs font-medium' style={{ color: labelColor }}>
          Huddle
        </Text>
      </Pressable>
    </View>
  );
});
Actions.displayName = 'UserProfile.Actions';

export { Actions };
