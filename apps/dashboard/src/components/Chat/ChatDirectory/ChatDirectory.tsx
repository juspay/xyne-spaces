import {
  ReactElement,
  ReactNode,
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ComponentType,
} from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { Radar as RadarIcon } from 'lucide-react';
import { useRadarEnabled } from '../../../hooks/radarCacConfig';
import { useLastVisitedChannel } from '../../../hooks/useLastVisitedChannel';
import { usePlatform } from '../../../hooks/usePlatform';
import { useShortcutById } from '../../../shortcuts';
import {
  ChatPlus,
  Subtask,
  ChatTyping,
  BookmarkDefault,
  SendPlaneSlant,
  ListAiGenerated,
  ChevronRight,
  PlusDefault,
  FolderPlus,
  SearchDefault,
  ClockDefault,
  PencilEdit,
  MultipleCrossCancelDefault,
  Star,
  Hashtag,
  ChatDefault,
  ThreeDotsMenuVertical,
  type PikaIconProps,
} from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { useAuthContextValues, useAuth } from '../../../hooks/useAuth';
import { ChatDirectoryProps, ChannelCategory } from './ChatDirectory.types';
import { keyBetween } from './ChatDirectory.utils';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import { useAllUnreadCount } from '../../../hooks/useUnreadCount';
import { useAllMentionCount } from '../../../hooks/useMentionCount';
import UnreadMentionsPill, { useOffscreenUnreadSections } from './UnreadMentionsPill';
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
import ProjectSectionSuggestionCard from './ProjectSectionSuggestionCard';
import SectionOrganizerDialog, { type OrganizerGroup } from './SectionOrganizerDialog';
import ManageSectionChannelsDialog from './ManageSectionChannelsDialog';
import { AddPeopleForm } from '../AddPeopleForm/AddPeopleForm';
import Badge from '../../ui/Badge';
import Avatar from '../../ui/Avatar/Avatar';
import Dialog, { cn } from '../../ui/Dialog';
import { Button } from '../../ui/Button';

import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { toast } from 'sonner';
import {
  useChannelSort,
  type SidebarGroup,
  type SidebarGroupPreference,
} from '../../../hooks/useChannelSort';
import {
  useChannelSectionDnd,
  STARRED_CONTAINER,
  DEFAULT_CONTAINER,
  DM_CONTAINER,
} from './useChannelSectionDnd';
import {
  ChannelSection,
  ChannelType,
  ChannelScopeType,
  isDeskChannelType,
  NotificationLevel,
  computeProjectSectionSuggestions,
} from '@xyne/shared';
import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Accordion } from 'radix-ui';
import { createPortal } from 'react-dom';
import SortableSection from './SortableSection';
import SectionSettingsMenu, { MENU_ROW } from './SectionSettingsMenu';
import SortableChannelItem from './SortableChannelItem';
import ChannelItemV2 from './ChannelItemV2';
import Tooltip from '../../ui/Tooltip';
import { ShortcutHint } from '../../ui/ShortcutHint';
import ChannelCommandMenu from './ChannelCommandMenu';
import AppNavigator from '../../AppNavigator/AppNavigator';
import { useThreadSidebarState } from '../../../hooks/useUnreadThreadsCount';
import { useOverdueRemindersCount } from '../../../hooks/useOverdueRemindersCount';
import { useRecapUnreadCount, usePrefetchRecap } from '../../../hooks/useRecapData';
import { stateMachineActor, type VisibleChannel } from '../../../machines/stateMachine';
import { usePendingDelayedMessagesCount } from '../../../hooks/useUserDelayedMessages';

const SECTION_SUGGESTION_DISMISSED_KEY = 'xyne:section-suggestion-dismissed';

const ContainerDropZone = ({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) => {
  const { setNodeRef } = useDroppable({ id, data: { type: 'container' } });
  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  );
};

const GroupSettingsMenu = ({
  group,
  trackName,
  groupPreferences,
  setGroupPreference,
  onOpenChange,
  alwaysVisible = false,
  actions = [],
  allowMentionsFilter = true,
}: {
  group: SidebarGroup;
  trackName: string;
  groupPreferences: Record<SidebarGroup, SidebarGroupPreference>;
  setGroupPreference: (group: SidebarGroup, patch: Partial<SidebarGroupPreference>) => void;
  onOpenChange?: (open: boolean) => void;
  alwaysVisible?: boolean;
  allowMentionsFilter?: boolean;
  actions?: {
    label: string;
    icon: ComponentType<PikaIconProps>;
    trackName: string;
    onSelect: () => void;
  }[];
}): ReactElement => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { filterMode, sortOrder } = groupPreferences[group];
  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={open => {
        setMenuOpen(open);
        onOpenChange?.(open);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group/child flex items-center justify-center rounded-md p-1 shrink-0 text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-opacity ease-in-out duration-300 focus:outline-none',
            alwaysVisible || menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          aria-label='Section options'
          data-track-category='CHAT_SIDEBAR'
          data-track-name={trackName}
        >
          <ThreeDotsMenuVertical strokeWidth={2.33} size={14} className='shrink-0' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side='right'
        align='start'
        alignOffset={-4}
        sideOffset={8}
        className='min-w-[230px]'
        onCloseAutoFocus={e => e.preventDefault()}
      >
        {actions.map(action => {
          const Glyph = action.icon;
          return (
            <DropdownMenuItem
              key={action.label}
              className={MENU_ROW}
              onClick={e => {
                e.stopPropagation();
                action.onSelect();
              }}
              data-track-category='CHAT_SIDEBAR'
              data-track-name={action.trackName}
            >
              <span className='flex size-5 shrink-0 items-center justify-center'>
                <Glyph size={16} />
              </span>
              <span className='flex-1'>{action.label}</span>
            </DropdownMenuItem>
          );
        })}
        {actions.length > 0 && <DropdownMenuSeparator />}
        <SectionSettingsMenu
          allowMentionsFilter={allowMentionsFilter}
          filterMode={filterMode}
          sortOrder={sortOrder}
          onSetFilter={mode => setGroupPreference(group, { filterMode: mode })}
          onSetSort={order => {
            if (order) setGroupPreference(group, { sortOrder: order });
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

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
  // Radar rollout is runtime CAC (radar_config), not a build-time flag:
  // enabling it must not need a dashboard rebuild, and the pilot runs on an
  // allowedEmails subset first.
  const radarEnabled = useRadarEnabled(auth.user?.email);
  const { selfDmChannelId, landingChannelId } = auth;
  const zero = useZero();
  const lastVisitedChannelId = useLastVisitedChannel(workspaceId ?? '');
  const { isMobile } = usePlatform();

  const { mentionCount: threadCount, hasUnreadThreads } = useThreadSidebarState();
  const overdueRemindersCount = useOverdueRemindersCount();
  const { unreadCount: recapUnreadCount } = useRecapUnreadCount();
  const prefetchRecap = usePrefetchRecap();
  const [showAddChannelForm, setShowAddChannelForm] = useState(false);
  const [showAddSectionForm, setShowAddSectionForm] = useState(false);
  const [addSectionSource, setAddSectionSource] = useState<'channels' | 'dms'>('channels');
  const [sectionToRename, setSectionToRename] = useState<ChannelSection | null>(null);
  const [sectionToDelete, setSectionToDelete] = useState<ChannelSection | null>(null);
  const [sectionToManage, setSectionToManage] = useState<ChannelSection | null>(null);
  const [showAddDmForm, setShowAddDmForm] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [showAddPeopleDialog, setShowAddPeopleDialog] = useState(false);
  const [newlyCreatedChannelId, setNewlyCreatedChannelId] = useState<string | null>(null);
  const pendingScheduledCount = usePendingDelayedMessagesCount();
  const draftsCount = useSelector(stateMachineActor, state => state.context.draftMessages.length);
  const unreadCounts = useAllUnreadCount();
  const mentionCounts = useAllMentionCount();
  const { starred, channels, directMessages, groupPreferences, setGroupPreference } =
    useChannelSort(channelData, allChannelsUserStatus, context.userID);
  const {
    channelSections,
    sectioned,
    sectionableChannels,
    lastSectionPosition,
    displaySectioned,
    defaultDisplayChannels,
    dmDisplayChannels,
    starredDisplayChannels,
    sectionUnreadCounts,
    defaultUnreadCount,
    dmUnreadCount,
    starredUnreadCount,
    activeOverlayChannel,
    activeOverlaySection,
    moveChannelToSection,
    dndContextProps,
  } = useChannelSectionDnd({
    channels,
    directMessages,
    starred,
    channelData,
    allChannelsUserStatus,
    groupPreferences,
    unreadCounts,
    mentionCounts,
    activeChannelId,
  });

  const [projects] = useCachedQuery(queries.getAllProjectsList());
  const [suggestionDismissed, setSuggestionDismissed] = useState(
    () => localStorage.getItem(SECTION_SUGGESTION_DISMISSED_KEY) === 'true',
  );
  const [showOrganizer, setShowOrganizer] = useState(false);

  const sectionSuggestions = useMemo(
    () =>
      computeProjectSectionSuggestions({
        channels: channelData ?? [],
        statuses: allChannelsUserStatus ?? [],
        projects: projects ?? [],
        existingSectionNames: (channelSections ?? []).map(section => section.name),
      }),
    [channelData, allChannelsUserStatus, projects, channelSections],
  );

  const showSuggestionCard = !suggestionDismissed && sectionSuggestions.length > 0;

  const channelsById = useMemo(
    () => new Map((channelData ?? []).map(channel => [channel.id, channel])),
    [channelData],
  );

  const handleDismissSuggestion = useCallback(() => {
    localStorage.setItem(SECTION_SUGGESTION_DISMISSED_KEY, 'true');
    setSuggestionDismissed(true);
    toast('You can create sections any time from the channel menu.', { duration: 5000 });
  }, []);

  const handleCreateSections = useCallback(
    (groups: OrganizerGroup[]) => {
      const timestamp = Date.now();
      const created: { id: string; channelIds: string[] }[] = [];
      let prevSectionKey = lastSectionPosition;

      for (const group of groups) {
        const sectionId = crypto.randomUUID();
        const position = keyBetween(prevSectionKey, null);
        prevSectionKey = position;

        void zero.mutate(
          mutators.channelSection.create({
            id: sectionId,
            name: group.name.trim(),
            emoji: null,
            position,
            timestamp,
          }),
        );

        let prevChannelKey: string | null = null;
        for (const channelId of group.channelIds) {
          const channelPosition = keyBetween(prevChannelKey, null);
          prevChannelKey = channelPosition;
          void zero.mutate(
            mutators.channel.moveToSection({
              channelId,
              sectionId,
              position: channelPosition,
              timestamp,
            }),
          );
        }

        created.push({ id: sectionId, channelIds: group.channelIds });
      }

      setShowOrganizer(false);

      const sectionCount = created.length;
      const channelCount = created.reduce((sum, s) => sum + s.channelIds.length, 0);
      toast(
        `${sectionCount} section${sectionCount === 1 ? '' : 's'} created with ${channelCount} channels.`,
        {
          duration: 8000,
          action: {
            label: 'Undo',
            onClick: () => {
              const undoTimestamp = Date.now();
              for (const section of created) {
                void zero.mutate(
                  mutators.channelSection.remove({ id: section.id, timestamp: undoTimestamp }),
                );
              }
            },
          },
        },
      );
    },
    [zero, lastSectionPosition],
  );

  // Flattened, de-duplicated sidebar conversation order — mirrors exactly what
  // ChatDirectory renders (starred → custom sections → channels → DMs) so keyboard
  // navigation can never drift from the visual list. Collapse state is
  // intentionally ignored: a collapsed section's channels stay valid targets.
  const flatSidebarChannels = useMemo(() => {
    const ordered = [
      ...starredDisplayChannels,
      ...displaySectioned.flatMap(({ channels: sectionChannels }) => sectionChannels),
      ...defaultDisplayChannels,
      ...dmDisplayChannels,
    ];
    const seen = new Set<string>();
    return ordered.filter(channel => {
      if (seen.has(channel.id)) return false;
      seen.add(channel.id);
      return true;
    });
  }, [starredDisplayChannels, displaySectioned, defaultDisplayChannels, dmDisplayChannels]);

  const navigateRelativeChannel = useCallback(
    (delta: number): void => {
      const flat = flatSidebarChannels ?? [];
      if (flat.length === 0) return;
      const currentIndex = flat.findIndex(c => c.id === activeChannelId);
      // With nothing active yet, Down enters at the top and Up at the bottom.
      const baseIndex = currentIndex === -1 ? (delta > 0 ? -1 : flat.length) : currentIndex;
      const nextIndex = Math.min(flat.length - 1, Math.max(0, baseIndex + delta));
      const target = flat[nextIndex];
      if (!target || target.id === activeChannelId) return;
      void navigate(`/chat/dir/${target.id}`);
    },
    [flatSidebarChannels, activeChannelId, navigate],
  );

  useShortcutById('sidebar.nextConversation', () => navigateRelativeChannel(1));
  useShortcutById('sidebar.prevConversation', () => navigateRelativeChannel(-1));

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
  const [isSectionMenuOpen, setIsSectionMenuOpen] = useState(false);
  const unreadSectionIds = useMemo(() => {
    const hasBadge = (list: VisibleChannel[]): boolean =>
      list.some(c => (unreadCounts[c.id] ?? 0) > 0 && c.id !== activeChannelId);

    const ids: string[] = [];
    if (hasBadge(starredDisplayChannels)) ids.push(ChannelCategory.STARRED);
    for (const { section, channels: sectionChannels } of displaySectioned) {
      if (hasBadge(sectionChannels)) ids.push(section.id);
    }
    if (hasBadge(defaultDisplayChannels)) ids.push(ChannelCategory.CHANNELS);
    if (hasBadge(dmDisplayChannels)) ids.push(ChannelCategory.DIRECT_MESSAGES);
    return ids;
  }, [
    starredDisplayChannels,
    displaySectioned,
    defaultDisplayChannels,
    dmDisplayChannels,
    unreadCounts,
    activeChannelId,
  ]);
  const { above: unreadSectionAbove, below: unreadSectionBelow } = useOffscreenUnreadSections(
    listContainerRef,
    unreadSectionIds,
  );

  const unreadActivityStats = useMemo(() => {
    const allOrdered = [...starred, ...channels, ...directMessages];
    let hasUnread = false;
    for (const c of allOrdered) {
      if (
        isDeskChannelType(c.type) ||
        c.type === ChannelType.SUPPORT ||
        c.type === ChannelType.SDLC
      )
        continue;

      const count = unreadCounts[c.id] ?? 0;

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
    return { hasUnread };
  }, [starred, channels, directMessages, unreadCounts, allChannelsUserStatus, context.userID]);

  // Unread subset of flatSidebarChannels — recomputed reactively so that once a
  // channel is auto-marked-read on open, it drops from this list and indexes
  // shift naturally for the next Alt+Shift+Arrow press.
  const unreadChannelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of flatSidebarChannels ?? []) {
      if (
        isDeskChannelType(c.type) ||
        c.type === ChannelType.SUPPORT ||
        c.type === ChannelType.SDLC
      )
        continue;
      const status = allChannelsUserStatus.find(
        s => s.channelId === c.id && s.userId === context.userID,
      );
      const isDM = c.scopeType === ChannelScopeType.DM || c.scopeType === ChannelScopeType.GROUP_DM;
      if (status?.desktopNotificationLevel === NotificationLevel.NONE) continue;
      const hasUnreadCount = (unreadCounts[c.id] ?? 0) > 0;
      let isUnread = hasUnreadCount;
      if (!isDM) {
        const hasNewActivity =
          !!status?.lastViewedAt &&
          !!c.channelStats?.lastActivityAt &&
          c.channelStats.lastActivityAt > status.lastViewedAt;
        isUnread = hasUnreadCount || hasNewActivity;
      }
      if (isUnread) ids.add(c.id); // For DM channels, unread count is single source of truth
    }
    return ids;
  }, [flatSidebarChannels, unreadCounts, allChannelsUserStatus, context.userID]);

  const navigateRelativeUnreadChannel = useCallback(
    (delta: number): void => {
      const flat = flatSidebarChannels ?? [];
      if (flat.length === 0 || unreadChannelIds.size === 0) return;
      const currentIndex = flat.findIndex(c => c.id === activeChannelId);
      const baseIndex = currentIndex === -1 ? (delta > 0 ? -1 : flat.length) : currentIndex;
      // Scan forward/backward from current position for the next unread channel.
      for (let i = baseIndex + delta; i >= 0 && i < flat.length; i += delta) {
        const candidate = flat[i];
        if (candidate && unreadChannelIds.has(candidate.id)) {
          void navigate(`/chat/dir/${candidate.id}`);
          return;
        }
      }
    },
    [flatSidebarChannels, unreadChannelIds, activeChannelId, navigate],
  );

  useShortcutById('sidebar.nextUnreadConversation', () => navigateRelativeUnreadChannel(1));
  useShortcutById('sidebar.prevUnreadConversation', () => navigateRelativeUnreadChannel(-1));

  const createChannelMutation = useMutation({
    mutationFn: (data: CreateChannelFormData) => channelService.createChannel(data),
    onSuccess: response => {
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
    onSuccess: response => {
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
      landingChannelId ||
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
    landingChannelId,
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
      // Only bare j/k/Enter navigate; ignore ⌘/⌃/⌥ combos so browser and
      // app shortcuts (e.g. ⌘K search) still work while the sidebar is focused.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'j' && e.key !== 'k' && e.key !== 'Enter') return;
      const active = document.activeElement;
      if (!listContainerRef.current || !active || !listContainerRef.current.contains(active)) {
        return;
      }
      const tag = (active as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (active as HTMLElement).isContentEditable) {
        return;
      }
      const flat = flatSidebarChannels ?? [];
      if (flat.length === 0) return;
      const currentId = activeChannelId ?? null;

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
  }, [flatSidebarChannels, activeChannelId, navigate]);

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
    <div className={cn('h-full w-full flex flex-col', isMobile && 'bg-sidebar')}>
      <div className='w-full h-[52px] shrink-0'>
        <AppNavigator />
      </div>
      <div className='relative flex-1 min-h-0 px-3 pt-3 pb-12 sm:pb-0 flex flex-col border-t border-sidebar-border-muted'>
        <div className='block sm:hidden -mx-2 px-2 bg-background/70 backdrop-blur-md rounded-b-3xl border-b border-black/10'>
          <div className='px-2 pt-2 pb-3 flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <img src='/svgs/xyne.svg' alt='Xyne Logo' className='h-3 w-auto' />
            </div>
            <div className='flex items-center gap-2'>
              <button
                onClick={() => setIsCommandMenuOpen(true)}
                className='size-8 flex items-center justify-center rounded-md hover:bg-sidebar-accent transition-colors'
                aria-label='Search'
                data-track-category='CHAT_SIDEBAR'
                data-track-name='OPEN_SEARCH'
              >
                <SearchDefault size={16} className='text-sidebar-foreground' />
              </button>
              <Avatar userId={context.userID} size='sm' />
            </div>
          </div>
        </div>
        <div className='relative hidden sm:flex pt-2 pb-3 px-2 h-10 items-center justify-between mb-2 shrink-0'>
          <h2 className='text-base font-semibold leading-normal text-sidebar-accent-foreground'>
            Inbox
          </h2>
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
            <UnreadMentionsPill target={unreadSectionAbove} direction='up' />
          </div>
        </div>

        <div
          ref={listContainerRef}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role='region'
          aria-label='Channels and direct messages'
          className='flex-1 h-full overflow-y-scroll no-scrollbar pb-[calc(2.5rem+env(safe-area-inset-bottom))] px-0.5 pt-1 outline-none'
        >
          <div className='hidden md:block'>
            <button
              className={cn(
                'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent hover:border-sidebar-border',
                'text-sidebar-foreground hover:text-sidebar-accent-foreground',
              )}
              onClick={() => {
                void navigate('/chat/search?mode=dm', { replace: true });
              }}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='NEW_MESSAGE'
            >
              <span className='size-4 flex items-center justify-center shrink-0'>
                <ChatPlus className='size-4' />
              </span>
              <span className='flex-1 min-w-0 text-left truncate block'>New Message</span>
              <ShortcutHint shortcut='global.composeMessage' />
            </button>
            <button
              className={cn(
                'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent hover:border-sidebar-border',
                hasUnreadThreads
                  ? 'text-sidebar-accent-foreground font-semibold'
                  : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
              )}
              onClick={() => {
                void navigate('/chat/dir/threads');
              }}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='OPEN_THREADS'
              data-track-metadata={JSON.stringify({ threadCount, hasUnreadThreads })}
            >
              <span className='size-4 flex items-center justify-center shrink-0'>
                <Subtask className='size-4' />
              </span>
              <span className='flex-1 min-w-0 text-left truncate block'>Threads</span>
              <ShortcutHint shortcut='global.openThreads' />
              {threadCount > 0 && (
                <span className='size-5 flex items-center justify-center shrink-0'>
                  <Badge
                    variant='success'
                    className='text-xs h-[18px] px-[6px] py-[1px] bg-sidebar-primary border border-sidebar-accent-ring text-sidebar-primary-foreground'
                  >
                    {threadCount > 10 ? '10+' : threadCount}
                  </Badge>
                </span>
              )}
            </button>
            <button
              className={cn(
                'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent hover:border-sidebar-border',
                location.pathname.includes('/chat/dir/unreads')
                  ? 'text-sidebar-accent-foreground font-medium bg-sidebar-accent'
                  : unreadActivityStats.hasUnread
                    ? 'text-sidebar-accent-foreground font-semibold'
                    : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
              )}
              onClick={() => {
                void navigate('/chat/dir/unreads');
              }}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='OPEN_UNREADS'
            >
              <span className='size-4 flex items-center justify-center shrink-0'>
                <ChatTyping className='size-4' />
              </span>
              <span className='flex-1 min-w-0 text-left truncate block'>Unreads</span>
            </button>
            <button
              className={cn(
                'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent hover:border-sidebar-border',
                overdueRemindersCount > 0
                  ? 'text-sidebar-accent-foreground font-semibold'
                  : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
              )}
              onClick={() => {
                void navigate('/chat/bookmarks');
              }}
              data-testid='open-bookmarks-button'
              data-track-category='CHAT_SIDEBAR'
              data-track-name='OPEN_BOOKMARKS'
              data-track-metadata={JSON.stringify({ overdueRemindersCount })}
            >
              <span className='size-4 flex items-center justify-center shrink-0'>
                <BookmarkDefault className='size-4' />
              </span>
              <span className='flex-1 min-w-0 text-left truncate block'>Bookmarks</span>
              {overdueRemindersCount > 0 && (
                <span className='size-5 flex items-center justify-center shrink-0'>
                  <Badge
                    variant='success'
                    className='text-xs h-[18px] px-[6px] py-[1px] bg-sidebar-primary border border-sidebar-accent-ring text-sidebar-primary-foreground'
                  >
                    {overdueRemindersCount > 10 ? '10+' : overdueRemindersCount}
                  </Badge>
                </span>
              )}
            </button>
            <button
              className={cn(
                'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent hover:border-sidebar-border',
                location.pathname.endsWith('/chat/drafts-sent')
                  ? 'text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
              )}
              onClick={() => {
                void navigate('drafts-sent');
              }}
              data-testid='open-drafts-and-sent-button'
              data-track-category='CHAT_SIDEBAR'
              data-track-name='OPEN_DRAFTS_AND_SENT'
            >
              <span className='size-4 flex items-center justify-center shrink-0'>
                <SendPlaneSlant className='size-4' />
              </span>
              <span className='flex-1 min-w-0 text-left truncate block'>Drafts &amp; Sent</span>
              <span className='flex items-center gap-2 text-sidebar-foreground'>
                {draftsCount > 0 && (
                  <span className='flex items-center gap-1 text-xs'>
                    <PencilEdit size={12} />
                    {draftsCount}
                  </span>
                )}
                {pendingScheduledCount > 0 && (
                  <span className='flex items-center gap-1 text-xs'>
                    <ClockDefault size={12} />
                    {pendingScheduledCount}
                  </span>
                )}
              </span>
            </button>
            <button
              className={cn(
                'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent hover:border-sidebar-border',
                recapUnreadCount > 0
                  ? 'text-sidebar-accent-foreground font-semibold'
                  : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
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
              <span className='size-4 flex items-center justify-center shrink-0'>
                <ListAiGenerated className='size-4' />
              </span>
              <span className='flex-1 min-w-0 text-left truncate block'>Recap</span>
              {recapUnreadCount > 0 && (
                <span className='size-5 flex items-center justify-center shrink-0'>
                  <Badge
                    variant='success'
                    className='text-xs h-[18px] px-[6px] py-[1px] bg-sidebar-primary border border-sidebar-accent-ring text-sidebar-primary-foreground'
                  >
                    {recapUnreadCount > 10 ? '10+' : recapUnreadCount}
                  </Badge>
                </span>
              )}
            </button>
            {radarEnabled && (
              <button
                className={cn(
                  'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent hover:border-sidebar-border',
                  location.pathname.includes('/chat/dir/radar')
                    ? 'text-sidebar-accent-foreground font-semibold bg-sidebar-accent'
                    : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
                )}
                onClick={() => {
                  void navigate('/chat/dir/radar');
                }}
                data-track-category='CHAT_SIDEBAR'
                data-track-name='OPEN_RADAR'
              >
                <span className='size-4 flex items-center justify-center shrink-0'>
                  <RadarIcon className='size-4' />
                </span>
                <span className='flex-1 min-w-0 text-left truncate block'>Radar</span>
              </button>
            )}
          </div>

          <div className='py-3 w-full hidden md:block' />

          {showSuggestionCard && (
            <ProjectSectionSuggestionCard
              onAccept={() => setShowOrganizer(true)}
              onDismiss={handleDismissSuggestion}
            />
          )}

          <Accordion.Root
            type='multiple'
            className='space-y-4'
            value={openSidebarSections}
            onValueChange={handleSectionsOpenChange}
          >
            <DndContext {...dndContextProps}>
              <ContainerDropZone id={`section-drop-${STARRED_CONTAINER}`}>
                {(starred.length > 0 || activeOverlayChannel !== null) && (
                  <Accordion.Item
                    value={ChannelCategory.STARRED}
                    data-sidebar-section={ChannelCategory.STARRED}
                  >
                    <Accordion.Header asChild>
                      <div className='group px-3 flex items-center justify-between gap-2'>
                        <Accordion.Trigger asChild>
                          <button className='flex items-center justify-start gap-2 w-full h-7 text-sidebar-foreground text-xs font-medium'>
                            <span className='size-4 flex items-center justify-center shrink-0'>
                              <Star size={14} className='group-hover:hidden' />
                              <ChevronRight
                                strokeWidth={2.33}
                                size={12}
                                className='hidden group-hover:block transition-transform duration-200 group-data-[state=open]:rotate-90'
                              />
                            </span>
                            <span className='text-left truncate block'>Starred</span>
                          </button>
                        </Accordion.Trigger>
                        {starredUnreadCount > 0 && (
                          <Badge className='order-last hidden group-data-[state=closed]:inline-flex font-mono h-[18px] shrink-0 bg-sidebar-primary border border-sidebar-accent-ring px-1.5 text-sidebar-primary-foreground'>
                            {starredUnreadCount > 9 ? '9+' : starredUnreadCount}
                          </Badge>
                        )}
                        <GroupSettingsMenu
                          group='starred'
                          trackName='STARRED_SECTION_OPTIONS'
                          groupPreferences={groupPreferences}
                          setGroupPreference={setGroupPreference}
                        />
                      </div>
                    </Accordion.Header>
                    <Accordion.Content>
                      <div className='min-h-[4px]'>
                        {starredDisplayChannels.length === 0 ? (
                          <div className='px-2 py-1 text-xs text-sidebar-foreground/60 italic'>
                            Drop here to star
                          </div>
                        ) : (
                          starredDisplayChannels.map(channel => (
                            <SortableChannelItem
                              key={channel.id}
                              channel={channel}
                              unreadCount={unreadCounts[channel.id] ?? 0}
                              isActive={activeChannelId === channel.id}
                              sections={channelSections ?? []}
                              onMoveToSection={moveChannelToSection}
                            />
                          ))
                        )}
                      </div>
                    </Accordion.Content>
                  </Accordion.Item>
                )}
              </ContainerDropZone>

              {/* Custom sections (per-user, drag to reorder) */}
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
                    sectionUnreadCount={sectionUnreadCounts[section.id] ?? 0}
                    activeChannelId={activeChannelId}
                    onRename={setSectionToRename}
                    onDelete={setSectionToDelete}
                    onManageChannels={setSectionToManage}
                    onCreateSection={() => {
                      setAddSectionSource('channels');
                      setShowAddSectionForm(true);
                    }}
                    onMoveChannelToSection={moveChannelToSection}
                    onSetSortOrder={(sectionId, order) => {
                      void zero.mutate(
                        mutators.channelSection.update({
                          id: sectionId,
                          sortOrder: order,
                          timestamp: Date.now(),
                        }),
                      );
                    }}
                    onSetFilterMode={(sectionId, mode) => {
                      void zero.mutate(
                        mutators.channelSection.update({
                          id: sectionId,
                          filterMode: mode,
                          timestamp: Date.now(),
                        }),
                      );
                    }}
                  />
                ))}
              </SortableContext>
              {/* Portaled to <body> so a transformed ancestor can't offset the overlay. */}
              {createPortal(
                <DragOverlay dropAnimation={null}>
                  {activeOverlayChannel ? (
                    <div className='rounded-md bg-sidebar-accent shadow-lg cursor-grabbing'>
                      <ChannelItemV2
                        channel={activeOverlayChannel}
                        unreadCount={unreadCounts[activeOverlayChannel.id] ?? 0}
                      />
                    </div>
                  ) : activeOverlaySection ? (
                    <div className='flex items-center gap-1 h-8 px-2 rounded-md bg-sidebar-accent text-xs font-medium text-sidebar-foreground shadow-lg cursor-grabbing'>
                      {activeOverlaySection.emoji &&
                        renderEmoji(activeOverlaySection.emoji, 'size-4')}
                      <span className='truncate'>{activeOverlaySection.name}</span>
                    </div>
                  ) : null}
                </DragOverlay>,
                document.body,
              )}

              {/* Channels  */}
              <Accordion.Item
                value={ChannelCategory.CHANNELS}
                data-sidebar-section={ChannelCategory.CHANNELS}
              >
                <Accordion.Header asChild>
                  <div className='group px-3 flex items-center justify-between gap-2 '>
                    <Accordion.Trigger asChild>
                      <button className=' flex items-center justify-start gap-2 w-full h-7 text-sidebar-foreground text-xs font-medium'>
                        <span className='size-4 flex items-center justify-center shrink-0'>
                          <Hashtag size={14} className='group-hover:hidden' />
                          <ChevronRight
                            strokeWidth={2.33}
                            size={12}
                            className='hidden group-hover:block transition-transform duration-200 group-data-[state=open]:rotate-90'
                          />
                        </span>
                        <span className='text-left truncate block'>Channels</span>
                      </button>
                    </Accordion.Trigger>
                    {defaultUnreadCount > 0 && (
                      <Badge className='order-last hidden group-data-[state=closed]:inline-flex font-mono h-[18px] shrink-0 bg-sidebar-primary border border-sidebar-accent-ring px-1.5 text-sidebar-primary-foreground'>
                        {defaultUnreadCount > 9 ? '9+' : defaultUnreadCount}
                      </Badge>
                    )}
                    <div
                      className={`flex items-center gap-2 mr-0.5 transition-opacity ease-in-out duration-300 ${isSectionMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    >
                      <Tooltip
                        content='Browse channels'
                        side='top'
                        sideOffset={0}
                        delayDuration={500}
                      >
                        <button
                          className='group/child text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors rounded-md p-1'
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void navigate('/chat/search?mode=channels');
                          }}
                          data-track-category='CHAT_SIDEBAR'
                          data-track-name='BROWSE_CHANNELS'
                        >
                          <SearchDefault
                            strokeWidth={2.33}
                            size={14}
                            className='text-sidebar-foreground group-hover/child:text-sidebar-primary transition-colors'
                          />
                        </button>
                      </Tooltip>
                      <Tooltip
                        content='Create channel'
                        side='top'
                        sideOffset={0}
                        delayDuration={500}
                      >
                        <button
                          className='group/child text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors rounded-md p-1'
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
                          <PlusDefault
                            strokeWidth={2.33}
                            size={14}
                            className='text-sidebar-foreground group-hover/child:text-sidebar-primary transition-colors'
                          />
                        </button>
                      </Tooltip>
                      <GroupSettingsMenu
                        group='channels'
                        trackName='CHANNELS_SECTION_OPTIONS'
                        groupPreferences={groupPreferences}
                        setGroupPreference={setGroupPreference}
                        onOpenChange={setIsSectionMenuOpen}
                        alwaysVisible
                        actions={[
                          {
                            label: 'Browse channels',
                            icon: SearchDefault,
                            trackName: 'BROWSE_CHANNELS',
                            onSelect: () => void navigate('/chat/search?mode=channels'),
                          },
                          {
                            label: 'Create channel',
                            icon: PlusDefault,
                            trackName: 'CREATE_NEW_CHANNEL',
                            onSelect: () => setShowAddChannelForm(true),
                          },
                          {
                            label: 'New section',
                            icon: FolderPlus,
                            trackName: 'CREATE_NEW_SECTION',
                            onSelect: () => {
                              setAddSectionSource('channels');
                              setShowAddSectionForm(true);
                            },
                          },
                        ]}
                      />
                    </div>
                  </div>
                </Accordion.Header>
                <Accordion.Content data-testid='channel-list'>
                  <ContainerDropZone
                    id={`section-drop-${DEFAULT_CONTAINER}`}
                    className='min-h-[4px]'
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
                  </ContainerDropZone>
                </Accordion.Content>
              </Accordion.Item>
              {/* DMS  */}
              <Accordion.Item
                value={ChannelCategory.DIRECT_MESSAGES}
                data-sidebar-section={ChannelCategory.DIRECT_MESSAGES}
              >
                <Accordion.Header asChild>
                  <div className='group px-3 flex items-center justify-between gap-2 '>
                    <Accordion.Trigger asChild>
                      <button className='flex items-center justify-start gap-2 w-full h-7 text-sidebar-foreground text-xs font-medium'>
                        <span className='size-4 flex items-center justify-center shrink-0'>
                          <ChatDefault size={14} className='group-hover:hidden' />
                          <ChevronRight
                            strokeWidth={2.33}
                            size={12}
                            className='hidden group-hover:block transition-transform duration-200 group-data-[state=open]:rotate-90'
                          />
                        </span>
                        <span className='text-left truncate block'>Direct Messages</span>
                      </button>
                    </Accordion.Trigger>
                    {dmUnreadCount > 0 && (
                      <Badge className='order-last hidden group-data-[state=closed]:inline-flex font-mono h-[18px] shrink-0 bg-sidebar-primary border border-sidebar-accent-ring px-1.5 text-sidebar-primary-foreground'>
                        {dmUnreadCount > 9 ? '9+' : dmUnreadCount}
                      </Badge>
                    )}
                    <Tooltip
                      content='Add direct message'
                      side='top'
                      sideOffset={0}
                      delayDuration={500}
                    >
                      <button
                        id='sidebar-add-dm-btn'
                        className='group/child text-sidebar-foreground hover:text-sidebar-accent-foreground opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity ease-in-out duration-300 hover:bg-sidebar-accent rounded-md p-1 mr-0.5'
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
                        <PlusDefault
                          strokeWidth={2.33}
                          size={14}
                          className='text-sidebar-foreground group-hover/child:text-sidebar-primary transition-colors'
                        />
                      </button>
                    </Tooltip>
                    <GroupSettingsMenu
                      group='dms'
                      trackName='DM_SECTION_OPTIONS'
                      allowMentionsFilter={false}
                      groupPreferences={groupPreferences}
                      setGroupPreference={setGroupPreference}
                      actions={[
                        {
                          label: 'Add direct message',
                          icon: PlusDefault,
                          trackName: 'CREATE_DIRECT_MESSAGE',
                          onSelect: handleAddDirectMessage,
                        },
                        {
                          label: 'New section',
                          icon: FolderPlus,
                          trackName: 'CREATE_NEW_SECTION',
                          onSelect: () => {
                            setAddSectionSource('dms');
                            setShowAddSectionForm(true);
                          },
                        },
                      ]}
                    />
                  </div>
                </Accordion.Header>
                <Accordion.Content data-testid='dm-list'>
                  <ContainerDropZone id={`section-drop-${DM_CONTAINER}`} className='min-h-[4px]'>
                    {dmDisplayChannels.map(channel => (
                      <SortableChannelItem
                        key={channel.id}
                        channel={channel}
                        unreadCount={unreadCounts[channel.id] ?? 0}
                        isActive={activeChannelId === channel.id}
                        sections={channelSections ?? []}
                        onMoveToSection={moveChannelToSection}
                      />
                    ))}
                  </ContainerDropZone>
                </Accordion.Content>
              </Accordion.Item>
            </DndContext>
          </Accordion.Root>
        </div>

        <div className='pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center'>
          <UnreadMentionsPill target={unreadSectionBelow} direction='down' />
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
              prioritizeType={addSectionSource === 'dms' ? 'dm' : 'channel'}
              onClose={() => setShowAddSectionForm(false)}
            />
          )}
        </Dialog>

        <Dialog
          open={showOrganizer}
          onOpenChange={setShowOrganizer}
          testId='section-organizer-dialog'
          className='max-w-lg'
        >
          {showOrganizer && (
            <SectionOrganizerDialog
              suggestions={sectionSuggestions}
              channelsById={channelsById}
              existingNames={(channelSections ?? []).map(s => s.name)}
              onCancel={() => setShowOrganizer(false)}
              onConfirm={handleCreateSections}
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
                <MultipleCrossCancelDefault size={20} />
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
              <Button
                variant='ghost'
                onClick={handleConfirmDeleteSection}
                trackId='delete_channel_section'
                data-track-category='CHAT_SIDEBAR'
                data-track-name='CONFIRM_DELETE_SECTION'
                className='inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors'
              >
                Delete
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          open={!!sectionToManage}
          onOpenChange={open => {
            if (!open) setSectionToManage(null);
          }}
          testId='manage-section-channels-dialog'
        >
          {sectionToManage && (
            <ManageSectionChannelsDialog
              section={sectionToManage}
              channels={sectionableChannels}
              currentChannelIds={allChannelsUserStatus
                .filter(s => s.sectionId === sectionToManage.id)
                .map(s => s.channelId)}
              onSave={(toAdd, toRemove) => {
                const timestamp = Date.now();
                const existingPositions = allChannelsUserStatus
                  .filter(s => s.sectionId === sectionToManage.id)
                  .map(s => s.sectionPosition ?? '')
                  .filter(p => p !== '')
                  .sort();
                let prevKey: string | null =
                  existingPositions[existingPositions.length - 1] ?? null;
                for (const channelId of toAdd) {
                  const position = keyBetween(prevKey, null);
                  void zero.mutate(
                    mutators.channel.moveToSection({
                      channelId,
                      sectionId: sectionToManage.id,
                      position,
                      timestamp,
                    }),
                  );
                  prevKey = position;
                }
                for (const channelId of toRemove) {
                  void zero.mutate(
                    mutators.channel.moveToSection({
                      channelId,
                      sectionId: null,
                      position: keyBetween(null, null),
                      timestamp,
                    }),
                  );
                }
                setSectionToManage(null);
              }}
              onClose={() => setSectionToManage(null)}
            />
          )}
        </Dialog>
      </div>
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
              data-track-category='CHAT_SIDEBAR'
              data-track-name='BACK_TO_CHAT'
              className='h-8 px-4 flex items-center justify-center rounded-[999px] border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] min-[500px]:hidden z-30 '
            >
              Chat
            </button>
            <div className='z-30'>
              <button
                onClick={() => setIsCommandMenuOpen(true)}
                data-track-category='CHAT_SIDEBAR'
                data-track-name='OPEN_COMMAND_MENU'
                className='h-8 px-2 flex items-center justify-center rounded-[999px] border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] min-[500px]:hidden z-30'
              >
                <SearchDefault size={16} />
              </button>
            </div>
          </div>
        </div> */}

        {/* Desktop */}
        {/* <div className=' sticky top-0 z-50 hidden min-[500px]:block pt-4 bg-sidebar-background'>
          <div className='pb-6 flex items-center justify-between'>
            <button onClick={() => void navigate('/chat')}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='BACK_TO_CHAT' className='cursor-pointer'>
              <h2 className='text-black font-inter text-base font-semibold leading-normal'>Chat</h2>
            </button>
            <button
              onClick={() => setIsCommandMenuOpen(true)}
              data-track-category='CHAT_SIDEBAR'
              data-track-name='OPEN_COMMAND_MENU'
              className='size-8 items-center justify-center hidden min-[500px]:flex cursor-pointer'
            >
              <SearchDefault size={16} />
            </button>
          </div>
          <ChatDirectoryButton
            icon={<NotificationBellIcons />}
            label='Activity'
            {...(activityCount > 0 && { count: activityCount })}
            onClick={() => {
              posthogService.capture(EVENTS.INITIATE_ACTION, {
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
              posthogService.capture(EVENTS.INITIATE_ACTION, {
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
            data-track-category='CHAT_SIDEBAR'
            data-track-name='OPEN_BOOKMARKS'
            data-track-metadata={JSON.stringify({ overdueRemindersCount })}
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
