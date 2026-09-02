import { useState, useEffect, useRef, JSX, cloneElement } from 'react';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useZero } from '../../../hooks/useZero';
import {
  useVisibleChannel,
  useGetChannelUserStatus,
  useUserChannelStatuses,
} from '../../../hooks/useChannels';
import useMeasure from '../../../hooks/useMeasure';
import {
  Star,
  UserTwo,
  NotificationBellOn,
  SearchDefault,
  MultipleCrossCancelDefault,
  ThreeDotsMenuVertical,
  CheckTickSingle,
  InformationCircle,
  ExternalLinkSquare,
  FolderArrowRight,
  UserArrowRight,
} from '@xyne/icons';
import CompactActionsMenu, { ActionMenuItem } from '../../ui/CompactActionsMenu';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import Dialog from '../../ui/Dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { cn } from '../../../utils/classNames';
import { mutators } from '../../../zero/mutators';
import Tooltip from '../../ui/Tooltip';
import Info, { ChannelTab } from '../Info/Info';
import ConversationHeaderMobile from '../ConversationHeaderMobile/ConversationHeaderMobile';
import ChannelIcon from '../ChannelIcon/ChannelIcon';
import { ConversationTabListType } from '../ConversationPannel/ConversationPannel.utils';
import { Button } from '../../ui/Button';
import { CallTriggerModal } from '../../Call/CallTriggerModal/CallTriggerModal';
import { getTargetUserIdForCall } from './ConversationHeader.utils';
import { useUser } from '../../../hooks/useUsers';
import { isOneToOneDMChannel, isDMChannel, keyBetween } from '../ChatDirectory/ChatDirectory.utils';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import { useNavigate } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { standaloneNavigate, APP_DRAG_STYLE, APP_NO_DRAG_STYLE } from '../../../utils/electronApp';
import { usePlatform } from '../../../hooks/usePlatform';
import { XyneAIStar } from '../../icons/xyne-ai';
import { trackAskAIOpened } from '../../../services/otel/xyneAIMetrics';
import { invokeShortcut } from '../../../shortcuts';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

interface ConversationHeaderProps {
  channelId: string;
  previousChannelId?: string | null;
  channelTabs?: ConversationTabListType[];
  activeTab?: string;
  setActiveTab?: (tab: string, e?: React.MouseEvent) => void;
  onClose?: () => void;
}

const ConversationHeader = ({
  channelId,
  previousChannelId,
  channelTabs,
  activeTab,
  setActiveTab,
  onClose,
}: ConversationHeaderProps): JSX.Element | null => {
  const context = useAuthContextValues();
  const zero = useZero();
  const channel = useVisibleChannel(channelId);
  const channelUserStatus = useGetChannelUserStatus(channelId);
  const { displayName, avatarUserId } = useChannelDisplayName(channel, context.userID);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [infoDefaultTab, setInfoDefaultTab] = useState<ChannelTab>('about');
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const [channelSections] = useCachedQuery(queries.userChannelSections({}));
  const allChannelsUserStatus = useUserChannelStatuses();

  // Get user status for 1-on-1 DMs only (not group DMs)
  const isDM = channel && isOneToOneDMChannel(channel.scopeType);
  const dmUser = useUser(avatarUserId || '');

  const { width } = useMeasure({ observeResize: true });

  // Measure header row, title, and actions to dynamically detect overflow
  const rowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const { width: rowWidth } = useMeasure({ ref: rowRef, observeResize: true });
  const { width: titleWidth } = useMeasure({ ref: titleRef, observeResize: true });
  const { width: actionsWidth } = useMeasure({ ref: actionsRef, observeResize: true });
  const fullActionsWidthRef = useRef(0);

  // Track the full (non-compact) actions width so we know when to expand back
  if (actionsWidth > fullActionsWidthRef.current) {
    fullActionsWidthRef.current = actionsWidth;
  }

  // Derive padding+gap from the row instead of hardcoding
  const headerPadding = rowWidth > 0 ? rowWidth - titleWidth - actionsWidth : 0;

  const MIN_TITLE_WIDTH = 150;
  const isCompact =
    rowWidth > 0 &&
    headerPadding > 0 &&
    rowWidth - fullActionsWidthRef.current - headerPadding < MIN_TITLE_WIDTH;
  const { isMobile } = usePlatform();
  const isActivityRightPanel = baseRoute === '/chat/activity' && !isMobile;

  // Get target user ID for 1:1 DM calls
  const targetUserId = getTargetUserIdForCall(channel?.scopeType, channel?.name, context.userID);

  // AI Onboarding: show tooltip after "Done exploring" is clicked
  const [showOnboardingTooltip, setShowOnboardingTooltip] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (): void => {
      setShowOnboardingTooltip(true);
      tooltipTimerRef.current = setTimeout(() => setShowOnboardingTooltip(false), 4000);
    };
    window.addEventListener('ai-onboarding-complete', handler);
    return () => {
      window.removeEventListener('ai-onboarding-complete', handler);
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, []);

  const handleStarToggle = (): void => {
    void zero.mutate(mutators.channel.toggleStarred({ channelId, updatedAt: Date.now() }));
  };

  const handleOpenAllLinks = (e?: React.MouseEvent): void => {
    standaloneNavigate(navigate, `${baseRoute}/${channelId}?tab=links&openAllLinks=true`, {
      ...(e && { event: e }),
    });
  };

  const handleLeaveChannel = (): void => {
    void zero.mutate(mutators.channel.leaveChannel({ channelId, updatedAt: Date.now() }));
    void navigate('/chat');
  };

  const handleMoveToSection = (sectionId: string): void => {
    const timestamp = Date.now();
    const positions = allChannelsUserStatus
      .filter(s => s.sectionId === sectionId)
      .map(s => s.sectionPosition ?? '')
      .filter(p => p !== '')
      .sort();
    const lastPos = positions[positions.length - 1] ?? null;
    const position = keyBetween(lastPos, null);
    if (channelUserStatus?.isStarred) {
      void zero.mutate(mutators.channel.toggleStarred({ channelId, updatedAt: timestamp }));
    }
    void zero.mutate(mutators.channel.moveToSection({ channelId, sectionId, position, timestamp }));
  };

  if (!channel) return null;

  const isChannelDM = isDMChannel(channel.scopeType);

  const compactMenuItems: ActionMenuItem[] = [
    {
      icon: (
        <Star
          size={16}
          variant={(channelUserStatus?.isStarred ?? false) ? 'Solid' : 'Stroke'}
          className={(channelUserStatus?.isStarred ?? false) ? 'text-status-pending' : ''}
        />
      ),
      label: channelUserStatus?.isStarred ? 'Unstar' : 'Star',
      onSelect: handleStarToggle,
      preventClose: true,
    },
    {
      icon: <UserTwo size={16} />,
      label: `Members (${channel.channelStats?.participantCount ?? 0})`,
      onSelect: () => {
        setInfoDefaultTab('members');
        setIsInfoOpen(true);
      },
      visible:
        (channel.channelStats?.participantCount ?? 0) > 1 &&
        !isOneToOneDMChannel(channel.scopeType),
    },
    {
      icon: <NotificationBellOn size={16} />,
      label: 'Notifications',
      onSelect: () => {
        setInfoDefaultTab('notifications');
        setIsInfoOpen(true);
      },
      visible: !!channelUserStatus,
    },
    {
      icon: <SearchDefault size={16} />,
      label: 'Search in this channel',
      onSelect: () => invokeShortcut('mod+f'),
    },
  ];

  // Icon actions sit muted at rest and come up to full strength on hover —
  // same treatment as the tab row below. twMerge lets these win over the
  // ghost variant's own text/hover colors.
  const actionIconClass = 'text-muted-foreground hover:text-foreground';

  if (isMobile || (width > 0 && width < 500))
    return (
      <div className='absolute top-0 left-0 right-0 z-10'>
        <ConversationHeaderMobile
          channelId={channelId}
          {...(previousChannelId !== undefined && { previousChannelId })}
          channel={channel}
          channelUserStatus={channelUserStatus!}
          channelTabs={channelTabs}
          activeTab={activeTab}
          handleStarToggle={handleStarToggle}
        />
      </div>
    );

  return (
    <div
      className={cn(
        'bg-background flex flex-col gap-3 pl-2 pr-3 py-3',
        isActivityRightPanel ? 'min-h-[107px]' : 'min-h-[88px]',
      )}
      style={APP_DRAG_STYLE}
    >
      <div ref={rowRef} className='shrink-0 flex items-center justify-between gap-6'>
        <div
          ref={titleRef}
          className='flex items-center gap-2 text-foreground min-w-0 flex-1 px-1.5'
        >
          <Tooltip content={channelUserStatus?.isStarred ? 'Unstar' : 'Star'}>
            <Button
              variant='ghost'
              size='sm'
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                handleStarToggle();
              }}
              trackId='toggle_star_channel'
              className={cn('h-7 w-7 rounded-lg shrink-0', actionIconClass)}
              style={APP_NO_DRAG_STYLE}
              data-track-category='CHANNELS'
              data-track-name='TOGGLE_STAR_CHANNEL'
              data-track-metadata={JSON.stringify({
                channelId,
                isStarred: channelUserStatus?.isStarred,
              })}
            >
              <Star
                size={16}
                variant={(channelUserStatus?.isStarred ?? false) ? 'Solid' : 'Stroke'}
                className={
                  // Starred stays amber, including on hover; unstarred inherits
                  // the button's muted → foreground treatment.
                  (channelUserStatus?.isStarred ?? false) ? 'text-status-pending' : ''
                }
              />
            </Button>
          </Tooltip>
          <Tooltip
            content='Get channel details'
            side='bottom'
            delayDuration={500}
            {...(isChannelDM ? { open: false } : {})}
          >
            <button
              onClick={() => {
                setInfoDefaultTab('about');
                setIsInfoOpen(true);
              }}
              className='text-base font-semibold tracking-[-0.32px] flex items-center gap-2 min-w-0 h-7 px-1.5 rounded-md hover:bg-muted transition-colors duration-100'
              style={APP_NO_DRAG_STYLE}
              data-testid='channel-info-trigger'
              data-track-category='CHANNELS'
              data-track-name='OPEN_CHANNEL_INFO'
              data-track-metadata={JSON.stringify({ channelId: channel.id, isDM })}
            >
              <span className='shrink-0 inline-flex items-center leading-none'>
                <ChannelIcon channel={channel} />
              </span>
              <span className='visual-regression-hide truncate'>{displayName}</span>
              {isDM && (
                <StatusIndicator
                  statusEmoji={dmUser?.statusEmoji}
                  statusContent={dmUser?.statusContent}
                  statusExpiryAt={dmUser?.statusExpiryAt}
                  size='md'
                  showOnHover={true}
                />
              )}
            </button>
          </Tooltip>
        </div>
        <div
          ref={actionsRef}
          className='flex items-center gap-1 shrink-0'
          style={APP_NO_DRAG_STYLE}
        >
          {!isCompact &&
            (channel.channelStats?.participantCount ?? 0) > 1 &&
            !isOneToOneDMChannel(channel.scopeType) && (
              <Tooltip content='View members'>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => {
                    setInfoDefaultTab('members');
                    setIsInfoOpen(true);
                  }}
                  className={cn('h-7 gap-1.5 px-2 rounded-[10px]', actionIconClass)}
                  data-track-category='CHANNELS'
                  data-track-name='VIEW_MEMBERS'
                  data-track-metadata={JSON.stringify({ channelId })}
                >
                  <span className='shrink-0'>
                    <UserTwo size={16} />
                  </span>
                  <span className='shrink-0'>{channel.channelStats?.participantCount ?? 0}</span>
                </Button>
              </Tooltip>
            )}
          {!isCompact && channelUserStatus && (
            <Tooltip content='Notifications'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  setInfoDefaultTab('notifications');
                  setIsInfoOpen(true);
                }}
                data-track-category='CHANNELS'
                data-track-name='OPEN_CHANNEL_NOTIFICATIONS'
                className={cn('h-7 w-7 rounded-lg', actionIconClass)}
              >
                <span className='shrink-0'>
                  <NotificationBellOn size={16} />
                </span>
              </Button>
            </Tooltip>
          )}
          <Tooltip
            content={showOnboardingTooltip ? 'Ask AI lives here! Click anytime.' : 'Ask AI'}
            {...(showOnboardingTooltip ? { open: true } : {})}
            side='bottom'
          >
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                // Track Ask AI opened event via OTel metrics
                trackAskAIOpened(channel.scopeType);

                // Trigger xstate machine to open XyneAI
                xyneAIActor.send({ type: 'OPEN', channelId });
              }}
              className='h-7 w-7 rounded-lg'
              data-track-category='CHANNELS'
              data-track-name='OPEN_XYNE_AI'
              data-track-metadata={JSON.stringify({ channelId })}
            >
              <XyneAIStar />
            </Button>
          </Tooltip>
          {!isCompact && (
            <Tooltip content='Search in this channel'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => invokeShortcut('mod+f')}
                className={cn('h-7 w-7 rounded-lg', actionIconClass)}
                data-track-category='CHANNELS'
                data-track-name='SEARCH_IN_CHANNEL'
                data-track-metadata={JSON.stringify({ channelId })}
              >
                <SearchDefault size={16} />
              </Button>
            </Tooltip>
          )}
          {isCompact && (
            <CompactActionsMenu
              items={compactMenuItems}
              triggerClassName={cn('h-7 w-7 rounded-lg', actionIconClass)}
            />
          )}
          <CallTriggerModal
            channelId={channelId}
            targetUserIds={targetUserId ? [targetUserId] : []}
            scopeType={channel.scopeType}
            channelName={displayName}
            participantCount={channel.channelStats?.participantCount ?? 0}
            callDisplayName={displayName}
            isMember={!!channelUserStatus}
            disabled={channel.isArchived}
          />
          {!isCompact && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className={cn('h-7 w-7 rounded-lg', actionIconClass)}
                  data-track-category='CHANNELS'
                  data-track-name='OPEN_CHANNEL_MENU'
                >
                  <ThreeDotsMenuVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='min-w-[180px]'>
                <DropdownMenuItem
                  className='gap-2'
                  onClick={() => {
                    setInfoDefaultTab('about');
                    setIsInfoOpen(true);
                  }}
                  data-track-category='CHANNELS'
                  data-track-name='OPEN_CHANNEL_ABOUT'
                >
                  <InformationCircle size={16} className='shrink-0' />
                  Channel details
                </DropdownMenuItem>
                <DropdownMenuItem
                  className='gap-2'
                  onClick={() => handleOpenAllLinks()}
                  data-track-category='CHANNELS'
                  data-track-name='OPEN_ALL_CHANNEL_LINKS'
                >
                  <ExternalLinkSquare size={16} className='shrink-0' />
                  Open all links
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className='gap-2'>
                    <FolderArrowRight size={16} className='shrink-0' />
                    Move to section
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {!channelSections || channelSections.length === 0 ? (
                      <DropdownMenuItem disabled>No sections yet</DropdownMenuItem>
                    ) : (
                      channelSections.map(section => (
                        <DropdownMenuItem
                          key={section.id}
                          className='gap-2'
                          onClick={() => handleMoveToSection(section.id)}
                          data-track-category='CHANNELS'
                          data-track-name='MOVE_CHANNEL_TO_SECTION'
                        >
                          {section.emoji && (
                            <span className='shrink-0'>{renderEmoji(section.emoji, 'size-4')}</span>
                          )}
                          <span className='flex-1 truncate'>{section.name}</span>
                          {!channelUserStatus?.isStarred &&
                            channelUserStatus?.sectionId === section.id && (
                              <CheckTickSingle size={14} className='shrink-0' />
                            )}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                {!isChannelDM && !!channelUserStatus && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className='gap-2 text-destructive focus:text-destructive'
                      onClick={handleLeaveChannel}
                      data-track-category='CHANNELS'
                      data-track-name='LEAVE_CHANNEL'
                    >
                      <UserArrowRight size={16} className='shrink-0' />
                      Leave channel
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onClose && (
            <Button
              variant='ghost'
              size='sm'
              onClick={onClose}
              data-track-category='CHANNELS'
              data-track-name='CLOSE_CONVERSATION_HEADER'
              className={cn('h-7 w-7 rounded-lg', actionIconClass)}
              aria-label='Close'
            >
              <MultipleCrossCancelDefault size={16} />
            </Button>
          )}
        </div>
      </div>
      <Tabs.Root defaultValue={activeTab || 'chat'}>
        <Tabs.List
          className='flex items-center justify-start gap-0.5 px-0.5 overflow-x-auto no-scrollbar'
          style={APP_NO_DRAG_STYLE}
        >
          {channelTabs?.map(tab => (
            <Tabs.Trigger key={tab.value} value={tab.value} asChild>
              <button
                data-testid={`channel-tab-${tab.value}`}
                data-track-category='CHANNELS'
                data-track-name='SWITCH_TAB'
                data-track-metadata={JSON.stringify({ tabValue: tab.value })}
                onClick={e => setActiveTab?.(tab.value || '', e)}
                className={cn(
                  'flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg transition-colors duration-100 cursor-pointer',
                  activeTab === tab.value
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <span className='shrink-0'>
                  {cloneElement(tab.icon, { color: 'currentColor' } as { color: string })}
                </span>
                <span className={cn('text-sm font-medium tracking-[-0.28px]')}>{tab.label}</span>
              </button>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      <Dialog
        className='max-w-[620px] rounded-2xl overflow-hidden'
        open={isInfoOpen}
        onOpenChange={setIsInfoOpen}
      >
        <Info
          channel={channel}
          {...(previousChannelId !== undefined && { previousChannelId })}
          defaultTab={infoDefaultTab}
          onClose={() => setIsInfoOpen(false)}
        />
      </Dialog>
    </div>
  );
};

export default ConversationHeader;
