import {
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Tooltip } from '../ui/Tooltip/Tooltip';
import { useAuth } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { mixpanelService, EVENTS } from '../../services/Analytics/mixpanelService';
import { useCanViewAnalytics } from '../../hooks/usePermissions';
import { isElectronApp } from '../../utils/electronApp';
import {
  ChartSpline,
  Settings,
  BookOpen,
  Ticket,
  FolderKanban,
  UsersIcon,
  Folder,
  Inbox,
  Phone,
  Home,
  Bell,
  MessageCircle,
  LifeBuoy,
  Clipboard,
  ClipboardCheck,
  PieChart,
  FileText,
  Mic,
  CalendarClock,
  EllipsisVertical,
  Bookmark,
  Globe,
  ShieldUser,
  Brain,
  Sparkles,
  ArrowRightLeft,
  AppWindow,
  SearchCode,
  CircleHelp,
  Building2,
  AlertCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import Avatar from '../ui/Avatar/Avatar';
import { Popover } from '../ui/Popover/Popover';
import SettingsContent from '../Settings/Settings';
import Preferences, { type PreferenceSection } from '../Settings/Preferences';
import { useSelf } from '../../hooks/useUsers';
import { isStatusExpired } from '../../utils/statusUtils';
import { UpdateStatusModal } from './UpdateStatusModal';
import { StatusIndicator } from '../ui/StatusIndicator';
import { useMissedCallCount } from '../../hooks/useMissedCallCount';
import { useRecapUnreadCount } from '../../hooks/useRecapData';
import { usePlatform } from '../../hooks/usePlatform';
import { useAllVisibleChannels } from '../../hooks/useChannels';
import { useAllUnreadCount } from '../../hooks/useUnreadCount';
import { reactNativeBridge } from '../../utils/reactNativeBridge';
import { PATH_TO_RESOURCE } from './utils/resourceMapping';
import { useKeyboard } from '../../contexts/KeyboardContext';
import { useAILandingDefault } from '../../hooks/useAILandingDefault';
import XyneAISidebarIcon from '../icons/xyne-ai/XyneAISidebarIcon';
import { cn } from '../../utils/classNames';
import { ErrorReportModal } from '../ErrorReportModal/ErrorReportModal';
import { isDMChannel } from '../Chat/ChatDirectory/ChatDirectory.utils';

const navigationItems: { path: string; label: string; icon: LucideIcon; iconSize?: number }[] = [
  { path: '/chat/dir', label: 'Chat', icon: Inbox },
  { path: '/chat/dm', label: 'DMs', icon: MessageCircle },
  { path: '/calls', label: 'Calls', icon: Phone },
  { path: '/recordings', label: 'Recordings', icon: Mic },
  { path: '/tickets', label: 'Tickets', icon: Ticket },
  { path: '/product-insights', label: 'Insights', icon: PieChart },
  { path: '/knowledge-base', label: 'Knowledge Base', icon: BookOpen },
  { path: '/memory', label: 'Context', icon: Brain },
  { path: '/analytics', label: 'Analytics', icon: ChartSpline },
  { path: '/projects', label: 'Projects Board', icon: FolderKanban },
  { path: '/user-groups', label: 'User Groups', icon: UsersIcon },
  { path: '/listProjects', label: 'List Projects', icon: Folder },
  { path: '/resource-access', label: 'User Management', icon: ShieldUser, iconSize: 18 },
  { path: '/jira-migration', label: 'Jira Migration', icon: ArrowRightLeft, iconSize: 18 },
  { path: '/migration/confluence', label: 'Confluence Migration', icon: BookOpen, iconSize: 18 },
  { path: '/support', label: 'Support', icon: LifeBuoy },
  { path: '/browser', label: 'Browser', icon: Globe },
  { path: '/forms', label: 'Forms', icon: Clipboard },
  { path: '/scheduled-messages', label: 'Scheduled Messages', icon: CalendarClock },
  { path: '/automations', label: 'Automations', icon: Zap },
  { path: '/apps', label: 'Apps', icon: AppWindow },
  { path: '/inspector', label: 'Inspector', icon: SearchCode },
  { path: '/guide', label: 'User Guide', icon: CircleHelp },
  { path: '/workspace-management', label: 'Workspace Management', icon: Settings },
  { path: '/organisations', label: 'Organisations', icon: Building2 },
];

const mobileNavigationItems = [
  {
    path: '/chat/dir',
    label: 'Home',
    icon: Home,
  },
  {
    path: '/chat/dm',
    label: 'DMs',
    icon: MessageCircle,
  },
  {
    path: '/calls',
    label: 'Calls',
    icon: Phone,
  },
  {
    path: '/chat/activity',
    label: 'Activity',
    icon: Bell,
  },
  {
    path: '/analytics',
    label: 'Analytics',
    icon: ChartSpline,
  },
  {
    path: '/chat/canvas',
    label: 'Canvas',
    icon: FileText,
  },
  {
    path: '/recorder',
    label: 'Record',
    icon: Mic,
  },
  {
    path: '/chat/bookmarks',
    label: 'Bookmarks',
    icon: Bookmark,
  },
  {
    path: '/rca',
    label: 'RCA',
    icon: ClipboardCheck,
  },
  {
    path: '/chat/threads',
    label: 'Threads',
    icon: MessageCircle,
  },
  {
    path: '/chat/recap',
    label: 'Recap',
    icon: Sparkles,
  },
  {
    path: '/error-report',
    label: 'Report Issue',
    icon: AlertCircle,
  },
  {
    path: '/guide',
    label: 'Guide',
    icon: CircleHelp,
  },
];

const AppSidebar = (): ReactElement => {
  const location = useLocation();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { user } = useAuth();
  const { aiLandingDefault } = useAILandingDefault();
  const currentUser = useSelf();
  const permissions = usePermissions();
  const missedCallCount = useMissedCallCount();
  const { unreadCount: recapUnreadCount } = useRecapUnreadCount();
  const { isMobile } = usePlatform();
  const visibleChannels = useAllVisibleChannels();
  const unreadCounts = useAllUnreadCount();

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  // Determine active route with early returns for special chat paths
  const getActiveRoute = (pathname: string): string => {
    if (pathname.startsWith('/chat/dir')) return '/chat/dir';
    if (pathname.startsWith('/chat/dm')) return '/chat/dm';
    if (pathname.startsWith('/chat/activity')) return '/chat/activity';
    if (pathname.startsWith('/chat/drafts')) return '/chat/drafts';
    if (pathname.startsWith('/chat/sent')) return '/chat/sent';
    if (pathname.startsWith('/chat/scheduled')) return '/chat/scheduled';
    if (pathname.startsWith('/migration/confluence')) return '/migration/confluence';
    return '/' + (pathname.split('/')[1] || '');
  };

  const activeRoute = getActiveRoute(
    workspaceId && location.pathname.startsWith(`/${workspaceId}`)
      ? location.pathname.slice(`/${workspaceId}`.length) || '/'
      : location.pathname,
  );

  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isSettingsPopoverOpen, setIsSettingsPopoverOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
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

  const navListRef = useRef<HTMLUListElement | null>(null);
  const navItemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const [activeMarkerY, setActiveMarkerY] = useState<number | null>(null);

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

  const filteredNavigationItems = useMemo(() => {
    return navigationItems.filter(item => {
      const resourceName = PATH_TO_RESOURCE[item.path];
      const requiresAccess = resourceName !== undefined;

      let hasAccess = true;
      if (requiresAccess) {
        if (resourceName === 'USER-GROUPS') {
          hasAccess = permissions.some(
            p =>
              p.resourceName === resourceName &&
              (p.accessType === 'ADMIN' || p.accessType === 'WRITE'),
          );
        } else if (resourceName === 'AUTOMATIONS') {
          // Tiered: READ surfaces the list (read-only), WRITE adds proposals/
          // activation, ADMIN adds approve/reject/disable. Any tier shows the
          // sidebar entry — per-action gates live in the screens.
          hasAccess = permissions.some(
            p =>
              p.resourceName === resourceName &&
              (p.accessType === 'ADMIN' || p.accessType === 'WRITE' || p.accessType === 'READ'),
          );
        } else {
          hasAccess = permissions.some(
            p => p.resourceName === resourceName && p.accessType === 'ADMIN',
          );
        }
      }

      if (item.path === '/browser' && !isElectronApp()) return false;
      return hasAccess;
    });
  }, [permissions]);

  const hasPendingDirectMessages = useMemo(() => {
    return visibleChannels.some(
      channel => isDMChannel(channel.scopeType) && (unreadCounts[channel.id] ?? 0) > 0,
    );
  }, [visibleChannels, unreadCounts]);

  const handleNavigationClick = (label: string): void => {
    mixpanelService.track(EVENTS.NAVIGATION, { item: label });
  };

  const updateActiveMarker = useCallback((): void => {
    if (window.innerWidth < 500) return;
    const listEl = navListRef.current;
    if (!listEl) return;

    const activeItemEl = navItemRefs.current[activeRoute];
    if (!activeItemEl) return;

    const containerRect = listEl.getBoundingClientRect();
    const itemRect = activeItemEl.getBoundingClientRect();

    setActiveMarkerY(itemRect.top - containerRect.top);
  }, [activeRoute]);

  useEffect(() => {
    const handleResize = (): void => {
      setWindowWidth(window.innerWidth);
      updateActiveMarker();
    };
    window.addEventListener('resize', handleResize);
    return (): void => {
      window.removeEventListener('resize', handleResize);
    };
  }, [updateActiveMarker]);

  useLayoutEffect(() => {
    updateActiveMarker();
  }, [updateActiveMarker, filteredNavigationItems, windowWidth]);

  if (isMobile || windowWidth < 500) {
    return (
      <MobileNavbar
        filteredNavigationItems={mobileNavigationItems}
        activeRoute={activeRoute}
        isOnChat={hasChannelOrThreadId}
        onNavigationClick={handleNavigationClick}
        missedCallCount={missedCallCount}
        recapUnreadCount={recapUnreadCount}
      />
    );
  }

  return (
    <aside className='h-full px-3 pt-5 pb-6 flex flex-col items-center justify-between'>
      <div className='space-y-8 overflow-y-auto scrollbar-none min-h-0 pr-2 -mr-2'>
        <nav>
          <ul ref={navListRef} className='relative flex flex-col gap-4'>
            {activeMarkerY !== null && (
              <div
                aria-hidden='true'
                className='absolute left-0 z-0 h-8 w-8 rounded-lg bg-appSidebar-active transition-transform duration-200 ease-out pointer-events-none'
                style={{ transform: `translate3d(0px, ${activeMarkerY}px, 0)` }}
              />
            )}
            {/* Xyne AI nav item — only visible when "Open AI on launch" is enabled */}
            {aiLandingDefault && (
              <li
                key='/ai'
                ref={el => {
                  navItemRefs.current['/ai'] = el;
                }}
                className='relative z-10'
              >
                <Tooltip content='Xyne AI' side='right' delayDuration={0}>
                  <Link
                    to='/ai'
                    onClick={() => handleNavigationClick('Xyne AI')}
                    data-testid='nav-xyne-ai'
                    data-track-category='App_Sidebar'
                    data-track-name='Sidebar_Nav_Item'
                    data-track-metadata={JSON.stringify({ path: '/ai', label: 'Xyne AI' })}
                    className={cn(
                      'size-8 flex items-center justify-center rounded-lg cursor-pointer transition-colors',
                      activeRoute === '/ai'
                        ? 'text-appSidebar-activeIcon'
                        : 'bg-transparent text-appSidebar-activeForeground',
                    )}
                  >
                    <XyneAISidebarIcon size={16} />
                  </Link>
                </Tooltip>
              </li>
            )}

            {filteredNavigationItems.map(item => {
              const isActive = activeRoute === item.path;
              const showMissedCallBadge = item.path === '/calls' && missedCallCount > 0;
              const showPendingDmDot = item.path === '/chat/dm' && hasPendingDirectMessages;
              const Icon = item.icon;

              const testId = `nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`;

              return (
                <li
                  key={item.path}
                  ref={el => {
                    navItemRefs.current[item.path] = el;
                  }}
                  className='relative z-10'
                >
                  <Tooltip content={item.label} side='right' delayDuration={0}>
                    <Link
                      to={item.path}
                      onClick={() => handleNavigationClick(item.label)}
                      aria-label={showPendingDmDot ? 'DMs unread' : item.label}
                      data-testid={testId}
                      data-track-category='App_Sidebar'
                      data-track-name='Sidebar_Nav_Item'
                      data-track-metadata={JSON.stringify({ path: item.path, label: item.label })}
                      className={cn(
                        'relative size-8 flex items-center justify-center rounded-lg cursor-pointer transition-colors',
                        isActive
                          ? 'text-appSidebar-activeIcon'
                          : 'bg-transparent text-appSidebar-activeForeground',
                      )}
                    >
                      <Icon size={item.iconSize ?? 16} />
                      {showPendingDmDot && (
                        <span
                          aria-hidden='true'
                          className='absolute top-1 right-1 size-[9px] rounded-full bg-[var(--sidebar-dm-dot-bg)]'
                          style={{ boxShadow: 'var(--sidebar-dm-dot-shadow)' }}
                        />
                      )}
                      {showMissedCallBadge && (
                        <span className='absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-[4px] rounded-full bg-destructive text-destructive-foreground text-[11px] font-semibold'>
                          {missedCallCount > 99 ? '99+' : missedCallCount}
                        </span>
                      )}
                    </Link>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <div className='flex flex-col items-center justify-center pb-4'>
        <Popover
          trigger={
            hasValidStatus ? (
              <div
                className='relative w-[32px] h-14 rounded-lg flex flex-col items-center justify-end transition-opacity hover:opacity-90'
                style={{ backgroundColor: 'var(--sidebar-divider)' }}
                data-testid='profile-icon'
              >
                {/* Status Emoji at Top Center */}
                <div
                  onClick={handleStatusClick}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleStatusClick();
                    }
                  }}
                  role='button'
                  tabIndex={0}
                  data-track-category='App_Sidebar'
                  data-track-name='Open_Status_Popover'
                  className='absolute top-1 left-1/2 -translate-x-1/2 cursor-pointer hover:scale-110 transition-transform'
                  aria-label='Update status'
                >
                  <StatusIndicator
                    statusEmoji={currentUser?.statusEmoji}
                    statusContent={currentUser?.statusContent}
                    statusExpiryAt={currentUser?.statusExpiryAt}
                    size='lg'
                    showOnHover={true}
                  />
                </div>

                {/* Avatar at Bottom - overlaps container slightly */}
                <div className='relative -mb-1.5'>
                  {user ? (
                    <Avatar userId={user.id} size='md' className='rounded-lg' />
                  ) : (
                    <div className='size-9 rounded-xl flex items-center justify-center bg-border'>
                      <Settings size={14} className='text-appSidebar-activeForeground' />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                className='relative w-[32px] flex flex-col items-center justify-end transition-opacity hover:opacity-90 cursor-pointer'
                data-testid='profile-icon'
              >
                {/* Avatar at Bottom - overlaps container slightly to match with-status state */}
                <div className='relative -mb-1.5'>
                  {user ? (
                    <Avatar userId={user.id} size='md' className='rounded-md' />
                  ) : (
                    <div className='size-9 rounded-xl flex items-center justify-center bg-border'>
                      <Settings size={14} className='text-appSidebar-activeForeground' />
                    </div>
                  )}
                </div>
              </div>
            )
          }
          open={isSettingsPopoverOpen}
          onOpenChange={setIsSettingsPopoverOpen}
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
          />
        </Popover>

        <Preferences
          open={isPreferencesOpen}
          onClose={() => setIsPreferencesOpen(false)}
          {...(preferencesInitialSection && { initialSection: preferencesInitialSection })}
        />
      </div>

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
    </aside>
  );
};

const MobileNavbar = ({
  filteredNavigationItems,
  activeRoute,
  isOnChat,
  onNavigationClick,
  missedCallCount,
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
  recapUnreadCount: number;
}): ReactElement => {
  const analyticsPermission = useCanViewAnalytics();
  const { isMobile } = usePlatform();
  const { isKeyboardOpen } = useKeyboard();
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

              return (
                <Link
                  to={item.path}
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
                      className={isActive ? 'text-foreground' : 'text-muted-foreground'}
                    />
                    {showMissedCallBadge && (
                      <span className='absolute -top-1 -right-2 flex items-center justify-center min-w-[18px] h-[18px] px-[4px] rounded-full bg-destructive text-destructive-foreground text-[11px] font-semibold'>
                        {missedCallCount > 99 ? '99+' : missedCallCount}
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
                <EllipsisVertical
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
                        to={item.path}
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
                            className={isActive ? 'text-foreground' : 'text-muted-foreground'}
                          />
                          {showRecapBadge && (
                            <span className='absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-[3px] rounded-full bg-sidebar-badge-accent text-sidebar-badge-accent-foreground text-[9px] font-semibold'>
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
