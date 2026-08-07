/**
 * useRecordingConnectionState
 *
 * Manages all LiveKit/browser connection state for an active recording:
 *  - Tracks roomConnectionState via RoomEvent.ConnectionStateChanged (single source of truth)
 *  - Bridges browser offline/online events into ConnectionState
 *  - Shows a "Recording resumed" banner when reconnection succeeds
 *  - Shows a network-quality warning modal when quality is Poor/Lost
 * Recording fallback decisions are owned by the global coordinator.
 *
 * Mirrors the pattern used in CallStateTransition / FullCallView.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Room } from 'livekit-client';
import { ConnectionState, ConnectionQuality, RoomEvent } from 'livekit-client';
import { useParticipantNetworkQuality } from '../../../components/Call/hooks/useParticipantNetworkQuality';
import { logger, Logger } from '../../../utils/logger';

export interface RecordingConnectionStateResult {
  /** The live LiveKit ConnectionState (null while no room is present). */
  roomConnectionState: ConnectionState | null;
  /** True when network quality is Poor or Lost during an active recording. */
  showConnectionWarning: boolean;
  /** Current network quality of the local participant. */
  networkQuality: ConnectionQuality | null;
  /** Call to manually dismiss the connection warning modal. */
  dismissConnectionWarning: () => void;
}

/**
 * @param room            The LiveKit Room from the recording store (null when not recording).
 * @param isActive        True while recordingStatus is recording/paused/starting.
 * @param recordingStatus Raw status string — used only for log context.
 */
export function useRecordingConnectionState(
  room: Room | null,
  isActive: boolean,
  recordingStatus: string,
): RecordingConnectionStateResult {
  const [roomConnectionState, setRoomConnectionState] = useState<ConnectionState | null>(null);
  const [showConnectionWarning, setShowConnectionWarning] = useState(false);

  // Tracks the previous ConnectionState so we can detect Reconnecting → Connected
  // transitions inside the event handler without a functional setState updater.
  const prevConnectionStateRef = useRef<ConnectionState | null>(null);

  const networkQuality = useParticipantNetworkQuality(room?.localParticipant ?? null);

  // ─── Network quality warning modal ────────────────────────────────────────
  useEffect(() => {
    if (!isActive) {
      setShowConnectionWarning(false);
      return;
    }
    const isDegraded =
      networkQuality === ConnectionQuality.Poor || networkQuality === ConnectionQuality.Lost;
    setShowConnectionWarning(isDegraded);
  }, [networkQuality, isActive]);

  // ─── Browser online/offline → translate into ConnectionState ──────────────
  useEffect(() => {
    const handleOffline = (): void => {
      console.warn('[RecordingsScreen] Browser went offline');
      logger.info(Logger.Event.LIVEKIT_SOCKET_DISCONNECTED, {
        source: 'recording_screen',
        reason: 'browser_offline',
        recordingStatus,
      });
      if (isActive) {
        setRoomConnectionState(ConnectionState.Reconnecting);
      }
    };

    const handleOnline = (): void => {
      console.info('[RecordingsScreen] Browser came back online');
      logger.info(Logger.Event.LIVEKIT_SOCKET_CONNECTING, {
        source: 'recording_screen',
        reason: 'browser_online',
        recordingStatus,
      });

      if (!isActive || !room) return;

      if (room.state === ConnectionState.Disconnected) {
        console.warn('[RecordingsScreen] Room remains disconnected; local protection continues');
        setRoomConnectionState(ConnectionState.Disconnected);
      } else if (room.state === ConnectionState.Connected) {
        // The blip was so brief LiveKit never lost the connection.
        // Clear the Reconnecting state we set from the offline event so the
        // overlay hides and the 30 s timeout is cancelled.
        console.info('[RecordingsScreen] Room still connected after brief offline');
        setRoomConnectionState(ConnectionState.Connected);
      }
      // If room.state === Reconnecting, LiveKit is handling it — let events drive state.
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return (): void => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [recordingStatus, isActive, room]);

  // ─── LiveKit ConnectionStateChanged — single source of truth ──────────────
  useEffect(() => {
    if (!room) {
      setRoomConnectionState(null);
      return;
    }

    // Seed with current state so the overlay is correct on mount.
    prevConnectionStateRef.current = room.state;
    setRoomConnectionState(room.state);

    const handleConnectionStateChanged = (state: ConnectionState): void => {
      console.info(`[RecordingsScreen] Connection state → ${state}`, { recordingStatus });
      logger.info(Logger.Event.RECORDING_STATE_CHANGED, {
        source: 'recording_screen',
        event: 'connection_state_changed',
        connectionState: state,
        recordingStatus,
      });

      const prev = prevConnectionStateRef.current;
      prevConnectionStateRef.current = state;
      setRoomConnectionState(state);

      if (
        state === ConnectionState.Connected &&
        prev === ConnectionState.Reconnecting &&
        isActive
      ) {
        logger.info(Logger.Event.RECORDING_STATE_CHANGED, {
          source: 'recording_screen',
          event: 'reconnected_with_local_protection',
          recordingStatus,
        });
      }
    };

    const handleQualityChanged = (quality: ConnectionQuality): void => {
      const label =
        quality === ConnectionQuality.Excellent
          ? 'excellent'
          : quality === ConnectionQuality.Good
            ? 'good'
            : quality === ConnectionQuality.Poor
              ? 'poor'
              : quality === ConnectionQuality.Lost
                ? 'lost'
                : 'unknown';
      console.info(`[RecordingsScreen] Network quality: ${label}`);
      logger.info(Logger.Event.RECORDING_STATE_CHANGED, {
        source: 'recording_screen',
        event: 'network_quality_changed',
        networkQuality: label,
        recordingStatus,
      });
    };

    room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
    room.on(RoomEvent.ConnectionQualityChanged, handleQualityChanged);
    return (): void => {
      room.off(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
      room.off(RoomEvent.ConnectionQualityChanged, handleQualityChanged);
    };
  }, [room, recordingStatus, isActive]);

  const dismissConnectionWarning = useCallback(() => setShowConnectionWarning(false), []);

  return {
    roomConnectionState,
    showConnectionWarning,
    networkQuality,
    dismissConnectionWarning,
  };
}
