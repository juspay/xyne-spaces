import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  BackHandler,
  InteractionManager,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import { Info, MessageSquare, Phone } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';
import { CallType } from '@xyne/shared';

import Avatar from '@/src/components/ui/avatar';
import { CopyableValue } from '@/src/components/ui/copyable-value';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useAuth } from '@/src/contexts/AuthContext';
import { useCallActions, useIsInCall } from '@/src/hooks/useRoomMachine';
import { useUser } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { ChannelService } from '@/src/services/ChannelService';
import { cn } from '@/src/utils/cn';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

type ChatUserProfileActionsTarget = {
  userId: string;
  displayName?: string | undefined;
  email?: string | undefined;
};

type ChatUserProfileActionsSheetContextValue = {
  openUserProfileActions: (target: ChatUserProfileActionsTarget) => void;
};

const ChatUserProfileActionsSheetContext =
  createContext<ChatUserProfileActionsSheetContextValue | null>(null);

export const useChatUserProfileActionsSheet = (): ChatUserProfileActionsSheetContextValue | null =>
  useContext(ChatUserProfileActionsSheetContext);

type ProviderProps = {
  children: ReactNode;
};

type SheetHostRef = {
  open: (target: ChatUserProfileActionsTarget) => void;
};

type ActionTileProps = {
  icon: ReactElement;
  label: string;
  onPress: () => void;
  pressedBackgroundColor: string;
  disabled?: boolean | undefined;
};

const ActionTile = memo(function ActionTile({
  icon,
  label,
  onPress,
  pressedBackgroundColor,
  disabled = false,
}: ActionTileProps): ReactElement {
  const { theme } = useUniwind();
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{
        color: theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.15)',
        foreground: true,
      }}
      className={cn(
        'flex-1 items-center justify-center overflow-hidden rounded-xl border border-border ~bg-card px-2 py-3',
        disabled ? 'opacity-50' : '',
      )}
      style={({ pressed }) =>
        Platform.OS === 'ios' && pressed && !disabled
          ? { backgroundColor: pressedBackgroundColor }
          : null
      }
    >
      {icon}
      <Text className='mt-2 text-xs font-medium text-foreground' numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

const MountedChatUserProfileActionsSheet = ({
  target,
  onClose,
}: {
  target: ChatUserProfileActionsTarget;
  onClose: () => void;
}): ReactElement => {
  const router = useRouter();
  const { user: authUser, token } = useAuth();
  const user = useUser(target.userId);
  const channelService = useMemo(() => new ChannelService(token), [token]);
  const [busy, setBusy] = useState<'message' | null>(null);
  const { initiateCall } = useCallActions();
  const isInCall = useIsInCall();
  const zero = useZero();
  const { accentText: actionPrimaryColor } = useBubbleAccent();
  const pressedBackgroundColor = useCSSVariable('--color-accent') as string;
  const isOwnProfile = target.userId === authUser?.user_id;
  const isActionDisabled = isOwnProfile;
  const messageBusy = busy === 'message';
  const displayName = user?.name ?? target.displayName ?? 'Unknown user';
  const email = user?.email ?? target.email ?? '';

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) onClose();
    },
    [onClose],
  );

  const handleMessage = useCallback(async (): Promise<void> => {
    if (isOwnProfile || messageBusy) return;
    setBusy('message');
    try {
      const dm = await channelService.createDm({ participantIds: [target.userId] });
      onClose();
      router.push(`/(protected)/chat/${dm.id}`);
    } finally {
      setBusy(null);
    }
  }, [channelService, isOwnProfile, messageBusy, onClose, router, target.userId]);

  const handleCall = useCallback((): void => {
    if (isOwnProfile) return;
    if (isInCall) {
      Alert.alert('Already in a call', 'Please leave your current call first.');
      return;
    }
    onClose();
    initiateCall({ callType: CallType.AUDIO, targetUserIds: [target.userId], zero });
    router.push('/(protected)/native-call');
  }, [initiateCall, isInCall, isOwnProfile, onClose, router, target.userId, zero]);

  const handleOpenProfile = useCallback((): void => {
    onClose();
    router.push(`/profile/${target.userId}`);
  }, [onClose, router, target.userId]);

  return (
    <AppBottomSheet isOpen onOpenChange={handleOpenChange} mode='dynamic' backdropOpacity={0.4}>
      <BottomSheetView>
        <View className='px-5 pt-2 pb-4'>
          <View className='flex-row items-center gap-3'>
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
        </View>

        <View className='flex-row gap-3 px-5 pb-6'>
          <ActionTile
            icon={<MessageSquare size={22} color={actionPrimaryColor} />}
            label='Message'
            onPress={handleMessage}
            pressedBackgroundColor={pressedBackgroundColor}
            disabled={isActionDisabled || messageBusy}
          />
          <ActionTile
            icon={<Info size={22} color={actionPrimaryColor} />}
            label='Info'
            onPress={handleOpenProfile}
            pressedBackgroundColor={pressedBackgroundColor}
            disabled={!target.userId}
          />
          <ActionTile
            icon={<Phone size={22} color={actionPrimaryColor} />}
            label='Call'
            onPress={handleCall}
            pressedBackgroundColor={pressedBackgroundColor}
            disabled={isActionDisabled}
          />
        </View>
      </BottomSheetView>
    </AppBottomSheet>
  );
};

const ChatUserProfileActionsSheetHost = memo(
  forwardRef<SheetHostRef>(function ChatUserProfileActionsSheetHost(_, ref): ReactElement | null {
    const [target, setTarget] = useState<ChatUserProfileActionsTarget | null>(null);
    const pendingOpenRef = useRef<ReturnType<
      typeof InteractionManager.runAfterInteractions
    > | null>(null);

    const closeSheet = useCallback((): void => {
      pendingOpenRef.current?.cancel();
      pendingOpenRef.current = null;
      setTarget(null);
    }, []);

    useEffect(
      () => (): void => {
        pendingOpenRef.current?.cancel();
      },
      [],
    );

    useEffect(() => {
      if (Platform.OS !== 'android' || !target) return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        closeSheet();
        return true;
      });
      return (): void => subscription.remove();
    }, [closeSheet, target]);

    useImperativeHandle(
      ref,
      () => ({
        open: (nextTarget: ChatUserProfileActionsTarget): void => {
          if (!nextTarget.userId) return;
          pendingOpenRef.current?.cancel();
          pendingOpenRef.current = InteractionManager.runAfterInteractions(() => {
            pendingOpenRef.current = null;
            setTarget(nextTarget);
          });
        },
      }),
      [],
    );

    if (!target) return null;
    return <MountedChatUserProfileActionsSheet target={target} onClose={closeSheet} />;
  }),
);

ChatUserProfileActionsSheetHost.displayName = 'ChatUserProfileActionsSheetHost';

export const ChatUserProfileActionsSheetProvider = ({ children }: ProviderProps): ReactElement => {
  const sheetHostRef = useRef<SheetHostRef>(null);

  const openUserProfileActions = useCallback((nextTarget: ChatUserProfileActionsTarget): void => {
    if (!nextTarget.userId) return;
    sheetHostRef.current?.open(nextTarget);
  }, []);

  const contextValue = useMemo(() => ({ openUserProfileActions }), [openUserProfileActions]);

  return (
    <ChatUserProfileActionsSheetContext.Provider value={contextValue}>
      {children}
      <ChatUserProfileActionsSheetHost ref={sheetHostRef} />
    </ChatUserProfileActionsSheetContext.Provider>
  );
};
