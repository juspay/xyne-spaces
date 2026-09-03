import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock, Users, Clock, Hash } from 'lucide-react';
import { UserHoverWrapper } from '../UserMentionPopover/UserMentionPopover';
import { GroupHoverWrapper } from '../GroupMentionPopover/GroupMentionPopover';
import { GenericMentionHoverPopover } from '../GenericMentionPopover/GenericMentionPopover';
import { useAuthContextValues } from '../../../hooks/useAuth';
import type { MentionTextProps } from './MentionText.types';
import { useUser } from '../../../hooks/useUsers';
import { useChannel } from '../../../hooks/useChannels';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { getUserDisplayName } from '../../../utils/userDisplayName';

export const MentionText: React.FC<MentionTextProps> = props => {
  const context = useAuthContextValues();
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const { channelId: currentChannelId } = useParams<{ channelId: string }>();
  const user = useUser(props.type === 'user' ? props.userId : '');
  const channel = useChannel(props.type === 'channel' ? props.channelId : '');
  const isCurrentUser = context.userID === user?.id;
  const [lastActivityAt, setLastActivity] = useState<number | undefined>(undefined);
  const [participantCount, setParticipantCount] = useState<number | undefined>(undefined);
  const zero = useZero();

  useEffect(() => {
    if (props.type !== 'channel') return;
    zero
      .run(queries.channelStats({ channelId: props.channelId }), { type: 'complete' })
      .then(stats => {
        if (!stats) return;
        setLastActivity(stats.lastActivityAt);
        setParticipantCount(stats.participantCount);
      })
      .catch(() => {
        // { Handle error silently, stats will just not show in popover }
      });
  }, [props.type, zero]);

  if (props.type === 'channel') {
    const handleChannelClick = (): void => {
      void navigate(`/chat/dir/${props.channelId}`);
    };

    const handleKeyDown = (event: React.KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void navigate(`/chat/dir/${props.channelId}`);
      }
    };

    // User doesn't have access if channel is null (query filtered it out)
    const hasAccess = channel !== null;

    const metadata: React.ReactNode[] = [];

    if (channel && hasAccess) {
      if (participantCount && participantCount > 0) {
        metadata.push(
          <div
            key='members'
            className='flex items-center gap-2 text-xs font-base text-muted-foreground'
          >
            <Users className='h-3.5 w-3.5' />
            <span>{participantCount} people in this channel</span>
          </div>,
        );
      }

      // Show last activity time
      if (lastActivityAt) {
        const lastActivityDate = new Date(lastActivityAt);
        const now = new Date();
        const diffMs = now.getTime() - lastActivityDate.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        let lastActivity = '';
        if (diffMins < 1) {
          lastActivity = 'Just now';
        } else if (diffMins < 60) {
          lastActivity = `${diffMins}m ago`;
        } else if (diffHours < 24) {
          lastActivity = `${diffHours}h ago`;
        } else {
          lastActivity = `${diffDays}d ago`;
        }
        metadata.push(
          <div
            key='activity'
            className='flex items-center gap-2 text-xs font-base text-muted-foreground'
          >
            <Clock className='h-3.5 w-3.5' />
            <span>Last message {lastActivity}</span>
          </div>,
        );
      }
    } else if (!hasAccess) {
      // Show "Private channel" badge when user doesn't have access
      metadata.push(
        <div key='no-access' className='inline-flex items-center'>
          <span className='text-xs px-2 py-0.5 bg-muted text-foreground rounded'>
            Private channel
          </span>
        </div>,
      );
    }

    const hoverData: {
      icon: React.ReactNode;
      title: string;
      description?: string;
      meta?: React.ReactNode;
    } = {
      icon: props.isPrivate ? (
        <Lock className='h-4 w-4 text-foreground' />
      ) : (
        <Hash className='h-4 w-4 text-foreground' />
      ),
      title: props.channelName,
      ...(hasAccess && props.description && { description: props.description }),
      ...(metadata.length > 0 && { meta: <div className='flex flex-col gap-1'>{metadata}</div> }),
    };

    return (
      <GenericMentionHoverPopover data={hoverData}>
        <span
          role='button'
          tabIndex={0}
          onClick={handleChannelClick}
          data-track-category='MENTION'
          data-track-name='OPEN_CHANNEL_FROM_MENTION'
          onKeyDown={handleKeyDown}
          className='text-[color:var(--mention-color)] bg-[var(--mention-channel-bg)] hover:bg-[var(--mention-channel-hover-bg)] px-1 py-[2px] rounded-[4px] font-normal cursor-pointer no-underline transition-colors duration-200 inline whitespace-nowrap leading-inherit align-baseline hover:text-[color:var(--mention-hover-color)]'
        >
          {props.isPrivate ? <Lock className='h-3 w-3 inline-block mr-0.5 mb-1' /> : '#'}
          {props.channelName}
        </span>
      </GenericMentionHoverPopover>
    );
  }

  if (props.type === 'user') {
    // Use displayName from userProfile if available, fallback to username prop
    const displayUsername = user ? getUserDisplayName(user) : props.username;

    if (!user) {
      return (
        <span className='text-[color:var(--mention-group-color)] font-normal cursor-pointer no-underline transition-colors duration-200 inline whitespace-nowrap leading-inherit align-baseline hover:text-[color:var(--mention-hover-color)]'>
          @{displayUsername}
        </span>
      );
    }

    return (
      <UserHoverWrapper
        userId={props.userId}
        preserveThreadRoute={props.preserveThreadRoute ?? false}
      >
        <span
          className={`${isCurrentUser ? 'bg-[var(--mention-current-user-bg)] text-[color:var(--mention-current-user-color,var(--mention-color))]' : 'bg-[var(--mention-bg)] text-[color:var(--mention-color)]'} px-1 py-[2px] rounded-[4px] font-normal cursor-pointer no-underline transition-colors duration-200 inline whitespace-nowrap leading-inherit align-baseline hover:text-[color:var(--mention-hover-color)] ${props.className ?? ''}`}
        >
          @{displayUsername}
        </span>
      </UserHoverWrapper>
    );
  }

  const handleGroupClick = (): void => {
    if (currentChannelId) {
      void navigate(`${baseRoute}/${currentChannelId}/group/${props.groupId}`);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleGroupClick();
    }
  };

  return (
    <GroupHoverWrapper groupId={props.groupId}>
      <span
        role='button'
        tabIndex={0}
        onClick={handleGroupClick}
        data-track-category='MENTION'
        data-track-name='OPEN_GROUP_FROM_MENTION'
        onKeyDown={handleKeyDown}
        className='text-[color:var(--mention-group-color)] font-normal cursor-pointer no-underline transition-colors duration-200 inline whitespace-nowrap leading-inherit align-baseline hover:text-[color:var(--mention-hover-color)]'
      >
        @{props.groupAlias || props.groupName}
      </span>
    </GroupHoverWrapper>
  );
};
