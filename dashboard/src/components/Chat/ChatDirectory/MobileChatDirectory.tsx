import { ReactElement, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus, Search } from 'lucide-react';
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
import Dialog from '../../ui/Dialog';
import ChannelCommandMenu from './ChannelCommandMenu';
import {
  mixpanelService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/mixpanelService';
import { MobileProfileMenu } from '../../ui/MobileProfileMenu/MobileProfileMenu';

import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { Accordion } from 'radix-ui';
import MobileChannelItem from './MobileChannelItem';
import Tooltip from '../../ui/Tooltip';

const MobileChatDirectory = ({
  channelData,
  allChannelsUserStatus,
}: ChatDirectoryProps): ReactElement | null => {
  const navigate = useNavigate();
  const context = useAuthContextValues();
  const zero = useZero();

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
      void navigate(`/chat/dir/${response.id}`);
    },
  });

  const createDmMutation = useMutation({
    mutationFn: (data: CreateDmRequest) => channelService.createDm(data),
    onSuccess: (response, variables) => {
      const isGroupDm = variables.participantIds.length > 1;

      mixpanelService.track(EVENTS.INITIATE_ACTION, {
        type: isGroupDm
          ? EVENT_PROPERTIES.ACTION_TYPES.NEW_GROUP_DM
          : EVENT_PROPERTIES.ACTION_TYPES.NEW_DM,
        hasInitialMessage: !!variables.message,
      });

      setShowAddDmForm(false);
      if (response.isExisting) {
        zero.mutate(mutators.channel.reopenDm({ channelId: response.id, updatedAt: Date.now() }));
      }
      void navigate(`/chat/dir/${response.id}`);
    },
  });

  // Group channels by scope type
  const { starred, channels, directMessages } = useMemo(() => {
    if (!channelData) return { starred: [], channels: [], directMessages: [] };

    const grouped = groupChannelsByScope(channelData, allChannelsUserStatus);

    const sortByActivity = (list: typeof channelData) =>
      [...list].sort(
        (a, b) =>
          new Date(b.channelStats?.lastActivityAt ?? 0).getTime() -
          new Date(a.channelStats?.lastActivityAt ?? 0).getTime(),
      );

    return {
      starred: sortByActivity(grouped.starred),
      channels: sortByActivity(grouped.channels),
      directMessages: sortByActivity(grouped.directMessages),
    };
  }, [channelData, context.userID, allChannelsUserStatus]);

  const handleAddChannelSubmit = (data: CreateChannelFormData): void => {
    createChannelMutation.mutate(data);
  };

  const handleAddDirectMessage = (): void => {
    setShowAddDmForm(true);
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
      className='h-full w-full px-2 flex flex-col bg-sidebar'
      style={{
        backdropFilter: 'blur(var(--sidebar-background-blur))',
      }}
    >
      {/* Mobile Header - Matches Figma Design */}
      <div className='-mx-2 px-4 pt-2 pb-4 bg-[#E9ECF5D9] rounded-b-[24px] border-b border-[#181B1D] border-opacity-[0.07]'>
        {/* Top Row: Logo + Name Badge | Avatar */}
        <div className='flex items-center justify-between mb-4'>
          <div className='flex items-center gap-1'>
            <img src='/svgs/xyne.svg' alt='Xyne Logo' className='h-5 w-auto' />
          </div>
          <MobileProfileMenu userId={context.userID} />
        </div>
        {/* Search Bar */}
        <button
          onClick={() => setIsCommandMenuOpen(true)}
          className='w-full flex items-center gap-3 px-4 py-3 bg-background/70 rounded-full text-left border border-[#181B1D] border-opacity-[0.06]'
          data-track-category='MOBILE_CHAT_DIRECTORY'
          data-track-name='OPEN_SEARCH_MOBILE'
        >
          <Search className='size-5 text-muted-foreground shrink-0' />
          <span className='text-sm text-muted-foreground'>Search...</span>
        </button>
      </div>

      <div className='flex-1 h-full overflow-y-scroll no-scrollbar pb-10 px-3 pt-2'>
        <Accordion.Root
          type='multiple'
          className='space-y-4'
          defaultValue={[
            ChannelCategory.STARRED,
            ChannelCategory.CHANNELS,
            ChannelCategory.DIRECT_MESSAGES,
          ]}
        >
          {/* Starred */}
          {starred.length > 0 && (
            <Accordion.Item value={ChannelCategory.STARRED}>
              <Accordion.Trigger asChild>
                <div className='group flex items-center justify-between w-full py-[8px]'>
                  <button className='flex items-center'>
                    <span className='font-medium text-[14px] text-[#a0a7ab] leading-[1.2] tracking-[-0.14px] text-left truncate block'>
                      Starred
                    </span>
                    <span className='size-[20px] flex items-center justify-center shrink-0'>
                      <ChevronRight
                        strokeWidth={2.33}
                        className='size-4 transition-transform duration-200 group-data-[state=open]:rotate-90'
                      />
                    </span>
                  </button>
                </div>
              </Accordion.Trigger>
              <Accordion.Content>
                {starred.map(channel => (
                  <MobileChannelItem
                    key={channel.id}
                    channel={channel}
                    unreadCount={unreadCounts[channel.id] ?? 0}
                  />
                ))}
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* Channels */}
          <Accordion.Item value={ChannelCategory.CHANNELS}>
            <Accordion.Trigger asChild>
              <div className='group flex items-center justify-between w-full py-[8px]'>
                <button className='flex items-center'>
                  <span className='font-medium text-[14px] text-[#a0a7ab] leading-[1.2] tracking-[-0.14px] text-left truncate block'>
                    Channels
                  </span>
                  <span className='size-[20px] flex items-center justify-center shrink-0'>
                    <ChevronRight
                      strokeWidth={2.33}
                      className='size-4 transition-transform duration-200 group-data-[state=open]:rotate-90'
                    />
                  </span>
                </button>
                <Tooltip content='Add channel' side='top' sideOffset={0} delayDuration={500}>
                  <button
                    className='text-[#a0a7ab] hover:text-[#181B1D] transition-colors'
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowAddChannelForm(true);
                    }}
                    data-track-category='MOBILE_CHAT_DIRECTORY'
                    data-track-name='ADD_CHANNEL_MOBILE'
                  >
                    <Plus className='size-5' />
                  </button>
                </Tooltip>
              </div>
            </Accordion.Trigger>
            <Accordion.Content>
              {channels.map(channel => (
                <MobileChannelItem
                  key={channel.id}
                  channel={channel}
                  unreadCount={unreadCounts[channel.id] ?? 0}
                />
              ))}
            </Accordion.Content>
          </Accordion.Item>

          {/* DMS */}
          <Accordion.Item value={ChannelCategory.DIRECT_MESSAGES}>
            <Accordion.Trigger asChild>
              <div className='group flex items-center justify-between w-full py-[8px]'>
                <button className='flex items-center'>
                  <span className='font-medium text-[14px] text-[#a0a7ab] leading-[1.2] tracking-[-0.14px] text-left truncate block'>
                    Direct Messages
                  </span>
                  <span className='size-[20px] flex items-center justify-center shrink-0'>
                    <ChevronRight
                      strokeWidth={2.33}
                      className='size-4 transition-transform duration-200 group-data-[state=open]:rotate-90'
                    />
                  </span>
                </button>
                <Tooltip content='Add direct message' side='top' sideOffset={0} delayDuration={500}>
                  <button
                    className='text-[#a0a7ab] hover:text-[#181B1D] transition-colors'
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleAddDirectMessage();
                    }}
                    data-track-category='MOBILE_CHAT_DIRECTORY'
                    data-track-name='ADD_DM_MOBILE'
                  >
                    <Plus className='size-5' />
                  </button>
                </Tooltip>
              </div>
            </Accordion.Trigger>
            <Accordion.Content>
              {directMessages.map(channel => (
                <MobileChannelItem
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

export default MobileChatDirectory;
