import { useEffect, useState, useRef } from 'react';
import type { Room } from 'livekit-client';
import { ConnectionQuality, ConnectionState, RoomEvent } from 'livekit-client';
import { Wifi, WifiOff, Radio } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { logger, Logger } from '../../../utils/logger';

interface ConnectionStatusIndicatorsProps {
  room: Room | null;
}

type ConnectionStatus = 'connected' | 'reconnecting' | 'connecting' | 'disconnected';

export function ConnectionStatusIndicators({
  room,
}: ConnectionStatusIndicatorsProps): React.ReactElement | null {
  const [wsState, setWsState] = useState<ConnectionStatus>('disconnected');
  const [rtcState, setRtcState] = useState<ConnectionStatus>('disconnected');
  const [isBrowserOffline, setIsBrowserOffline] = useState(!navigator.onLine);
  const previousWsState = useRef<ConnectionStatus>('disconnected');
  const previousRtcState = useRef<ConnectionStatus>('disconnected');
  const wsStateChangeTime = useRef<number>(Date.now());
  const rtcStateChangeTime = useRef<number>(Date.now());

  useEffect(() => {
    const handleOffline = (): void => {
      logger.info(Logger.Event.LIVEKIT_SOCKET_DISCONNECTED, {
        reason: 'browser_offline',
        previousState: previousWsState.current,
      });
      setIsBrowserOffline(true);
      setWsState('disconnected');
    };

    const handleOnline = (): void => {
      logger.info(Logger.Event.LIVEKIT_SOCKET_CONNECTING, {
        reason: 'browser_online',
        previousState: previousWsState.current,
      });
      setIsBrowserOffline(false);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return (): void => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  useEffect(() => {
    if (!room) {
      setWsState('disconnected');
      setRtcState('disconnected');
      return;
    }

    const updateStates = (): void => {
      if (isBrowserOffline) {
        logger.info(Logger.Event.LIVEKIT_SOCKET_DISCONNECTED, {
          reason: 'browser_offline',
          previousWsState: previousWsState.current,
          previousRtcState: previousRtcState.current,
        });
        setWsState('disconnected');
        setRtcState('disconnected');
        return;
      }

      const stateMap: Partial<Record<ConnectionState, ConnectionStatus>> = {
        [ConnectionState.Connected]: 'connected',
        [ConnectionState.Reconnecting]: 'reconnecting',
        [ConnectionState.Connecting]: 'connecting',
        [ConnectionState.Disconnected]: 'disconnected',
        [ConnectionState.SignalReconnecting]: 'reconnecting',
      };
      const newWsState = stateMap[room.state] || 'disconnected';

      // Log WebSocket state changes
      if (newWsState !== previousWsState.current) {
        const latencyMs = Date.now() - wsStateChangeTime.current;
        const eventType =
          newWsState === 'connected'
            ? Logger.Event.LIVEKIT_SOCKET_CONNECTED
            : newWsState === 'reconnecting'
              ? Logger.Event.LIVEKIT_SOCKET_RECONNECTING
              : newWsState === 'connecting'
                ? Logger.Event.LIVEKIT_SOCKET_CONNECTING
                : Logger.Event.LIVEKIT_SOCKET_DISCONNECTED;

        logger.info(eventType, {
          roomState: room.state,
          currentState: newWsState,
          previousState: previousWsState.current,
          latencyMs,
        });
        previousWsState.current = newWsState;
        wsStateChangeTime.current = Date.now();
      }
      setWsState(newWsState);

      const hasLocalTracks = room.localParticipant?.trackPublications.size > 0;
      const hasRemoteTracks = Array.from(room.remoteParticipants.values()).some(
        participant => participant.trackPublications.size > 0,
      );
      const quality = room.localParticipant?.connectionQuality;
      const hasQuality = quality && quality !== ConnectionQuality.Unknown;

      let newRtcState: ConnectionStatus;
      if (
        room.state === ConnectionState.Connected &&
        (hasLocalTracks || hasRemoteTracks || hasQuality)
      ) {
        newRtcState = 'connected';
      } else if (room.state === ConnectionState.Connected) {
        newRtcState = 'connecting';
      } else if (
        room.state === ConnectionState.Reconnecting ||
        room.state === ConnectionState.SignalReconnecting
      ) {
        newRtcState = 'reconnecting';
      } else {
        newRtcState = 'disconnected';
      }

      // Log RTC state changes
      if (newRtcState !== previousRtcState.current) {
        const latencyMs = Date.now() - rtcStateChangeTime.current;
        const eventType =
          newRtcState === 'connected'
            ? Logger.Event.LIVEKIT_RTC_CONNECTED
            : newRtcState === 'connecting'
              ? Logger.Event.LIVEKIT_RTC_CONNECTING
              : Logger.Event.LIVEKIT_RTC_DISCONNECTED;

        logger.info(eventType, {
          roomState: room.state,
          currentState: newRtcState,
          previousState: previousRtcState.current,
          hasLocalTracks,
          hasRemoteTracks,
          hasQuality,
          quality,
          latencyMs,
        });
        previousRtcState.current = newRtcState;
        rtcStateChangeTime.current = Date.now();
      }
      setRtcState(newRtcState);
    };

    room.on(RoomEvent.ConnectionQualityChanged, updateStates);
    room.on(RoomEvent.Connected, updateStates);
    room.on(RoomEvent.Disconnected, updateStates);
    room.on(RoomEvent.Reconnecting, updateStates);
    room.on(RoomEvent.Reconnected, updateStates);
    room.on(RoomEvent.TrackPublished, updateStates);
    room.on(RoomEvent.TrackSubscribed, updateStates);
    room.on(RoomEvent.SignalReconnecting, updateStates);
    room.on(RoomEvent.SignalConnected, updateStates);

    updateStates();

    return (): void => {
      room.off(RoomEvent.ConnectionQualityChanged, updateStates);
      room.off(RoomEvent.Connected, updateStates);
      room.off(RoomEvent.Disconnected, updateStates);
      room.off(RoomEvent.Reconnecting, updateStates);
      room.off(RoomEvent.Reconnected, updateStates);
      room.off(RoomEvent.TrackPublished, updateStates);
      room.off(RoomEvent.TrackSubscribed, updateStates);
      room.off(RoomEvent.SignalReconnecting, updateStates);
      room.off(RoomEvent.SignalConnected, updateStates);
    };
  }, [room, isBrowserOffline]);

  if (!room) {
    return null;
  }

  const getStatusColor = (status: ConnectionStatus): string => {
    switch (status) {
      case 'connected':
        return 'bg-green-500/90 text-white';
      case 'reconnecting':
        return 'bg-yellow-500/90 text-white';
      case 'connecting':
        return 'bg-gray-500/90 text-white';
      case 'disconnected':
        return 'bg-red-500/90 text-white';
    }
  };

  const getWsIcon = (status: ConnectionStatus): React.ReactElement => {
    return status === 'disconnected' || status === 'reconnecting' ? (
      <WifiOff className='h-3 w-3' />
    ) : (
      <Wifi className='h-3 w-3' />
    );
  };

  return (
    <div className='flex items-center gap-1.5 pointer-events-none select-none'>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
          getStatusColor(wsState),
        )}
        title={`WebSocket: ${wsState}`}
      >
        {getWsIcon(wsState)}
        <span>WS</span>
      </div>

      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
          getStatusColor(rtcState),
        )}
        title={`RTC: ${rtcState}`}
      >
        <Radio className='h-3 w-3' />
        <span>RTC</span>
      </div>
    </div>
  );
}
