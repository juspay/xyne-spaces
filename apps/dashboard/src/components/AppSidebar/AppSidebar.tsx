import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Tooltip } from '../ui/Tooltip/Tooltip';
import { XyneAIQuickMenu } from './XyneAIQuickMenu';
import { ChatQuickMenu } from './ChatQuickMenu';
import { RailQuickNavEntry } from './RailQuickNav';
import { ShortcutHint } from '../ui/ShortcutHint';
import { useShortcutById } from '../../shortcuts';
import { useAuth } from '../../hooks/useAuth';
import { useCanViewAnalytics } from '../../hooks/usePermissions';
import {
  GraphTrendLine,
  Settings01,
  PhoneDefault,
  HomeDefault,
  NotificationBellOn,
  ChatDefault,
  ClipboardCheck,
  FileText,
  MicMicrophone,
  ThreeDotsMenuHorizontal,
  BookmarkDefault,
  SparkleAi01,
  GridDashboard01,
  QuestionMarkCircle,
  InformationCircle,
  AlertCircle,
  TicketToken,
  UserPlus,
} from '@xyne/icons';
import { WorkspaceType } from '@xyne/shared';

import Avatar from '../ui/Avatar/Avatar';
import { Popover } from '../ui/Popover/Popover';
import SettingsContent from '../Settings/Settings';
import ProfileModal from '../ProfileSidebar/ProfileModal';
import Preferences, { type PreferenceSection } from '../Settings/Preferences';
import { useSelf } from '../../hooks/useUsers';
import { isStatusExpired } from '../../utils/statusUtils';
import { UpdateStatusModal } from './UpdateStatusModal';
import { StatusIndicator } from '../ui/StatusIndicator';
import { useMissedCallCount } from '../../hooks/useMissedCallCount';
import { useUnreadActivitiesCount } from '../../hooks/useUnreadActivitiesCount';
import { useRecapUnreadCount } from '../../hooks/useRecapData';
import { usePlatform } from '../../hooks/usePlatform';
import { useAllVisibleChannels } from '../../hooks/useChannels';
import { useAllUnreadCount } from '../../hooks/useUnreadCount';
import { reactNativeBridge } from '../../utils/reactNativeBridge';
import { useVisibleNavigationItems } from '../../hooks/useVisibleNavigationItems';
import { usePinnedArtifactApps } from '../../hooks/usePinnedArtifactApps';
import { useToolbarItems } from '../../hooks/useToolbarItems';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import type { NavigationItem } from './navigationConfig';
import {
  RAIL_SHORTCUT_LIMIT,
  railItemIndexFromEvent,
  railShortcutsAvailable,
} from './navigationConfig';
import { useKeyboard } from '../../contexts/KeyboardContext';
import { cn } from '../../utils/classNames';
import { APP_DRAG_STYLE, isElectronApp, openInAppWindow } from '../../utils/electronApp';
import { toast } from 'sonner';
import { ErrorReportModal } from '../ErrorReportModal/ErrorReportModal';
import { isDMChannel } from '../Chat/ChatDirectory/ChatDirectory.utils';
import { SupportRail } from './SupportRail';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { ZeroConnectionStatus } from '../ZeroConnectionStatus/ZeroConnectionStatus';
import WorkspaceInviteDialog from './WorkspaceInviteDialog';

const mobileNavigationItems = [
  {
    path: '/chat/dir',
    label: 'Home',
    icon: HomeDefault,
  },
  {
    path: '/chat/dm',
    label: 'DMs',
    icon: ChatDefault,
  },
  {
    path: '/calls',
    label: 'Calls',
    icon: PhoneDefault,
  },
  {
    path: '/chat/activity',
    label: 'Activity',
    icon: NotificationBellOn,
  },
  {
    path: '/analytics',
    label: 'Analytics',
    icon: GraphTrendLine,
  },
  {
    path: '/chat/canvas',
    label: 'Canvas',
    icon: FileText,
  },
  {
    path: '/dashboards',
    label: 'Dashboards',
    icon: GridDashboard01,
  },
  {
    path: '/recorder',
    label: 'Record',
    icon: MicMicrophone,
  },
  {
    path: '/chat/bookmarks',
    label: 'Bookmarks',
    icon: BookmarkDefault,
  },
  {
    path: '/rca',
    label: 'RCA',
    icon: ClipboardCheck,
  },
  {
    path: '/chat/threads',
    label: 'Threads',
    icon: ChatDefault,
  },
  {
    path: '/chat/recap',
    label: 'Recap',
    icon: SparkleAi01,
  },
  {
    path: '/error-report',
    label: 'Report Issue',
    icon: AlertCircle,
  },
  {
    path: '/guide',
    label: 'Guide',
    icon: QuestionMarkCircle,
  },
];

type QuickMenuProps = {
  prefixWs: (path: string) => string;
  onNavigate: (label: string) => void;
  onDismiss: () => void;
};

const quickMenuFor = (path: string): ((props: QuickMenuProps) => ReactElement) | null => {
  if (path === '/ai') return XyneAIQuickMenu;
  if (path === '/chat/dir') return ChatQuickMenu;
  return null;
};

const SUPPORT_HOME_ROUTES = ['/support'];
const SUPPORT_REUSED_ROUTES = [
  '/ai',
  '/chat/activity',
  '/calls',
  '/automations',
  '/analytics-dashboard',
  '/knowledge-base',
];

const AppSidebar = (): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);
  const { user } = useAuth();
  const currentUser = useSelf();
  const visibleNavigationItems = useVisibleNavigationItems();
  const { toolbarPaths } = useToolbarItems();
  const { pinnedApps } = usePinnedArtifactApps();
  const missedCallCount = useMissedCallCount();
  const unreadActivityCount = useUnreadActivitiesCount();
  const { unreadCount: recapUnreadCount } = useRecapUnreadCount();
  const { isMobile } = usePlatform();
  const visibleChannels = useAllVisibleChannels();
  const unreadCounts = useAllUnreadCount();
  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId: workspaceId || '' }), {
    enabled: !!workspaceId,
  });
  const isCommunityWorkspace = workspace?.workspaceType === WorkspaceType.COMMUNITY;

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  // Determine active route with early returns for special chat paths
  const getActiveRoute = (pathname: string): string => {
    if (pathname.startsWith('/chat/dir')) return '/chat/dir';
    if (pathname.startsWith('/chat/dm')) return '/chat/dm';
    if (pathname.startsWith('/chat/activity')) return '/chat/activity';
    if (pathname.startsWith('/chat/canvas')) return '/chat/canvas';
    if (pathname.startsWith('/chat/drafts')) return '/chat/drafts';
    if (pathname.startsWith('/chat/sent')) return '/chat/sent';
    if (pathname.startsWith('/chat/scheduled')) return '/chat/scheduled';
    if (pathname.startsWith('/migration/confluence')) return '/migration/confluence';
    if (pathname.startsWith('/migration/whatsapp')) return '/migration/whatsapp';
    return '/' + (pathname.split('/')[1] || '');
  };

  const relativePath =
    workspaceId && location.pathname.startsWith(`/${workspaceId}`)
      ? location.pathname.slice(`/${workspaceId}`.length) || '/'
      : location.pathname;

  // Release Manager reuses the /listProjects/:id URL family; keep it highlighted there.
  const inReleaseManager =
    relativePath.startsWith('/listProjects/') &&
    (relativePath.includes('/releases/') ||
      (location.state as { from?: string } | null)?.from === 'releaseManager');
  const activeRoute = inReleaseManager ? '/releaseManager' : getActiveRoute(relativePath);

  const isSupportHome = SUPPORT_HOME_ROUTES.includes(activeRoute);
  const isSupportReused = SUPPORT_REUSED_ROUTES.includes(activeRoute);
  const [supportMode, setSupportMode] = useState<boolean>(
    () => sessionStorage.getItem('xyne-support-mode') === 'true' || isSupportHome,
  );
  useEffect(() => {
    setSupportMode(prev => {
      const next = isSupportHome ? true : isSupportReused ? prev : false;
      sessionStorage.setItem('xyne-support-mode', String(next));
      return next;
    });
  }, [isSupportHome, isSupportReused]);
  const isSupportContext = isSupportHome || (supportMode && isSupportReused);

  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [openQuickMenu, setOpenQuickMenu] = useState<string | null>(null);
  const [isSettingsPopoverOpen, setIsSettingsPopoverOpen] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isErrorReportOpen, setIsErrorReportOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [preferencesInitialSection, setPreferencesInitialSection] = useState<
    PreferenceSection | undefined
  >(undefined);

  const handleOpenPreferences = (): void => {
    setIsSettingsPopoverOpen(false);
    setPreferencesInitialSection(undefined);
    setIsPreferencesOpen(true);
  };

  useEffect(() => {
    const handler = (e: Event): void => {
      const section = (e as CustomEvent<{ section?: PreferenceSection }>).detail?.section;
      setPreferencesInitialSection(section);
      setIsSettingsPopoverOpen(false);
      setIsPreferencesOpen(true);
    };
    window.addEventListener('xyne-open-preferences', handler);
    return (): void => window.removeEventListener('xyne-open-preferences', handler);
  }, []);

  useEffect(() => {
    const handler = (): void => {
      setIsSettingsPopoverOpen(false);
      setIsStatusModalOpen(true);
    };
    window.addEventListener('xyne-open-status', handler);
    return (): void => window.removeEventListener('xyne-open-status', handler);
  }, []);

  // Check if user has a valid (non-expired) status
  const hasValidStatus =
    currentUser?.statusEmoji &&
    (!currentUser?.statusExpiryAt || !isStatusExpired(currentUser.statusExpiryAt));

  const handleStatusClick = (): void => {
    setIsSettingsPopoverOpen(false);
    setIsStatusModalOpen(true);
  };

  const handleStatusModalClose = (): void => {
    setIsStatusModalOpen(false);
  };

  // Hide footer only on pages that have their own complete navigation (channels, bookmarks, threads, etc.)
  const hasChannelOrThreadId =
    (location.pathname.includes('/chat/dir/') && location.pathname.split('/').length > 3) ||
    (location.pathname.includes('/chat/dm/') && location.pathname.split('/').length > 3) ||
    (location.pathname.includes('/chat/activity/') && location.pathname.split('/').length > 3) ||
    (location.pathname.includes('/chat/bookmarks/') && location.pathname.split('/').length > 3) ||
    (location.pathname.includes('/chat/drafts/') && location.pathname.split('/').length > 3) ||
    (location.pathname.includes('/chat/sent/') && location.pathname.split('/').length > 3) ||
    (location.pathname.includes('/chat/scheduled/') && location.pathname.split('/').length > 3) ||
    location.pathname.includes('threadId') ||
    location.hash.includes('threadId');

  // Split the visible items into the toolbar (rendered in the rail) and the
  // "More" overflow menu, based on the user's customized toolbar selection.
  const toolbarItems = useMemo(
    () => visibleNavigationItems.filter(item => toolbarPaths.has(item.path)),
    [visibleNavigationItems, toolbarPaths],
  );
  const moreItems = useMemo(
    () => visibleNavigationItems.filter(item => !toolbarPaths.has(item.path)),
    [visibleNavigationItems, toolbarPaths],
  );
  const isMoreActive = moreItems.some(item => item.path === activeRoute);

  const permittedGlobalPaths = useMemo(
    () => new Set(visibleNavigationItems.map(item => item.path)),
    [visibleNavigationItems],
  );

  const handleCustomizeToolbar = (): void => {
    setIsMoreOpen(false);
    window.dispatchEvent(
      new CustomEvent('xyne-open-preferences', { detail: { section: 'toolbar' } }),
    );
  };

  const hasPendingDirectMessages = useMemo(() => {
    return visibleChannels.some(
      channel => isDMChannel(channel.scopeType) && (unreadCounts[channel.id] ?? 0) > 0,
    );
  }, [visibleChannels, unreadCounts]);

  const handleNavigationClick = (_label: string, _openedInNewWindow = false): void => {};

  const railShortcuts = railShortcutsAvailable();

  useShortcutById(
    'global.goToRailItem',
    event => {
      const item = toolbarItems[railItemIndexFromEvent(event)];
      if (!item) return;
      handleNavigationClick(item.label);
      void navigate(prefixWs(item.path));
    },
    { enabled: railShortcuts && !isSupportContext },
  );

  const handleMoreNavigate = (label: string, openedInNewWindow = false): void => {
    setIsMoreOpen(false);
    handleNavigationClick(label, openedInNewWindow);
  };

  // Keep focus on the trigger when the menu opens so no item shows a focus ring.
  const handleMorePopoverAutoFocus = (e: Event): void => {
    e.preventDefault();
  };

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onAppWindowLimitReached?.(limit => {
      toast.info(`You can have up to ${limit} extra windows open. Close one to open another.`);
    });
    return (): void => unsubscribe?.();
  }, []);

  useEffect(() => {
    const handleResize = (): void => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return (): void => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  if (isMobile || windowWidth < 500) {
    return (
      <MobileNavbar
        filteredNavigationItems={mobileNavigationItems}
        activeRoute={activeRoute}
        isOnChat={hasChannelOrThreadId}
        onNavigationClick={handleNavigationClick}
        missedCallCount={missedCallCount}
        unreadActivityCount={unreadActivityCount}
        recapUnreadCount={recapUnreadCount}
      />
    );
  }

  return (
    <aside className='h-full w-[60px] flex flex-col bg-sidebar'>
      {/* Top spacer aligns with the header strip / macOS traffic lights; make it a
          drag region so the window can be moved by its top-left corner in Electron. */}
      <div className='w-full h-[52px] shrink-0' style={APP_DRAG_STYLE} />
      <div className='flex-1 min-h-0 p-3 flex flex-col items-center justify-between border-t border-r border-sidebar-border-muted'>
        <WorkspaceSwitcher />
        <div className='flex-1 mt-5 space-y-8 overflow-y-auto scrollbar-none min-h-0 pr-2 -mr-2'>
          {isSupportContext ? (
            <SupportRail
              prefixWs={prefixWs}
              onNavigationClick={handleNavigationClick}
              permittedGlobalPaths={permittedGlobalPaths}
              activeRoute={activeRoute}
            />
          ) : (
            <nav>
              <ul className='relative flex flex-col gap-4'>
                {toolbarItems.map((item, index) => {
                  const shortcutIndex =
                    railShortcuts && index < RAIL_SHORTCUT_LIMIT ? index + 1 : null;
                  const isActive = activeRoute === item.path;
                  const showMissedCallBadge = item.path === '/calls' && missedCallCount > 0;
                  const showPendingDmDot = item.path === '/chat/dm' && hasPendingDirectMessages;
                  const showActivityBadge =
                    item.path === '/chat/activity' && unreadActivityCount > 0;
                  const Icon = item.icon;

                  const testId = `nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`;

                  const tooltipContent = shortcutIndex ? (
                    <span className='flex items-center gap-2'>
                      {item.label}
                      <ShortcutHint keys={`mod+${shortcutIndex}`} />
                    </span>
                  ) : (
                    item.label
                  );

                  const QuickMenu = quickMenuFor(item.path);

                  return (
                    <li key={item.path} className='relative'>
                      <RailQuickNavEntry
                        tooltip={tooltipContent}
                        showQuickMenu={!!QuickMenu && !isActive}
                        open={openQuickMenu === item.path}
                        onOpenChange={next => setOpenQuickMenu(next ? item.path : null)}
                        menu={
                          QuickMenu ? (
                            <QuickMenu
                              prefixWs={prefixWs}
                              onNavigate={handleNavigationClick}
                              onDismiss={() => setOpenQuickMenu(null)}
                            />
                          ) : null
                        }
                        trigger={
                          <Link
                            to={prefixWs(item.path)}
                            onClick={event => {
                              const openedInNewWindow =
                                !!item.popout && openInAppWindow(prefixWs(item.path), event);
                              handleNavigationClick(item.label, openedInNewWindow);
                              if (openedInNewWindow) {
                                event.preventDefault();
                              }
                            }}
                            aria-label={showPendingDmDot ? 'DMs unread' : item.label}
                            data-testid={testId}
                            data-track-category='App_Sidebar'
                            data-track-name='Sidebar_Nav_Item'
                            data-track-metadata={JSON.stringify({
                              path: item.path,
                              label: item.label,
                            })}
                            className={cn(
                              'relative size-8 flex items-center justify-center rounded-lg cursor-pointer border border-transparent transition-colors',
                              isActive
                                ? 'bg-sidebar-accent border-sidebar-border text-sidebar-accent-foreground'
                                : 'bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                            )}
                          >
                            <Icon
                              size={item.iconSize ?? 16}
                              variant={isActive ? 'Solid' : 'Stroke'}
                            />
                            {showPendingDmDot && (
                              <span
                                aria-hidden='true'
                                className='absolute top-1 right-1 size-[9px] rounded-full bg-sidebar-primary border border-sidebar-accent-ring'
                              />
                            )}
                            {showMissedCallBadge && (
                              <span className='absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-[4px] rounded-full bg-sidebar-primary border border-sidebar-accent-ring text-sidebar-primary-foreground text-[11px] font-semibold'>
                                {missedCallCount > 99 ? '99+' : missedCallCount}
                              </span>
                            )}
                            {showActivityBadge && (
                              <span className='absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-[4px] rounded-full bg-sidebar-primary border border-sidebar-accent-ring text-sidebar-primary-foreground text-[11px] font-semibold'>
                                {unreadActivityCount > 99 ? '99+' : unreadActivityCount}
                              </span>
                            )}
                          </Link>
                        }
                      />
                    </li>
                  );
                })}

                {/* Pinned artifact apps — user-generated apps promoted to the
                    rail from the AI Library. Stored per-device in localStorage. */}
                {pinnedApps.map(app => {
                  const path = `/ai/library/app/${app.id}`;
                  const isActive = activeRoute === path;
                  const initial = app.title.trim().charAt(0).toUpperCase() || '?';
                  return (
                    <li key={app.id} className='relative'>
                      <Tooltip content={app.title} side='right' delayDuration={0}>
                        <Link
                          to={prefixWs(path)}
                          onClick={() => handleNavigationClick(app.title)}
                          aria-label={app.title}
                          data-testid={`nav-artifact-app-${app.id}`}
                          data-track-category='App_Sidebar'
                          data-track-name='Sidebar_Pinned_App'
                          data-track-metadata={JSON.stringify({ appId: app.id })}
                          className={cn(
                            'relative size-8 flex items-center justify-center rounded-lg cursor-pointer border border-transparent transition-colors text-[11px] font-semibold',
                            isActive
                              ? 'bg-sidebar-accent border-sidebar-border text-sidebar-accent-foreground'
                              : 'bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                          )}
                        >
                          {initial}
                        </Link>
                      </Tooltip>
                    </li>
                  );
                })}

                {/* More menu — overflow items + customize toolbar (Slack-style) */}
                <li className='relative'>
                  <Popover
                    open={isMoreOpen}
                    onOpenChange={setIsMoreOpen}
                    side='right'
                    align='start'
                    sideOffset={8}
                    collisionPadding={12}
                    onOpenAutoFocus={handleMorePopoverAutoFocus}
                    className='p-1.5 w-64 max-h-[80vh] overflow-y-auto rounded-xl'
                    trigger={
                      <button
                        type='button'
                        aria-label='More'
                        data-testid='nav-more'
                        data-track-category='App_Sidebar'
                        data-track-name='Sidebar_More_Toggle'
                        className={cn(
                          'size-8 flex items-center justify-center rounded-lg cursor-pointer border border-transparent transition-colors',
                          isMoreActive || isMoreOpen
                            ? 'bg-sidebar-accent border-sidebar-border text-sidebar-accent-foreground'
                            : 'bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        )}
                      >
                        <ThreeDotsMenuHorizontal size={16} />
                      </button>
                    }
                  >
                    <SidebarMoreMenu
                      items={moreItems}
                      activeRoute={activeRoute}
                      prefixWs={prefixWs}
                      onNavigate={handleMoreNavigate}
                      onCustomize={handleCustomizeToolbar}
                    />
                  </Popover>
                </li>
              </ul>
            </nav>
          )}
        </div>

        <div
          className={cn('flex flex-col items-center justify-center', !isElectronApp() && 'pb-4')}
        >
          <ZeroConnectionStatus className='mb-2' />

          {isCommunityWorkspace && (
            <Tooltip content='Invite people' side='right' delayDuration={0}>
              <button
                type='button'
                aria-label='Invite people to workspace'
                title='Invite people'
                onClick={() => setIsInviteDialogOpen(true)}
                data-testid='nav-invite-people'
                data-track-category='App_Sidebar'
                data-track-name='Sidebar_InvitePeople_Open'
                className={cn(
                  'size-8 mb-2 translate-y-[10px] flex items-center justify-center rounded-lg cursor-pointer border border-transparent transition-colors',
                  isInviteDialogOpen
                    ? 'bg-sidebar-accent border-sidebar-border text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <UserPlus size={18} variant='Solid' className='text-black' />
              </button>
            </Tooltip>
          )}

          <Popover
            open={isSupportOpen}
            onOpenChange={setIsSupportOpen}
            side='right'
            align='end'
            sideOffset={8}
            collisionPadding={12}
            onOpenAutoFocus={e => e.preventDefault()}
            className='p-1.5 w-56 rounded-xl'
            trigger={
              <button
                type='button'
                aria-label='Support'
                title='Support'
                data-testid='nav-support'
                data-track-category='App_Sidebar'
                data-track-name='Sidebar_Support_Toggle'
                className={cn(
                  'size-8 mb-2 flex items-center justify-center rounded-lg cursor-pointer border border-transparent transition-colors',
                  isSupportOpen
                    ? 'bg-sidebar-accent border-sidebar-border text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <InformationCircle size={16} />
              </button>
            }
          >
            <SidebarSupportMenu
              onReportIssue={() => {
                setIsSupportOpen(false);
                setIsErrorReportOpen(true);
              }}
              onViewMyTickets={() => {
                setIsSupportOpen(false);
                void navigate(prefixWs('/chat/my-tickets'));
              }}
            />
          </Popover>

          <Popover
            trigger={
              hasValidStatus ? (
                <div
                  className='relative w-[32px] h-14 rounded-lg flex flex-col items-center justify-end transition-opacity hover:opacity-90 cursor-pointer [--avatar-ring:var(--sidebar-avatar-ring)]'
                  data-testid='profile-icon'
                >
                  <div className='absolute inset-x-0 top-0 bottom-2 rounded-lg bg-sidebar-border' />

                  {/* Status Emoji at Top Center */}
                  <div className='absolute top-0 left-1/2 -translate-x-1/2 z-10'>
                    <StatusIndicator
                      statusEmoji={currentUser?.statusEmoji}
                      statusContent={currentUser?.statusContent}
                      statusExpiryAt={currentUser?.statusExpiryAt}
                      size='lg'
                      showOnHover={true}
                    />
                  </div>

                  {/* Avatar at Bottom - overlaps container slightly */}
                  <div className='relative z-10 flex'>
                    {user ? (
                      <Avatar userId={user.id} size='md' className='rounded-lg' />
                    ) : (
                      <div className='size-9 rounded-xl flex items-center justify-center bg-border'>
                        <Settings01 size={14} className='text-sidebar-foreground' />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className='relative w-[32px] flex flex-col items-center justify-end transition-opacity hover:opacity-90 cursor-pointer [--avatar-ring:var(--sidebar-avatar-ring)]'
                  data-testid='profile-icon'
                >
                  {/* Avatar at Bottom - overlaps container slightly to match with-status state */}
                  <div className='relative flex'>
                    {user ? (
                      <Avatar userId={user.id} size='md' className='rounded-md' />
                    ) : (
                      <div className='size-9 rounded-xl flex items-center justify-center bg-border'>
                        <Settings01 size={14} className='text-sidebar-foreground' />
                      </div>
                    )}
                  </div>
                </div>
              )
            }
            open={isSettingsPopoverOpen}
            onOpenChange={setIsSettingsPopoverOpen}
            onOpenAutoFocus={e => e.preventDefault()}
            side='right'
            sideOffset={8}
            align='end'
            collisionPadding={12}
            className='max-h-[calc(100vh-24px)] overflow-y-auto overscroll-contain no-scrollbar'
          >
            <SettingsContent
              onClose={() => setIsSettingsPopoverOpen(false)}
              onOpenPreferences={handleOpenPreferences}
              onOpenStatusModal={handleStatusClick}
              onOpenProfileModal={userId => setProfileModalUserId(userId)}
            />
          </Popover>

          <Preferences
            open={isPreferencesOpen}
            onClose={() => setIsPreferencesOpen(false)}
            {...(preferencesInitialSection && { initialSection: preferencesInitialSection })}
          />

          {/* Profile modal — used on non-chat pages where the routed profile
              sidebar (`/chat/dir/.../profile/...`) is not mounted. */}
          <ProfileModal
            userId={profileModalUserId}
            isOpen={profileModalUserId !== null}
            onClose={() => setProfileModalUserId(null)}
          />
        </div>

        {/* Error Report Modal — opened from the Support rail button */}
        <ErrorReportModal isOpen={isErrorReportOpen} onClose={() => setIsErrorReportOpen(false)} />

        <WorkspaceInviteDialog
          open={isInviteDialogOpen}
          onOpenChange={setIsInviteDialogOpen}
          workspaceId={workspaceId}
        />

        {/* Status Update Modal */}
        <UpdateStatusModal
          isOpen={isStatusModalOpen}
          onClose={handleStatusModalClose}
          currentStatus={
            hasValidStatus
              ? {
                  emoji: currentUser?.statusEmoji || '',
                  content: currentUser?.statusContent || '',
                  expiryAt: currentUser?.statusExpiryAt || null,
                }
              : null
          }
        />
      </div>
    </aside>
  );
};

const SidebarMoreMenu = ({
  items,
  activeRoute,
  prefixWs,
  onNavigate,
  onCustomize,
}: {
  items: NavigationItem[];
  activeRoute: string;
  prefixWs: (path: string) => string;
  onNavigate: (label: string, openedInNewWindow?: boolean) => void;
  onCustomize: () => void;
}): ReactElement => {
  return (
    <div className='flex flex-col'>
      <p className='px-2.5 pt-1 pb-1.5 text-sm font-semibold text-popover-foreground'>More</p>
      {items.length > 0 ? (
        <ul className='flex flex-col'>
          {items.map(item => {
            const Icon = item.icon;
            const isActive = activeRoute === item.path;
            return (
              <li key={item.path}>
                <Link
                  to={prefixWs(item.path)}
                  onClick={event => {
                    const openedInNewWindow =
                      !!item.popout && openInAppWindow(prefixWs(item.path), event);
                    onNavigate(item.label, openedInNewWindow);
                    if (openedInNewWindow) {
                      event.preventDefault();
                    }
                  }}
                  data-testid={`more-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  data-track-category='App_Sidebar'
                  data-track-name='Sidebar_More_Item'
                  data-track-metadata={JSON.stringify({ path: item.path, label: item.label })}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-popover-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <span className='flex size-5 shrink-0 items-center justify-center'>
                    <Icon size={16} variant={isActive ? 'Solid' : 'Stroke'} />
                  </span>
                  <span className='truncate'>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className='px-2.5 py-2 text-sm text-muted-foreground'>All items are in your toolbar.</p>
      )}

      <div className='my-1 border-t border-border' />

      <button
        type='button'
        onClick={onCustomize}
        data-testid='more-customize-toolbar'
        data-track-category='App_Sidebar'
        data-track-name='Sidebar_Customize_Toolbar'
        className='block w-full rounded-md px-2.5 py-2 text-left text-sm font-medium text-[color:var(--mention-color)] transition-colors hover:bg-accent'
      >
        Customize toolbar
      </button>
    </div>
  );
};

const SidebarSupportMenu = ({
  onReportIssue,
  onViewMyTickets,
}: {
  onReportIssue: () => void;
  onViewMyTickets: () => void;
}): ReactElement => {
  return (
    <div className='flex flex-col'>
      <p className='px-2.5 pt-1 pb-1.5 text-sm font-semibold text-popover-foreground'>Support</p>
      <ul className='flex flex-col'>
        <li>
          <button
            type='button'
            onClick={onReportIssue}
            data-testid='support-report-issue'
            data-track-category='App_Sidebar'
            data-track-name='Sidebar_Support_ReportIssue'
            className='flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
          >
            <span className='flex size-5 shrink-0 items-center justify-center'>
              <AlertCircle size={16} />
            </span>
            <span className='flex-1 truncate text-left'>Report issue</span>
          </button>
        </li>
        <li>
          <button
            type='button'
            onClick={onViewMyTickets}
            data-testid='support-view-my-tickets'
            data-track-category='App_Sidebar'
            data-track-name='Sidebar_Support_ViewMyTickets'
            className='flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
          >
            <span className='flex size-5 shrink-0 items-center justify-center'>
              <TicketToken size={16} />
            </span>
            <span className='flex-1 truncate text-left'>View my tickets</span>
          </button>
        </li>
      </ul>
    </div>
  );
};

const MobileNavbar = ({
  filteredNavigationItems,
  activeRoute,
  isOnChat,
  onNavigationClick,
  missedCallCount,
  unreadActivityCount,
  recapUnreadCount,
}: {
  filteredNavigationItems: {
    path: string;
    label: string;
    icon: React.ElementType;
  }[];
  activeRoute: string;
  isOnChat: boolean;
  onNavigationClick: (label: string) => void;
  missedCallCount: number;
  unreadActivityCount: number;
  recapUnreadCount: number;
}): ReactElement => {
  const analyticsPermission = useCanViewAnalytics();
  const { isMobile } = usePlatform();
  const { isKeyboardOpen } = useKeyboard();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);
  const [isErrorReportOpen, setIsErrorReportOpen] = useState(false);

  // All hooks MUST be called before any early returns (React Rules of Hooks)
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleMenu = (): void => setIsMenuOpen(!isMenuOpen);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        isMenuOpen &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const mobileNavItems = filteredNavigationItems.filter(item => {
    // Filter analytics based on admin access
    if (item.path === '/analytics' && !analyticsPermission) return false;
    if (item.path === '/dashboards' && !analyticsPermission) return false;
    if (item.path === '/recorder' && !reactNativeBridge.isAvailable()) return false;

    return true;
  });

  const handleItemClick = (item: { path: string; label: string }): void => {
    if (item.path === '/recorder' && isMobile && reactNativeBridge.isAvailable()) {
      reactNativeBridge.startNoteTaker();
      onNavigationClick(item.label);
    }
    if (item.path === '/error-report') {
      setIsErrorReportOpen(true);
      onNavigationClick(item.label);
    }
  };

  // Early return AFTER all hooks have been called
  if (isOnChat) return <></>;

  const primaryItems = mobileNavItems.filter(item =>
    ['Home', 'DMs', 'Calls', 'Activity'].includes(item.label),
  );
  const menuItems = mobileNavItems.filter(
    item => !['Home', 'DMs', 'Calls', 'Activity'].includes(item.label),
  );
  const isMoreActive = isMenuOpen || menuItems.some(item => activeRoute === item.path);

  return (
    <>
      {!isKeyboardOpen && (
        <div className='fixed bottom-2 w-screen z-50 pointer-events-none px-4'>
          <div
            className='pointer-events-auto mx-auto w-full flex items-center justify-center gap-6 rounded-[102px] border border-border px-6 py-2 shadow-lg backdrop-blur-[10px]'
            style={{ background: 'var(--mobile-panel-bg)' }}
          >
            {primaryItems.map(item => {
              const isActive = activeRoute === item.path;
              const Icon = item.icon;
              const showMissedCallBadge = item.path === '/calls' && missedCallCount > 0;
              const showActivityBadge = item.path === '/chat/activity' && unreadActivityCount > 0;

              return (
                <Link
                  to={prefixWs(item.path)}
                  key={item.path}
                  onClick={() => onNavigationClick(item.label)}
                  data-track-category='Mobile_Sidebar'
                  data-track-name='Mobile_Nav_Item'
                  data-track-metadata={JSON.stringify({ path: item.path, label: item.label })}
                  className='flex flex-col gap-[3px] h-[44px] items-center justify-center p-[2px] cursor-pointer'
                >
                  <div className='size-[24px] flex items-center justify-center relative'>
                    <Icon
                      size={20}
                      variant={isActive ? 'Solid' : 'Stroke'}
                      className={isActive ? 'text-foreground' : 'text-muted-foreground'}
                    />
                    {showMissedCallBadge && (
                      <span className='absolute -top-1 -right-2 flex items-center justify-center min-w-[18px] h-[18px] px-[4px] rounded-full bg-sidebar-primary border border-sidebar-accent-ring text-sidebar-primary-foreground text-[11px] font-semibold'>
                        {missedCallCount > 99 ? '99+' : missedCallCount}
                      </span>
                    )}
                    {showActivityBadge && (
                      <span className='absolute -top-1 -right-2 flex items-center justify-center min-w-[18px] h-[18px] px-[4px] rounded-full bg-sidebar-primary border border-sidebar-accent-ring text-sidebar-primary-foreground text-[11px] font-semibold'>
                        {unreadActivityCount > 99 ? '99+' : unreadActivityCount}
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-medium text-[12px] leading-[1.2] text-center whitespace-nowrap font-['Geist',sans-serif] ${
                      isActive ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}

            <div
              ref={menuButtonRef}
              onClick={toggleMenu}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleMenu();
                }
              }}
              role='button'
              tabIndex={0}
              aria-label='More options'
              data-track-category='Mobile_Sidebar'
              data-track-name='Toggle_Mobile_Menu'
              data-track-metadata={JSON.stringify({ isOpen: !isMenuOpen })}
              className='flex flex-col gap-[3px] h-[44px] items-center justify-center p-[2px] cursor-pointer relative'
            >
              <div className='size-[24px] flex items-center justify-center'>
                <ThreeDotsMenuHorizontal
                  size={20}
                  className={isMoreActive ? 'text-foreground' : 'text-muted-foreground'}
                />
              </div>
              <span
                className={`font-medium text-[12px] leading-[1.2] text-center whitespace-nowrap font-Geist ${
                  isMoreActive ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                More
              </span>

              {isMenuOpen && (
                <div
                  ref={menuRef}
                  className='absolute bottom-14 left-1/2 z-50 min-w-[160px] -translate-x-1/2 rounded-xl border border-border bg-popover/95 py-2 text-popover-foreground shadow-2xl backdrop-blur-[10px]'
                >
                  {menuItems.map(item => {
                    const Icon = item.icon;
                    const isActive = activeRoute === item.path;
                    const isRecorder = item.path === '/recorder';
                    const isButtonItem = isRecorder || item.path === '/error-report';

                    // For Record, don't use Link - just handle click
                    if (isButtonItem) {
                      return (
                        <div
                          key={item.path}
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                            isActive ? 'bg-accent' : 'hover:bg-accent'
                          }`}
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleItemClick(item);
                            setIsMenuOpen(false);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              handleItemClick(item);
                              setIsMenuOpen(false);
                            }
                          }}
                          role='button'
                          tabIndex={0}
                          aria-label={item.label}
                          data-track-category='Mobile_Sidebar'
                          data-track-name='Mobile_Menu_Item'
                          data-track-metadata={JSON.stringify({
                            path: item.path,
                            label: item.label,
                          })}
                        >
                          <Icon
                            size={20}
                            variant={isActive ? 'Solid' : 'Stroke'}
                            className={isActive ? 'text-foreground' : 'text-muted-foreground'}
                          />
                          <span
                            className={`text-[14px] font-medium ${
                              isActive ? 'text-foreground' : 'text-muted-foreground'
                            }`}
                          >
                            {item.label}
                          </span>
                        </div>
                      );
                    }

                    const showRecapBadge = item.path === '/chat/recap' && recapUnreadCount > 0;

                    return (
                      <Link
                        to={prefixWs(item.path)}
                        key={item.path}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                          isActive ? 'bg-accent' : 'hover:bg-accent'
                        }`}
                        onClick={() => {
                          setIsMenuOpen(false);
                          onNavigationClick(item.label);
                        }}
                        data-track-category='Mobile_Sidebar'
                        data-track-name='Mobile_Menu_Link'
                        data-track-metadata={JSON.stringify({ path: item.path, label: item.label })}
                      >
                        <div className='relative'>
                          <Icon
                            size={20}
                            variant={isActive ? 'Solid' : 'Stroke'}
                            className={isActive ? 'text-foreground' : 'text-muted-foreground'}
                          />
                          {showRecapBadge && (
                            <span className='absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-[3px] rounded-full bg-sidebar-primary border border-sidebar-accent-ring text-sidebar-primary-foreground text-[9px] font-semibold'>
                              {recapUnreadCount > 9 ? '9+' : recapUnreadCount}
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-[14px] font-medium ${
                            isActive ? 'text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          {item.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <ErrorReportModal isOpen={isErrorReportOpen} onClose={() => setIsErrorReportOpen(false)} />
    </>
  );
};

export default AppSidebar;
