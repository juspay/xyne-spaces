import { ReactElement, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Search, PenBox, ArrowLeft, X, HelpCircle } from 'lucide-react';
import { useAllUnreadCount } from '../../../hooks/useUnreadCount';
import { DmListItem } from './DmListItem';
import { useNavigate, Outlet, useParams, Link } from 'react-router-dom';
import { useShortcut } from '../../../shortcuts';
import { useMutation } from '@tanstack/react-query';
import { channelService, CreateDmRequest } from '../../../services/Chat/channelService';
import { AddDmForm, CreateDmFormData } from '../AddDmForm/AddDmForm';
import { Dialog } from '../../ui/Dialog';
import { usePlatform } from '../../../hooks/usePlatform';
import { usePath } from '../../../hooks/usePath';
import { MobileProfileMenu } from '../../ui/MobileProfileMenu/MobileProfileMenu';

import { useAuthContextValues } from '../../../hooks/useAuth';
import { useWalkthrough } from '../../../hooks/useWalkthrough';
import { DirectMessagesIcon } from '../../icons';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { useUsers } from '../../../hooks/useUsers';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import Button from '../../ui/Button';
import Avatar from '../../ui/Avatar/Avatar';
import { useDmsPaginatedMessages } from '../../../hooks/useDmsPaginatedMessages';
import { useDmsSearch } from '../../../hooks/useDmsSearch';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Channel, ChannelScopeType } from '@xyne/shared';
import { StatusIndicator } from '../../ui/StatusIndicator';

// Simple component for DM search results (no message preview)
const DmSearchResultItem = ({
  channel,
  isSelected,
}: {
  channel: Channel;
  isSelected: boolean;
}): ReactElement => {
  const context = useAuthContextValues();
  const { displayName, avatarUserId } = useChannelDisplayName(channel, context.userID);
  const is1on1DM = channel.scopeType === ChannelScopeType.DM;

  const allUsers = useUsers();
  const targetUser = allUsers.find(u => u.id === avatarUserId);

  return (
    <div className={`flex items-center gap-3 px-2 py-2 ${isSelected ? 'bg-accent' : ''}`}>
      <Avatar userId={avatarUserId} size='md' showActiveStatus={is1on1DM} className='rounded-lg' />
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-1.5'>
          <span className='text-sm font-medium text-foreground truncate'>{displayName}</span>
          {is1on1DM && (targetUser?.statusEmoji || targetUser?.statusContent) && (
            <StatusIndicator
              statusEmoji={targetUser.statusEmoji}
              statusContent={targetUser.statusContent}
              statusExpiryAt={targetUser.statusExpiryAt}
              size='sm'
            />
          )}
        </div>
      </div>
    </div>
  );
};

// Component for user search results (start new conversation)
interface DmUserSearchResultItemProps {
  user: {
    id: string;
    name: string;
  };
  isSelected: boolean;
  isCurrentUser?: boolean;
}

const DmUserSearchResultItem = ({
  user,
  isSelected,
  isCurrentUser,
}: DmUserSearchResultItemProps): ReactElement => {
  return (
    <div className={`flex items-center gap-3 px-2 py-2 ${isSelected ? 'bg-accent' : ''}`}>
      <Avatar userId={user.id} size='md' showActiveStatus className='rounded-lg' />
      <span className='text-sm font-medium text-foreground truncate'>
        {user.name}
        {isCurrentUser ? ' (you)' : ''}
      </span>
    </div>
  );
};

// Hardcoded item heights derived from CSS (avoids DOM measurement via ref)
// Desktop: py-3 (24px) + size-[48px] avatar + 1px border-bottom = 73px
// Mobile: 47px DmListItem + 16px pt-4 wrapper padding = 63px
const DESKTOP_ITEM_HEIGHT = 75;
const MOBILE_ITEM_HEIGHT = 65;

const DmsPage = (): ReactElement => {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const { channelId } = useParams<{ channelId: string }>();
  const isOnIndexRoute = usePath() === '/chat/dm';

  const dmPanelRef = useRef<ImperativePanelHandle>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [showAddDmForm, setShowAddDmForm] = useState(false);
  const context = useAuthContextValues();

  const selectedChannelIdRef = useRef<string | undefined>(channelId);
  if (selectedChannelIdRef.current !== channelId) {
    selectedChannelIdRef.current = channelId;
  }

  // Pending scroll: set when jumpToChannel returns 'loaded' (channel not yet in list).
  // Cleared once the channel appears in the channels array and we scroll to it.
  const pendingScrollChannelIdRef = useRef<string | null>(null);

  const createDmMutation = useMutation({
    mutationFn: (data: CreateDmRequest) => channelService.createDm(data),
    onSuccess: response => {
      setShowAddDmForm(false);
      void navigate(`/chat/dm/${response.id}?fromDM=true`);
    },
  });

  const unreadCounts = useAllUnreadCount();

  const { startWalkthrough } = useWalkthrough({
    feature: 'direct_messages',
    autoPlay: false,
  });

  const {
    messagesMap,
    channels: directMessages,
    loadMore,
    firstItemIndex,
    selectedChannelMovedVersion,
    jumpToChannel,
  } = useDmsPaginatedMessages({ selectedChannelId: channelId });

  const {
    dmSearchQuery,
    setDmSearchQuery,
    dmChannelResults,
    userResults,
    showDmSearchDropdown,
    setShowDmSearchDropdown,
    selectedDmSearchIndex,
    dmSearchInputRef,
    handleDmSearchKeyDown,
  } = useDmsSearch();

  // Clear search when a DM is selected
  useEffect(() => {
    if (channelId) {
      setDmSearchQuery('');
      setShowDmSearchDropdown(false);
    }
  }, [channelId, setDmSearchQuery, setShowDmSearchDropdown]);

  // j/k keyboard navigation through DM list
  const currentDmIndex = useMemo(
    () => (channelId ? directMessages.findIndex(ch => ch.id === channelId) : -1),
    [channelId, directMessages],
  );

  const navigateDm = useCallback(
    (delta: number) => {
      if (directMessages.length === 0) return;
      const nextIndex =
        currentDmIndex < 0
          ? delta > 0
            ? 0
            : directMessages.length - 1
          : Math.max(0, Math.min(directMessages.length - 1, currentDmIndex + delta));
      const next = directMessages[nextIndex];
      if (next && next.id !== channelId) {
        virtuosoRef.current?.scrollToIndex({ index: nextIndex, align: 'center' });
        void navigate(`/chat/dm/${next.id}?fromDM=true&nofocus=1`);
      }
    },
    [directMessages, currentDmIndex, channelId, navigate],
  );

  useShortcut('j', () => navigateDm(1), {
    scope: 'global',
    description: 'Next DM',
    category: 'DMs',
    enabled: !isMobile && directMessages.length > 0,
  });
  useShortcut('k', () => navigateDm(-1), {
    scope: 'global',
    description: 'Previous DM',
    category: 'DMs',
    enabled: !isMobile && directMessages.length > 0,
  });

  // Handle DM selection from search dropdown
  const handleDmSelect = useCallback(
    async (selectedChannelId: string) => {
      setDmSearchQuery('');
      setShowDmSearchDropdown(false);
      void navigate(`/chat/dm/${selectedChannelId}`);

      // On mobile the sidebar unmounts immediately after navigation, so jumping the
      // list (switching to cursor mode) is both pointless and harmful — cursor mode
      // blocks page1 reactive updates, so sending a message in the channel and pressing
      // back would show a stale list. Skip jumpToChannel entirely on mobile.
      if (isMobile) return;

      // Desktop only: scroll the sidebar to the channel in the background.
      const result = await jumpToChannel(selectedChannelId);

      if (result.type === 'scroll') {
        virtuosoRef.current?.scrollToIndex({ index: result.index, align: 'center' });
      } else if (result.type === 'loaded') {
        pendingScrollChannelIdRef.current = selectedChannelId;
      }
    },
    [isMobile, jumpToChannel, navigate, setDmSearchQuery, setShowDmSearchDropdown],
  );

  // When directMessages updates, check if the pending scroll channel has appeared.
  // rAF ensures Virtuoso has finished re-measuring after firstItemIndex changes before scrolling.
  useEffect(() => {
    const pendingId = pendingScrollChannelIdRef.current;
    if (!pendingId) return;

    const index = directMessages.findIndex(ch => ch.id === pendingId);
    if (index < 0) return;

    pendingScrollChannelIdRef.current = null;
    const raf = requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index, align: 'center' });
    });
    return (): void => cancelAnimationFrame(raf);
  }, [directMessages]);

  // Scroll to top when the selected channel receives a new message and moves to top.
  // Only fires in live mode (the hook guards this internally).
  useEffect(() => {
    if (!isMobile && selectedChannelMovedVersion > 0 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: 0, align: 'start', behavior: 'auto' });
    }
  }, [selectedChannelMovedVersion, isMobile]);

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

  const itemHeight = isMobile ? MOBILE_ITEM_HEIGHT : DESKTOP_ITEM_HEIGHT;
  // Trigger loadMore ~5 items before reaching the bottom
  const threshold = itemHeight * 5;

  const renderDmItem = useCallback(
    (_index: number, channel: (typeof directMessages)[number]) => {
      return (
        <div>
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

  const renderMobileDmItem = useCallback(
    (index: number, channel: (typeof directMessages)[number]) => {
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

  // Handle new user selection (no existing DM) — navigate to compose panel inside DmsPage.
  // Pass a unique composePanelKey in location state so the compose panel always remounts
  // on a new selection (even if the same userId is re-selected after removing them via X).
  const handleUserSelect = useCallback(
    (userId: string) => {
      setDmSearchQuery('');
      setShowDmSearchDropdown(false);
      void navigate(`/chat/dm/compose?userId=${userId}`, {
        state: { composePanelKey: Date.now() },
      });
    },
    [navigate, setDmSearchQuery, setShowDmSearchDropdown],
  );

  // Shared search dropdown JSX to avoid duplication between mobile and desktop
  const renderSearchDropdown = (): ReactElement | null => {
    if (!showDmSearchDropdown || !dmSearchQuery.trim()) return null;

    const hasChannels = dmChannelResults.length > 0;
    const hasUsers = userResults.length > 0;
    const noResults = !hasChannels && !hasUsers;

    return (
      <div className='absolute top-full left-0 right-0 mt-2 bg-background rounded-xl border border-border shadow-lg z-50 max-h-80 overflow-y-auto'>
        {noResults ? (
          <div className='px-4 py-3 text-sm text-muted-foreground'>No results found</div>
        ) : (
          <>
            {hasChannels && (
              <>
                <div className='px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
                  Conversations
                </div>
                {dmChannelResults.map((channel, index) => (
                  <button
                    key={channel.id}
                    type='button'
                    className={`w-full text-left cursor-pointer hover:bg-accent ${
                      index === selectedDmSearchIndex ? 'bg-accent' : ''
                    }`}
                    onClick={() => void handleDmSelect(channel.id)}
                    data-track-category='DM'
                    data-track-name='SELECT_DM_SEARCH_RESULT'
                  >
                    <DmSearchResultItem
                      channel={channel}
                      isSelected={index === selectedDmSearchIndex}
                    />
                  </button>
                ))}
              </>
            )}
            {hasUsers && (
              <>
                <div className='px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
                  Start new conversation
                </div>
                {userResults.map((user, userIndex) => {
                  const absoluteIndex = dmChannelResults.length + userIndex;
                  const isSelected = absoluteIndex === selectedDmSearchIndex;
                  return (
                    <button
                      key={user.id}
                      type='button'
                      className={`w-full text-left cursor-pointer hover:bg-accent ${
                        isSelected ? 'bg-accent' : ''
                      }`}
                      onClick={() => handleUserSelect(user.id)}
                      data-track-category='DM'
                      data-track-name='SELECT_NEW_DM_USER'
                    >
                      <DmUserSearchResultItem
                        user={user}
                        isSelected={isSelected}
                        isCurrentUser={user.id === context.userID}
                      />
                    </button>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    );
  };

  if (isMobile) {
    // If on a specific DM route, render the outlet for chat view
    if (!isOnIndexRoute) {
      return (
        <div className='flex flex-col h-full max-w-full bg-background text-foreground overflow-x-hidden w-screen'>
          <Outlet />
        </div>
      );
    }

    // Show DM list on index route
    return (
      <div className='flex flex-col h-full max-w-full bg-background text-foreground overflow-x-hidden px-2 w-screen'>
        <div
          className='block sm:hidden -mx-2 px-4 pt-2 pb-4 rounded-b-[24px] border-b border-border'
          style={{ background: 'var(--mobile-panel-bg)' }}
        >
          {/* Top Row: Logo + Avatar */}
          <div className='flex items-center justify-between mb-4'>
            <div className='flex items-center gap-1'>
              <img src='/svgs/xyne.svg' alt='Xyne Logo' className='h-5 w-auto' />
            </div>
            <div className='flex items-center gap-3'>
              <button
                onClick={() => startWalkthrough(true)}
                className='p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
                aria-label='Replay Tour'
                title='Replay Tour'
                data-track-category='DM'
                data-track-name='REPLAY_TOUR_MOBILE'
              >
                <HelpCircle size={20} />
              </button>
              <MobileProfileMenu userId={context.userID} />
            </div>
          </div>

          {/* Search Row: Input Only */}
          <div className='relative w-full dm-search-container'>
            <div className='absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none'>
              <Search className='size-5 text-muted-foreground' />
            </div>
            <input
              id='dm-search-input'
              ref={dmSearchInputRef}
              type='text'
              className='w-full h-11 pl-12 pr-10 py-3 bg-background rounded-full border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0'
              placeholder='Search DMs (Cmd+K)'
              autoFocus={!isMobile}
              value={dmSearchQuery}
              onChange={e => {
                setDmSearchQuery(e.target.value);
                setShowDmSearchDropdown(true);
              }}
              onFocus={() => setShowDmSearchDropdown(true)}
              onKeyDown={e =>
                handleDmSearchKeyDown(e, id => void handleDmSelect(id), handleUserSelect)
              }
              data-track-event='blur'
              data-track-category='DM'
              data-track-name='SEARCH_DMS_INPUT'
            />
            {dmSearchQuery && (
              <Button
                className='absolute inset-y-1 right-1 pr-3 flex items-center'
                onClick={() => {
                  setDmSearchQuery('');
                  setShowDmSearchDropdown(false);
                }}
                aria-label='Clear search'
                variant='link'
                size='icon'
              >
                <X className='size-4 text-muted-foreground hover:text-foreground' />
              </Button>
            )}
            {renderSearchDropdown()}
          </div>
        </div>

        <div className='flex-1 w-full max-w-full overflow-hidden'>
          {directMessages.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-full pb-24 px-6'>
              <img
                src='/images/empty-chats.svg'
                alt='No conversations'
                className='w-full max-w-[280px] h-auto mb-6 opacity-90 theme-invert'
              />
              <h3 className='text-lg font-medium text-foreground mb-2'>No conversations yet</h3>
              <p className='text-sm text-muted-foreground text-center max-w-[250px]'>
                Start a new chat with your team members to collaborate and share ideas.
              </p>
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              data={directMessages}
              firstItemIndex={firstItemIndex}
              computeItemKey={(_, channel) => channel.id}
              fixedItemHeight={itemHeight}
              overscan={5}
              increaseViewportBy={{ top: threshold, bottom: threshold }}
              startReached={() => void jumpToChannel()}
              endReached={loadMore}
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
          id='dm-create-btn'
          className='fixed bottom-[85px] right-4 z-40 flex items-center justify-center size-14 rounded-full bg-action-primary border border-border backdrop-blur-[10px] shadow-lg'
          onClick={handleAddDirectMessage}
          aria-label='Create new message'
          data-testid='create-new-message-btn'
          data-track-category='DM'
          data-track-name='CREATE_DM'
        >
          <PenBox className='size-5 text-action-primary-foreground' />
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
                  <div className='flex items-center gap-2'>
                    <h2 className='text-lg font-semibold' data-testid='dms-heading'>
                      Direct Messages
                    </h2>
                    <button
                      onClick={() => startWalkthrough(true)}
                      className='p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
                      aria-label='Replay Tour'
                      title='Replay Tour'
                      data-track-category='DM'
                      data-track-name='REPLAY_TOUR_DESKTOP'
                    >
                      <HelpCircle size={18} />
                    </button>
                  </div>
                </div>
                <button
                  id='dm-create-btn'
                  className='flex items-center justify-center size-10 rounded-full bg-background border-[0.1px] backdrop-blur-[10px] shadow-md hover:bg-accent hover:border-primary transition-colors'
                  onClick={handleAddDirectMessage}
                  aria-label='Create new message'
                  data-testid='create-new-message-btn'
                  data-track-category='DM'
                  data-track-name='CREATE_DM_DESKTOP'
                >
                  <PenBox className='size-5 text-primary' />
                </button>
              </div>
              <div className='relative dm-search-container'>
                <Search className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
                <input
                  id='dm-search-input'
                  ref={dmSearchInputRef}
                  type='text'
                  autoFocus
                  className='w-full pl-9 pr-8 py-2 bg-muted rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                  placeholder='Search DMs (Cmd+K)'
                  value={dmSearchQuery}
                  onChange={e => {
                    setDmSearchQuery(e.target.value);
                    setShowDmSearchDropdown(true);
                  }}
                  onFocus={() => setShowDmSearchDropdown(true)}
                  onKeyDown={e =>
                    handleDmSearchKeyDown(e, id => void handleDmSelect(id), handleUserSelect)
                  }
                  data-testid='search-messages-input'
                  data-track-event='blur'
                  data-track-category='DM'
                  data-track-name='SEARCH_DMS_INPUT_DESKTOP'
                />
                {dmSearchQuery && (
                  <Button
                    className='absolute right-1 top-1/2 -translate-y-1/2 flex items-center'
                    onClick={() => {
                      setDmSearchQuery('');
                      setShowDmSearchDropdown(false);
                    }}
                    aria-label='Clear search'
                    variant='link'
                    size='icon'
                  >
                    <X className='size-4 text-muted-foreground hover:text-foreground' />
                  </Button>
                )}
                {renderSearchDropdown()}
              </div>
            </div>

            <div className='flex-1 w-full overflow-hidden'>
              {directMessages.length === 0 ? (
                <div className='flex flex-col items-center justify-center h-full px-6'>
                  <img
                    src='/images/empty-chats.svg'
                    alt='No conversations'
                    className='w-full max-w-[280px] h-auto mb-6 opacity-90 theme-invert'
                  />
                  <h3 className='text-lg font-medium text-foreground mb-2'>No conversations yet</h3>
                  <p className='text-sm text-muted-foreground text-center max-w-[250px]'>
                    Start a new chat with your team members to collaborate and share ideas.
                  </p>
                </div>
              ) : (
                <Virtuoso
                  ref={virtuosoRef}
                  data={directMessages}
                  firstItemIndex={firstItemIndex}
                  computeItemKey={(_, channel) => channel.id}
                  fixedItemHeight={itemHeight}
                  overscan={5}
                  increaseViewportBy={{ top: threshold, bottom: threshold }}
                  startReached={() => void jumpToChannel()}
                  endReached={loadMore}
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
