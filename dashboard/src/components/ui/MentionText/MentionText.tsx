import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Users, Clock, Hash } from 'lucide-react';
import { UserHoverWrapper } from '../UserMentionPopover/UserMentionPopover';
import { GenericMentionHoverPopover } from '../GenericMentionPopover/GenericMentionPopover';
import { useAuthContextValues } from '../../../hooks/useAuth';
import type { MentionTextProps } from './MentionText.types';
import { useUser } from '../../../hooks/useUsers';
import { useChannel } from '../../../hooks/useChannels';

export const MentionText: React.FC<MentionTextProps> = props => {
  const context = useAuthContextValues();
  const navigate = useNavigate();
  const user = useUser(props.type === 'user' ? props.userId : '');
  const channel = useChannel(props.type === 'channel' ? props.channelId : '');
  const isCurrentUser = context.userID === user?.id;

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
      if (channel.participantCount > 0) {
        metadata.push(
          <div key='members' className='flex items-center gap-2 text-xs font-base text-gray-600'>
            <Users className='h-3.5 w-3.5' />
            <span>{channel.participantCount} people in this channel</span>
          </div>,
        );
      }

      // Show last activity time
      if (channel.lastActivityAt) {
        const lastActivityDate = new Date(channel.lastActivityAt);
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
          <div key='activity' className='flex items-center gap-2 text-xs font-base text-gray-600'>
            <Clock className='h-3.5 w-3.5' />
            <span>Last message {lastActivity}</span>
          </div>,
        );
      }
    } else if (!hasAccess) {
      // Show "Private channel" badge when user doesn't have access
      metadata.push(
        <div key='no-access' className='inline-flex items-center'>
          <span className='text-xs px-2 py-0.5 bg-gray-200 text-gray-700 rounded'>
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
        <Lock className='h-4 w-4 text-gray-700' />
      ) : (
        <Hash className='h-4 w-4 text-gray-700' />
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
          onKeyDown={handleKeyDown}
          className='text-[#1264A3] bg-[#1D9BD11A] hover:bg-[#04374d1a] font-normal cursor-pointer no-underline transition-colors duration-200 inline whitespace-nowrap leading-inherit align-baseline hover:text-[#113F67]'
        >
          {props.isPrivate ? <Lock className='h-3 w-3 inline-block mr-0.5 mb-1' /> : '#'}
          {props.channelName}
        </span>
      </GenericMentionHoverPopover>
    );
  }

  if (props.type === 'user') {
    if (!user) {
      return (
        <span className='text-[#3D74B6] font-normal cursor-pointer no-underline transition-colors duration-200 inline whitespace-nowrap leading-inherit align-baseline hover:text-[#113F67]'>
          @{props.username}
        </span>
      );
    }

    return (
      <UserHoverWrapper userId={props.userId}>
        <span
          className={`${isCurrentUser ? 'bg-[#fef3c7]' : 'bg-[#e5f1fe]'} px-1 py-[2px] text-[#1264a3] rounded-[4px] font-normal cursor-pointer no-underline transition-colors duration-200 inline whitespace-nowrap leading-inherit align-baseline hover:text-[#113F67]`}
        >
          @{props.username}
        </span>
      </UserHoverWrapper>
    );
  }

  return (
    <GenericMentionHoverPopover
      data={{
        icon: '👥',
        title: props.groupAlias || props.groupName,
        ...(props.groupAlias &&
          props.groupName !== props.groupAlias && { subtitle: props.groupName }),
        ...(props.description && { description: props.description }),
        // ...(props.memberCount !== undefined && { meta: `${props.memberCount} members` }),
      }}
    >
      <span className='text-[#3D74B6] font-normal cursor-pointer no-underline transition-colors duration-200 inline whitespace-nowrap leading-inherit align-baseline hover:text-[#113F67]'>
        @{props.groupAlias || props.groupName}
      </span>
    </GenericMentionHoverPopover>
  );
};
