import { memo, ReactElement, useState } from 'react';
import { withProfiler } from '../../../utils/withProfiler';
import { Link, useNavigate } from 'react-router-dom';
import { Hash, Pencil, Headphones, X, MoreVertical, Check } from 'lucide-react';
import {
  ChannelVisibility,
  ChannelScopeType,
  ChannelType,
  NotificationLevel,
  ChannelSection,
} from '@xyne/shared';
import { VisibleChannel } from '../../../machines/stateMachine';
import { isDMChannel, isGroupDMChannel, parseDMParticipantIds } from './ChatDirectory.utils';
import { useDraft, useDraftFromDB } from '../../../hooks/useDraft';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import ChatLock from '../../icons/ChatLock';
import { useChannelHasActiveCall } from '../../../hooks/useCalls';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import Badge from '../../ui/Badge';
import Avatar from '../../ui/Avatar/Avatar';
import Tooltip from '../../ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../../ui/dropdown-menu';
import { stripHtml } from '../../xyne-desk/EmailComposer/helpers';
import { cn } from '../../../utils/classNames';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { usePlatform } from '../../../hooks/usePlatform';
import { useUser } from '../../../hooks/useUsers';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { standaloneNavigate } from '../../../utils/electronApp';
import { SupportChannelBadge } from '../SupportChannelBadge';

interface ChannelItemV2Props {
  channel: VisibleChannel;
  unreadCount?: number;
  isActive?: boolean;
  sections?: ChannelSection[];
  onMoveToSection?: (channelId: string, sectionId: string | null) => void;
}

const ChannelItemV2 = memo(
  ({
    channel,
    unreadCount = 0,
    isActive = false,
    sections = [],
    onMoveToSection,
  }: ChannelItemV2Props): ReactElement => {
    const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
    const zero = useZero();
    const context = useAuthContextValues();
    const navigate = useNavigate();

    const currentUserID = context.userID;

    const { isMobile } = usePlatform();

    const draftMessage = useDraft(channel.id, null);
    const draftFromDB = useDraftFromDB(channel.id, null);
    const shouldShowDraft =
      (draftMessage || (draftFromDB && draftFromDB.attachments.length > 0)) && !isActive;
    const isPrivate = channel.visibility === ChannelVisibility.PRIVATE;
    const isDM = isDMChannel(channel.scopeType);

    const hasActiveCall = useChannelHasActiveCall(channel.id);

    const { displayName, avatarUserId } = useChannelDisplayName(channel, currentUserID);

    const status = useGetChannelUserStatus(channel.id);
    const hasUnreadCount = unreadCount > 0;
    const isMuted = status?.desktopNotificationLevel === NotificationLevel.NONE;
    const shouldShowBold = isDM
      ? hasUnreadCount
      : !isMuted &&
        (hasUnreadCount ||
          (!!status?.lastViewedAt &&
            !!channel.channelStats?.lastActivityAt &&
            channel.channelStats.lastActivityAt > status.lastViewedAt));

    const shouldShowCloseButton = isDM && !isActive && unreadCount === 0 && !isMobile;

    // Get user status for 1-on-1 DMs only (not group DMs)
    const is1on1DM = channel.scopeType === ChannelScopeType.DM;
    const dmUser = useUser(is1on1DM && avatarUserId ? avatarUserId : '');

    // Check if this is a support channel
    const isSupportChannel = channel?.type === ChannelType.SUPPORT;

    const handleCloseDm = (e: React.MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      zero.mutate(mutators.channel.closeDm({ channelId: channel.id, updatedAt: Date.now() }));
      // If currently viewing this DM, navigate away
      if (isActive) {
        void navigate('/chat');
      }
    };

    const currentSectionId = status?.sectionId ?? null;
    const isStarred = status?.isStarred ?? false;
    const showSectionMenu =
      !!onMoveToSection && (sections.length > 0 || !!currentSectionId || isStarred);

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
          <span className='flex items-center justify-center size-5 rounded-md bg-sidebar-item-hover text-sidebar-secondary-foreground text-[10px] font-medium'>
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
        <Hash size={12} />
      );
    };

    const handleChannelClick = (e: React.MouseEvent<HTMLAnchorElement>): void => {
      e.preventDefault();
      e.stopPropagation();
      standaloneNavigate(navigate, `/chat/dir/${channel.id}`, { event: e });
    };

    const draftTooltipContent = (
      <div className='flex flex-col items-center'>
        {draftMessage && <span>{stripHtml(draftMessage)}</span>}
        {draftFromDB && draftFromDB.attachments.length > 0 && (
          <span>{draftFromDB.attachments.length} attachment(s)</span>
        )}
      </div>
    );

    return (
      <Link
        className=''
        draggable={false}
        to={`/chat/dir/${channel.id}`}
        onClick={handleChannelClick}
        data-track-category='CHAT_SIDEBAR'
        data-track-name='OPEN_CHANNEL'
        data-track-metadata={JSON.stringify({
          channelId: channel.id,
          channelName: displayName,
          isDM,
        })}
      >
        <div
          className={cn(
            'flex items-center gap-2 h-8 group rounded-md pl-5 pr-1.5 transition-colors',
            isActive
              ? 'text-sidebar-primary-foreground bg-sidebar-item-active'
              : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover',
            shouldShowBold && !isActive && '!font-semibold text-sidebar-unread-foreground',
          )}
          style={shouldShowBold && !isActive ? { fontWeight: '700' } : undefined}
        >
          <span className='flex items-center'>{getIcon()}</span>
          <span className='text-sm flex-1 truncate min-w-0 flex items-center gap-2'>
            <span className='visual-regression-hide truncate'>{displayName}</span>
            {isSupportChannel && <SupportChannelBadge />}
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
          {shouldShowDraft && (
            <Tooltip content={draftTooltipContent} side='top' sideOffset={6}>
              <Pencil size={14} className='shrink-0' />
            </Tooltip>
          )}
          {unreadCount > 0 && !isActive && (
            <Badge className='order-last font-mono h-[18px] bg-sidebar-badge-accent px-1.5 text-sidebar-badge-accent-foreground'>
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
          {showSectionMenu && (
            <DropdownMenu open={sectionMenuOpen} onOpenChange={setSectionMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className={cn(
                    'flex items-center justify-center p-1 rounded-md hover:bg-sidebar-item-hover shrink-0 transition-opacity',
                    sectionMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDown={e => e.stopPropagation()}
                  aria-label='Channel section options'
                  data-track-category='CHAT_SIDEBAR'
                  data-track-name='CHANNEL_SECTION_MENU'
                >
                  <MoreVertical size={14} className='shrink-0' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                onCloseAutoFocus={e => e.preventDefault()}
                className='min-w-[180px]'
              >
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to section</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {sections.length === 0 ? (
                      <DropdownMenuItem disabled>No sections yet</DropdownMenuItem>
                    ) : (
                      sections.map(section => (
                        <DropdownMenuItem
                          key={section.id}
                          className='gap-2'
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            onMoveToSection?.(channel.id, section.id);
                          }}
                        >
                          {section.emoji && (
                            <span className='shrink-0'>{renderEmoji(section.emoji, 'size-4')}</span>
                          )}
                          <span className='flex-1 truncate'>{section.name}</span>
                          {currentSectionId === section.id && (
                            <Check size={14} className='shrink-0' />
                          )}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                {(currentSectionId || isStarred) && (
                  <DropdownMenuItem
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      onMoveToSection?.(channel.id, null);
                    }}
                  >
                    Remove from section
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {shouldShowCloseButton && (
            <button
              type='button'
              className='group-hover:block hidden p-1 rounded-md -blue'
              onClick={handleCloseDm}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='CLOSE_DM_CHANNEL'
              data-track-metadata={JSON.stringify({
                channelId: channel.id,
                channelName: displayName,
              })}
            >
              <X size={14} className='shrink-0' />
            </button>
          )}
        </div>
      </Link>
    );
  },
);

ChannelItemV2.displayName = 'ChannelItemV2';

export default withProfiler(ChannelItemV2, 'ChannelItemV2');
