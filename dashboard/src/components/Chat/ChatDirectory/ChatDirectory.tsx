import { ReactElement, useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useLastVisitedChannel } from '../../../hooks/useLastVisitedChannel';
import { usePlatform } from '../../../hooks/usePlatform';
import {
  Bookmark,
  ChevronRight,
  Plus,
  FolderPlus,
  Search,
  CornerDownRight,
  Sparkles,
  FileEdit,
  Clock,
  Pencil,
  ArrowUpDown,
  ArrowDownAZ,
  Check,
  BellDot,
  X,
  Star,
  Hash,
  MessageCircle,
  MessageSquareDot,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { useAuthContextValues, useAuth } from '../../../hooks/useAuth';
import { ChatDirectoryProps, ChannelCategory } from './ChatDirectory.types';
import { sumSectionUnread } from './ChatDirectory.utils';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import { useAllUnreadCount } from '../../../hooks/useUnreadCount';
import { useMutation } from '@tanstack/react-query';
import { useSelector } from '@xstate/react';
import {
  channelService,
  CreateChannelFormData,
  CreateDmRequest,
} from '../../../services/Chat/channelService';
import { AddDmForm, CreateDmFormData } from '../AddDmForm/AddDmForm';
import AddChannelForm from '../AddChannelForm/AddChannelForm';
import AddSectionForm from '../AddSectionForm/AddSectionForm';
import CreateSectionDialog from '../CreateSectionDialog/CreateSectionDialog';
import { AddPeopleForm } from '../AddPeopleForm/AddPeopleForm';
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
import { useChannelSort } from '../../../hooks/useChannelSort';
import { useChannelSectionDnd } from './useChannelSectionDnd';
import { ChannelSortOrder, ChannelSection, ChannelType, ChannelScopeType } from '@xyne/shared';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Accordion } from 'radix-ui';
import { createPortal } from 'react-dom';
import SortableSection from './SortableSection';
import SortableChannelItem from './SortableChannelItem';
import ChannelItemV2 from './ChannelItemV2';
import Tooltip from '../../ui/Tooltip';
import ChannelCommandMenu from './ChannelCommandMenu';
import { useUnreadThreadsCount } from '../../../hooks/useUnreadThreadsCount';
import { useRecapUnreadCount, usePrefetchRecap } from '../../../hooks/useRecapData';
import { stateMachineActor } from '../../../machines/stateMachine';
import { usePendingDelayedMessagesCount } from '../../../hooks/useUserDelayedMessages';

const ChatDirectory = ({
  channelData,
  allChannelsUserStatus,
}: ChatDirectoryProps): ReactElement | null => {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId, channelId: activeChannelId } = useParams<{
    workspaceId: string;
    channelId: string;
  }>();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const context = useAuthContextValues();
  const auth = useAuth();
  const { selfDmChannelId } = auth;
  const zero = useZero();
  const lastVisitedChannelId = useLastVisitedChannel(workspaceId ?? '');
  const { isMobile } = usePlatform();

  const threadCount = useUnreadThreadsCount();
  const { unreadCount: recapUnreadCount } = useRecapUnreadCount();
  const prefetchRecap = usePrefetchRecap();
  const [showAddChannelForm, setShowAddChannelForm] = useState(false);
  const [showAddSectionForm, setShowAddSectionForm] = useState(false);
  const [sectionToRename, setSectionToRename] = useState<ChannelSection | null>(null);
  const [sectionToDelete, setSectionToDelete] = useState<ChannelSection | null>(null);
  const [showAddDmForm, setShowAddDmForm] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [showAddPeopleDialog, setShowAddPeopleDialog] = useState(false);
  const [newlyCreatedChannelId, setNewlyCreatedChannelId] = useState<string | null>(null);
  const pendingScheduledCount = usePendingDelayedMessagesCount();
  const draftsCount = useSelector(stateMachineActor, state => state.context.draftMessages.length);
  const { starred, channels, directMessages, channelSortOrder, setChannelSortOrder } =
    useChannelSort(channelData, allChannelsUserStatus, context.userID, activeChannelId);
  const {
    channelSections,
    sectioned,
    sectionableChannels,
    lastSectionPosition,
    displaySectioned,
    defaultDisplayChannels,
    setDefaultDropRef,
    activeOverlayChannel,
    activeOverlaySection,
    moveChannelToSection,
    dndContextProps,
  } = useChannelSectionDnd({
    channels,
    channelData,
    allChannelsUserStatus,
  });
  // Base groups start open; each custom section adopts its persisted isCollapsed once.
  const [openSidebarSections, setOpenSidebarSections] = useState<string[]>([
    ChannelCategory.STARRED,
    ChannelCategory.CHANNELS,
    ChannelCategory.DIRECT_MESSAGES,
  ]);
  const initializedSectionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const unseen = sectioned.filter(b => !initializedSectionIdsRef.current.has(b.section.id));
    if (unseen.length === 0) return;
    setOpenSidebarSections(prev => {
      const next = new Set(prev);
      for (const { section } of unseen) {
        initializedSectionIdsRef.current.add(section.id);
        if (!section.isCollapsed) {
          next.add(section.id);
        }
      }
      return Array.from(next);
    });
  }, [sectioned]);
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);

  // Get unread counts for all channels (for DMs)
  const unreadCounts = useAllUnreadCount();

  const unreadActivityStats = useMemo(() => {
    const allOrdered = [...starred, ...channels, ...directMessages];
    let sum = 0;
    let hasUnread = false;
    for (const c of allOrdered) {
      if (c.type === ChannelType.EMAIL || c.type === ChannelType.SUPPORT) continue;

      const count = unreadCounts[c.id] ?? 0;
      sum += count;

      const status = allChannelsUserStatus.find(
        s => s.channelId === c.id && s.userId === context.userID,
      );
      const isDM = c.scopeType === ChannelScopeType.DM || c.scopeType === ChannelScopeType.GROUP_DM;

      if (count > 0) {
        hasUnread = true;
      } else if (!isDM) {
        const hasNewActivity =
          !!status?.lastViewedAt &&
          !!c.channelStats?.lastActivityAt &&
          c.channelStats.lastActivityAt > status.lastViewedAt;
        if (hasNewActivity) {
          hasUnread = true;
        }
      }
    }
    return { sum, hasUnread };
  }, [starred, channels, directMessages, unreadCounts, allChannelsUserStatus, context.userID]);

  const starredUnreadCount = sumSectionUnread(starred, unreadCounts, activeChannelId);
  const channelsUnreadCount = sumSectionUnread(
    defaultDisplayChannels,
    unreadCounts,
    activeChannelId,
  );

  const createChannelMutation = useMutation({
    mutationFn: (data: CreateChannelFormData) => channelService.createChannel(data),
    onSuccess: response => {
      mixpanelService.track(EVENTS.INITIATE_ACTION, {
        type: EVENT_PROPERTIES.ACTION_TYPES.NEW_CHANNEL,
      });
      setShowAddChannelForm(false);
      // Navigate to the newly created channel
      void navigate(`/chat/dir/${response.id}`);
      // Auto-open add people dialog after channel creation
      setNewlyCreatedChannelId(response.id);
      setShowAddPeopleDialog(true);
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
        zero.mutate(mutators.channel.reopenDm({ channelId: response.id, updatedAt: Date.now() }));
      }
      // Navigate to the DM channel
      void navigate(`/chat/dir/${response.id}`);
    },
  });

  // Redirect to last visited channel or first available channel when at /chat/dir root
  useEffect(() => {
    if (isMobile) return; // Don't redirect on mobile
    const isAtChatDirRoot =
      location.pathname === '/chat/dir' ||
      (workspaceId && location.pathname === `/${workspaceId}/chat/dir`);
    if (!isAtChatDirRoot) return;

    const targetChannelId =
      lastVisitedChannelId ||
      selfDmChannelId ||
      starred[0]?.id ||
      channels[0]?.id ||
      directMessages[0]?.id;

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
    selfDmChannelId,
    workspaceId,
  ]);

  const handleAddChannelSubmit = (data: CreateChannelFormData): void => {
    createChannelMutation.mutate(data);
  };

  // Persist collapse for custom sections (base groups stay local-only).
  const handleSectionsOpenChange = (next: string[]): void => {
    const nextSet = new Set(next);
    for (const { section } of sectioned) {
      const wasOpen = openSidebarSections.includes(section.id);
      const isOpen = nextSet.has(section.id);
      if (wasOpen !== isOpen) {
        void zero.mutate(
          mutators.channelSection.update({
            id: section.id,
            isCollapsed: !isOpen,
            timestamp: Date.now(),
          }),
        );
      }
    }
    setOpenSidebarSections(next);
  };

  const handleRenameSection = (data: { name: string; emoji?: string }): void => {
    if (!sectionToRename) return;
    void zero.mutate(
      mutators.channelSection.update({
        id: sectionToRename.id,
        name: data.name,
        emoji: data.emoji ?? null,
        timestamp: Date.now(),
      }),
    );
    setSectionToRename(null);
  };

  const handleConfirmDeleteSection = (): void => {
    if (!sectionToDelete) return;
    void zero.mutate(
      mutators.channelSection.remove({ id: sectionToDelete.id, timestamp: Date.now() }),
    );
    setSectionToDelete(null);
  };

  // j/k navigate through starred + channels + DMs as one continuous list when
  // focus is inside the sidebar list container. j/k appends ?nofocus=1 so the
  // chat input does NOT auto-focus (keyboard navigation should stay in the
  // sidebar); Enter navigates without the param so normal auto-focus kicks in.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'j' && e.key !== 'k' && e.key !== 'Enter') return;
      const active = document.activeElement;
      if (!listContainerRef.current || !active || !listContainerRef.current.contains(active)) {
        return;
      }
      const tag = (active as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (active as HTMLElement).isContentEditable) {
        return;
      }
      const flat = [...starred, ...channels, ...directMessages];
      if (flat.length === 0) return;
      const match = location.pathname.match(/^\/chat\/dir\/([^/?#]+)/);
      const currentId = match?.[1] ?? null;

      if (e.key === 'Enter') {
        // Confirm current selection → focus the chat input directly
        // (URL may already be on this channel thanks to j/k navigation).
        e.preventDefault();
        e.stopPropagation();
        const input = document.querySelector<HTMLElement>(
          '[aria-label="Message input"] [contenteditable="true"], [aria-label="Message input"]',
        );
        input?.focus();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const currentIndex = currentId ? flat.findIndex(c => c.id === currentId) : -1;
      const delta = e.key === 'j' ? 1 : -1;
      const nextIndex =
        currentIndex < 0
          ? delta > 0
            ? 0
            : flat.length - 1
          : Math.max(0, Math.min(flat.length - 1, currentIndex + delta));
      const next = flat[nextIndex];
      if (next && next.id !== currentId) {
        void navigate(`/chat/dir/${next.id}?nofocus=1`);
      }
    };
    document.addEventListener('keydown', handler, true);
    return (): void => document.removeEventListener('keydown', handler, true);
  }, [starred, channels, directMessages, location.pathname, navigate]);

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
      <div className='hidden sm:flex pt-2 pb-3 px-2 h-10 items-center justify-between mb-2'>
        <h2 className='text-base font-semibold leading-normal text-sidebar-primary-foreground'>
          Chat
        </h2>
      </div>

      <div className='hidden md:block'>
        <button
          className={cn(
            'flex items-center justify-start gap-3 w-full h-8 text-sm px-2 rounded-md transition-colors hover:bg-sidebar-item-hover',
            threadCount > 0
              ? 'text-sidebar-unread-foreground'
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
            location.pathname.includes('/chat/dir/unreads')
              ? 'text-sidebar-primary-foreground font-medium bg-sidebar-item-active'
              : unreadActivityStats.hasUnread
                ? 'text-sidebar-unread-foreground font-semibold'
                : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground',
          )}
          onClick={() => {
            void navigate('/chat/dir/unreads');
          }}
          data-track-category='CHAT_SIDEBAR'
          data-track-name='OPEN_UNREADS'
        >
          <span className='size-5 flex items-center justify-center shrink-0'>
            <MessageSquareDot className='size-4' />
          </span>
          <span className='flex-1 min-w-0 text-left truncate block'>Unreads</span>
          {unreadActivityStats.sum > 0 && (
            <span className='size-5 flex items-center justify-center shrink-0'>
              <Badge
                variant='success'
                className='text-xs h-[18px] px-[6px] py-[1px] bg-sidebar-badge-accent text-sidebar-badge-accent-foreground'
              >
                {unreadActivityStats.sum > 99 ? '99+' : unreadActivityStats.sum}
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
            'flex items-center justify-start gap-3 w-full h-8 text-sm px-2 rounded-md transition-colors hover:bg-sidebar-item-hover',
            location.pathname.endsWith('/chat/drafts-sent')
              ? 'text-sidebar-primary-foreground'
              : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground',
          )}
          onClick={() => {
            void navigate('drafts-sent');
          }}
          data-testid='open-drafts-and-sent-button'
          data-track-category='CHAT_SIDEBAR'
          data-track-name='OPEN_DRAFTS_AND_SENT'
        >
          <span className='size-5 flex items-center justify-center shrink-0'>
            <FileEdit className='size-4' />
          </span>
          <span className='flex-1 min-w-0 text-left truncate block'>Drafts &amp; Sent</span>
          <span className='flex items-center gap-2 text-sidebar-secondary-foreground'>
            {draftsCount > 0 && (
              <span className='flex items-center gap-1 text-xs'>
                <Pencil className='size-3' />
                {draftsCount}
              </span>
            )}
            {pendingScheduledCount > 0 && (
              <span className='flex items-center gap-1 text-xs'>
                <Clock className='size-3' />
                {pendingScheduledCount}
              </span>
            )}
          </span>
        </button>
        <button
          className={cn(
            'flex items-center justify-start gap-3 w-full h-8 text-sm px-2 rounded-md transition-colors hover:bg-sidebar-item-hover',
            recapUnreadCount > 0
              ? 'text-sidebar-unread-foreground'
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

      <div
        ref={listContainerRef}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role='region'
        aria-label='Channels and direct messages'
        className=' flex-1 h-full overflow-y-scroll no-scrollbar pb-[calc(2.5rem+env(safe-area-inset-bottom))] px-0.5 pt-1 outline-none'
      >
        <Accordion.Root
          type='multiple'
          className='space-y-4'
          value={openSidebarSections}
          onValueChange={handleSectionsOpenChange}
        >
          {/* Starred  */}
          {starred.length > 0 && (
            <Accordion.Item value={ChannelCategory.STARRED}>
              <Accordion.Trigger asChild>
                <button className='group flex items-center justify-start gap-2 w-full h-8 text-sidebar-secondary-foreground text-xs font-medium px-1'>
                  <span className='size-4 flex items-center justify-center shrink-0'>
                    <Star className='size-3.5 group-hover:hidden' />
                    <ChevronRight
                      strokeWidth={2.33}
                      className='size-3 hidden group-hover:block transition-transform duration-200 group-data-[state=open]:rotate-90'
                    />
                  </span>
                  <span className='text-left truncate block'>Starred</span>
                  {starredUnreadCount > 0 && (
                    <Badge className='ml-auto mr-0.5 hidden group-data-[state=closed]:inline-flex font-mono h-[18px] shrink-0 bg-sidebar-badge-accent px-1.5 text-sidebar-badge-accent-foreground'>
                      {starredUnreadCount > 9 ? '9+' : starredUnreadCount}
                    </Badge>
                  )}
                </button>
              </Accordion.Trigger>
              <Accordion.Content>
                {starred.map(channel => (
                  <ChannelItemV2
                    key={channel.id}
                    channel={channel}
                    unreadCount={unreadCounts[channel.id] ?? 0}
                    isActive={activeChannelId === channel.id}
                  />
                ))}
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* Custom sections (per-user, drag to reorder) */}
          <DndContext {...dndContextProps}>
            <SortableContext
              items={sectioned.map(b => b.section.id)}
              strategy={verticalListSortingStrategy}
            >
              {displaySectioned.map(({ section, channels: sectionChannels }) => (
                <SortableSection
                  key={section.id}
                  section={section}
                  channels={sectionChannels}
                  sections={channelSections ?? []}
                  unreadCounts={unreadCounts}
                  activeChannelId={activeChannelId}
                  onRename={setSectionToRename}
                  onDelete={setSectionToDelete}
                  onCreateSection={() => setShowAddSectionForm(true)}
                  onMoveChannelToSection={moveChannelToSection}
                />
              ))}
            </SortableContext>
            {/* Portaled to <body> so a transformed ancestor can't offset the overlay. */}
            {createPortal(
              <DragOverlay dropAnimation={null}>
                {activeOverlayChannel ? (
                  <div className='rounded-md bg-sidebar-item-hover shadow-lg cursor-grabbing'>
                    <ChannelItemV2
                      channel={activeOverlayChannel}
                      unreadCount={unreadCounts[activeOverlayChannel.id] ?? 0}
                    />
                  </div>
                ) : activeOverlaySection ? (
                  <div className='flex items-center gap-1 h-8 px-2 rounded-md bg-sidebar-item-hover text-xs font-medium text-sidebar-secondary-foreground shadow-lg cursor-grabbing'>
                    {activeOverlaySection.emoji &&
                      renderEmoji(activeOverlaySection.emoji, 'size-4')}
                    <span className='truncate'>{activeOverlaySection.name}</span>
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}

            {/* Channels  */}
            <Accordion.Item value={ChannelCategory.CHANNELS}>
              <Accordion.Header asChild>
                <div className='group px-1 flex items-center justify-between gap-2 '>
                  <Accordion.Trigger asChild>
                    <button className=' flex items-center justify-start gap-2 w-full h-8 text-sidebar-secondary-foreground text-xs font-medium'>
                      <span className='size-4 flex items-center justify-center shrink-0'>
                        <Hash className='size-3.5 group-hover:hidden' />
                        <ChevronRight
                          strokeWidth={2.33}
                          className='size-3 hidden group-hover:block transition-transform duration-200 group-data-[state=open]:rotate-90'
                        />
                      </span>
                      <span className='text-left truncate block'>Channels</span>
                    </button>
                  </Accordion.Trigger>
                  {channelsUnreadCount > 0 && (
                    <Badge className='order-last hidden group-data-[state=closed]:inline-flex font-mono h-[18px] shrink-0 bg-sidebar-badge-accent px-1.5 text-sidebar-badge-accent-foreground'>
                      {channelsUnreadCount > 9 ? '9+' : channelsUnreadCount}
                    </Badge>
                  )}
                  <div
                    className={`flex items-center gap-2 mr-0.5 transition-opacity ease-in-out duration-300 ${isSortDropdownOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  >
                    <Tooltip
                      content='Browse channels'
                      side='top'
                      sideOffset={0}
                      delayDuration={500}
                    >
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
                    <Tooltip content='New section' side='top' sideOffset={0} delayDuration={500}>
                      <button
                        className='group/child text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover transition-colors rounded-md p-1'
                        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowAddSectionForm(true);
                        }}
                        data-track-category='CHAT_SIDEBAR'
                        data-track-name='CREATE_NEW_SECTION'
                      >
                        <FolderPlus
                          strokeWidth={2.33}
                          className='size-3.5 text-sidebar-secondary-foreground group-hover/child:text-sidebar-badge-accent transition-colors'
                        />
                      </button>
                    </Tooltip>
                    <DropdownMenu onOpenChange={setIsSortDropdownOpen}>
                      <Tooltip
                        content='Sort channels'
                        side='top'
                        sideOffset={0}
                        delayDuration={500}
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            className='group/child text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover transition-colors rounded-md p-1 focus:outline-none'
                            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            data-track-category='CHAT_SIDEBAR'
                            data-track-name='SORT_CHANNELS'
                          >
                            <ArrowUpDown
                              strokeWidth={2.33}
                              className='size-3.5 text-sidebar-secondary-foreground group-hover/child:text-sidebar-badge-accent transition-colors'
                            />
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
                          className='gap-2'
                        >
                          <BellDot className='size-3.5 shrink-0' />
                          <span className='flex-1'>Unread & Activity</span>
                          {channelSortOrder === ChannelSortOrder.UNREAD && (
                            <Check className='size-3.5 shrink-0' />
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={e => {
                            e.stopPropagation();
                            setChannelSortOrder(ChannelSortOrder.RECENCY);
                          }}
                          className='gap-2'
                        >
                          <Clock className='size-3.5 shrink-0' />
                          <span className='flex-1'>By recency</span>
                          {channelSortOrder === ChannelSortOrder.RECENCY && (
                            <Check className='size-3.5 shrink-0' />
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={e => {
                            e.stopPropagation();
                            setChannelSortOrder(ChannelSortOrder.ALPHABETICAL);
                          }}
                          className='gap-2'
                        >
                          <ArrowDownAZ className='size-3.5 shrink-0' />
                          <span className='flex-1'>Alphabetical A-Z</span>
                          {channelSortOrder === ChannelSortOrder.ALPHABETICAL && (
                            <Check className='size-3.5 shrink-0' />
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Accordion.Header>
              <Accordion.Content data-testid='channel-list'>
                <div ref={setDefaultDropRef} className='min-h-[4px]'>
                  <SortableContext
                    items={defaultDisplayChannels.map(c => c.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {defaultDisplayChannels.map(channel => (
                      <SortableChannelItem
                        key={channel.id}
                        channel={channel}
                        unreadCount={unreadCounts[channel.id] ?? 0}
                        isActive={activeChannelId === channel.id}
                        sections={channelSections ?? []}
                        onMoveToSection={moveChannelToSection}
                      />
                    ))}
                  </SortableContext>
                </div>
              </Accordion.Content>
            </Accordion.Item>
          </DndContext>

          {/* DMS  */}
          <Accordion.Item value={ChannelCategory.DIRECT_MESSAGES}>
            <Accordion.Header asChild>
              <div className='group px-1 flex items-center justify-between gap-2 '>
                <Accordion.Trigger asChild>
                  <button className='flex items-center justify-start gap-2 w-full h-8 text-sidebar-secondary-foreground text-xs font-medium px-1'>
                    <span className='size-4 flex items-center justify-center shrink-0'>
                      <MessageCircle className='size-3.5 group-hover:hidden' />
                      <ChevronRight
                        strokeWidth={2.33}
                        className='size-3 hidden group-hover:block transition-transform duration-200 group-data-[state=open]:rotate-90'
                      />
                    </span>
                    <span className='text-left truncate block'>Direct Messages</span>
                  </button>
                </Accordion.Trigger>
                <Tooltip content='Add direct message' side='top' sideOffset={0} delayDuration={500}>
                  <button
                    id='sidebar-add-dm-btn'
                    className='group/child text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity ease-in-out duration-300 hover:bg-sidebar-item-hover rounded-md p-1 mr-0.5'
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
            </Accordion.Header>
            <Accordion.Content data-testid='dm-list'>
              {directMessages.map(channel => (
                <ChannelItemV2
                  key={channel.id}
                  channel={channel}
                  unreadCount={unreadCounts[channel.id] ?? 0}
                  isActive={activeChannelId === channel.id}
                />
              ))}
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
      </div>

      <Dialog
        open={showAddChannelForm}
        onOpenChange={setShowAddChannelForm}
        testId='add-channel-dialog'
      >
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

      <Dialog
        open={showAddSectionForm}
        onOpenChange={setShowAddSectionForm}
        testId='add-section-dialog'
      >
        {showAddSectionForm && (
          <CreateSectionDialog
            channels={sectionableChannels}
            existingNames={(channelSections ?? []).map(s => s.name)}
            lastSectionPosition={lastSectionPosition}
            onClose={() => setShowAddSectionForm(false)}
          />
        )}
      </Dialog>

      <Dialog
        open={!!sectionToRename}
        onOpenChange={open => {
          if (!open) setSectionToRename(null);
        }}
        testId='rename-section-dialog'
      >
        {sectionToRename && (
          <div className='p-4'>
            <AddSectionForm
              initialName={sectionToRename.name}
              initialEmoji={sectionToRename.emoji ?? ''}
              existingNames={(channelSections ?? [])
                .filter(s => s.id !== sectionToRename.id)
                .map(s => s.name)}
              submitLabel='Save'
              title='Rename section'
              onSubmit={handleRenameSection}
              onCancel={() => setSectionToRename(null)}
            />
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!sectionToDelete}
        onOpenChange={open => {
          if (!open) setSectionToDelete(null);
        }}
        testId='delete-section-dialog'
      >
        <div className='p-4 space-y-4'>
          <div className='flex items-start justify-between gap-2'>
            <div className='text-xl font-medium text-foreground'>Delete this section?</div>
            <button
              type='button'
              onClick={() => setSectionToDelete(null)}
              aria-label='Close'
              data-track-category='CHAT_SIDEBAR'
              data-track-name='CLOSE_DELETE_SECTION'
              className='-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            >
              <X className='size-5' />
            </button>
          </div>
          <div className='space-y-3 text-sm text-foreground'>
            <p>
              Any channels you added to{' '}
              <span className='font-semibold inline-flex items-center gap-1'>
                {sectionToDelete?.emoji && renderEmoji(sectionToDelete.emoji, 'size-4')}
                {sectionToDelete?.name}
              </span>{' '}
              will move back to the Channels list.
            </p>
            <p className='text-foreground'>
              Don’t worry — deleting this section won’t remove you from any channels.
            </p>
          </div>
          <div className='flex justify-end gap-3 pt-2'>
            <button
              onClick={() => setSectionToDelete(null)}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='CANCEL_DELETE_SECTION'
              className='inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors'
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDeleteSection}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='CONFIRM_DELETE_SECTION'
              className='inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors'
            >
              Delete
            </button>
          </div>
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

      <Dialog
        open={showAddChannelForm}
        onOpenChange={setShowAddChannelForm}
        testId='add-channel-dialog'
      >
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
