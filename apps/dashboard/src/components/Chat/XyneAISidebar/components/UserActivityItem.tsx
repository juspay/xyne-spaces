/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, ReactNode, useCallback, useState } from 'react';
import {
  Check,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  MessageSquare,
  Ticket,
  FileText,
  RefreshCw,
  Activity,
  Settings,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { UserActivity } from '../../../../hooks/useUserActivity';
import { RenderMessageWithHTML } from '../../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';

interface UserActivityItemProps {
  activity: UserActivity;
  isSelected: boolean;
  onToggle: (activity: UserActivity, isShiftKey: boolean, isMetaKey: boolean) => void;
  onConfigure?: (activity: UserActivity) => void;
  canConfigure?: boolean;
}

const toTitleCase = (str: string): string => {
  if (!str) return '';
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const getActivityIcon = (activity: UserActivity): ReactNode => {
  const { eventName, contextMetadata } = activity;
  const eventLower = eventName.toLowerCase();

  // Check for specific entity types in contextMetadata first
  if (contextMetadata) {
    if (contextMetadata['messageId'] || contextMetadata['message']) {
      return <MessageSquare className='w-4 h-3.5 text-primary' />;
    }
    if (contextMetadata['xyneId'] || contextMetadata['ticketId']) {
      return <Ticket className='w-4 h-3.5 text-status-success' />;
    }
    if (contextMetadata['canvasId']) {
      return <FileText className='w-4 h-3.5 text-status-pending' />;
    }
  }

  if (
    eventLower.includes('switch') ||
    eventLower.includes('toggle') ||
    eventLower.includes('open')
  ) {
    return <RefreshCw className='w-4 h-3.5 text-status-pending' />;
  }

  // Default icon
  return <Activity className='w-4 h-3.5 text-muted-foreground' />;
};

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

  // Handle mixed case like Duplicate_Canvas or GoBack
  return eventName
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
};

const formatActivityHeading = (activity: UserActivity): string => {
  const { eventName, contextMetadata } = activity;

  switch (eventName.toLowerCase()) {
    case 'switch_tab':
      if (contextMetadata && contextMetadata['tabValue']) {
        return `${formatEventName(eventName)} to ${contextMetadata['tabValue'] as string}`;
      }
      return formatEventName(eventName);
    case 'sidebar_nav_item':
      if (contextMetadata && contextMetadata['label']) {
        return `${formatEventName(eventName)} to ${contextMetadata['label'] as string}`;
      }
      return formatEventName(eventName);
    default:
      // Please dont change the ordering
      if (contextMetadata) {
        if (contextMetadata['messageId']) {
          return formatEventName(eventName);
        }
        if (contextMetadata['xyneId']) {
          return (
            formatEventName(eventName) +
            ' | ' +
            ((contextMetadata['xyneId'] as string) || 'Unknown Ticket')
          );
        }
        if (contextMetadata['canvasId']) {
          return (
            formatEventName(eventName) +
            ' | ' +
            ((contextMetadata['title'] as string) || 'Unknown Channel')
          );
        }
        if (contextMetadata['channelId']) {
          return (
            formatEventName(eventName) +
            ' | ' +
            ((contextMetadata['channelName'] as string) || 'Unknown Channel')
          );
        }
      }

      return formatEventName(eventName);
  }

  // Customize based on event type and available metadata
};

const getRedirection = (
  activity: UserActivity,
  navigate: ReturnType<typeof useNavigate>,
): ReactNode => {
  if (activity.contextMetadata) {
    let url = '';

    if (activity.contextMetadata['canvasId']) {
      const u = activity.contextMetadata['canvasId'] as string;
      url = `/chat/dir/canvas/${u}`;
    }
    if (activity.contextMetadata['channelId']) {
      const u = activity.contextMetadata['channelId'] as string;
      url = `/chat/dir/${u}`;
    }
    if (activity.contextMetadata['messageId']) {
      const u = activity.contextMetadata['messageId'] as string;
      const channelId = activity.contextMetadata['channelId'] as string;
      const conversationId = activity.contextMetadata['conversationId'] as string;
      url = `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${u}`;
    }
    if (activity.contextMetadata['ticketId']) {
      const u = activity.contextMetadata['ticketId'] as string;
      const channelId = activity.contextMetadata['channelId'] as string;
      const conversationId = activity.contextMetadata['conversationId'] as string;
      url = `/chat/dir/${channelId}?tab=tickets&ticketId=${u}&conversationId=${conversationId}`;
    }

    if (!url) {
      return null;
    }

    const handleClick = (e: React.MouseEvent): void => {
      e.stopPropagation();
      void navigate(url, {
        state: {
          activityNavigationNonce: Date.now(),
        },
      });
    };

    return (
      <button
        type='button'
        onClick={handleClick}
        data-track-category='XYNE_AI_SIDEBAR'
        data-track-name='OPEN_ACTIVITY_ITEM'
        className='flex-shrink-0 p-1 hover:bg-accent rounded transition-colors cursor-pointer'
        title={`Go to ${url}`}
      >
        <ExternalLink className='w-4 h-3.5 text-muted-foreground' />
      </button>
    );
  }
  return null;
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

const renderMessageIfAny = (activity: UserActivity): React.ReactNode => {
  const contextMetadata = activity.contextMetadata;
  if (contextMetadata === null) {
    return null;
  }
  const message = contextMetadata['message'] as string | undefined;

  if (!message) {
    return null;
  }

  return (
    <div className='text-sm text-muted-foreground mt-1'>
      <RenderMessageWithHTML message={message} />
    </div>
  );
};

export const UserActivityItem = ({
  activity,
  isSelected,
  onToggle,
  onConfigure,
  canConfigure,
}: UserActivityItemProps): ReactElement => {
  const navigate = useNavigate();
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
        ${isSelected ? 'bg-muted' : 'hover:bg-accent'}
        ${isExpanded ? 'bg-muted' : ''}
      `}
    >
      {/* Main Row */}
      <button
        type='button'
        onClick={handleClick}
        data-track-category='XYNE_AI_SIDEBAR'
        data-track-name='OPEN_ACTIVITY_ITEM'
        className='w-full flex items-center gap-2 px-4 py-1 text-left'
      >
        {/* Expand/Collapse Chevron */}
        <div
          onClick={handleToggleExpand}
          data-track-category='XYNE_AI_SIDEBAR'
          data-track-name='TOGGLE_ACTIVITY_DETAILS'
          className='flex-shrink-0 p-1.5 hover:bg-accent rounded transition-colors cursor-pointer self-start'
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
            <ChevronDown className='w-4 h-4 text-muted-foreground' />
          ) : (
            <ChevronRight className='w-4 h-4 text-muted-foreground' />
          )}
        </div>

        {/* Content */}
        <div className='flex-1 min-w-0'>
          <div className='flex items-start gap-2'>
            <div className='mt-1'>{getActivityIcon(activity)}</div>
            <div className='flex-1 min-w-0'>
              <div className='text-sm font-medium text-foreground truncate'>
                {toTitleCase(formatActivityHeading(activity))}
              </div>
              <div className='text-sm font-medium text-foreground truncate'>
                {renderMessageIfAny(activity)}
              </div>
            </div>
          </div>
          {/* <div className='flex items-center gap-1.5'>  */}
          {/* <span className='text-xs text-muted-foreground'>{activity.eventCategory}</span> */}
          {/* <span className='text-xs text-muted'></span> */}
          {/* // <span className='text-xs text-muted-foreground truncate' title={activity.url}>
            //   {truncateUrl(activity.url)}
            // </span> */}
          {/* </div>  */}
        </div>

        {/* Redirection Icon */}
        {getRedirection(activity, navigate)}

        {/* Checkmark (when selected) */}
        {isSelected && <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />}

        {onConfigure && canConfigure && (
          <button
            onClick={handleConfigure}
            data-track-category='XYNE_AI_SIDEBAR'
            data-track-name='CONFIGURE_ACTIVITY'
            className='rounded'
            title='Configure activity'
            type='button'
          >
            <Settings className='w-3.5 h-3.5 text-muted-foreground hover:text-muted-foreground' />
          </button>
        )}

        {/* Timestamp (when not selected, or always visible) */}
        <span className='text-xs text-muted-foreground shrink-0 ml-1'>
          {formatTimestamp(activity.timestamp)}
        </span>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className='px-4 pb-3 pl-11 border-t border-border'>
          <div className='grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2'>
            <div>
              <span className='text-muted-foreground'>Session:</span>{' '}
              <span className='font-mono text-foreground'>{activity.sessionId.slice(0, 8)}...</span>
            </div>
            <div>
              <span className='text-muted-foreground'>Trigger:</span>{' '}
              <span className='text-foreground'>{activity.triggerType}</span>
            </div>
            <div>
              <span className='text-muted-foreground'>Platform:</span>{' '}
              <span className='text-foreground'>{activity.platform}</span>
            </div>
            <div>
              <span className='text-muted-foreground'>ID:</span>{' '}
              <span className='font-mono text-foreground'>{activity.id.slice(0, 8)}...</span>
            </div>
          </div>

          {activity.contextMetadata && Object.keys(activity.contextMetadata).length > 0 && (
            <div className='mt-2'>
              <span className='text-xs text-muted-foreground'>Metadata:</span>
              <pre className='mt-1 text-xs text-foreground bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed'>
                {JSON.stringify(activity.contextMetadata, null, 2)}
              </pre>
            </div>
          )}

          {activity.eventLabel && (
            <div className='mt-2 text-xs'>
              <span className='text-muted-foreground'>Label:</span>{' '}
              <span className='text-foreground'>{activity.eventLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
