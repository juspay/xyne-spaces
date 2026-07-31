import { useConnectionState } from '@rocicorp/zero/react';
import { ComponentType, ReactElement, useCallback } from 'react';
import {
  WifiExclamationMark,
  WifiOff,
  WifiOn,
  type PikaIconProps,
  type PikaStyle,
} from '@xyne/icons';
import { Tooltip } from '../ui/Tooltip/Tooltip';
import { cn } from '../../utils/classNames';
import { logger, Event as LoggerEvent } from '../../utils/logger';
import { stateMachineActor } from '../../machines/stateMachine';

type ConnectionStateName = ReturnType<typeof useConnectionState>['name'];

interface StatusPresentation {
  icon: ComponentType<PikaIconProps>;
  iconVariant: PikaStyle;
  label: string;
  /** Appended to the tooltip when clicking the icon does something. */
  hint?: string;
  tone: string;
  /** Only the states Zero won't recover from on its own are clickable. */
  actionable: boolean;
}

// `connected` is absent on purpose — the healthy state renders nothing at all so
// the 60px rail stays quiet, and the icon appearing is itself the signal.
const CONNECTION_STATUS: Record<Exclude<ConnectionStateName, 'connected'>, StatusPresentation> = {
  connecting: {
    icon: WifiOn,
    iconVariant: 'Duo Stroke',
    label: 'Connecting…',
    tone: 'text-amber-500 dark:text-amber-400 animate-pulse',
    actionable: false,
  },
  disconnected: {
    icon: WifiOff,
    iconVariant: 'Stroke',
    label: 'Disconnected',
    hint: 'click to reconnect',
    tone: 'text-red-500 dark:text-red-400',
    actionable: true,
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- key comes from Zero's ConnectionState union
  'needs-auth': {
    icon: WifiExclamationMark,
    iconVariant: 'Stroke',
    label: 'Session expired',
    hint: 'click to reconnect',
    tone: 'text-amber-500 dark:text-amber-400',
    actionable: true,
  },
  error: {
    icon: WifiExclamationMark,
    iconVariant: 'Stroke',
    label: 'Connection error',
    hint: 'click to retry',
    tone: 'text-red-500 dark:text-red-400',
    actionable: true,
  },
  closed: {
    icon: WifiOff,
    iconVariant: 'Duo Stroke',
    label: 'Connection closed',
    hint: 'click to reconnect',
    tone: 'text-muted-foreground',
    actionable: true,
  },
};

export const ZeroConnectionStatus = ({
  className,
}: {
  className?: string;
}): ReactElement | null => {
  const connectionState = useConnectionState();

  const refreshConnection = useCallback(() => {
    logger.info(LoggerEvent.ZERO_ERROR_RECONNECT_INITIATED, {
      trigger: 'USER_CLICK_REFRESH_ICON',
    });
    stateMachineActor.send({ type: 'REFRESH_ZERO' });
  }, []);

  if (connectionState.name === 'connected') return null;

  const status = CONNECTION_STATUS[connectionState.name] ?? CONNECTION_STATUS.disconnected;
  const Icon = status.icon;
  const tooltip = status.hint ? `${status.label} — ${status.hint}` : status.label;
  const shell = cn(
    'size-8 flex items-center justify-center rounded-lg border border-transparent transition-colors',
    status.tone,
    className,
  );
  const icon = <Icon size={16} variant={status.iconVariant} />;

  // `connecting` is passive — rendering it as a <div> keeps globalClickTracker from
  // logging a REFRESH_CONNECTION_STATUS event for a click that reconnects nothing,
  // and keeps a no-op button out of the tab order.
  return (
    <Tooltip content={tooltip} side='right' delayDuration={0}>
      {status.actionable ? (
        <button
          type='button'
          onClick={refreshConnection}
          aria-label={`Connection status: ${status.label}. ${status.hint ?? ''}`.trim()}
          data-testid='zero-connection-status'
          data-connection-state={connectionState.name}
          data-track-category='ZERO_CONNECTION'
          data-track-name='REFRESH_CONNECTION_STATUS'
          className={cn(shell, 'cursor-pointer hover:bg-sidebar-accent')}
        >
          {icon}
        </button>
      ) : (
        <div
          role='status'
          aria-label={`Connection status: ${status.label}`}
          data-testid='zero-connection-status'
          data-connection-state={connectionState.name}
          className={cn(shell, 'cursor-default')}
        >
          {icon}
        </div>
      )}
    </Tooltip>
  );
};
