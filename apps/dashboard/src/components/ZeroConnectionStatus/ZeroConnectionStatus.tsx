import { useConnectionState } from '@rocicorp/zero/react';
import { ComponentType, ReactElement, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
  labelKey: string;
  /** Appended to the tooltip when clicking the icon does something. */
  hintKey?: string;
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
    labelKey: 'zeroConnectionStatus.states.connecting',
    tone: 'text-amber-500 dark:text-amber-400 animate-pulse',
    actionable: false,
  },
  disconnected: {
    icon: WifiOff,
    iconVariant: 'Stroke',
    labelKey: 'zeroConnectionStatus.states.disconnected',
    hintKey: 'zeroConnectionStatus.hints.clickToReconnect',
    tone: 'text-red-500 dark:text-red-400',
    actionable: true,
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- key comes from Zero's ConnectionState union
  'needs-auth': {
    icon: WifiExclamationMark,
    iconVariant: 'Stroke',
    labelKey: 'zeroConnectionStatus.states.sessionExpired',
    hintKey: 'zeroConnectionStatus.hints.clickToReconnect',
    tone: 'text-amber-500 dark:text-amber-400',
    actionable: true,
  },
  error: {
    icon: WifiExclamationMark,
    iconVariant: 'Stroke',
    labelKey: 'zeroConnectionStatus.states.connectionError',
    hintKey: 'zeroConnectionStatus.hints.clickToRetry',
    tone: 'text-red-500 dark:text-red-400',
    actionable: true,
  },
  closed: {
    icon: WifiOff,
    iconVariant: 'Duo Stroke',
    labelKey: 'zeroConnectionStatus.states.connectionClosed',
    hintKey: 'zeroConnectionStatus.hints.clickToReconnect',
    tone: 'text-muted-foreground',
    actionable: true,
  },
};

export const ZeroConnectionStatus = ({
  className,
}: {
  className?: string;
}): ReactElement | null => {
  const { t } = useTranslation('common');
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
  const label = t(status.labelKey);
  const hint = status.hintKey ? t(status.hintKey) : undefined;
  const tooltip = hint ? `${label} — ${hint}` : label;
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
          data-ph-capture-attribute-track-id='reconnect_zero_connection'
          aria-label={t('zeroConnectionStatus.connectionStatusAriaLabel', {
            label,
            hint: hint ?? '',
          }).trim()}
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
          aria-label={t('zeroConnectionStatus.connectionStatusAriaLabelNoHint', { label })}
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
