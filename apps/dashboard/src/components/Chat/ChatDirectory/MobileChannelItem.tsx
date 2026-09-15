import { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Hashtag, PencilEdit, Headphones } from '@xyne/icons';
import { ChannelVisibility, NotificationLevel } from '@xyne/shared';
import { isDMChannel, isGroupDMChannel, parseDMParticipantIds } from './ChatDirectory.utils';
import { useDraft } from '../../../hooks/useDraft';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import ChatLock from '../../icons/ChatLock';
import { useChannelHasActiveCall } from '../../../hooks/useCalls';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import Avatar from '../../ui/Avatar/Avatar';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useUser } from '../../../hooks/useUsers';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { ChannelScopeType } from '@xyne/shared';
import { VisibleChannel } from '../../../machines/stateMachine';
import { useChannelHasSlashCommandArtifactSideEffect } from '../SlashCommandArtifactSideEffects';

interface MobileChannelItemProps {
  channel: VisibleChannel;
  unreadCount?: number;
}

const MobileChannelItem = ({ channel, unreadCount = 0 }: MobileChannelItemProps): ReactElement => {
  const { channelId: activeChannelId } = useParams();
  const context = useAuthContextValues();

  const currentUserID = context.userID;

  // Get draft from state machine (reactive updates)
  const draftMessage = useDraft(channel.id, null);

  const isActive = activeChannelId === channel.id;
  const isPrivate = channel.visibility === ChannelVisibility.PRIVATE;
  const isDM = isDMChannel(channel.scopeType);

  const hasActiveCall = useChannelHasActiveCall(channel.id);
  const hasSlashCommandArtifactSideEffect = useChannelHasSlashCommandArtifactSideEffect(channel.id);

  const { displayName, avatarUserId } = useChannelDisplayName(channel, currentUserID);

  // Get user status for 1-on-1 DMs only (not group DMs)
  const is1on1DM = channel.scopeType === ChannelScopeType.DM;
  const dmUser = useUser(is1on1DM && avatarUserId ? avatarUserId : '');

  const status = useGetChannelUserStatus(channel.id);
  const hasUnreadCount = unreadCount > 0;
  const isMuted = status?.mobileNotificationLevel === NotificationLevel.NONE;
  const shouldShowBold = isDM
    ? hasUnreadCount
    : !isMuted &&
      (hasUnreadCount ||
        (!!status?.lastViewedAt &&
          !!channel.channelStats?.lastActivityAt &&
          channel.channelStats?.lastActivityAt > status.lastViewedAt));

  /**
   * Returns the icon for the channel type:
   * - Group DM: participant count badge
   * - 1:1 DM: other user's avatar
   * - Private channel: lock icon
   * - Public channel: hash icon
   */
  const getIcon = (): ReactElement => {
    if (isGroupDMChannel(channel.scopeType)) {
      const participantCount = parseDMParticipantIds(channel).length;
      return (
        <span className='flex items-center justify-center size-5 rounded-md bg-sidebar-accent text-sidebar-foreground text-[10px] font-medium'>
          {participantCount}
        </span>
      );
    } else if (isDM && avatarUserId) {
      return (
        <Avatar
          userId={avatarUserId}
          size='sm'
          className='rounded-md size-5 flex items-center justify-center'
        />
      );
    }

    return isPrivate ? (
      <ChatLock color={isActive ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'} />
    ) : (
      <Hashtag size={12} />
    );
  };

  return (
    <Tooltip content={displayName} delayDuration={1000} side='top'>
      <Link className='' to={`/chat/dir/${channel.id}`}>
        <div
          className={cn(
            'flex items-center group py-[6px]',
            isDM ? 'gap-[12px]' : 'gap-[8px]',
            isActive && 'bg-sidebar-accent rounded-md px-2',
          )}
        >
          {/* Icon/Avatar with online status for DMs */}
          <div className='relative shrink-0 size-[24px] flex items-center justify-center'>
            {getIcon()}
            {/* Online status indicator for DMs - shown on the Avatar */}
            {/* {isDM && avatarUserId && (
              <div className='absolute bottom-0 right-0 size-[6px] bg-status-success border border-background rounded-full' />
            )} */}
          </div>
          <span
            className={cn(
              'flex-1 truncate min-w-0 text-[16px] leading-[1.2] tracking-[-0.32px] flex items-center gap-1.5',
              shouldShowBold
                ? 'font-semibold text-foreground'
                : 'font-medium text-muted-foreground',
            )}
          >
            <span className='truncate'>{displayName}</span>
            {hasSlashCommandArtifactSideEffect && (
              <span className='relative flex size-2 shrink-0' aria-label='Active incident'>
                <span className='absolute inline-flex size-full animate-ping rounded-full bg-orange-500 opacity-70' />
                <span className='relative inline-flex size-2 rounded-full bg-orange-500' />
              </span>
            )}
            {is1on1DM && (
              <StatusIndicator
                statusEmoji={dmUser?.statusEmoji}
                statusContent={dmUser?.statusContent}
                statusExpiryAt={dmUser?.statusExpiryAt}
                size='sm'
                showOnHover={true}
              />
            )}
          </span>
          {hasActiveCall && (
            <span className='shrink-0 rounded-full bg-status-success px-2 py-1 text-background'>
              <Headphones size={14} />
            </span>
          )}
          {draftMessage && !isActive && (
            <Tooltip content={draftMessage} side='top' sideOffset={6}>
              <PencilEdit size={14} className='shrink-0' />
            </Tooltip>
          )}
          {unreadCount > 0 && (
            <div className='bg-sidebar-primary border border-sidebar-accent-ring h-[18px] px-[6px] py-px rounded-full flex items-center justify-center'>
              <span className='font-mono font-semibold text-[11px] text-sidebar-primary-foreground leading-normal'>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            </div>
          )}
        </div>
      </Link>
    </Tooltip>
  );
};

export default MobileChannelItem;
