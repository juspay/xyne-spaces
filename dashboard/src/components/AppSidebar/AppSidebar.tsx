import {
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
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
  MoreHorizontal,
  Bookmark,
  Globe,
  ShieldUser,
  Brain,
} from 'lucide-react';

import Avatar from '../ui/Avatar/Avatar';
import { Popover } from '../ui/Popover/Popover';
import SettingsContent from '../Settings/Settings';
import { useSelf } from '../../hooks/useUsers';
import { isStatusExpired } from '../../utils/statusUtils';
import { UpdateStatusModal } from './UpdateStatusModal';
import { StatusIndicator } from '../ui/StatusIndicator';
import { useMissedCallCount } from '../../hooks/useMissedCallCount';
import { usePlatform } from '../../hooks/usePlatform';
import { reactNativeBridge } from '../../utils/reactNativeBridge';
import { PATH_TO_RESOURCE } from './utils/resourceMapping';
import { useKeyboard } from '../../contexts/KeyboardContext';

const navigationItems = [
  {
    path: '/chat/dir',
    label: 'Chat',
    icon: <Inbox size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/calls',
    label: 'Calls',
    icon: <Phone size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/recordings',
    label: 'Recordings',
    icon: <Mic size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/tickets',
    label: 'Tickets',
    icon: <Ticket size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/product-insights',
    label: 'Insights',
    icon: <PieChart size={16} color='var(--app-sidebar-active-foreground)' />,
  },

  {
    path: '/knowledge-base',
    label: 'Knowledge Base',
    icon: <BookOpen size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/memory',
    label: 'Context',
    icon: <Brain size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/analytics',
    label: 'Analytics',
    icon: <ChartSpline size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/projects',
    label: 'Projects Board',
    icon: <FolderKanban size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/user-groups',
    label: 'User Groups',
    icon: <UsersIcon size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/listProjects',
    label: 'List Projects',
    icon: <Folder size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/resource-access',
    label: 'User Management',
    icon: <ShieldUser size={18} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/support',
    label: 'Support',
    icon: <LifeBuoy size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  // {
  //   path: '/vscode',
  //   label: 'VS Code',
  //   icon: <Code2 size={16} color='var(--app-sidebar-active-foreground)' />,
  // },
  {
    path: '/browser',
    label: 'Browser',
    icon: <Globe size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  {
    path: '/forms',
    label: 'Forms',
    icon: <Clipboard size={16} color='var(--app-sidebar-active-foreground)' />,
  },
  // {
  //   path: '/rca',
  //   label: 'RCA',
  //   icon: <ClipboardCheck size={16} color='var(--app-sidebar-active-foreground)' />,
  // },
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
];

const AppSidebar = (): ReactElement => {
  const location = useLocation();
  const { user } = useAuth();
  const currentUser = useSelf();
  const permissions = usePermissions();
  const missedCallCount = useMissedCallCount();
  const { isMobile } = usePlatform();

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  // Determine active route with early returns for special chat paths
  const getActiveRoute = (pathname: string): string => {
    if (pathname.startsWith('/chat/dir')) return '/chat/dir';
    if (pathname.startsWith('/chat/dm')) return '/chat/dm';
    if (pathname.startsWith('/chat/activity')) return '/chat/activity';
    return '/' + (pathname.split('/')[1] || '');
  };

  const activeRoute = getActiveRoute(location.pathname);

  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);

  // Check if user has a valid (non-expired) status
  const hasValidStatus =
    currentUser?.presenceStatus?.statusEmoji &&
    (!currentUser?.presenceStatus?.statusExpiryAt ||
      !isStatusExpired(currentUser.presenceStatus.statusExpiryAt));

  const handleStatusClick = (): void => {
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
        } else {
          hasAccess = permissions.some(
            p => p.resourceName === resourceName && p.accessType === 'ADMIN',
          );
        }
      }

      // if (item.path === '/vscode' && !isElectronApp()) return false;
      if (item.path === '/browser' && !isElectronApp()) return false;
      return hasAccess;
    });
  }, [permissions]);

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
      />
    );
  }

  return (
    <aside className='h-full px-3 pt-5 pb-6 flex flex-col items-center justify-between'>
      <div className='space-y-8'>
        <nav>
          <ul ref={navListRef} className='relative space-y-4'>
            {activeMarkerY !== null && (
              <div
                aria-hidden='true'
                className='absolute left-0 z-0 h-8 w-8 rounded-lg bg-appSidebar-active transition-transform duration-200 ease-out pointer-events-none'
                style={{ transform: `translate3d(0px, ${activeMarkerY}px, 0)` }}
              />
            )}
            {filteredNavigationItems.map(item => {
              const isActive = activeRoute === item.path;
              const showMissedCallBadge = item.path === '/calls' && missedCallCount > 0;

              const testId = `nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`;

              return (
                <li
                  key={item.path}
                  ref={el => {
                    navItemRefs.current[item.path] = el;
                  }}
                  className='relative z-10'
                >
                  <Tooltip content={item.label} side='right' delayDuration={500}>
                    <Link
                      to={item.path}
                      onClick={() => handleNavigationClick(item.label)}
                      data-testid={testId}
                      data-track-category='App_Sidebar'
                      data-track-name='Sidebar_Nav_Item'
                      data-track-metadata={JSON.stringify({ path: item.path, label: item.label })}
                      className={`size-8 flex items-center justify-center rounded-lg cursor-pointer transition-colors ${
                        isActive ? 'text-white' : 'bg-transparent text-foreground'
                      }`}
                    >
                      {item.icon}
                      {showMissedCallBadge && (
                        <span className='absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-[4px] bg-red-500 text-white text-[11px] font-semibold rounded-full'>
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
                style={{ backgroundColor: 'var(--sidebar-divider, #CFD4E2)' }}
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
                    statusEmoji={currentUser?.presenceStatus?.statusEmoji}
                    statusContent={currentUser?.presenceStatus?.statusContent}
                    statusExpiryAt={currentUser?.presenceStatus?.statusExpiryAt}
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
                      <Settings size={14} color='var(--app-sidebar-active-foreground)' />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                className='relative w-[32px] h-14 flex flex-col items-center justify-end transition-opacity hover:opacity-90'
                data-testid='profile-icon'
              >
                {/* Avatar at Bottom - overlaps container slightly to match with-status state */}
                <div className='relative -mb-1.5'>
                  {user ? (
                    <Avatar userId={user.id} size='md' className='rounded-md' />
                  ) : (
                    <div className='size-9 rounded-xl flex items-center justify-center bg-border'>
                      <Settings size={14} color='var(--app-sidebar-active-foreground)' />
                    </div>
                  )}
                </div>
              </div>
            )
          }
          side='right'
          sideOffset={8}
          align='end'
        >
          <SettingsContent />
        </Popover>
      </div>

      {/* Status Update Modal */}
      <UpdateStatusModal
        isOpen={isStatusModalOpen}
        onClose={handleStatusModalClose}
        currentStatus={
          hasValidStatus
            ? {
                emoji: currentUser?.presenceStatus?.statusEmoji || '',
                content: currentUser?.presenceStatus?.statusContent || '',
                expiryAt: currentUser?.presenceStatus?.statusExpiryAt || null,
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
}): ReactElement => {
  const analyticsPermission = useCanViewAnalytics();
  const { isMobile } = usePlatform();
  const { isKeyboardOpen } = useKeyboard();

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
  };

  // Early return AFTER all hooks have been called
  if (isOnChat) return <></>;

  const primaryItems = mobileNavItems.filter(item =>
    ['Home', 'DMs', 'Calls', 'Activity'].includes(item.label),
  );
  const menuItems = mobileNavItems.filter(
    item => !['Home', 'DMs', 'Calls', 'Activity'].includes(item.label),
  );

  return (
    <>
      {!isKeyboardOpen && (
        <div className='fixed bottom-2 w-screen z-50 pointer-events-none px-4'>
          <div className='pointer-events-auto mx-auto w-full flex items-center justify-center gap-6 bg-[#181B1D]/60 backdrop-blur-[10px] border-[0.5px] border-[#181B1D]/30 rounded-[102px] px-6 py-2'>
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
                    <Icon size={20} className={isActive ? 'text-white' : 'text-[#c9cccf]'} />
                    {showMissedCallBadge && (
                      <span className='absolute -top-1 -right-2 flex items-center justify-center min-w-[18px] h-[18px] px-[4px] bg-red-500 text-white text-[11px] font-semibold rounded-full'>
                        {missedCallCount > 99 ? '99+' : missedCallCount}
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-medium text-[12px] leading-[1.2] text-center whitespace-nowrap font-['Geist',sans-serif] ${
                      isActive ? 'text-white' : 'text-muted'
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
                <MoreHorizontal size={20} className='text-[#c9cccf]' />
              </div>
              <span className='font-medium text-[12px] leading-[1.2] text-center whitespace-nowrap font-Geist text-muted'>
                More
              </span>

              {isMenuOpen && (
                <div
                  ref={menuRef}
                  className='absolute bottom-14 left-1/2 -translate-x-1/2 bg-[#181B1D]/60 backdrop-blur-[10px] border-[0.5px] border-[#181B1D]/30 rounded-xl py-2 min-w-[160px] shadow-2xl z-50'
                >
                  {menuItems.map(item => {
                    const Icon = item.icon;
                    const isActive = activeRoute === item.path;
                    const isRecorder = item.path === '/recorder';

                    // For Record, don't use Link - just handle click
                    if (isRecorder) {
                      return (
                        <div
                          key={item.path}
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#2a2d30] transition-colors ${
                            isActive ? 'bg-[#2a2d30]' : ''
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
                          <Icon size={20} className={isActive ? 'text-white' : 'text-[#9ca3af]'} />
                          <span
                            className={`text-[14px] font-medium ${isActive ? 'text-white' : 'text-[#d1d5db]'}`}
                          >
                            {item.label}
                          </span>
                        </div>
                      );
                    }

                    return (
                      <Link
                        to={item.path}
                        key={item.path}
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-[#2a2d30] transition-colors ${
                          isActive ? 'bg-[#2a2d30]' : ''
                        }`}
                        onClick={() => {
                          setIsMenuOpen(false);
                          onNavigationClick(item.label);
                        }}
                        data-track-category='Mobile_Sidebar'
                        data-track-name='Mobile_Menu_Link'
                        data-track-metadata={JSON.stringify({ path: item.path, label: item.label })}
                      >
                        <Icon size={20} className={isActive ? 'text-white' : 'text-[#9ca3af]'} />
                        <span
                          className={`text-[14px] font-medium ${isActive ? 'text-white' : 'text-[#d1d5db]'}`}
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
    </>
  );
};

export default AppSidebar;
