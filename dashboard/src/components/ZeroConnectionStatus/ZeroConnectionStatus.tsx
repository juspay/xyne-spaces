import { useConnectionState } from '@rocicorp/zero/react';
import { ReactElement, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { useZero } from '../../hooks/useZero';
import { logger, Event as LoggerEvent } from '../../utils/logger';
import { stateMachineActor } from '../../machines/stateMachine';

export const ZeroConnectionStatus = (): ReactElement => {
  const connectionState = useConnectionState();
  const zero = useZero();

  const refreshConnection = useCallback(() => {
    logger.info(LoggerEvent.ZERO_ERROR_RECONNECT_INITIATED, {
      trigger: 'USER_CLICK_REFRESH_ICON',
    });
    stateMachineActor.send({ type: 'REFRESH_ZERO' });
  }, [zero, connectionState.name]);

  let statusText = '';
  let statusColor = '';

  switch (connectionState.name) {
    case 'connected':
      statusText = 'Connected';
      statusColor = '#00C851'; // Green
      break;
    case 'connecting':
      statusText = 'Connecting...';
      statusColor = '#FFD600'; // Yellow
      break;
    case 'disconnected':
      statusText = 'Disconnected';
      statusColor = '#FF5252'; // Red
      break;
    default:
      statusText = connectionState.name;
      statusColor = '#9E9E9E'; // Gray
  }

  const isConnecting = connectionState.name === 'connecting';
  const isDisconnected = connectionState.name === 'disconnected';
  const isError = connectionState.name === 'error';

  // Show refresh button when disconnected or error state
  const showRefreshButton = isDisconnected || isError;

  return (
    <div className='flex items-center gap-2 mr-2'>
      <div className='w-2 h-2 rounded-full' style={{ backgroundColor: statusColor }} />
      <span className='font-sans font-normal text-xs leading-none tracking-normal text-[var(--metrics-bar-color)]'>
        {statusText}
      </span>
      {showRefreshButton && (
        <button
          onClick={refreshConnection}
          disabled={isConnecting}
          className={`
            p-1 rounded hover:bg-[var(--metrics-bar-hover-bg)]
            transition-colors duration-150
            ${!isConnecting ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}
          `}
          title={isConnecting ? 'Connecting...' : 'Refresh connection'}
          data-track-category='ZERO_CONNECTION'
          data-track-name='REFRESH_CONNECTION_STATUS'
        >
          <RefreshCw
            className={`w-3 h-3 text-[var(--metrics-bar-color)] ${isConnecting ? 'animate-spin' : ''}`}
            strokeWidth={2.5}
          />
        </button>
      )}
    </div>
  );
};
