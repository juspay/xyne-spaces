import { memo, ReactElement, useState } from 'react';
import { withProfiler } from '../../../utils/withProfiler';
import { Link, useNavigate } from 'react-router-dom';
import {
  Hashtag,
  PencilEdit,
  Headphones,
  MultipleCrossCancelDefault,
  ThreeDotsMenuVertical,
  CheckTickSingle,
  FolderArrowRight,
  FolderRemove,
} from '@xyne/icons';
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
  DropdownMenuSeparator,
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
import { useChannelHasSlashCommandArtifactSideEffect } from '../SlashCommandArtifactSideEffects';

interface ChannelItemV2Props {
  channel: VisibleChannel;
  unreadCount?: number;
  isActive?: boolean;
  sections?: ChannelSection[];
  onMoveToSection?: (channelId: string, sectionId: string | null) => void;
  hideDraftIndicator?: boolean;
}

const ChannelItemV2 = memo(
  ({
    channel,
    unreadCount = 0,
    isActive = false,
    sections = [],
    onMoveToSection,
    hideDraftIndicator = false,
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
    const hasSlashCommandArtifactSideEffect = useChannelHasSlashCommandArtifactSideEffect(
      channel.id,
    );

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

      return isPrivate ? <ChatLock /> : <Hashtag size={12} />;
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
            'flex items-center gap-3 h-9 mt-px group rounded-[10px] px-3 border border-transparent transition-colors',
            isActive
              ? 'text-sidebar-accent-foreground font-medium bg-sidebar-accent border-sidebar-border'
              : 'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent',
            shouldShowBold && !isActive && '!font-semibold text-sidebar-accent-foreground',
          )}
          style={shouldShowBold && !isActive ? { fontWeight: '700' } : undefined}
        >
          <span className='flex h-4 w-4 shrink-0 items-center justify-center'>{getIcon()}</span>
          <span className='text-sm flex-1 truncate min-w-0 flex items-center gap-2'>
            <span className='visual-regression-hide truncate'>{displayName}</span>
            {hasSlashCommandArtifactSideEffect && (
              <span className='relative flex size-2 shrink-0' aria-label='Active incident'>
                <span className='absolute inline-flex size-full animate-ping rounded-full bg-orange-500 opacity-70' />
                <span className='relative inline-flex size-2 rounded-full bg-orange-500' />
              </span>
            )}
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
          {shouldShowDraft && !hideDraftIndicator && (
            <Tooltip content={draftTooltipContent} side='top' sideOffset={6}>
              <PencilEdit size={14} className='shrink-0' />
            </Tooltip>
          )}
          {unreadCount > 0 && !isActive && (
            <Badge className='order-last font-mono h-[18px] bg-sidebar-primary border border-sidebar-accent-ring px-1.5 text-sidebar-primary-foreground'>
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
          {showSectionMenu && (
            <DropdownMenu open={sectionMenuOpen} onOpenChange={setSectionMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className={cn(
                    'items-center justify-center p-1 rounded-md hover:bg-sidebar-accent shrink-0',
                    // Use display (not opacity) so the hidden trigger reserves no
                    // width — otherwise it shrinks the name and truncates early.
                    sectionMenuOpen ? 'flex' : 'hidden group-hover:flex',
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
                  <ThreeDotsMenuVertical size={14} className='shrink-0' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                onCloseAutoFocus={e => e.preventDefault()}
                className='min-w-[180px]'
              >
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className='gap-2'>
                    <FolderArrowRight size={14} className='shrink-0' />
                    <span className='flex-1'>Move to section</span>
                  </DropdownMenuSubTrigger>
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
                          data-track-category='CHAT_SIDEBAR'
                          data-track-name='MOVE_CHANNEL_TO_SECTION'
                        >
                          {section.emoji && (
                            <span className='shrink-0'>{renderEmoji(section.emoji, 'size-4')}</span>
                          )}
                          <span className='flex-1 truncate'>{section.name}</span>
                          {currentSectionId === section.id && (
                            <CheckTickSingle size={14} className='shrink-0' />
                          )}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                {(currentSectionId || isStarred) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className='gap-2 text-destructive focus:text-destructive'
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        onMoveToSection?.(channel.id, null);
                      }}
                      data-track-category='CHAT_SIDEBAR'
                      data-track-name='REMOVE_CHANNEL_FROM_SECTION'
                    >
                      <FolderRemove size={14} className='shrink-0' />
                      <span className='flex-1'>Remove from section</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {shouldShowCloseButton && (
            <button
              type='button'
              className='group-hover:block hidden p-1 rounded-md -blue'
              onClick={handleCloseDm}
              data-ph-capture-attribute-track-id='close_dm_channel'
              data-track-category='CHAT_SIDEBAR'
              data-track-name='CLOSE_DM_CHANNEL'
              data-track-metadata={JSON.stringify({
                channelId: channel.id,
                channelName: displayName,
              })}
            >
              <MultipleCrossCancelDefault size={14} className='shrink-0' />
            </button>
          )}
        </div>
      </Link>
    );
  },
);

ChannelItemV2.displayName = 'ChannelItemV2';

export default withProfiler(ChannelItemV2, 'ChannelItemV2');
