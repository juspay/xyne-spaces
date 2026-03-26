import { ReactElement, useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Search, PenBox, ArrowLeft, X } from 'lucide-react';
import { useAllUnreadCount } from '../../../hooks/useUnreadCount';
import { DmListItem } from './DmListItem';
import { useNavigate, Outlet, useLocation, useParams, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { channelService, CreateDmRequest } from '../../../services/Chat/channelService';
import { AddDmForm, CreateDmFormData } from '../AddDmForm/AddDmForm';
import { Dialog } from '../../ui/Dialog';
import { usePlatform } from '../../../hooks/usePlatform';
import { MobileProfileMenu } from '../../ui/MobileProfileMenu/MobileProfileMenu';

import { useAuthContextValues } from '../../../hooks/useAuth';
import { DirectMessagesIcon } from '../../icons';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { useUsers } from '../../../hooks/useUsers';
import { parseDMParticipantIds } from '../ChatDirectory/ChatDirectory.utils';
import Button from '../../ui/Button';
import { useDmsPaginatedMessages } from '../../../hooks/useDmsPaginatedMessages';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

const DmsPage = (): ReactElement => {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const location = useLocation();
  const isOnIndexRoute = location.pathname === '/chat/dm';

  const dmPanelRef = useRef<ImperativePanelHandle>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // All hooks must be called before any conditional returns
  const { channelId } = useParams<{ channelId: string }>();
  const [showAddDmForm, setShowAddDmForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const context = useAuthContextValues();

  const selectedChannelIdRef = useRef<string | undefined>(channelId);
  if (selectedChannelIdRef.current !== channelId) {
    selectedChannelIdRef.current = channelId;
  }

  const createDmMutation = useMutation({
    mutationFn: (data: CreateDmRequest) => channelService.createDm(data),
    onSuccess: response => {
      setShowAddDmForm(false);
      // Navigate to /chat/dm/:channelId for both mobile and desktop
      void navigate(`/chat/dm/${response.id}?fromDM=true`);
    },
  });

  const unreadCounts = useAllUnreadCount();
  const allUsers = useUsers();

  const {
    messagesMap,
    channels: directMessages,
    hasMore,
    loadMore,
    onVisibleRangeChanged,
    selectedChannelMovedVersion,
  } = useDmsPaginatedMessages({ selectedChannelId: channelId });
  // Scroll to top when the selected channel receives an update and moves
  useEffect(() => {
    if (!isMobile && selectedChannelMovedVersion > 0 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: 0, align: 'start', behavior: 'auto' });
    }
  }, [selectedChannelMovedVersion, isMobile]);

  // Create userId -> name map for O(1) lookups
  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    allUsers.forEach(user => {
      if (user.name) map.set(user.id, user.name.toLowerCase());
    });
    return map;
  }, [allUsers]);

  const filteredDms = useMemo(() => {
    if (!searchQuery) return directMessages;

    const query = searchQuery.toLowerCase().trim();

    return directMessages.filter(dm => {
      // For DM/GROUP_DM channels, search by participant names
      const participantIds = parseDMParticipantIds(dm);
      const participantNames = participantIds
        .map(id => userMap.get(id))
        .filter((name): name is string => Boolean(name));
      return participantNames.some(name => name.includes(query));
    });
  }, [directMessages, searchQuery, userMap]);

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

  const renderDmItem = useCallback(
    (_index: number, channel: (typeof filteredDms)[number]) => {
      return (
        <DmListItem
          key={channel.id}
          channel={channel}
          unreadCount={unreadCounts[channel.id] || 0}
          isSelected={channel.id === selectedChannelIdRef.current}
          latestConversation={messagesMap.get(channel.id)}
        />
      );
    },
    [unreadCounts, messagesMap],
  );

  const renderMobileDmItem = useCallback(
    (index: number, channel: (typeof filteredDms)[number]) => {
      return (
        <div className={index === 0 ? 'pt-4' : 'mt-6'}>
          <DmListItem
            key={channel.id}
            channel={channel}
            unreadCount={unreadCounts[channel.id] || 0}
            isSelected={channel.id === selectedChannelIdRef.current}
            latestConversation={messagesMap.get(channel.id)}
          />
        </div>
      );
    },
    [unreadCounts, messagesMap],
  );

  if (isMobile) {
    // If on a specific DM route, render the outlet for chat view with white background
    if (!isOnIndexRoute) {
      return (
        <div className='flex flex-col h-full max-w-full bg-background text-foreground overflow-x-hidden w-screen'>
          <Outlet />
        </div>
      );
    }

    // Show DM list on index route
    return (
      <div className='flex flex-col h-full max-w-full bg-background text-foreground overflow-x-hidden px-2 bg-sidebar w-screen'>
        <div className='block sm:hidden -mx-2 px-4 pt-2 pb-4 bg-[#E9ECF5D9] rounded-b-[24px] border-b border-[#181B1D] border-opacity-[0.07]'>
          {/* Top Row: Logo + Avatar */}
          <div className='flex items-center justify-between mb-4'>
            <div className='flex items-center gap-1'>
              <img src='/svgs/xyne.svg' alt='Xyne Logo' className='h-5 w-auto' />
            </div>
            <MobileProfileMenu userId={context.userID} />
          </div>

          {/* Search Row: Input Only */}
          <div className='relative w-full'>
            <div className='absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none'>
              <Search className='size-5 text-muted-foreground' />
            </div>
            <input
              type='text'
              className='w-full h-11 pl-12 pr-10 py-3 bg-background/70 rounded-full border border-[#181B1D] border-opacity-[0.06] text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-0'
              placeholder='Search'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              data-track-event='blur'
              data-track-category='DM'
              data-track-name='SEARCH_DMS_INPUT'
            />
            {searchQuery && (
              <Button
                className='absolute inset-y-1 right-1 pr-3 flex items-center'
                onClick={() => setSearchQuery('')}
                aria-label='Clear search'
                variant='link'
                size='icon'
              >
                <X className='size-4 text-muted-foreground hover:text-foreground' />
              </Button>
            )}
          </div>
        </div>

        <div className='flex-1 w-full max-w-full overflow-hidden'>
          {filteredDms.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-full pb-24 px-6'>
              <img
                src='/images/empty-chats.png'
                alt='No conversations'
                className='w-full max-w-[280px] h-auto mb-6 opacity-90'
              />
              <h3 className='text-lg font-medium text-foreground mb-2'>No conversations yet</h3>
              <p className='text-sm text-muted-foreground text-center max-w-[250px]'>
                Start a new chat with your team members to collaborate and share ideas.
              </p>
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              data={filteredDms}
              computeItemKey={(_, channel) => channel.id}
              overscan={5}
              increaseViewportBy={{ top: 100, bottom: 100 }}
              endReached={() => {
                if (hasMore) loadMore();
              }}
              rangeChanged={range => onVisibleRangeChanged(range.startIndex)}
              itemContent={renderMobileDmItem}
              components={{
                Footer: () => <div className='pb-20' />,
              }}
              className='h-full'
            />
          )}
        </div>

        {/* Floating Create DM Button */}
        <button
          className='fixed bottom-[85px] right-4 z-40 flex items-center justify-center size-14 rounded-full bg-[#ff4f4f] border-[0.5px] border-[#181B1D]/30 backdrop-blur-[10px] shadow-lg'
          onClick={handleAddDirectMessage}
          aria-label='Create new message'
          data-testid='create-new-message-btn'
          data-track-category='DM'
          data-track-name='CREATE_DM'
        >
          <PenBox className='size-5 text-white' />
        </button>

        {/* Render the Dialog and AddDmForm component */}
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
  }

  // Desktop view - two-panel layout with resizable panels
  return (
    <div className='flex h-full w-full md:rounded-2xl overflow-hidden shadow-md'>
      <PanelGroup
        direction='horizontal'
        className='flex align-top h-full'
        autoSaveId='dm-screen-resize'
      >
        {/* LEFT PANEL - DM List */}
        <Panel ref={dmPanelRef} defaultSize={20} minSize={30} maxSize={40}>
          <div className='flex flex-col bg-background text-foreground border-r border-border h-full'>
            {/* Desktop search/header */}
            <div className='p-4'>
              <div className='flex items-center justify-between mb-3'>
                <div className='flex items-center gap-2'>
                  <Link
                    to='/chat/dir'
                    className='p-1 rounded-md text-foreground hover:text-muted-foreground hover:bg-accent transition-colors duration-200'
                    aria-label='Go back'
                    data-testid='dms-go-back-link'
                  >
                    <ArrowLeft size={20} />
                  </Link>
                  <h2 className='text-lg font-semibold' data-testid='dms-heading'>
                    Direct Messages
                  </h2>
                </div>
                <button
                  className='flex items-center justify-center size-10 rounded-full bg-background border-[0.1px] backdrop-blur-[10px] shadow-md hover:bg-accent hover:border-primary transition-colors'
                  onClick={handleAddDirectMessage}
                  aria-label='Create new message'
                  data-testid='create-new-message-btn'
                  data-track-category='DM'
                  data-track-name='CREATE_DM_DESKTOP'
                >
                  <PenBox className='size-5 text-blue-600' />
                </button>
              </div>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
                <input
                  type='text'
                  className='w-full pl-9 pr-4 py-2 bg-muted rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                  placeholder='Search messages'
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  data-testid='search-messages-input'
                  data-track-event='blur'
                  data-track-category='DM'
                  data-track-name='SEARCH_DMS_INPUT_DESKTOP'
                />
              </div>
            </div>

            <div className='flex-1 w-full overflow-hidden'>
              {filteredDms.length === 0 ? (
                <div className='flex flex-col items-center justify-center h-full px-6'>
                  <img
                    src='/images/empty-chats.png'
                    alt='No conversations'
                    className='w-full max-w-[280px] h-auto mb-6 opacity-90'
                  />
                  <h3 className='text-lg font-medium text-foreground mb-2'>No conversations yet</h3>
                  <p className='text-sm text-muted-foreground text-center max-w-[250px]'>
                    Start a new chat with your team members to collaborate and share ideas.
                  </p>
                </div>
              ) : (
                <Virtuoso
                  ref={virtuosoRef}
                  data={filteredDms}
                  computeItemKey={(_, channel) => channel.id}
                  overscan={5}
                  increaseViewportBy={{ top: 100, bottom: 100 }}
                  endReached={() => {
                    if (hasMore) loadMore();
                  }}
                  rangeChanged={range => onVisibleRangeChanged(range.startIndex)}
                  itemContent={renderDmItem}
                  className='h-full'
                />
              )}
            </div>
          </div>
        </Panel>

        {/* RESIZE HANDLE */}
        <PanelResizeHandle className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-sidebar-badge-accent group-active:bg-sidebar-badge-accent'></div>
        </PanelResizeHandle>

        {/* RIGHT PANEL - Chat View */}
        <Panel>
          <div className='flex-1 flex flex-col bg-background relative h-full'>
            <div className='flex-1 h-full overflow-hidden flex items-center justify-center'>
              {isOnIndexRoute ? (
                <div className='max-w-full max-h-full flex items-center justify-center'>
                  <DirectMessagesIcon />
                </div>
              ) : (
                <div className='w-full h-full'>
                  <Outlet />
                </div>
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>

      {/* Render the Dialog and AddDmForm component */}
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
};

export default DmsPage;
