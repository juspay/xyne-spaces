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
  Bell,
  MessageCircle,
  LifeBuoy,
  Clipboard,
  PieChart,
  Mic,
  CalendarClock,
  Globe,
  ShieldUser,
  Brain,
  LayoutDashboard,
  ArrowRightLeft,
  AppWindow,
  SearchCode,
  CircleHelp,
  Building2,
  Zap,
  Atom,
  type LucideIcon,
} from 'lucide-react';

import { PATH_TO_RESOURCE } from './utils/resourceMapping';
import { isElectronApp } from '../../utils/electronApp';
import type { usePermissions } from '../../hooks/usePermissions';

export interface NavigationItem {
  path: string;
  label: string;
  icon: LucideIcon;
  iconSize?: number;
}

// Items are listed toolbar-first: the default toolbar paths come first in the
// order they should appear in the rail, followed by everything that lives in
// the "More" menu by default. Toggling is handled per-path by useToolbarItems.
export const NAVIGATION_ITEMS: NavigationItem[] = [
  { path: '/chat/dir', label: 'Chat', icon: Inbox },
  { path: '/chat/dm', label: 'DMs', icon: MessageCircle },
  { path: '/calls', label: 'Calls', icon: Phone },
  { path: '/recordings', label: 'Recordings', icon: Mic },
  { path: '/projects', label: 'Tickets', icon: FolderKanban },
  { path: '/support', label: 'Support', icon: LifeBuoy },
  { path: '/chat/activity', label: 'Activity', icon: Bell },
  { path: '/tickets', label: 'Workflows', icon: Ticket },
  { path: '/product-insights', label: 'Insights', icon: PieChart },
  { path: '/knowledge-base', label: 'Knowledge Base', icon: BookOpen },
  { path: '/memory', label: 'Context', icon: Brain },
  { path: '/analytics', label: 'Analytics', icon: ChartSpline },
  { path: '/dashboards', label: 'Dashboards', icon: LayoutDashboard },
  { path: '/user-groups', label: 'User Groups', icon: UsersIcon },
  { path: '/listProjects', label: 'List Projects', icon: Folder },
  { path: '/resource-access', label: 'User Management', icon: ShieldUser, iconSize: 18 },
  { path: '/jira-migration', label: 'Jira Migration', icon: ArrowRightLeft, iconSize: 18 },
  { path: '/migration/confluence', label: 'Confluence Migration', icon: BookOpen, iconSize: 18 },
  { path: '/browser', label: 'Browser', icon: Globe },
  { path: '/forms', label: 'Forms', icon: Clipboard },
  { path: '/scheduled-messages', label: 'Scheduled Messages', icon: CalendarClock },
  { path: '/automations', label: 'Automations', icon: Zap },
  { path: '/apps', label: 'Apps', icon: AppWindow },
  { path: '/inspector', label: 'Inspector', icon: SearchCode },
  { path: '/guide', label: 'User Guide', icon: CircleHelp },
  { path: '/workspace-management', label: 'Workspace Management', icon: Settings },
  { path: '/organisations', label: 'Organisations', icon: Building2 },
  { path: '/team-intelligence', label: 'Team Intelligence', icon: Atom },
];

// Core items that are always in the toolbar. Users cannot remove these — their
// toggle is locked on in the customize UI.
export const REQUIRED_TOOLBAR_PATHS: string[] = [
  '/chat/dir',
  '/chat/dm',
  '/calls',
  '/recordings',
  '/projects',
  '/support',
  '/chat/activity',
];

// Paths shown in the toolbar by default (before any user customization).
export const DEFAULT_TOOLBAR_PATHS: string[] = [...REQUIRED_TOOLBAR_PATHS];

// Whether a path is locked into the toolbar (cannot be toggled off).
export const isRequiredToolbarPath = (path: string): boolean =>
  REQUIRED_TOOLBAR_PATHS.includes(path);

type Permissions = ReturnType<typeof usePermissions>;

// Filters out items the current user cannot access (permission-gated routes and
// Electron-only routes). Mirrors the access rules used across the sidebar.
export const filterNavItemsByPermission = (
  items: NavigationItem[],
  permissions: Permissions,
): NavigationItem[] => {
  return items.filter(item => {
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

    if (item.path === '/browser' && !isElectronApp()) return false;
    return hasAccess;
  });
};
