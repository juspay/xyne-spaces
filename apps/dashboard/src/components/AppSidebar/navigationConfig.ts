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
  type PikaIconProps,
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
  icon: PikaIcon;
  iconSize?: number;
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
  { path: '/ai', label: 'Xyne AI', icon: XyneAINavIcon },
  { path: '/chat/dir', label: 'Chat', icon: Hashtag },
  { path: '/chat/dm', label: 'DMs', icon: ChatDefault },
  { path: '/chat/activity', label: 'Activity', icon: NotificationBellOn },
  { path: '/calls', label: 'Calls', icon: PhoneDefault },
  { path: '/recordings', label: 'Recordings', icon: AudioWaveIcon },
  { path: '/projects', label: 'Tickets', icon: TicketToken },
  { path: '/sdlc', label: 'SDLC', icon: Atom },
  { path: '/support', label: 'Support', icon: Troubleshoot },
  { path: '/chat/canvas', label: 'My Canvas', icon: FileText },
  { path: '/automations', label: 'Automations', icon: LightningThunderElectricOn },
  { path: '/scheduled-messages', label: 'Scheduled Messages', icon: CalendarTimer },
  { path: '/user-groups', label: 'User Groups', icon: UserThree },
  { path: '/resource-access', label: 'User Management', icon: UserShield, iconSize: 18 },
  { path: '/roles', label: 'Roles', icon: ShieldCheck, iconSize: 18 },
  { path: '/workspace-management', label: 'Workspace Management', icon: Settings01 },
  { path: '/organisations', label: 'Organisations', icon: BuildingApartmentTwo },
  { path: '/analytics', label: 'Analytics', icon: GraphTrendLine },
  { path: '/forms', label: 'Forms', icon: ClipboardDefault },
  { path: '/browser', label: 'Browser', icon: Globe },
  { path: '/apps', label: 'Apps', icon: Grid02 },
  { path: '/guide', label: 'User Guide', icon: QuestionMarkCircle },
  { path: '/product-insights', label: 'Insights', icon: Piechart01 },
  { path: '/knowledge-base', label: 'Knowledge Base', icon: Notebook },
  { path: '/memory', label: 'Context', icon: Database },
  { path: '/dashboards', label: 'Dashboards', icon: GridDashboard01 },
  { path: '/listProjects', label: 'List Projects', icon: FolderDefault },
  { path: '/releaseManager', label: 'Release Manager', icon: RocketShip },
  { path: '/jira-migration', label: 'Jira Migration', icon: SwapArrowHorizontal, iconSize: 18 },
  { path: '/migration/confluence', label: 'Confluence Migration', icon: Notebook, iconSize: 18 },
  {
    path: '/migration/whatsapp',
    label: 'WhatsApp Migration',
    icon: ChatChatting,
    iconSize: 18,
  },
  { path: '/slack-migration', label: 'Slack Migration', icon: SwapArrowHorizontal, iconSize: 18 },
  { path: '/team-intelligence', label: 'Team Intelligence', icon: Atom },
  { path: '/claw-agents', label: 'Claw Agents', icon: Bot },
];

// Core items that are always in the toolbar. Users cannot remove these — their
// toggle is locked on in the customize UI.
export const REQUIRED_TOOLBAR_PATHS: string[] = [
  '/ai',
  '/chat/dir',
  '/chat/dm',
  '/calls',
  '/recordings',
  '/projects',
  '/sdlc',
  '/support',
  '/chat/activity',
  '/guide',
  '/releaseManager',
];

// Paths shown in the toolbar by default (before any user customization).
export const DEFAULT_TOOLBAR_PATHS: string[] = [...REQUIRED_TOOLBAR_PATHS];

// Whether a path is locked into the toolbar (cannot be toggled off).
export const isRequiredToolbarPath = (path: string): boolean =>
  REQUIRED_TOOLBAR_PATHS.includes(path);

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
        // Any tier (READ/WRITE/ADMIN) unlocks the SDLC screen.
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
