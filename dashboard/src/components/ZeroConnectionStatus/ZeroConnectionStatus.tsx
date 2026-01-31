import { useConnectionState } from '@rocicorp/zero/react';
import { ReactElement } from 'react';

export const ZeroConnectionStatus = (): ReactElement => {
  const connectionState = useConnectionState();

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

  return (
    <div className='flex items-center gap-2 mr-2'>
      <div className='w-2 h-2 rounded-full' style={{ backgroundColor: statusColor }} />
      <span className='font-sans font-normal text-xs leading-none tracking-normal text-[var(--metrics-bar-color)]'>
        {statusText}
      </span>
    </div>
  );
};
