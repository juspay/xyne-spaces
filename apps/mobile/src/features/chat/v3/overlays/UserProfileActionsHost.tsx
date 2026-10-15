import { CallType } from '@xyne/shared';
import { Info, MessageSquare, Phone } from 'lucide-react-native';
import { useMemo, useState, type ReactElement } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { CopyableValue } from '@/src/components/ui/copyable-value';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useAuth } from '@/src/contexts/AuthContext';
import { useCallActions, useIsInCall } from '@/src/hooks/useRoomMachine';
import { useUser } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { ChannelService } from '@/src/services/ChannelService';
import { profileActionEnabled, profileCallBlockedReason } from './profileActions';

export type ProfileActionsTarget = {
  userId: string;
  displayName?: string;
  email?: string;
};

export type UserProfileActionsHostProps = {
  target: ProfileActionsTarget | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function UserProfileActionsHost({
  target,
  isOpen,
  onOpenChange,
}: UserProfileActionsHostProps): ReactElement | null {
  if (!target) {
    return null;
  }
  return (
    <MountedUserProfileActionsHost target={target} isOpen={isOpen} onOpenChange={onOpenChange} />
  );
}

function MountedUserProfileActionsHost({
  target,
  isOpen,
  onOpenChange,
}: UserProfileActionsHostProps & { target: ProfileActionsTarget }): ReactElement {
  const router = useRouter();
  const { user: authUser, token } = useAuth();
  const user = useUser(target.userId);
  const channelService = useMemo(() => new ChannelService(token), [token]);
  const { initiateCall } = useCallActions();
  const isInCall = useIsInCall();
  const zero = useZero();
  const accent = useCSSVariable('--color-brand') as string;
  const [busy, setBusy] = useState(false);
  const isOwn = target.userId === authUser?.user_id;
  const flags = { isOwnProfile: isOwn, hasUserId: Boolean(target.userId) };
  const displayName = user?.name ?? target.displayName ?? 'Unknown user';
  const email = user?.email ?? target.email ?? '';
  const close = (): void => onOpenChange(false);

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      mode='dynamic'
      backdropOpacity={0.4}
    >
      <BottomSheetView>
        <View className='px-5 pb-6 pt-2'>
          <View className='mb-4 flex-row items-center gap-3'>
            <Avatar userIds={[target.userId]} size={72} rounded />
            <View className='min-w-0 flex-1'>
              <Text className='text-lg font-semibold text-foreground' numberOfLines={1}>
                {displayName}
              </Text>
              {email ? (
                <CopyableValue
                  value={email}
                  className='mt-0.5'
                  textClassName='text-sm text-secondary-foreground'
                  copyAccessibilityLabel='Copy email address'
                  richEmailCopy
                />
              ) : null}
            </View>
          </View>
          <View className='flex-row gap-3'>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Message'
              disabled={!profileActionEnabled('message', flags) || busy}
              className='flex-1 items-center rounded-xl border border-border bg-card py-3'
              onPress={(): void => {
                if (!profileActionEnabled('message', flags) || busy) {
                  return;
                }
                setBusy(true);
                void channelService
                  .createDm({ participantIds: [target.userId] })
                  .then(dm => {
                    close();
                    router.push(`/(protected)/chat/${dm.id}`);
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <MessageSquare size={22} color={accent} />
              <Text className='mt-2 text-xs font-medium text-foreground'>Message</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Info'
              disabled={!profileActionEnabled('info', flags)}
              className='flex-1 items-center rounded-xl border border-border bg-card py-3'
              onPress={(): void => {
                close();
                router.push(`/profile/${target.userId}`);
              }}
            >
              <Info size={22} color={accent} />
              <Text className='mt-2 text-xs font-medium text-foreground'>Info</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Call'
              disabled={!profileActionEnabled('call', flags)}
              className='flex-1 items-center rounded-xl border border-border bg-card py-3'
              onPress={(): void => {
                const blocked = profileCallBlockedReason(isOwn, isInCall);
                if (blocked === 'own') {
                  return;
                }
                if (blocked === 'in-call') {
                  Alert.alert('Already in a call', 'Please leave your current call first.');
                  return;
                }
                close();
                initiateCall({ callType: CallType.AUDIO, targetUserIds: [target.userId], zero });
                router.push('/(protected)/native-call');
              }}
            >
              <Phone size={22} color={accent} />
              <Text className='mt-2 text-xs font-medium text-foreground'>Call</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheetView>
    </AppBottomSheet>
  );
}
