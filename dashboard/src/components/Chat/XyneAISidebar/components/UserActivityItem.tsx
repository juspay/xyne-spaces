/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useCallback, useState } from 'react';
import { Check, ChevronRight, ChevronDown, Settings } from 'lucide-react';
import type { UserActivity } from '../../../../hooks/useUserActivity';

interface UserActivityItemProps {
  activity: UserActivity;
  isSelected: boolean;
  onToggle: (activity: UserActivity, isShiftKey: boolean, isMetaKey: boolean) => void;
  onConfigure?: (activity: UserActivity) => void;
  canConfigure?: boolean;
}

const formatEventName = (eventName: string): string => {
  if (!eventName) return '';

  // If it's all uppercase with underscores (e.g., CREATE_TICKET_BUTTON)
  if (eventName === eventName.toUpperCase() && eventName.includes('_')) {
    return eventName
      .toLowerCase()
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Handle mixed case like Create_Quarto_Doc or GoBack
  return eventName
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
};

const truncateUrl = (url: string, maxLength: number = 35): string => {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname + urlObj.search;
    const full = urlObj.host + path;
    if (full.length <= maxLength) return full;
    return full.substring(0, maxLength - 3) + '...';
  } catch {
    return url.length > maxLength ? url.substring(0, maxLength - 3) + '...' : url;
  }
};

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const UserActivityItem = ({
  activity,
  isSelected,
  onToggle,
  onConfigure,
  canConfigure,
}: UserActivityItemProps): ReactElement => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(prev => !prev);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onToggle(activity, e.shiftKey, e.metaKey || e.ctrlKey);
    },
    [activity, onToggle],
  );

  const handleConfigure = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onConfigure?.(activity);
    },
    [activity, onConfigure],
  );

  return (
    <div
      className={`
        w-full transition-all outline-none
        ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}
        ${isExpanded ? 'bg-gray-50' : ''}
      `}
    >
      {/* Main Row */}
      <button
        type='button'
        onClick={handleClick}
        className='w-full flex items-center gap-2 px-4 py-2.5 text-left group'
      >
        {/* Expand/Collapse Chevron */}
        <div
          onClick={handleToggleExpand}
          className='flex-shrink-0 p-0.5 hover:bg-gray-200 rounded transition-colors cursor-pointer'
          role='button'
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              setIsExpanded(prev => !prev);
            }
          }}
        >
          {isExpanded ? (
            <ChevronDown className='w-4 h-4 text-gray-500' />
          ) : (
            <ChevronRight className='w-4 h-4 text-gray-400' />
          )}
        </div>

        {/* Content */}
        <div className='flex-1 min-w-0'>
          <div className='text-sm font-medium text-gray-900 truncate'>
            {formatEventName(activity.eventName)}
          </div>
          <div className='flex items-center gap-1.5'>
            <span className='text-xs text-gray-500'>{activity.eventCategory}</span>
            <span className='text-xs text-gray-300'>|</span>
            <span className='text-xs text-gray-500 truncate' title={activity.url}>
              {truncateUrl(activity.url)}
            </span>
          </div>
        </div>

        {/* Checkmark (when selected) */}
        {isSelected && <Check className='w-4 h-4 text-blue-600 shrink-0' aria-hidden='true' />}

        {onConfigure && canConfigure && (
          <button
            onClick={handleConfigure}
            className='rounded'
            title='Configure activity'
            type='button'
          >
            <Settings className='w-3.5 h-3.5 text-gray-400 hover:text-gray-600' />
          </button>
        )}

        {/* Timestamp (when not selected, or always visible) */}
        <span className='text-xs text-gray-400 shrink-0 ml-1'>
          {formatTimestamp(activity.timestamp)}
        </span>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className='px-4 pb-3 pl-11 border-t border-gray-100'>
          <div className='grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2'>
            <div>
              <span className='text-gray-500'>Session:</span>{' '}
              <span className='font-mono text-gray-700'>{activity.sessionId.slice(0, 8)}...</span>
            </div>
            <div>
              <span className='text-gray-500'>Trigger:</span>{' '}
              <span className='text-gray-700'>{activity.triggerType}</span>
            </div>
            <div>
              <span className='text-gray-500'>Platform:</span>{' '}
              <span className='text-gray-700'>{activity.platform}</span>
            </div>
            <div>
              <span className='text-gray-500'>ID:</span>{' '}
              <span className='font-mono text-gray-700'>{activity.id.slice(0, 8)}...</span>
            </div>
          </div>

          {activity.contextMetadata && Object.keys(activity.contextMetadata).length > 0 && (
            <div className='mt-2'>
              <span className='text-xs text-gray-500'>Metadata:</span>
              <pre className='mt-1 text-xs text-gray-700 bg-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed'>
                {JSON.stringify(activity.contextMetadata, null, 2)}
              </pre>
            </div>
          )}

          {activity.eventLabel && (
            <div className='mt-2 text-xs'>
              <span className='text-gray-500'>Label:</span>{' '}
              <span className='text-gray-700'>{activity.eventLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
