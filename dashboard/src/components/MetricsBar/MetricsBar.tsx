import { ReactElement, useState, useCallback } from 'react';
import { ChevronsUpDown, UserRound, MessageCircle, Phone, Copy } from 'lucide-react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../../machines/stateMachine';
import { logger } from '../../utils/logger';
import Tooltip from '../ui/Tooltip/Tooltip';
import { toast } from 'sonner';

type MetricsMode = 'today' | 'allTime';

const formatCount = (count: number): string => {
  if (count >= 1000) {
    return (count / 1000).toFixed(2) + 'K';
  }
  return count.toString();
};

/**
 * Format duration in minutes to a human-readable string
 * - Less than 60 minutes: "X mins"
 * - 60+ minutes: "X.X hrs"
 */
const formatDuration = (durationMinutes: number): string => {
  if (durationMinutes < 60) {
    return `${Math.round(durationMinutes)} mins`;
  }
  const hours = durationMinutes / 60;
  if (hours >= 1000) {
    return (hours / 1000).toFixed(2) + 'K hrs';
  }
  return `${hours.toFixed(1)} hrs`;
};

const MetricsBar = (): ReactElement => {
  const [mode, setMode] = useState<MetricsMode>('today');

  // Subscribe to metrics from global XState store
  const { today, allTime, loading, error } = useSelector(
    stateMachineActor,
    state => state.context.metrics,
  );

  // Get current period's metrics
  const currentMetrics = mode === 'today' ? today : allTime;

  // Helper to format display value based on loading/error state
  const getDisplayValue = useCallback(
    (value: number, formatter: (v: number) => string = formatCount): string => {
      if (loading) return '...';
      if (error) return '--';
      return formatter(value);
    },
    [loading, error],
  );

  const toggleMode = (): void => {
    setMode(prev => (prev === 'today' ? 'allTime' : 'today'));
  };

  const handleCopySessionId = (): void => {
    if (logger.zeroClientID) {
      navigator.clipboard
        .writeText(logger.zeroClientID)
        .then(() => {
          toast.success('Zero Client ID copied to clipboard');
        })
        .catch(() => {
          toast.error('Failed to copy Zero Client ID');
        });
    }
  };

  const displayLabel = mode === 'today' ? 'Today' : 'All Time';
  const activeCount = getDisplayValue(currentMetrics.users);
  const messagesCount = getDisplayValue(currentMetrics.messages);

  const getCallsDisplay = (): string => {
    if (loading) return '...';
    if (error) return '--';
    return `${formatCount(currentMetrics.calls)} (${formatDuration(currentMetrics.callsDuration)})`;
  };

  return (
    <div className='flex items-center gap-4 pl-2 pr-4 py-0'>
      {/* Time Period Toggle */}
      <button
        onClick={toggleMode}
        className='flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity font-sans font-medium text-xs leading-none tracking-normal text-[var(--metrics-bar-color)]'
      >
        <span>{displayLabel}</span>
        <ChevronsUpDown className='w-4 h-4 text-[var(--metrics-bar-color)]' />
      </button>

      {/* Active Users */}
      <div className='flex items-center gap-2 transition-all duration-300 ease-out'>
        <UserRound className='w-4 h-4 text-[var(--metrics-bar-color)]' />
        <span className='font-sans font-normal text-xs leading-none tracking-normal text-[var(--metrics-bar-color)]'>
          Active
        </span>
        <span className='font-sans font-semibold text-xs leading-none tracking-normal text-[var(--metrics-bar-color)] transition-all duration-300 ease-out visual-regression-hide'>
          {activeCount}
        </span>
      </div>

      {/* Divider */}
      <div className='w-px h-4 bg-[var(--metrics-bar-divider)]' />

      {/* Messages */}
      <div className='flex items-center gap-2 transition-all duration-300 ease-out'>
        <MessageCircle className='w-4 h-4 text-[var(--metrics-bar-color)]' />
        <span className='font-sans font-normal text-xs leading-none tracking-normal text-[var(--metrics-bar-color)]'>
          Messages
        </span>
        <span className='font-sans font-semibold text-xs leading-none tracking-normal text-[var(--metrics-bar-color)] transition-all duration-300 ease-out visual-regression-hide'>
          {messagesCount}
        </span>
      </div>

      {/* Divider */}
      <div className='w-px h-4 bg-[var(--metrics-bar-divider)]' />

      {/* Calls (Count + Duration) */}
      <div className='flex items-center gap-2 transition-all duration-300 ease-out'>
        <Phone className='w-4 h-4 text-[var(--metrics-bar-color)]' />
        <span className='font-sans font-normal text-xs leading-none tracking-normal text-[var(--metrics-bar-color)]'>
          Calls
        </span>
        <span className='font-sans font-semibold text-xs leading-none tracking-normal text-[var(--metrics-bar-color)] transition-all duration-300 ease-out visual-regression-hide'>
          {getCallsDisplay()}
        </span>
      </div>

      <div className='w-px h-4 bg-[var(--metrics-bar-divider)]' />

      <Tooltip
        content={logger.zeroClientID || 'No Zero Client ID'}
        side='bottom'
        delayDuration={300}
      >
        <button
          onClick={handleCopySessionId}
          className='flex items-center gap-2 transition-all duration-300 ease-out cursor-pointer hover:opacity-80'
          disabled={!logger.zeroClientID}
        >
          <Copy className='w-4 h-4 text-[var(--metrics-bar-color)]' />
          <span className='font-sans font-normal text-xs leading-none tracking-normal text-[var(--metrics-bar-color)]'>
            Zero Client ID
          </span>
          <span className='font-sans font-semibold text-xs leading-none tracking-normal text-[var(--metrics-bar-color)] transition-all duration-300 ease-out visual-regression-hide'></span>
        </button>
      </Tooltip>
    </div>
  );
};

export default MetricsBar;
