import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { Mic, MicOff, Phone, Video, VideoOff, X } from 'lucide-react-native';
import { CallType } from '@xyne/shared';
import { useCSSVariable, useUniwind } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { useAuth } from '@/src/contexts/AuthContext';
import { useSelectedChatBubbleContentTokens } from '@/src/theme/useSelectedChatBubbleContentTokens';
import type { InitialCallMediaSettings } from '@/src/utils/callMediaSettings';
import { cn } from '@/src/utils/cn';

interface CallPreJoinScreenProps {
  callId: string;
  callType: CallType;
  onJoin: (settings: InitialCallMediaSettings) => boolean;
  onCancel: () => void;
}

type PendingPermission = 'microphone' | 'camera' | null;

function showPermissionBlockedAlert(kind: 'microphone' | 'camera'): void {
  const label = kind === 'microphone' ? 'Microphone' : 'Camera';
  Alert.alert(
    `${label} access is off`,
    `Allow ${label.toLowerCase()} access in Settings if you want to join with it enabled. You can still join with it off.`,
    [
      { text: 'Keep off', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: (): void => {
          void Linking.openSettings();
        },
      },
    ],
  );
}

export function CallPreJoinScreen({
  onJoin,
  onCancel,
}: CallPreJoinScreenProps): React.ReactElement {
  const insets = useRawSafeAreaInsets();
  const { user } = useAuth();
  const { theme } = useUniwind();
  const screenBackgroundColor = useCSSVariable('--color-chat-root-background') as string;
  const foregroundColor = useCSSVariable('--color-chat-foreground') as string;
  const actionForegroundColor = useCSSVariable('--color-accent-foreground') as string;
  const {
    tokens: { ambientActionBg },
  } = useSelectedChatBubbleContentTokens();
  const isFocused = useIsFocused();
  const { height: windowHeight } = useWindowDimensions();
  const cameraDevice = useCameraDevice('front');
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState(
    Camera.getCameraPermissionStatus() === 'granted',
  );
  const [pendingPermission, setPendingPermission] = useState<PendingPermission>(null);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setIsAppActive(state === 'active');
    });
    return (): void => subscription.remove();
  }, []);

  const displayName = user?.name?.trim() || 'You';

  const requestPermission = useCallback(async (kind: 'microphone' | 'camera'): Promise<boolean> => {
    setPendingPermission(kind);
    try {
      const currentStatus =
        kind === 'microphone'
          ? Camera.getMicrophonePermissionStatus()
          : Camera.getCameraPermissionStatus();
      const result =
        currentStatus === 'granted'
          ? currentStatus
          : kind === 'microphone'
            ? await Camera.requestMicrophonePermission()
            : await Camera.requestCameraPermission();
      const granted = result === 'granted';
      if (!granted) {
        showPermissionBlockedAlert(kind);
      }
      return granted;
    } catch {
      Alert.alert(
        `Unable to access ${kind}`,
        `Xyne Spaces could not check ${kind} permission. You can still join with it off.`,
      );
      return false;
    } finally {
      setPendingPermission(null);
    }
  }, []);

  const handleMicrophoneToggle = useCallback(async (): Promise<void> => {
    if (pendingPermission || isJoining) return;
    if (microphoneEnabled) {
      setMicrophoneEnabled(false);
      return;
    }
    if (await requestPermission('microphone')) {
      setMicrophoneEnabled(true);
    }
  }, [isJoining, microphoneEnabled, pendingPermission, requestPermission]);

  const handleCameraToggle = useCallback(async (): Promise<void> => {
    if (pendingPermission || isJoining) return;
    if (cameraEnabled) {
      setCameraEnabled(false);
      return;
    }
    if (!cameraDevice) {
      Alert.alert('Camera unavailable', 'A front camera could not be found on this device.');
      return;
    }
    if (await requestPermission('camera')) {
      setCameraPermissionGranted(true);
      setCameraEnabled(true);
    }
  }, [cameraDevice, cameraEnabled, isJoining, pendingPermission, requestPermission]);

  const handleJoin = useCallback((): void => {
    if (isJoining || pendingPermission) return;
    const didStartJoining = onJoin({ microphoneEnabled, cameraEnabled });
    if (didStartJoining) {
      setIsJoining(true);
    }
  }, [cameraEnabled, isJoining, microphoneEnabled, onJoin, pendingPermission]);

  const cameraPreviewActive =
    cameraEnabled &&
    cameraPermissionGranted &&
    !!cameraDevice &&
    isFocused &&
    isAppActive &&
    !isJoining;
  const previewHeight = Math.max(250, Math.min(470, windowHeight * 0.43));

  return (
    <View
      className='bg-chat-root-background'
      style={{
        flex: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <StatusBar
        barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={screenBackgroundColor}
      />
      <ScrollView
        className='flex-1'
        contentContainerClassName='grow px-5 pb-3'
        showsVerticalScrollIndicator={false}
      >
        <View className='min-h-14 flex-row items-center justify-between'>
          <View className='size-12 items-center justify-center'>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Cancel joining call'
              hitSlop={8}
              onPress={onCancel}
              disabled={isJoining}
              className='size-10 items-center justify-center rounded-full bg-chat-card active:opacity-75 disabled:opacity-50'
            >
              <X size={22} color={foregroundColor} />
            </Pressable>
          </View>
          <View className='size-12 items-center justify-center' />
        </View>

        <View className='items-center pb-[18px] pt-2'>
          <Text className='text-center text-[28px] font-bold leading-[34px] text-chat-foreground'>
            Ready to join?
          </Text>
          <Text className='mt-2 max-w-[330px] text-center text-[15px] leading-[21px] text-chat-foreground-muted'>
            Check your camera and microphone. Nothing is shared until you join.
          </Text>
        </View>

        <View className='flex-1 justify-center py-4'>
          <View
            className='min-h-[250px] w-full max-w-[520px] self-center overflow-hidden rounded-3xl border border-border bg-chat-card'
            style={{ height: previewHeight }}
          >
            {cameraPreviewActive ? (
              <Camera
                style={StyleSheet.absoluteFill}
                device={cameraDevice}
                isActive={cameraPreviewActive}
                resizeMode='cover'
                androidPreviewViewType='texture-view'
              />
            ) : (
              <View className='absolute inset-0 items-center justify-center bg-chat-background'>
                <View className='size-[116px] items-center justify-center rounded-full border border-border bg-chat-card-muted p-1.5'>
                  {user?.user_id ? (
                    <Avatar
                      userIds={[user.user_id]}
                      fallbackUsers={[
                        {
                          id: user.user_id,
                          name: displayName,
                          picture: user.photo_url ?? null,
                        },
                      ]}
                      size={104}
                    />
                  ) : null}
                </View>
                <Text className='mt-4 text-[17px] font-semibold text-chat-foreground'>
                  {displayName}
                </Text>
              </View>
            )}

            <View pointerEvents='box-none' className='absolute inset-x-0 bottom-0 p-4'>
              <View className='flex-row items-end justify-between'>
                <View className='rounded-[10px] border border-border bg-chat-card/90 px-2.5 py-[7px]'>
                  <Text className='text-[13px] font-semibold text-chat-foreground'>You</Text>
                </View>
                <View className='flex-row gap-2.5'>
                  <Pressable
                    accessibilityRole='switch'
                    accessibilityLabel='Microphone'
                    accessibilityState={{ checked: microphoneEnabled }}
                    disabled={!!pendingPermission || isJoining}
                    onPress={() => void handleMicrophoneToggle()}
                    className={cn(
                      'size-[52px] items-center justify-center rounded-full border disabled:opacity-60',
                      microphoneEnabled ? 'border-transparent' : 'border-border bg-chat-card/90',
                    )}
                    style={
                      microphoneEnabled
                        ? { backgroundColor: ambientActionBg, borderColor: ambientActionBg }
                        : undefined
                    }
                  >
                    {pendingPermission === 'microphone' ? (
                      <ActivityIndicator size='small' color={foregroundColor} />
                    ) : microphoneEnabled ? (
                      <Mic size={23} color={actionForegroundColor} />
                    ) : (
                      <MicOff size={23} color={foregroundColor} />
                    )}
                  </Pressable>
                  <Pressable
                    accessibilityRole='switch'
                    accessibilityLabel='Camera'
                    accessibilityState={{ checked: cameraEnabled }}
                    disabled={!!pendingPermission || isJoining}
                    onPress={() => void handleCameraToggle()}
                    className={cn(
                      'size-[52px] items-center justify-center rounded-full border disabled:opacity-60',
                      cameraEnabled ? 'border-transparent' : 'border-border bg-chat-card/90',
                    )}
                    style={
                      cameraEnabled
                        ? { backgroundColor: ambientActionBg, borderColor: ambientActionBg }
                        : undefined
                    }
                  >
                    {pendingPermission === 'camera' ? (
                      <ActivityIndicator size='small' color={foregroundColor} />
                    ) : cameraEnabled ? (
                      <Video size={23} color={actionForegroundColor} />
                    ) : (
                      <VideoOff size={23} color={foregroundColor} />
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </View>

        <View className='mt-auto gap-2.5 pt-4'>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Join call'
            disabled={isJoining || !!pendingPermission}
            onPress={handleJoin}
            className='min-h-[54px] flex-row items-center justify-center gap-[9px] rounded-2xl active:scale-[0.99] active:opacity-[0.85] disabled:opacity-[0.55]'
            style={{ backgroundColor: ambientActionBg }}
          >
            {isJoining ? (
              <ActivityIndicator size='small' color={actionForegroundColor} />
            ) : (
              <Phone size={21} color={actionForegroundColor} />
            )}
            <Text className='text-[17px] font-bold text-accent-foreground'>
              {isJoining ? 'Joining…' : 'Join call'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
