/**
 * useRecordingConnectionState
 *
 * Manages all LiveKit/browser connection state for an active recording:
 *  - Tracks roomConnectionState via RoomEvent.ConnectionStateChanged (single source of truth)
 *  - Bridges browser offline/online events into ConnectionState
 *  - Shows a "Recording resumed" banner when reconnection succeeds
 *  - Shows a network-quality warning modal when quality is Poor/Lost
 *  - Applies a 30 s safety-net timeout: stops the recording if still reconnecting
 *
 * Mirrors the pattern used in CallStateTransition / FullCallView.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Room } from 'livekit-client';
import { ConnectionState, ConnectionQuality, RoomEvent } from 'livekit-client';
import { useParticipantNetworkQuality } from '../../../components/Call/hooks/useParticipantNetworkQuality';
import { logger, Logger, Event as LogEvent } from '../../../utils/logger';

const RECONNECT_TIMEOUT_MS = 30_000;

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
 * @param onUnexpectedDisconnect  Called when the room disconnects unexpectedly or the
 *                        reconnect timeout fires.  Caller is responsible for stopping
 *                        the recording and showing the save-title modal.
 */
export function useRecordingConnectionState(
  room: Room | null,
  isActive: boolean,
  recordingStatus: string,
  onUnexpectedDisconnect: () => void,
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
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('[RecordingsScreen] Browser went offline'),
      });
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
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String('[RecordingsScreen] Browser came back online'),
      });
      logger.info(Logger.Event.LIVEKIT_SOCKET_CONNECTING, {
        source: 'recording_screen',
        reason: 'browser_online',
        recordingStatus,
      });

      if (!isActive || !room) return;

      if (room.state === ConnectionState.Disconnected) {
        // Room gave up while we were offline — stop immediately.
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String(
            '[RecordingsScreen] Room already disconnected on browser online — stopping',
          ),
        });
        setRoomConnectionState(ConnectionState.Disconnected);
        onUnexpectedDisconnect();
      } else if (room.state === ConnectionState.Connected) {
        // The blip was so brief LiveKit never lost the connection.
        // Clear the Reconnecting state we set from the offline event so the
        // overlay hides and the 30 s timeout is cancelled.
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_info',
          message: String('[RecordingsScreen] Room still connected after brief offline'),
        });
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
  }, [recordingStatus, isActive, room, onUnexpectedDisconnect]);

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
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String(`[RecordingsScreen] Connection state → ${state}`),
        context: [{ recordingStatus }],
      });
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
        // After reconnecting, check if the transcription agent (or anyone else) is
        // still in the room.  If we're alone there's nothing to transcribe, so stop.
        if (room.remoteParticipants.size === 0) {
          logger.warn(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_warn',
            message: String(
              '[RecordingsScreen] Reconnected but no remote participants — stopping recording (no agent)',
            ),
          });
          logger.info(Logger.Event.RECORDING_STATE_CHANGED, {
            source: 'recording_screen',
            event: 'reconnected_alone_in_room',
            recordingStatus,
          });
          onUnexpectedDisconnect();
        } else {
          // Agent is still present — recording can continue normally.
        }
      }

      if (state === ConnectionState.Disconnected && isActive) {
        onUnexpectedDisconnect();
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
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String(`[RecordingsScreen] Network quality: ${label}`),
      });
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
  }, [room, recordingStatus, isActive, onUnexpectedDisconnect]);

  // ─── Safety-net: stop recording if stuck reconnecting for >30 s ───────────
  useEffect(() => {
    if (roomConnectionState !== ConnectionState.Reconnecting || !isActive) return;
    const timer = setTimeout(() => {
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String(
          `[RecordingsScreen] Reconnect timeout after ${RECONNECT_TIMEOUT_MS / 1000} s — auto-stopping`,
        ),
      });
      logger.info(Logger.Event.LIVEKIT_SOCKET_DISCONNECTED, {
        source: 'recording_screen',
        reason: 'reconnect_timeout',
        recordingStatus,
      });
      onUnexpectedDisconnect();
    }, RECONNECT_TIMEOUT_MS);
    return (): void => clearTimeout(timer);
  }, [roomConnectionState, isActive, recordingStatus, onUnexpectedDisconnect]);

  const dismissConnectionWarning = useCallback(() => setShowConnectionWarning(false), []);

  return {
    roomConnectionState,
    showConnectionWarning,
    networkQuality,
    dismissConnectionWarning,
  };
}
