import { ReactElement, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  PlusDefault,
  SearchDefault,
  ChevronSortVertical,
  ListSortAlphabetically,
  NotificationBellOn,
  ClockDefault,
  CheckTickSingle,
} from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { ChatDirectoryProps, ChannelCategory } from './ChatDirectory.types';
import { useAllUnreadCount } from '../../../hooks/useUnreadCount';
import { useMutation } from '@tanstack/react-query';
import {
  channelService,
  CreateChannelFormData,
  CreateDmRequest,
} from '../../../services/Chat/channelService';
import { AddDmForm, CreateDmFormData } from '../AddDmForm/AddDmForm';
import AddChannelForm from '../AddChannelForm/AddChannelForm';
import { AddPeopleForm } from '../AddPeopleForm/AddPeopleForm';
import Dialog from '../../ui/Dialog';
import ChannelCommandMenu from './ChannelCommandMenu';
import {
  posthogService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/posthogService';
import { MobileProfileMenu } from '../../ui/MobileProfileMenu/MobileProfileMenu';

import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { useChannelSort } from '../../../hooks/useChannelSort';
import { ChannelSortOrder } from '@xyne/shared';
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

  const { starred, channels, directMessages, channelSortOrder, setChannelSortOrder } =
    useChannelSort(channelData, allChannelsUserStatus, context.userID);

  const [showAddChannelForm, setShowAddChannelForm] = useState(false);
  const [showAddDmForm, setShowAddDmForm] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [showAddPeopleDialog, setShowAddPeopleDialog] = useState(false);
  const [newlyCreatedChannelId, setNewlyCreatedChannelId] = useState<string | null>(null);

  // Get unread counts for all channels (for DMs)
  const unreadCounts = useAllUnreadCount();

  const createChannelMutation = useMutation({
    mutationFn: (data: CreateChannelFormData) => channelService.createChannel(data),
    onSuccess: response => {
      posthogService.capture(EVENTS.INITIATE_ACTION, {
        type: EVENT_PROPERTIES.ACTION_TYPES.NEW_CHANNEL,
      });
      setShowAddChannelForm(false);
      void navigate(`/chat/dir/${response.id}`);
      // Auto-open add people dialog after channel creation
      setNewlyCreatedChannelId(response.id);
      setShowAddPeopleDialog(true);
    },
  });

  const createDmMutation = useMutation({
    mutationFn: (data: CreateDmRequest) => channelService.createDm(data),
    onSuccess: (response, variables) => {
      const isGroupDm = variables.participantIds.length > 1;

      posthogService.capture(EVENTS.INITIATE_ACTION, {
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

  const sectionHeadingClass =
    'font-medium text-[14px] text-muted-foreground leading-[1.2] tracking-[-0.14px] text-left truncate block';

  return (
    <div
      className='h-full w-full px-2 flex flex-col bg-sidebar'
      style={{
        backdropFilter: 'blur(var(--sidebar-background-blur))',
      }}
    >
      {/* Mobile Header - Matches Figma Design */}
      <div
        className='-mx-2 px-4 pt-2 pb-4 rounded-b-[24px] border-b border-border'
        style={{ background: 'var(--mobile-panel-bg)' }}
      >
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
          className='w-full flex items-center gap-3 px-4 py-3 bg-background rounded-full text-left border border-border'
          data-track-category='MOBILE_CHAT_DIRECTORY'
          data-track-name='OPEN_SEARCH_MOBILE'
        >
          <SearchDefault size={20} className='text-muted-foreground shrink-0' />
          <span className='text-sm text-muted-foreground'>Search...</span>
        </button>
      </div>

      <div className='flex-1 h-full overflow-y-scroll no-scrollbar pb-32 px-3 pt-2'>
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
                    <span className={sectionHeadingClass}>Starred</span>
                    <span className='size-[20px] flex items-center justify-center shrink-0'>
                      <ChevronRight
                        strokeWidth={2.33}
                        size={16}
                        className='transition-transform duration-200 group-data-[state=open]:rotate-90'
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
                  <span className={sectionHeadingClass}>Channels</span>
                  <span className='size-[20px] flex items-center justify-center shrink-0'>
                    <ChevronRight
                      strokeWidth={2.33}
                      size={16}
                      className='transition-transform duration-200 group-data-[state=open]:rotate-90'
                    />
                  </span>
                </button>
                <div className='flex items-center gap-2'>
                  <DropdownMenu>
                    <Tooltip content='Sort channels' side='top' sideOffset={0} delayDuration={500}>
                      <DropdownMenuTrigger asChild>
                        <button
                          className='text-muted-foreground hover:text-foreground transition-colors focus:outline-none'
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          data-track-category='MOBILE_CHAT_DIRECTORY'
                          data-track-name='SORT_CHANNELS_MOBILE'
                        >
                          <ChevronSortVertical size={20} />
                        </button>
                      </DropdownMenuTrigger>
                    </Tooltip>
                    <DropdownMenuContent
                      align='end'
                      className='min-w-[160px]'
                      onCloseAutoFocus={e => e.preventDefault()}
                    >
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation();
                          setChannelSortOrder(ChannelSortOrder.UNREAD);
                        }}
                        data-track-category='MOBILE_CHAT_DIRECTORY'
                        data-track-name='SORT_CHANNELS_BY_UNREAD'
                        className='gap-2'
                      >
                        <NotificationBellOn size={14} className='shrink-0' />
                        <span className='flex-1'>Unread & Activity</span>
                        {channelSortOrder === ChannelSortOrder.UNREAD && (
                          <CheckTickSingle size={14} className='shrink-0' />
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation();
                          setChannelSortOrder(ChannelSortOrder.RECENCY);
                        }}
                        data-track-category='MOBILE_CHAT_DIRECTORY'
                        data-track-name='SORT_CHANNELS_BY_RECENCY'
                        className='gap-2'
                      >
                        <ClockDefault size={14} className='shrink-0' />
                        <span className='flex-1'>By recency</span>
                        {channelSortOrder === ChannelSortOrder.RECENCY && (
                          <CheckTickSingle size={14} className='shrink-0' />
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation();
                          setChannelSortOrder(ChannelSortOrder.ALPHABETICAL);
                        }}
                        data-track-category='MOBILE_CHAT_DIRECTORY'
                        data-track-name='SORT_CHANNELS_BY_ALPHABETICAL'
                        className='gap-2'
                      >
                        <ListSortAlphabetically size={14} className='shrink-0' />
                        <span className='flex-1'>Alphabetical A-Z</span>
                        {channelSortOrder === ChannelSortOrder.ALPHABETICAL && (
                          <CheckTickSingle size={14} className='shrink-0' />
                        )}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Tooltip content='Add channel' side='top' sideOffset={0} delayDuration={500}>
                    <button
                      className='text-muted-foreground hover:text-foreground transition-colors'
                      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowAddChannelForm(true);
                      }}
                      data-track-category='MOBILE_CHAT_DIRECTORY'
                      data-track-name='ADD_CHANNEL_MOBILE'
                    >
                      <PlusDefault size={20} />
                    </button>
                  </Tooltip>
                </div>
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
                  <span className={sectionHeadingClass}>Direct Messages</span>
                  <span className='size-[20px] flex items-center justify-center shrink-0'>
                    <ChevronRight
                      strokeWidth={2.33}
                      size={16}
                      className='transition-transform duration-200 group-data-[state=open]:rotate-90'
                    />
                  </span>
                </button>
                <Tooltip content='Add direct message' side='top' sideOffset={0} delayDuration={500}>
                  <button
                    className='text-muted-foreground hover:text-foreground transition-colors'
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleAddDirectMessage();
                    }}
                    data-track-category='MOBILE_CHAT_DIRECTORY'
                    data-track-name='ADD_DM_MOBILE'
                  >
                    <PlusDefault size={20} />
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

      {newlyCreatedChannelId && (
        <Dialog
          open={showAddPeopleDialog}
          onOpenChange={setShowAddPeopleDialog}
          title='Add Members'
        >
          <AddPeopleForm
            channelId={newlyCreatedChannelId}
            onSuccess={() => setShowAddPeopleDialog(false)}
            onCancel={() => setShowAddPeopleDialog(false)}
          />
        </Dialog>
      )}
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
