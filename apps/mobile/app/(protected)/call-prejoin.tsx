import { useCallback } from 'react';
import { Alert } from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { CallType } from '@xyne/shared';

import { CallPreJoinScreen } from '@/src/screens/CallPreJoinScreen';
import { roomActor } from '@/src/machines/roomMachine';
import { callRuntimeNativeService } from '@/src/services/CallRuntimeNativeService';
import type { InitialCallMediaSettings } from '@/src/utils/callMediaSettings';
import { readSingleRouteParam } from '@/src/utils/callMediaSettings';
import { tabRoute } from '@/src/navigation/routes';

export default function CallPreJoinRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    callId?: string | string[];
    callType?: string | string[];
  }>();
  const callId = readSingleRouteParam(params.callId);
  const requestedCallType = readSingleRouteParam(params.callType);
  const callType = requestedCallType === CallType.VIDEO ? CallType.VIDEO : CallType.AUDIO;

  const handleCancel = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(tabRoute('calls'));
  }, [router]);

  const handleJoin = useCallback(
    (settings: InitialCallMediaSettings): boolean => {
      if (!callId) return false;

      const activeCall = callRuntimeNativeService.getActiveCall();
      const connectionState = callRuntimeNativeService.getConnectionState();
      const roomSnapshot = roomActor.getSnapshot();
      const roomIsBusy =
        roomSnapshot.matches('initiating') ||
        roomSnapshot.matches('joining') ||
        roomSnapshot.matches('connecting') ||
        roomSnapshot.matches('connected') ||
        roomSnapshot.matches('disconnecting');
      const currentCallId =
        activeCall?.callId ?? roomSnapshot.context.externalId ?? roomSnapshot.context.callId;
      const runtimeIsBusy = connectionState === 'connecting' || connectionState === 'connected';
      const hasAnotherActiveCall = (roomIsBusy || runtimeIsBusy) && currentCallId !== callId;
      if (hasAnotherActiveCall) {
        Alert.alert('Already in a call', 'Leave your current call before joining a different one.');
        return false;
      }

      router.replace({
        pathname: '/(protected)/native-call',
        params: {
          channelId: callId,
          callType,
          initiateCall: 'false',
          initialMicrophoneEnabled: String(settings.microphoneEnabled),
          initialCameraEnabled: String(settings.cameraEnabled),
        },
      });
      return true;
    },
    [callId, callType, router],
  );

  if (!callId) {
    return <Redirect href={tabRoute('calls')} />;
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <CallPreJoinScreen
        callId={callId}
        callType={callType}
        onJoin={handleJoin}
        onCancel={handleCancel}
      />
    </>
  );
}
