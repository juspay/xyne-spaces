import { useCallback } from 'react';
import { Alert } from 'react-native';
import { CallType, ChannelScopeType } from '@xyne/shared';

import type { ScheduleCallParticipants } from '@/src/features/schedule-call/hooks/useScheduleCallForm';

import { useCallActions, useIsInCall } from './useRoomMachine';
import { useZero } from './useZero';

/** Starts an audio call with whoever the people picker returned: one channel, or individuals. */
export function useInstantCall(): {
  startCall: (participants: ScheduleCallParticipants) => void;
} {
  const zero = useZero();
  const { initiateCall } = useCallActions();
  const isInCall = useIsInCall();

  const startCall = useCallback(
    ({ users, channel }: ScheduleCallParticipants) => {
      if (!channel && users.length === 0) return;
      if (isInCall) {
        Alert.alert('Already in a call', 'Please leave your current call first.');
        return;
      }
      if (channel) {
        // The picker only offers DEFAULT-scope channels, as the dashboard's instant call does.
        initiateCall({
          callType: CallType.AUDIO,
          channelId: channel.id,
          scopeType: ChannelScopeType.DEFAULT,
          zero,
        });
      } else {
        initiateCall({ callType: CallType.AUDIO, targetUserIds: users.map(u => u.id), zero });
      }
    },
    [initiateCall, isInCall, zero],
  );

  return { startCall };
}
