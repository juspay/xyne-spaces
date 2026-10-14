import { useLocalSearchParams, Redirect, Stack } from 'expo-router';
import { View } from 'react-native';
import { NativeCallScreen } from '@/src/screens/NativeCallScreenV2';
import { callRuntimeNativeService } from '@/src/services/CallRuntimeNativeService';
import { CallType } from '@xyne/shared';
import { ConnectionState } from 'livekit-client';
import { roomActor } from '@/src/machines/roomMachine';
import { useSelector } from '@xstate/react';
import {
  parseOptionalBooleanRouteParam,
  readSingleRouteParam,
} from '@/src/utils/callMediaSettings';

export default function NativeCallRoute(): React.ReactElement {
  const params = useLocalSearchParams<{
    channelId?: string | string[];
    callType?: string | string[];
    initiateCall?: string | string[];
    initialMicrophoneEnabled?: string | string[];
    initialCameraEnabled?: string | string[];
  }>();
  const channelId = readSingleRouteParam(params.channelId);
  const callType = readSingleRouteParam(params.callType);
  const initiateCall = readSingleRouteParam(params.initiateCall);
  const initialMicrophoneEnabled = parseOptionalBooleanRouteParam(params.initialMicrophoneEnabled);
  const initialCameraEnabled = parseOptionalBooleanRouteParam(params.initialCameraEnabled);

  // Check if we're already connected to this call
  const activeCall = callRuntimeNativeService.getActiveCall();
  const isAlreadyConnected =
    activeCall?.callId === channelId &&
    callRuntimeNativeService.getConnectionState() === ConnectionState.Connected;

  // If there's no channelId and the room is idle, this screen was restored from
  // stale navigation state (expo-router persists the stack between sessions).
  // Redirect away to avoid showing "Call ID not available" on every sign-in.
  const isRoomIdle = useSelector(roomActor, s => s.matches('idle'));
  const isStaleIdle = !channelId && isRoomIdle;
  if (isStaleIdle) {
    console.log('[NativeCallRoute] No channelId and room is idle — stale nav state, redirecting');
    return <Redirect href='/(protected)' />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <NativeCallScreen
        channelId={channelId ?? ''}
        callType={callType === CallType.VIDEO ? CallType.VIDEO : CallType.AUDIO}
        // Only initiate if explicitly requested and not already connected
        shouldInitiateCall={initiateCall === 'true' && !isAlreadyConnected}
        // Pass flag to indicate we're already in this call
        isAlreadyConnected={isAlreadyConnected}
        {...(initialMicrophoneEnabled !== undefined ? { initialMicrophoneEnabled } : {})}
        {...(initialCameraEnabled !== undefined ? { initialCameraEnabled } : {})}
      />
    </View>
  );
}
