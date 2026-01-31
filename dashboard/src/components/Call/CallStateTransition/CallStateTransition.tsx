import { ConnectionState } from 'livekit-client';
import { cn } from '../../../utils/classNames';

interface CallStateTransitionProps {
  connectionState: ConnectionState;
  machineState: string;
  children: React.ReactNode;
}

export function CallStateTransition({
  connectionState,
  machineState,
  children,
}: CallStateTransitionProps): React.ReactElement {
  // Show loading states for initiating/joining/connecting (initial connection)
  if (
    machineState === 'initiating' ||
    machineState === 'joining' ||
    machineState === 'connecting'
  ) {
    return (
      <div className={cn('h-full w-full flex items-center justify-center')}>
        <div className={cn('text-center px-4')}>
          <div
            className={cn(
              'animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500 mx-auto mb-4',
            )}
          />
          <p className={cn('text-white font-semibold mb-1 text-sm sm:text-base')}>
            {machineState === 'initiating' ? 'Starting call...' : 'Joining call...'}
          </p>
          <p className={cn('text-gray-400 text-xs sm:text-sm')}>Please wait</p>
        </div>
      </div>
    );
  }

  // Show reconnecting state (only after initial connection)
  if (connectionState === ConnectionState.Reconnecting && machineState === 'connected') {
    return (
      <div className={cn('h-full w-full flex items-center justify-center')}>
        <div className={cn('text-center px-4')}>
          <div
            className={cn(
              'animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-yellow-500 mx-auto mb-4',
            )}
          />
          <p className={cn('text-white font-semibold mb-1 text-sm sm:text-base')}>
            Reconnecting...
          </p>
          <p className={cn('text-yellow-400 text-xs sm:text-sm')}>Connection lost</p>
        </div>
      </div>
    );
  }

  // Show disconnecting state
  if (machineState === 'disconnecting') {
    return (
      <div className={cn('h-full w-full flex items-center justify-center')}>
        <div className={cn('text-center px-4')}>
          <div
            className={cn(
              'animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-red-500 mx-auto mb-4',
            )}
          />
          <p className={cn('text-white font-semibold mb-1 text-sm sm:text-base')}>Leaving...</p>
          <p className={cn('text-red-400 text-xs sm:text-sm')}>Disconnecting from call</p>
        </div>
      </div>
    );
  }

  // Show normal connected state
  return <>{children}</>;
}
