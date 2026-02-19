import { ReactElement, useMemo, useState, useRef } from 'react';
import { Search, PenBox, ArrowLeft, X } from 'lucide-react';
import { useAllChannels } from '../../../hooks/useChannels';
import { ChannelScopeType } from '@xyne/shared';
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

const DmsPage = (): ReactElement => {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const location = useLocation();
  const isOnIndexRoute = location.pathname === '/chat/dm';

  const dmPanelRef = useRef<ImperativePanelHandle>(null);

  // All hooks must be called before any conditional returns
  const { channelId } = useParams<{ channelId: string }>();
  const channelData = useAllChannels();
  const [showAddDmForm, setShowAddDmForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const context = useAuthContextValues();

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

  const displayUnreadCounts: Record<string, number> = {
    ...unreadCounts,
  };

  const directMessages = useMemo(() => {
    if (!channelData) return [];

    // Filter for DM and GROUP_DM channels, then sort by activity
    return channelData
      .filter(
        channel =>
          channel.scopeType === ChannelScopeType.DM ||
          channel.scopeType === ChannelScopeType.GROUP_DM,
      )
      .sort(
        (a, b) =>
          new Date(b.lastActivityAt ?? 0).getTime() - new Date(a.lastActivityAt ?? 0).getTime(),
      );
  }, [channelData]);

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

  // Mobile view - show DM list on index route, chat view otherwise
  if (isMobile) {
    // If on a specific DM route, render the outlet for chat view with white background
    if (!isOnIndexRoute) {
      return (
        <div className='flex flex-col h-full max-w-full bg-white text-gray-900 overflow-x-hidden w-screen'>
          <Outlet />
        </div>
      );
    }

    // Show DM list on index route
    return (
      <div className='flex flex-col h-full max-w-full bg-white text-gray-900 overflow-x-hidden px-2 bg-sidebar w-screen'>
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
              <Search className='size-5 text-gray-400' />
            </div>
            <input
              type='text'
              className='w-full h-11 pl-12 pr-10 py-3 bg-white bg-opacity-70 rounded-full border border-[#181B1D] border-opacity-[0.06] text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0'
              placeholder='Search'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <Button
                className='absolute inset-y-1 right-1 pr-3 flex items-center'
                onClick={() => setSearchQuery('')}
                aria-label='Clear search'
                variant='link'
                size='icon'
              >
                <X className='size-4 text-gray-400 hover:text-gray-600' />
              </Button>
            )}
          </div>
        </div>

        {/* DMs List */}
        <div className='flex-1 w-full max-w-full overflow-y-auto overflow-x-hidden no-scrollbar'>
          {filteredDms.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-full pb-24 px-6'>
              <img
                src='/images/empty-chats.png'
                alt='No conversations'
                className='w-full max-w-[280px] h-auto mb-6 opacity-90'
              />
              <h3 className='text-lg font-medium text-gray-900 mb-2'>No conversations yet</h3>
              <p className='text-sm text-gray-500 text-center max-w-[250px]'>
                Start a new chat with your team members to collaborate and share ideas.
              </p>
            </div>
          ) : (
            <div className='w-full max-w-full pb-20 space-y-6  pt-4'>
              {filteredDms.map(channel => (
                <DmListItem
                  key={`dm-${channel.id}`}
                  channel={channel}
                  unreadCount={displayUnreadCounts[channel.id] || 0}
                  isSelected={channel.id === channelId}
                />
              ))}
            </div>
          )}
        </div>

        {/* Floating Create DM Button */}
        <button
          className='fixed bottom-[85px] right-4 z-40 flex items-center justify-center size-14 rounded-full bg-[#ff4f4f] border-[0.5px] border-[#181B1D]/30 backdrop-blur-[10px] shadow-lg'
          onClick={handleAddDirectMessage}
          aria-label='Create new message'
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
    <div className='flex h-full w-full md:rounded-2xl overflow-hidden shadow-[0_0_8px_0_rgba(0,0,0,0.15)]'>
      <PanelGroup
        direction='horizontal'
        className='flex align-top h-full'
        autoSaveId='dm-screen-resize'
      >
        {/* LEFT PANEL - DM List */}
        <Panel ref={dmPanelRef} defaultSize={20} minSize={30} maxSize={40}>
          <div className='flex flex-col bg-white text-gray-900 border-r border-gray-200 h-full'>
            {/* Desktop search/header */}
            <div className='p-4'>
              <div className='flex items-center justify-between mb-3'>
                <div className='flex items-center gap-2'>
                  <Link
                    to='/chat/dir'
                    className='p-1 rounded-md text-gray-900 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200'
                    aria-label='Go back'
                  >
                    <ArrowLeft size={20} />
                  </Link>
                  <h2 className='text-lg font-semibold'>Direct Messages</h2>
                </div>
                <button
                  className='flex items-center justify-center size-10 rounded-full bg-white border-[0.1px] backdrop-blur-[10px] shadow-md hover:bg-blue-50 hover:border-blue-200 transition-colors'
                  onClick={handleAddDirectMessage}
                  aria-label='Create new message'
                >
                  <PenBox className='size-5 text-blue-600' />
                </button>
              </div>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400' />
                <input
                  type='text'
                  className='w-full pl-9 pr-4 py-2 bg-gray-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'
                  placeholder='Search messages'
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* DMs List */}
            <div className='flex-1 w-full overflow-y-auto overflow-x-hidden no-scrollbar'>
              {filteredDms.length === 0 ? (
                <div className='flex flex-col items-center justify-center h-full px-6'>
                  <img
                    src='/images/empty-chats.png'
                    alt='No conversations'
                    className='w-full max-w-[280px] h-auto mb-6 opacity-90'
                  />
                  <h3 className='text-lg font-medium text-gray-900 mb-2'>No conversations yet</h3>
                  <p className='text-sm text-gray-500 text-center max-w-[250px]'>
                    Start a new chat with your team members to collaborate and share ideas.
                  </p>
                </div>
              ) : (
                <div className='w-full'>
                  {filteredDms.map(channel => (
                    <DmListItem
                      key={`dm-${channel.id}`}
                      channel={channel}
                      unreadCount={displayUnreadCounts[channel.id] || 0}
                      isSelected={channel.id === channelId}
                    />
                  ))}
                </div>
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
          <div className='flex-1 flex flex-col bg-white relative h-full'>
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
