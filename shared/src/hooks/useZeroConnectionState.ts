import { useConnectionState } from '@rocicorp/zero/react';
import { useCallback, useEffect, useRef } from 'react';
import { stateMachineActor } from '../machines/stateMachine.js';
import { useInstrumentation } from './useZero.js';
import { Event } from '../logger/events.js';
import { recordConnectionChange, recordConnectionConnected } from './metricValidity.js';

export interface ZeroConnectionInfo {
  /** Connection state name: 'connected' | 'connecting' | 'disconnected' | 'error' | etc */
  stateName: string;
  /** Human-readable status text */
  statusText: string;
  /** Status color hex code */
  statusColor: string;
  /** Whether currently connecting */
  isConnecting: boolean;
  /** Whether disconnected or in error state */
  isDisconnectedOrError: boolean;
  /** Trigger a Zero refresh (reconnect) */
  refreshConnection: () => void;
}

/**
 * Shared hook for Zero connection state.
 * Provides connection status info and a refresh action.
 * Each platform renders its own UI using this data.
 */
export function useZeroConnectionInfo(): ZeroConnectionInfo {
  const connectionState = useConnectionState();
  const { logger } = useInstrumentation();
  const prevStateRef = useRef(connectionState.name);

  useEffect(() => {
    if (prevStateRef.current !== connectionState.name) {
      if (connectionState.name === 'connected') {
        recordConnectionConnected();
      } else {
        recordConnectionChange();
      }
      prevStateRef.current = connectionState.name;
    }
  }, [connectionState.name]);

  const refreshConnection = useCallback(() => {
    logger.info(Event.ZERO_ERROR_RECONNECT_INITIATED, {
      trigger: 'USER_CLICK_REFRESH',
    });
    stateMachineActor.send({ type: 'REFRESH_ZERO' });
  }, [connectionState.name]);

  let statusText = '';
  let statusColor = '';

  switch (connectionState.name) {
    case 'connected':
      statusText = 'Connected';
      statusColor = '#00C851';
      break;
    case 'connecting':
      statusText = 'Connecting...';
      statusColor = '#FFD600';
      break;
    case 'disconnected':
      statusText = 'Disconnected';
      statusColor = '#FF5252';
      break;
    default:
      statusText = connectionState.name;
      statusColor = '#9E9E9E';
  }

  const isConnecting = connectionState.name === 'connecting';
  const isDisconnected = connectionState.name === 'disconnected';
  const isError = connectionState.name === 'error';

  return {
    stateName: connectionState.name,
    statusText,
    statusColor,
    isConnecting,
    isDisconnectedOrError: isDisconnected || isError,
    refreshConnection,
  };
}
