import { useCallback } from 'react';
import { toast } from 'sonner';
import { CallType, CallOrigin, type Call } from '@xyne/shared';
import { channelService } from '../services/Chat/channelService';
import { mutators } from '../zero/mutators';
import { roomActor } from '../machines/roomMachine';
import { reactNativeBridge } from '../utils/reactNativeBridge';
import { useAuth } from './useAuth';
import { useZero } from './useZero';
import { usePlatform } from './usePlatform';
import { isCallWindowActive } from '../utils/callWindowChannel';
import {
  openInitiateCallWindow,
  openJoinCallWindow,
  shouldUseCallWindow,
} from '../routes/CallWindow/callWindowLauncher';

// INITIATE_CALL is only handled in the machine's `idle` state; if we're already in
// (or starting) a call, XState silently drops it. Guard so callers can bail *before*
// any createDm, leaving no dangling channel for a call that never starts.
const ensureRoomIdle = (): boolean => {
  if (isCallWindowActive()) {
    toast.error('Leave your current call before starting a new one.');
    return false;
  }
  if (roomActor.getSnapshot().matches('idle')) return true;
  toast.error('Leave your current call before starting a new one.');
  return false;
};

// A channel's live call = the CHANNEL-origin ACTIVE call on that channel. Shared by the
// "already live?" check (join directly) and joinOrStartCall's join-vs-initiate branch.
// Match CHANNEL explicitly rather than excluding CONVERSATION — the query is ordered
// newest-first, so "anything but a thread call" follows a calendar call that started
// later. CHANNEL is what the backend converges on in findActiveCallByChannelId.
const findLiveChannelCall = (channelId: string): Call | undefined =>
  roomActor
    .getSnapshot()
    .context.activeCalls.find(
      call => call.channelId === channelId && call.callOrigin === CallOrigin.CHANNEL,
    );

interface UseQuickCallReturn {
  /** Call a single user: resolve/create the 1:1 DM, then start the call. */
  startCall: (userId: string, displayName: string) => void;
  /** Call an existing channel by id — no DM creation, no target user list. */
  startChannelCall: (channelId: string, displayName: string) => void;
  /** True if a (non-thread) call is already live on the channel — caller can join directly. */
  hasActiveChannelCall: (channelId: string) => boolean;
  /** True if the room is idle; otherwise toasts "leave your current call" and returns false. */
  ensureRoomIdle: () => boolean;
}

/**
 * Start an audio call without navigating, straight against the global room machine.
 *
 * Talks to the `roomActor` singleton imperatively rather than through a mounted
 * `useCallActions` effect, because the caller (the Cmd+K menu) unmounts immediately
 * after triggering the call — a mounted-effect approach would never fire.
 */
export const useQuickCall = (): UseQuickCallReturn => {
  const { user: currentUser } = useAuth();
  const zero = useZero();
  const { isMobile } = usePlatform();

  // Shared tail: request native media permissions (matching useCallActions), then either JOIN a
  // call already live on the channel or INITIATE a new one. Joining first avoids creating a
  // duplicate call when the channel is already ringing. `targetUserIds` is omitted for channel calls.
  const joinOrStartCall = useCallback(
    (channelId: string, displayName: string, targetUserIds?: string[]): void => {
      if (reactNativeBridge.isAvailable()) {
        reactNativeBridge.requestMediaPermissions({
          permissions: ['microphone', 'camera', 'screenShare'],
        });
      }
      const viewMode = isMobile ? 'full' : 'mini';
      // CONVERSATION-origin calls are message-thread calls, not the channel call — exclude them
      // (mirrors useCallActions' currentChannelCall lookup).
      const activeCall = findLiveChannelCall(channelId);

      if (shouldUseCallWindow(isMobile)) {
        if (activeCall) {
          openJoinCallWindow(activeCall.externalId);
        } else {
          openInitiateCallWindow({
            channelId,
            callType: CallType.AUDIO,
            callDisplayName: displayName,
            targetUserIds,
          });
        }
        return;
      }

      if (activeCall) {
        roomActor.send({ type: 'JOIN_CALL', callId: activeCall.externalId, zero, viewMode });
        return;
      }
      roomActor.send({
        type: 'INITIATE_CALL',
        channelId,
        callType: CallType.AUDIO,
        zero,
        viewMode,
        ...(targetUserIds && { targetUserIds }),
        callDisplayName: displayName,
      });
    },
    [zero, isMobile],
  );

  const startCall = useCallback(
    (userId: string, displayName: string): void => {
      const callerId = currentUser?.id;
      if (!callerId || userId === callerId) return;
      if (!ensureRoomIdle()) return;
      void channelService
        .createDm({ participantIds: [callerId, userId] })
        .then(dm => {
          // The 1:1 DM may have been closed — reopen it so it reappears in the sidebar
          // (matches ComposeDmPanel's isExisting handling).
          if (dm.isExisting) {
            zero.mutate(mutators.channel.reopenDm({ channelId: dm.id, updatedAt: Date.now() }));
          }
          joinOrStartCall(dm.id, displayName, [userId]);
        })
        .catch((error: unknown) => {
          toast.error('Failed to start call.', {
            description: error instanceof Error ? error.message : 'Please try again.',
          });
        });
    },
    [currentUser?.id, zero, joinOrStartCall],
  );

  const startChannelCall = useCallback(
    (channelId: string, displayName: string): void => {
      if (!currentUser?.id) return;
      if (!ensureRoomIdle()) return;
      joinOrStartCall(channelId, displayName);
    },
    [currentUser?.id, joinOrStartCall],
  );

  const hasActiveChannelCall = useCallback(
    (channelId: string): boolean => findLiveChannelCall(channelId) !== undefined,
    [],
  );

  return { startCall, startChannelCall, hasActiveChannelCall, ensureRoomIdle };
};
