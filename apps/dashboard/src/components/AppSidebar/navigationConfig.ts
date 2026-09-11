import { createElement, type ComponentType, type ReactElement } from 'react';
import {
  GraphTrendLine,
  Settings01,
  Notebook,
  TicketToken,
  UserThree,
  FolderDefault,
  Hashtag,
  PhoneDefault,
  NotificationBellOn,
  ChatDefault,
  Troubleshoot,
  ClipboardDefault,
  Piechart01,
  FileText,
  CalendarTimer,
  Globe,
  UserShield,
  ShieldCheck,
  Database,
  GridDashboard01,
  SwapArrowHorizontal,
  Grid02,
  QuestionMarkCircle,
  BuildingApartmentTwo,
  LightningThunderElectricOn,
  Atom,
  ChatChatting,
  Bot,
  RocketShip,
  GitBranch,
  type PikaIconProps,
  Tag,
} from '@xyne/icons';
import { AudioLines } from 'lucide-react';

import { PATH_TO_RESOURCE } from './utils/resourceMapping';
import { isElectronApp } from '../../utils/electronApp';
import type { usePermissions } from '../../hooks/usePermissions';
import { AccessType } from '@xyne/shared';
import { XyneAISidebarIcon } from '../icons/xyne-ai';

/** A themeable pika-icon component (accepts size, color, variant, strokeWidth, className). */
export type PikaIcon = ComponentType<PikaIconProps>;

// Matches the waveform the Xyne Scribe list uses. lucide has no Solid/Stroke
// pair, so `variant` is dropped here rather than passed through to the <svg>.
const AudioWaveIcon = ({ variant: _variant, ...props }: PikaIconProps): ReactElement =>
  createElement(AudioLines, props);

export const RAIL_SHORTCUT_LIMIT = 9;
export const railShortcutsAvailable = (): boolean => isElectronApp();

// Read the number off event.code, not event.key: mod+1..9 match on physical key
// position, and on layouts like AZERTY that key types '&' rather than '1'.
export const railItemIndexFromEvent = (event: KeyboardEvent): number => {
  const positional = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1];
  return Number(positional ?? event.key) - 1;
};

export interface NavigationItem {
  path: string;
  label: string;
  // Stable id for data-testid / i18n key lookup — independent of `label` so
  // translating the display text can't change test selectors or drop the
  // key `label` is still used as by other consumers (search, analytics).
  testKey: string;
  icon: PikaIcon;
  iconSize?: number;
  popout?: boolean;
}

// Adapts XyneAISidebarIcon — a plain {color?, size?: number} SVG component,
// not a pika-icon — to the PikaIcon shape NavigationItem.icon requires.
// PikaIconProps.size is `number | string`, so it's coerced rather than
// widening XyneAISidebarIcon's own signature. Pika-only props (variant/
// strokeWidth/...) are dropped: this glyph has no stroke/variant concept and
// renders identically regardless of active state, unlike every other item.
const XyneAINavIcon: PikaIcon = ({ size, color }) =>
  createElement(XyneAISidebarIcon, {
    // exactOptionalPropertyTypes rejects an explicit `undefined` for an
    // optional prop — omit the key entirely instead of assigning it.
    ...(typeof size === 'number' ? { size } : {}),
    ...(color !== undefined ? { color } : {}),
  });

// Items are listed toolbar-first: the default toolbar paths come first in the
// order they should appear in the rail, followed by everything that lives in
// the "More" menu by default. Toggling is handled per-path by useToolbarItems.
export const NAVIGATION_ITEMS: NavigationItem[] = [
  { path: '/ai', label: 'Xyne AI', testKey: 'xyne-ai', icon: XyneAINavIcon, popout: true },
  { path: '/chat/dir', label: 'Chat', testKey: 'chat', icon: Hashtag, popout: true },
  { path: '/chat/dm', label: 'DMs', testKey: 'dms', icon: ChatDefault, popout: true },
  {
    path: '/chat/activity',
    label: 'Activity',
    testKey: 'activity',
    icon: NotificationBellOn,
    popout: true,
  },
  { path: '/calls', label: 'Calls', testKey: 'calls', icon: PhoneDefault, popout: true },
  {
    path: '/recordings',
    label: 'Recordings',
    testKey: 'recordings',
    icon: AudioWaveIcon,
    popout: true,
  },
  { path: '/projects', label: 'Tickets', testKey: 'tickets', icon: TicketToken, popout: true },
  { path: '/sdlc', label: 'SDLC', testKey: 'sdlc', icon: Atom, popout: true },
  { path: '/support', label: 'Support', testKey: 'support', icon: Troubleshoot, popout: true },
  { path: '/chat/canvas', label: 'My Canvas', testKey: 'my-canvas', icon: FileText, popout: true },
  {
    path: '/automations',
    label: 'Automations',
    testKey: 'automations',
    icon: LightningThunderElectricOn,
    popout: true,
  },
  { path: '/workflows', label: 'Workflows', testKey: 'workflows', icon: GitBranch, popout: true },
  {
    path: '/scheduled-messages',
    label: 'Scheduled Messages',
    testKey: 'scheduled-messages',
    icon: CalendarTimer,
    popout: true,
  },
  {
    path: '/user-groups',
    label: 'User Groups',
    testKey: 'user-groups',
    icon: UserThree,
    popout: true,
  },
  {
    path: '/resource-access',
    label: 'User Management',
    testKey: 'user-management',
    icon: UserShield,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/roles',
    label: 'Roles',
    testKey: 'roles',
    icon: ShieldCheck,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/workspace-management',
    label: 'Workspace Management',
    testKey: 'workspace-management',
    icon: Settings01,
    popout: true,
  },
  {
    path: '/tag-review',
    label: 'Tag Review',
    testKey: 'tag-review',
    icon: Tag,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/organisations',
    label: 'Organisations',
    testKey: 'organisations',
    icon: BuildingApartmentTwo,
    popout: true,
  },
  {
    path: '/analytics',
    label: 'Analytics',
    testKey: 'analytics',
    icon: GraphTrendLine,
    popout: true,
  },
  { path: '/forms', label: 'Forms', testKey: 'forms', icon: ClipboardDefault, popout: true },
  { path: '/browser', label: 'Browser', testKey: 'browser', icon: Globe, popout: true },
  { path: '/apps', label: 'Apps', testKey: 'apps', icon: Grid02, popout: true },
  {
    path: '/guide',
    label: 'User Guide',
    testKey: 'user-guide',
    icon: QuestionMarkCircle,
    popout: true,
  },
  {
    path: '/product-insights',
    label: 'Insights',
    testKey: 'insights',
    icon: Piechart01,
    popout: true,
  },
  {
    path: '/knowledge-base',
    label: 'Knowledge Base',
    testKey: 'knowledge-base',
    icon: Notebook,
    popout: true,
  },
  { path: '/memory', label: 'Context', testKey: 'context', icon: Database, popout: true },
  {
    path: '/dashboards',
    label: 'Dashboards',
    testKey: 'dashboards',
    icon: GridDashboard01,
    popout: true,
  },
  {
    path: '/listProjects',
    label: 'List Projects',
    testKey: 'list-projects',
    icon: FolderDefault,
    popout: true,
  },
  {
    path: '/releaseManager',
    label: 'Release Manager',
    testKey: 'release-manager',
    icon: RocketShip,
    popout: true,
  },
  {
    path: '/jira-migration',
    label: 'Jira Migration',
    testKey: 'jira-migration',
    icon: SwapArrowHorizontal,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/migration/confluence',
    label: 'Confluence Migration',
    testKey: 'confluence-migration',
    icon: Notebook,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/migration/whatsapp',
    label: 'WhatsApp Migration',
    testKey: 'whatsapp-migration',
    icon: ChatChatting,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/slack-migration',
    label: 'Slack Migration',
    testKey: 'slack-migration',
    icon: SwapArrowHorizontal,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/team-intelligence',
    label: 'Team Intelligence',
    testKey: 'team-intelligence',
    icon: Atom,
    popout: true,
  },
  { path: '/claw-agents', label: 'Claw Agents', testKey: 'claw-agents', icon: Bot, popout: true },
];

// Paths shown in the toolbar by default (before any user customization).
export const DEFAULT_TOOLBAR_PATHS: string[] = [
  '/ai',
  '/chat/dir',
  '/chat/dm',
  '/calls',
  '/recordings',
  '/projects',
  '/sdlc',
  '/support',
  '/chat/activity',
];

// One-line description per toolbar-manageable path, shown under the label in
// the workspace admin's Toolbar tab — same { name, description } shape as
// the RESOURCES registry backing the Roles access grid (seed-acl.ts), so an
// admin sees what they're hiding, not just a bare label.
export const TOOLBAR_ITEM_DESCRIPTIONS: Record<string, string> = {
  '/ai': 'AI chat assistant panel',
  '/chat/dir': 'Channel-based team chat',
  '/chat/dm': 'Direct messages between users',
  '/chat/activity': 'Mentions and notification activity feed',
  '/calls': 'Voice and video calling',
  '/recordings': 'Call and meeting recordings',
  '/chat/canvas': 'Personal canvas documents',
  '/automations': 'Workflow automation triggers and actions',
  '/scheduled-messages': 'Messages scheduled for later delivery',
  '/browser': 'In-app browser tabs (desktop app only)',
  '/apps': 'Installed app integrations',
  '/guide': 'Product documentation and onboarding guide',
  '/knowledge-base': 'File and folder knowledge base for Ask AI',
  '/memory': 'Saved context and memory for AI',
  '/releaseManager': 'Release and deployment tracking',
  '/claw-agents': 'Claw AI agents dashboard',
};

type Permissions = ReturnType<typeof usePermissions>;

// Filters out items the current user cannot access (permission-gated routes and
// Electron-only routes). Mirrors the access rules used across the sidebar.
export const filterNavItemsByPermission = (
  items: NavigationItem[],
  permissions: Permissions,
  canManageOwnUserGroups = false,
): NavigationItem[] => {
  return items.filter(item => {
    const resourceName = PATH_TO_RESOURCE[item.path];
    const requiresAccess = resourceName !== undefined;

    let hasAccess = true;
    if (requiresAccess) {
      if (resourceName === 'SDLC') {
        // Any tier (READ/WRITE/ADMIN) unlocks the screen.
        hasAccess = permissions.some(p => p.resourceName === resourceName);
      } else if (resourceName === 'USER-GROUPS' || resourceName === 'ROLES') {
        hasAccess = permissions.some(
          p =>
            p.resourceName === resourceName &&
            (p.accessType === AccessType.ADMIN || p.accessType === AccessType.WRITE),
        );
        if (resourceName === 'USER-GROUPS') {
          hasAccess ||= canManageOwnUserGroups;
        }
      } else {
        hasAccess = permissions.some(
          p => p.resourceName === resourceName && p.accessType === AccessType.ADMIN,
        );
      }
    }

    if (item.path === '/browser' && !isElectronApp()) return false;
    return hasAccess;
  });
};
