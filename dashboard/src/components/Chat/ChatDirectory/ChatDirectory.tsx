import { ReactElement, useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLastVisitedChannel } from '../../../hooks/useLastVisitedChannel';
import { usePlatform } from '../../../hooks/usePlatform';
import {
  Bookmark,
  Megaphone,
  ChevronRight,
  Plus,
  Search,
  CornerDownRight,
  Ticket,
  FileText,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { ChatDirectoryProps, ChannelCategory } from './ChatDirectory.types';
import { groupChannelsByScope } from './ChatDirectory.utils';
import { useAllUnreadCount } from '../../../hooks/useUnreadCount';
import { useMutation } from '@tanstack/react-query';
import {
  channelService,
  CreateChannelFormData,
  CreateDmRequest,
} from '../../../services/Chat/channelService';
import { AddDmForm, CreateDmFormData } from '../AddDmForm/AddDmForm';
import AddChannelForm from '../AddChannelForm/AddChannelForm';
import { useUnreadActivitiesCount } from '../../../hooks/useUnreadActivitiesCount';
import Badge from '../../ui/Badge';
import Avatar from '../../ui/Avatar/Avatar';
import Dialog, { cn } from '../../ui/Dialog';
import {
  mixpanelService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/mixpanelService';

import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { Accordion } from 'radix-ui';
import ChannelItemV2 from './ChannelItemV2';
import Tooltip from '../../ui/Tooltip';
import ChannelCommandMenu from './ChannelCommandMenu';
import { useUnreadThreadsCount } from '../../../hooks/useUnreadThreadsCount';
import { useRecapUnreadCount, usePrefetchRecap } from '../../../hooks/useRecapData';

const ChatDirectory = ({
  channelData,
  allChannelsUserStatus,
}: ChatDirectoryProps): ReactElement | null => {
  const navigate = useNavigate();
  const location = useLocation();
  const context = useAuthContextValues();
  const zero = useZero();
  const lastVisitedChannelId = useLastVisitedChannel();
  const { isMobile } = usePlatform();

  // Get unread activities count with cancelled reactions filtered out
  const activityCount = useUnreadActivitiesCount();
  const threadCount = useUnreadThreadsCount();
  const { unreadCount: recapUnreadCount } = useRecapUnreadCount();
  const prefetchRecap = usePrefetchRecap();
  const [showAddChannelForm, setShowAddChannelForm] = useState(false);
  const [showAddDmForm, setShowAddDmForm] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);

  // Get unread counts for all channels (for DMs)
  const unreadCounts = useAllUnreadCount();

  const createChannelMutation = useMutation({
    mutationFn: (data: CreateChannelFormData) => channelService.createChannel(data),
    onSuccess: response => {
      mixpanelService.track(EVENTS.INITIATE_ACTION, {
        type: EVENT_PROPERTIES.ACTION_TYPES.NEW_CHANNEL,
      });
      setShowAddChannelForm(false);
      // Navigate to the newly created channel
      void navigate(`/chat/dir/${response.id}`);
    },
  });

  const createDmMutation = useMutation({
    mutationFn: (data: CreateDmRequest) => channelService.createDm(data),
    onSuccess: (response, variables) => {
      // Track group creation if more than 1 participant (excluding current user)
      const isGroupDm = variables.participantIds.length > 1;

      mixpanelService.track(EVENTS.INITIATE_ACTION, {
        type: isGroupDm
          ? EVENT_PROPERTIES.ACTION_TYPES.NEW_GROUP_DM
          : EVENT_PROPERTIES.ACTION_TYPES.NEW_DM,
        hasInitialMessage: !!variables.message,
      });

      setShowAddDmForm(false);
      // If existing DM was returned (might have been closed), reopen it
      if (response.isExisting) {
        zero.mutate(mutators.channel.reopenDm({ channelId: response.id }));
      }
      // Navigate to the DM channel
      void navigate(`/chat/dir/${response.id}`);
    },
  });

  // Group channels by scope type
  const { starred, channels, directMessages } = useMemo(() => {
    if (!channelData) return { starred: [], channels: [], directMessages: [] };

    const grouped = groupChannelsByScope(channelData, allChannelsUserStatus);

    const sortByUnreadAndActivity = (list: typeof channelData) => {
      const withUnread: typeof channelData = [];
      const withNewActivity: typeof channelData = [];
      const normal: typeof channelData = [];

      for (const channel of list) {
        const status = allChannelsUserStatus.find(
          s => s.channelId === channel.id && s.userId === context.userID,
        );
        const unreadCount = status?.unreadCount ?? 0;
        const lastActivityAt = channel.lastActivityAt ?? 0;
        const lastViewedAt = status?.lastViewedAt ?? 0;

        if (unreadCount > 0) {
          withUnread.push(channel);
        } else if (lastActivityAt > lastViewedAt) {
          withNewActivity.push(channel);
        } else {
          normal.push(channel);
        }
      }

      const sortByActivity = (channels: typeof channelData) =>
        [...channels].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));

      return [
        ...sortByActivity(withUnread),
        ...sortByActivity(withNewActivity),
        ...sortByActivity(normal),
      ];
    };

    return {
      starred: sortByUnreadAndActivity(grouped.starred),
      channels: sortByUnreadAndActivity(grouped.channels),
      directMessages: sortByUnreadAndActivity(grouped.directMessages),
    };
  }, [channelData, allChannelsUserStatus, context.userID]);

  // Redirect to last visited channel or first available channel when at /chat/dir root
  useEffect(() => {
    if (isMobile) return; // Don't redirect on mobile
    if (location.pathname !== '/chat/dir') return; // Only redirect at /chat/dir root

    const targetChannelId =
      lastVisitedChannelId || starred[0]?.id || channels[0]?.id || directMessages[0]?.id;

    if (targetChannelId) {
      void navigate(`/chat/dir/${targetChannelId}`, { replace: true });
    }
  }, [
    location.pathname,
    lastVisitedChannelId,
    starred,
    channels,
    directMessages,
    navigate,
    isMobile,
  ]);

  const handleAddChannelSubmit = (data: CreateChannelFormData): void => {
    createChannelMutation.mutate(data);
  };

  // only use drawer/modal for mobile view otherwise change route
  const handleAddDirectMessage = (): void => {
    if (isMobile) {
      setShowAddDmForm(true);
    } else void navigate(`/chat/search?mode=dm`);
  };

  const handleAddDmSubmit = (data: CreateDmFormData): void => {
    const dmRequest: CreateDmRequest = {
      participantIds: data.participants.map(user => user.id),
      ...(data.message && data.message.trim() && { message: data.message }),
    };
    createDmMutation.mutate(dmRequest);
  };

  return (
    <div
      className='h-full w-full px-2 pt-2 pb-12 flex flex-col bg-sidebar'
      style={{
        backdropFilter: 'blur(var(--sidebar-background-blur))',
        // TODO: add blur to tailwind config
        // intentionally done due to a bug in tailwind config
        // - ref @fractal for issues
      }}
    >
      <div className='block sm:hidden -mx-2 px-2 bg-background/70 backdrop-blur-md rounded-b-3xl border-b border-black/10'>
        <div className='px-2 pt-2 pb-3 flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <img src='/svgs/xyne.svg' alt='Xyne Logo' className='h-3 w-auto' />
          </div>
          <div className='flex items-center gap-2'>
            <button
              onClick={() => setIsCommandMenuOpen(true)}
              className='size-8 flex items-center justify-center rounded-md hover:bg-sidebar-item-hover transition-colors'
              aria-label='Search'
              data-track-category='CHAT_SIDEBAR'
              data-track-name='OPEN_SEARCH'
            >
              <Search className='size-4 text-sidebar-secondary-foreground' />
            </button>
            <Avatar userId={context.userID} size='sm' />
          </div>
        </div>
      </div>
      <div className='hidden sm:block pt-2 pb-3 px-2 h-10 flex items-center justify-between mb-2'>
        <h2 className='text-base font-semibold leading-normal text-sidebar-primary-foreground'>
          Chat
        </h2>
      </div>

      <div className='hidden md:block'>
        <button
          className={cn(
            'flex items-center justify-start gap-3 w-full h-8 text-sm px-2 rounded-md transition-colors hover:bg-sidebar-item-hover',
            activityCount > 0
              ? 'text-sidebar-primary-foreground'
              : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground',
          )}
          onClick={() => {
            mixpanelService.track(EVENTS.INITIATE_ACTION, {
              type: EVENT_PROPERTIES.ACTION_TYPES.ACTIVITY_VIEWED,
            });
            void navigate('/chat/activity');
          }}
          data-track-category='CHAT_SIDEBAR'
          data-track-name='OPEN_ACTIVITY'
          data-track-metadata={JSON.stringify({ activityCount })}
        >
          <span className='size-5 flex items-center justify-center shrink-0'>
            <Megaphone className='size-4' />
          </span>
          <span className='flex-1 min-w-0 text-left truncate block' data-testid='nav-activity'>
            Activity
          </span>
          {activityCount > 0 && (
            <span className='size-5 flex items-center justify-center shrink-0'>
              <Badge
                variant='success'
                className='text-xs h-[18px] px-[6px] py-[1px] bg-sidebar-badge-accent text-sidebar-badge-accent-foreground'
              >
                {activityCount}
              </Badge>
            </span>
          )}
        </button>
        <button
          className={cn(
            'flex items-center justify-start gap-3 w-full h-8 text-sm px-2 rounded-md transition-colors hover:bg-sidebar-item-hover text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground',
          )}
          onClick={() => {
            void navigate('/chat/bookmarks');
          }}
          data-testid='open-bookmarks-button'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='OPEN_BOOKMARKS'
        >
          <span className='size-5 flex items-center justify-center shrink-0'>
            <Bookmark className='size-4' />
          </span>
          <span className='flex-1 min-w-0 text-left truncate block'>Bookmarks</span>
        </button>
        <button
          className={cn(
            'flex items-center justify-start gap-3 w-full h-8 text-sm px-2 rounded-md transition-colors hover:bg-sidebar-item-hover text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground',
          )}
          onClick={() => {
            void navigate('/chat/dm');
          }}
          data-testid='open-dms-button'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='OPEN_DMS'
        >
          <span className='size-5 flex items-center justify-center shrink-0'>
            <MessageCircle className='size-4' />
          </span>
          <span className='flex-1 min-w-0 text-left truncate block'>DMs</span>
        </button>
        <button
          className={cn(
            'flex items-center justify-start gap-3 w-full h-8 text-sm px-2 rounded-md transition-colors hover:bg-sidebar-item-hover text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground',
          )}
          onClick={() => {
            void navigate('/chat/dir/my-tickets');
          }}
          data-track-category='CHAT_SIDEBAR'
          data-track-name='OPEN_MY_TICKETS'
          data-testid='my-tickets-btn'
        >
          <span className='size-5 flex items-center justify-center shrink-0'>
            <Ticket className='size-4' />
          </span>
          <span className='flex-1 min-w-0 text-left truncate block'>My Tickets</span>
        </button>
        <button
          className={cn(
            'flex items-center justify-start gap-3 w-full h-8 text-sm px-2 rounded-md transition-colors hover:bg-sidebar-item-hover text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground',
          )}
          onClick={() => {
            void navigate('/chat/canvas');
          }}
          data-track-category='CHAT_SIDEBAR'
          data-track-name='OPEN_MY_CANVAS'
        >
          <span className='size-5 flex items-center justify-center shrink-0'>
            <FileText className='size-4' />
          </span>
          <span className='flex-1 min-w-0 text-left truncate block'>My Canvas</span>
        </button>
        <button
          className={cn(
            'flex items-center justify-start gap-3 w-full h-8 text-sm px-2 rounded-md transition-colors hover:bg-sidebar-item-hover',
            threadCount > 0
              ? 'text-sidebar-primary-foreground'
              : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground',
          )}
          onClick={() => {
            void navigate('/chat/dir/threads');
          }}
          data-track-category='CHAT_SIDEBAR'
          data-track-name='OPEN_THREADS'
          data-track-metadata={JSON.stringify({ threadCount })}
        >
          <span className='size-5 flex items-center justify-center shrink-0'>
            <CornerDownRight className='size-4' />
          </span>
          <span className='flex-1 min-w-0 text-left truncate block'>Threads</span>
          {threadCount > 0 && (
            <span className='size-5 flex items-center justify-center shrink-0'>
              <Badge
                variant='success'
                className='text-xs h-[18px] px-[6px] py-[1px] bg-sidebar-badge-accent text-sidebar-badge-accent-foreground'
              >
                {threadCount > 10 ? '10+' : threadCount}
              </Badge>
            </span>
          )}
        </button>
        <button
          className={cn(
            'flex items-center justify-start gap-3 w-full h-8 text-sm px-2 rounded-md transition-colors hover:bg-sidebar-item-hover',
            recapUnreadCount > 0
              ? 'text-sidebar-primary-foreground'
              : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground',
          )}
          onMouseEnter={() => {
            // Pre-fetch recap data on hover for instant load
            prefetchRecap();
          }}
          onClick={() => {
            // Always navigate to recap page first
            void navigate('/chat/dir/recap');
          }}
          data-track-category='CHAT_SIDEBAR'
          data-track-name='OPEN_RECAP'
        >
          <span className='size-5 flex items-center justify-center shrink-0'>
            <Sparkles className='size-4' />
          </span>
          <span className='flex-1 min-w-0 text-left truncate block'>Recap</span>
          {recapUnreadCount > 0 && (
            <span className='size-5 flex items-center justify-center shrink-0'>
              <Badge
                variant='success'
                className='text-xs h-[18px] px-[6px] py-[1px] bg-sidebar-badge-accent text-sidebar-badge-accent-foreground'
              >
                {recapUnreadCount > 10 ? '10+' : recapUnreadCount}
              </Badge>
            </span>
          )}
        </button>
      </div>

      <div className='py-3 w-full hidden md:block'>
        <hr className='border-sidebar-divider h-[0.5px]' />
      </div>

      <div className=' flex-1 h-full overflow-y-scroll no-scrollbar pb-[calc(2.5rem+env(safe-area-inset-bottom))] px-0.5 pt-1'>
        <Accordion.Root
          type='multiple'
          className='space-y-4'
          defaultValue={[
            ChannelCategory.STARRED,
            ChannelCategory.CHANNELS,
            ChannelCategory.DIRECT_MESSAGES,
          ]}
        >
          {/* Starred  */}
          {starred.length > 0 && (
            <Accordion.Item value={ChannelCategory.STARRED}>
              <Accordion.Trigger asChild>
                <button className='group flex items-center justify-start gap-1 w-full h-8 text-sidebar-secondary-foreground text-xs font-medium'>
                  <span className='text-left truncate block'>Starred</span>
                  <span className='flex items-center justify-center shrink-0'>
                    <ChevronRight
                      strokeWidth={2.33}
                      className='size-3 transition-transform duration-200 group-data-[state=open]:rotate-90'
                    />
                  </span>
                </button>
              </Accordion.Trigger>
              <Accordion.Content>
                {starred.map(channel => (
                  <ChannelItemV2
                    key={channel.id}
                    channel={channel}
                    unreadCount={unreadCounts[channel.id] ?? 0}
                  />
                ))}
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* Channels  */}
          <Accordion.Item value={ChannelCategory.CHANNELS}>
            <Accordion.Trigger asChild>
              <div className='group px-1 flex items-center justify-between gap-2 '>
                <button className=' flex items-center justify-start gap-1 w-full h-8 text-sidebar-secondary-foreground text-xs font-medium'>
                  <span className='text-left truncate block'>Channels</span>
                  <span className='size-4 flex items-center justify-center shrink-0'>
                    <ChevronRight
                      strokeWidth={2.33}
                      className='size-3 transition-transform duration-200 group-data-[state=open]:rotate-90'
                    />
                  </span>
                </button>
                <div className='flex items-center gap-2 mr-0.5 opacity-0 group-hover:opacity-100 transition-opacity ease-in-out duration-300'>
                  <Tooltip content='Browse channels' side='top' sideOffset={0} delayDuration={500}>
                    <button
                      className='group/child text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover transition-colors rounded-md p-1'
                      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void navigate('/chat/search?mode=channels');
                      }}
                      data-track-category='CHAT_SIDEBAR'
                      data-track-name='BROWSE_CHANNELS'
                    >
                      <Search
                        strokeWidth={2.33}
                        className='size-3.5 text-sidebar-secondary-foreground group-hover/child:text-sidebar-badge-accent transition-colors'
                      />
                    </button>
                  </Tooltip>
                  <Tooltip content='Create channel' side='top' sideOffset={0} delayDuration={500}>
                    <button
                      className='group/child text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover transition-colors rounded-md p-1'
                      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowAddChannelForm(true);
                      }}
                      data-testid='create-new-channel'
                      data-track-event='BUTTON_CLICK'
                      data-track-category='CHAT_SIDEBAR'
                      data-track-name='CREATE_NEW_CHANNEL'
                      data-track-metadata={JSON.stringify({ source: 'directory' })}
                    >
                      <Plus
                        strokeWidth={2.33}
                        className='size-3.5 text-sidebar-secondary-foreground group-hover/child:text-sidebar-badge-accent transition-colors'
                      />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </Accordion.Trigger>
            <Accordion.Content data-testid='channel-list'>
              {channels.map(channel => (
                <ChannelItemV2
                  key={channel.id}
                  channel={channel}
                  unreadCount={unreadCounts[channel.id] ?? 0}
                />
              ))}
            </Accordion.Content>
          </Accordion.Item>

          {/* DMS  */}
          <Accordion.Item value={ChannelCategory.DIRECT_MESSAGES}>
            <Accordion.Trigger asChild>
              <div className='group px-1 flex items-center justify-between gap-2 '>
                <button className='flex items-center justify-start gap-1 w-full h-8 text-sidebar-secondary-foreground text-xs font-medium'>
                  <span className='text-left truncate block'>Direct Messages</span>
                  <span className='size-3.5 flex items-center justify-center shrink-0'>
                    <ChevronRight
                      strokeWidth={2.33}
                      className='size-3 transition-transform duration-200 group-data-[state=open]:rotate-90'
                    />
                  </span>
                </button>
                <Tooltip content='Add direct message' side='top' sideOffset={0} delayDuration={500}>
                  <button
                    className='group/child text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground opacity-0 group-hover:opacity-100 transition-opacity ease-in-out duration-300 hover:bg-sidebar-item-hover rounded-md p-1 mr-0.5'
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleAddDirectMessage();
                    }}
                    data-testid='create-new-dm'
                    data-track-event='BUTTON_CLICK'
                    data-track-category='CHAT_SIDEBAR'
                    data-track-name='CREATE_DIRECT_MESSAGE'
                    data-track-metadata={JSON.stringify({ source: 'directory' })}
                  >
                    <Plus
                      strokeWidth={2.33}
                      className='size-3.5 text-sidebar-secondary-foreground group-hover/child:text-sidebar-badge-accent transition-colors'
                    />
                  </button>
                </Tooltip>
              </div>
            </Accordion.Trigger>
            <Accordion.Content data-testid='dm-list'>
              {directMessages.map(channel => (
                <ChannelItemV2
                  key={channel.id}
                  channel={channel}
                  unreadCount={unreadCounts[channel.id] ?? 0}
                />
              ))}
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
      </div>

      <Dialog open={showAddChannelForm} onOpenChange={setShowAddChannelForm}>
        <div className='p-4'>
          <AddChannelForm
            loading={createChannelMutation.isPending}
            onSubmit={handleAddChannelSubmit}
            onCancel={() => setShowAddChannelForm(false)}
          />
        </div>
      </Dialog>

      <Dialog open={showAddDmForm} onOpenChange={setShowAddDmForm}>
        <div className='p-4'>
          <AddDmForm
            loading={createDmMutation.isPending}
            onSubmit={handleAddDmSubmit}
            onCancel={() => setShowAddDmForm(false)}
          />
        </div>
      </Dialog>
    </div>
  );

  return (
    <div className='h-full'>
      <div className='h-full overflow-scroll no-scrollbar px-3 relative bg-rsed-300'>
        {/* Mobile  */}
        {/* <div className='sticky top-0 z-50 pt-4  block min-[500px]:hidden'>
          <div className='absolute top-0 left-0 right-0 h-20 touch-none bg-gradient-to-b from-white to-transparent z-10'></div>
          <div className='flex items-center justify-between gap-2'>
            <button
              onClick={() => void navigate('/chat')}
              className='h-8 px-4 flex items-center justify-center rounded-[999px] border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] min-[500px]:hidden z-30 '
            >
              Chat
            </button>
            <div className='z-30'>
              <button
                onClick={() => setIsCommandMenuOpen(true)}
                className='h-8 px-2 flex items-center justify-center rounded-[999px] border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] min-[500px]:hidden z-30'
              >
                <Search className='size-4' />
              </button>
            </div>
          </div>
        </div> */}

        {/* Desktop */}
        {/* <div className=' sticky top-0 z-50 hidden min-[500px]:block pt-4 bg-sidebar-background'>
          <div className='pb-6 flex items-center justify-between'>
            <button onClick={() => void navigate('/chat')} className='cursor-pointer'>
              <h2 className='text-black font-inter text-base font-semibold leading-normal'>Chat</h2>
            </button>
            <button
              onClick={() => setIsCommandMenuOpen(true)}
              className='size-8 items-center justify-center hidden min-[500px]:flex cursor-pointer'
            >
              <Search className='size-4' />
            </button>
          </div>
          <ChatDirectoryButton
            icon={<NotificationBellIcons />}
            label='Activity'
            {...(activityCount > 0 && { count: activityCount })}
            onClick={() => {
              mixpanelService.track(EVENTS.INITIATE_ACTION, {
                type: EVENT_PROPERTIES.ACTION_TYPES.ACTIVITY_VIEWED,
              });
              void navigate('/chat/dir/activity');
            }}
          />
          <ChatDirectoryButton
            icon={<ThreadIcon />}
            label='Thread'
            disabled={true}
            onClick={() => {
              mixpanelService.track(EVENTS.INITIATE_ACTION, {
                type: EVENT_PROPERTIES.ACTION_TYPES.THREAD_VIEWED,
              });
              void navigate('/chat/threads');
            }}
          />
          <ChatDirectoryButton
            icon={<Bookmark className='size-5' />}
            label='Bookmarks'
            onClick={() => {
              void navigate('/chat/bookmarks');
            }}
          />
          <hr className='border-border mt-4' />
        </div> */}
        {/* 
        <div className='h-fit min-[500px]:pt-0 pt-4'>
          <div data-id='starred-channels' className='mt-3'>
            {starred.length > 0 && (
              <div>
                <DirectorySectionHeader
                  title='Starred'
                  isExpanded={isStarredExpanded}
                  onToggle={() => setIsStarredExpanded(!isStarredExpanded)}
                  // No onAdd for starred section
                />

                {isStarredExpanded && (
                  <div>
                    {starred.map(channel => (
                      <ChannelItem
                        key={channel.id}
                        channel={channel}
                        activeChannelId={activeChannelId}
                        currentUserID={context.userID}
                        draftMessage={allDrafts[channel.id]?.text.trim() || undefined}
                        unreadCount={unreadCounts[channel.id] ?? 0}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div data-id='channels' className='mt-3'>
            <DirectorySectionHeader
              title='Channels'
              isExpanded={isChannelsExpanded}
              onToggle={() => setIsChannelsExpanded(!isChannelsExpanded)}
              renderAddButton={() => (
                <ChannelAddDropdown
                  open={showChannelMenu}
                  onOpenChange={setShowChannelMenu}
                  onBrowseChannels={() => void navigate('/chat/search?mode=channels')}
                  onCreateChannel={() => setShowAddChannelForm(true)}
                />
              )}
            />

            {isChannelsExpanded && (
              <div>
                {channels.map(channel => (
                  <ChannelItem
                    key={channel.id}
                    channel={channel}
                    activeChannelId={activeChannelId}
                    draftMessage={allDrafts[channel.id]?.text.trim() || undefined}
                    currentUserID={context.userID}
                    unreadCount={unreadCounts[channel.id] ?? 0}
                  />
                ))}
                {channels.length === 0 && (
                  <div className='p-2 text-[13px] text-neutral-400 w-full text-center'>
                    No channels found
                  </div>
                )}
              </div>
            )}
          </div>

          <div data-id='direct-messages' className='mt-3'>
            <DirectorySectionHeader
              title='Direct Messages'
              isExpanded={isDirectMessagesExpanded}
              onToggle={() => setIsDirectMessagesExpanded(!isDirectMessagesExpanded)}
              onAdd={handleAddDirectMessage}
            />

            {isDirectMessagesExpanded && (
              <div>
                {directMessages.map(channel => (
                  <ChannelItem
                    key={channel.id}
                    channel={channel}
                    activeChannelId={activeChannelId}
                    draftMessage={allDrafts[channel.id]?.text.trim() || undefined}
                    currentUserID={context.userID}
                    unreadCount={unreadCounts[channel.id] ?? 0}
                  />
                ))}
                {directMessages.length === 0 && (
                  <div className='p-2 text-[13px] text-neutral-400 w-full text-center'>
                    No direct messages found
                  </div>
                )}
              </div>
            )}
          </div>
        </div> */}
      </div>

      <Dialog open={showAddChannelForm} onOpenChange={setShowAddChannelForm}>
        <div className='p-4'>
          <AddChannelForm
            loading={createChannelMutation.isPending}
            onSubmit={handleAddChannelSubmit}
            onCancel={() => setShowAddChannelForm(false)}
          />
        </div>
      </Dialog>

      <Dialog open={showAddDmForm} onOpenChange={setShowAddDmForm}>
        <div className='p-4'>
          <AddDmForm
            loading={createDmMutation.isPending}
            onSubmit={handleAddDmSubmit}
            onCancel={() => setShowAddDmForm(false)}
          />
        </div>
      </Dialog>

      <ChannelCommandMenu
        channels={channels}
        starred={starred}
        directMessages={directMessages}
        currentUserID={context.userID}
        unreadCounts={unreadCounts}
        open={isCommandMenuOpen}
        onOpenChange={setIsCommandMenuOpen}
      />
    </div>
  );
};

export default ChatDirectory;
