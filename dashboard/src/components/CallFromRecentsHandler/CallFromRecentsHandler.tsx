import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { reactNativeBridge, NativeInboundMessageType } from '../../utils/reactNativeBridge';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import { useAuthContext } from '../../providers/AuthProvider';
import { roomActor } from '../../machines/roomMachine';
import { stateMachineActor } from '../../machines/stateMachine';
import { CallType } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';

interface PendingCall {
  channelId: string;
  callType: CallType;
}

export const CallFromRecentsHandler = (): ReactElement | null => {
  const { user } = useAuthContext();
  const zero = useZero();
  const [pendingCall, setPendingCall] = useState<PendingCall | null>(null);

  const state = stateMachineActor.getSnapshot();
  const channel = pendingCall
    ? state.context.allChannels.find(c => c.id === pendingCall.channelId)
    : null;

  const { displayName, isLoading } = useChannelDisplayName(channel, user?.id || '');

  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return undefined;
    }

    const unsubscribe = reactNativeBridge.on(
      NativeInboundMessageType.START_CALL_FROM_RECENTS,
      (message): void => {
        if (!message.payload || typeof message.payload !== 'object') {
          return;
        }

        // Type-safe payload access - TypeScript knows the payload type from the discriminated union
        const { channelId, callType: payloadCallType } = message.payload;

        if (!channelId || typeof channelId !== 'string') {
          return;
        }

        const callType = payloadCallType === 'VIDEO' ? CallType.VIDEO : CallType.AUDIO;
        setPendingCall({ channelId, callType });
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!pendingCall || !user || !channel) {
      return;
    }

    if (isLoading) {
      return;
    }

    roomActor.send({
      type: 'INITIATE_CALL',
      callType: pendingCall.callType,
      channelId: pendingCall.channelId,
      scopeType: channel.scopeType, // Pass channel type for CallKit filtering
      zero,
      viewMode: 'full',
      callDisplayName: displayName,
    });

    setPendingCall(null);
  }, [pendingCall, user, channel, isLoading, displayName, zero]);

  return null;
};
