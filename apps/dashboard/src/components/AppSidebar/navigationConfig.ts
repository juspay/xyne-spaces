import { createElement, type ComponentType, type ReactElement } from 'react';
import {
  GraphTrendLine,
  Notebook,
  TicketToken,
  FolderDefault,
  Hashtag,
  PhoneDefault,
  NotificationBellOn,
  ChatDefault,
  Troubleshoot,
  ClipboardDefault,
  FileText,
  CalendarTimer,
  Globe,
  GridDashboard01,
  SwapArrowHorizontal,
  Grid02,
  QuestionMarkCircle,
  BuildingApartmentTwo,
  LightningThunderElectricOn,
  Atom,
  RocketShip,
  GitBranch,
  LayoutGridTwoVertical,
  type PikaIconProps,
  Tag,
  ChatPlus,
  Subtask,
  ChatTyping,
  BookmarkDefault,
  SendPlaneSlant,
  ListAiGenerated,
  KeySlant,
} from '@xyne/icons';
import { AudioLines, Radar } from 'lucide-react';

import { PATH_TO_RESOURCE } from './utils/resourceMapping';
import { isElectronApp } from '../../utils/electronApp';
import type { usePermissions } from '../../hooks/usePermissions';
import { AccessType } from '@xyne/shared';
import { XyneAISidebarIcon } from '../icons/xyne-ai';
import { organisationsAccess } from '../../routes/OrganisationsModule/organisationsAccess';

/** A themeable pika-icon component (accepts size, color, variant, strokeWidth, className). */
export type PikaIcon = ComponentType<PikaIconProps>;

// Matches the waveform the Xyne Scribe list uses. lucide has no Solid/Stroke
// pair, so `variant` is dropped here rather than passed through to the <svg>.
const AudioWaveIcon = ({ variant: _variant, ...props }: PikaIconProps): ReactElement =>
  createElement(AudioLines, props);

const RadarNavIcon = ({ variant: _variant, ...props }: PikaIconProps): ReactElement =>
  createElement(Radar, props);

export type ChatNavKey =
  | 'new-message'
  | 'threads'
  | 'unreads'
  | 'bookmarks'
  | 'drafts-sent'
  | 'recap'
  | 'radar'
  | 'scheduled-messages';

/** A built-in Inbox entry, or an artifact app the user added (`app:<id>`). */
export type InboxItemKey = ChatNavKey | `app:${string}`;

export interface ChatNavItem {
  key: InboxItemKey;
  label: string;
  to: string;
  icon: PikaIcon;
  trackName: string;
  replace?: boolean;
  requiresRadar?: boolean;
  /** disabled_toolbar_paths entry that hides this item for a workspace. */
  toolbarPath?: string;
}

export const CHAT_NAV_ITEMS: ChatNavItem[] = [
  {
    key: 'new-message',
    label: 'New Message',
    to: '/chat/search?mode=dm',
    icon: ChatPlus,
    trackName: 'NEW_MESSAGE',
    replace: true,
  },
  {
    key: 'threads',
    label: 'Threads',
    to: '/chat/dir/threads',
    icon: Subtask,
    trackName: 'OPEN_THREADS',
  },
  {
    key: 'unreads',
    label: 'Unreads',
    to: '/chat/dir/unreads',
    icon: ChatTyping,
    trackName: 'OPEN_UNREADS',
  },
  {
    key: 'bookmarks',
    label: 'Bookmarks',
    to: '/chat/bookmarks',
    icon: BookmarkDefault,
    trackName: 'OPEN_BOOKMARKS',
  },
  {
    key: 'drafts-sent',
    label: 'Drafts & Sent',
    to: '/chat/drafts-sent',
    icon: SendPlaneSlant,
    trackName: 'OPEN_DRAFTS_AND_SENT',
  },
  {
    key: 'scheduled-messages',
    label: 'Scheduled Messages',
    to: '/scheduled-messages',
    icon: CalendarTimer,
    trackName: 'OPEN_SCHEDULED_MESSAGES',
    toolbarPath: '/scheduled-messages',
  },
  {
    key: 'recap',
    label: 'Recap',
    to: '/chat/dir/recap',
    icon: ListAiGenerated,
    trackName: 'OPEN_RECAP',
  },
  {
    key: 'radar',
    label: 'Radar',
    to: '/chat/dir/radar',
    icon: RadarNavIcon,
    trackName: 'OPEN_RADAR',
    requiresRadar: true,
  },
];

// The full built-in set, radar-gated. The Inbox itself renders the user's
// ordered selection — see useInboxNavItems — this is what the picker offers.
export const chatNavItems = (radarEnabled: boolean): ChatNavItem[] =>
  CHAT_NAV_ITEMS.filter(item => !item.requiresRadar || radarEnabled);

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
  { path: '/ai', label: 'Xyne AI', icon: XyneAINavIcon, popout: true },
  { path: '/chat/dir', label: 'Chat', icon: Hashtag, popout: true },
  { path: '/chat/dm', label: 'DMs', icon: ChatDefault, popout: true },
  { path: '/chat/activity', label: 'Activity', icon: NotificationBellOn, popout: true },
  { path: '/streams', label: 'Streams', icon: LayoutGridTwoVertical, popout: true },
  { path: '/calls', label: 'Calls', icon: PhoneDefault, popout: true },
  { path: '/recordings', label: 'Recordings', icon: AudioWaveIcon, popout: true },
  { path: '/projects', label: 'Tickets', icon: TicketToken, popout: true },
  { path: '/sdlc', label: 'SDLC', icon: Atom, popout: true },
  { path: '/support', label: 'Support', icon: Troubleshoot, popout: true },
  { path: '/chat/canvas', label: 'My Canvas', icon: FileText, popout: true },
  { path: '/automations', label: 'Automations', icon: LightningThunderElectricOn, popout: true },
  { path: '/workflows', label: 'Workflows', icon: GitBranch, popout: true },
  // Administration (the /organisations module) holds Workspace Management,
  // Members (formerly User Management), User Groups, Roles and Organisations.
  { path: '/organisations', label: 'Administration', icon: BuildingApartmentTwo, popout: true },
  { path: '/tag-review', label: 'Tag Review', icon: Tag, iconSize: 18, popout: true },
  { path: '/analytics', label: 'Analytics', icon: GraphTrendLine, popout: true },
  { path: '/forms', label: 'Forms', icon: ClipboardDefault, popout: true },
  { path: '/browser', label: 'Browser', icon: Globe, popout: true },
  { path: '/apps', label: 'Apps', icon: Grid02, popout: true },
  { path: '/guide', label: 'User Guide', icon: QuestionMarkCircle, popout: true },
  { path: '/knowledge-base', label: 'Knowledge Base', icon: Notebook, popout: true },
  { path: '/dashboards', label: 'Dashboards', icon: GridDashboard01, popout: true },
  { path: '/listProjects', label: 'List Projects', icon: FolderDefault, popout: true },
  { path: '/releaseManager', label: 'Release Manager', icon: RocketShip, popout: true },
  {
    path: '/migrations',
    label: 'Migrations',
    icon: SwapArrowHorizontal,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/migration/confluence',
    label: 'Confluence Migration',
    icon: Notebook,
    iconSize: 18,
    popout: true,
  },
  { path: '/team-intelligence', label: 'Team Intelligence', icon: Atom, popout: true },
  { path: '/secrets', label: 'Secrets', icon: KeySlant, iconSize: 18, popout: true },
];

// Rail items that were folded into a combined screen. A toolbar pin stored on
// the old path pins the new one instead of silently disappearing.
export const LEGACY_TOOLBAR_PATH_ALIASES: Readonly<Record<string, string>> = {
  '/workspace-management': '/organisations',
  '/resource-access': '/organisations',
  '/user-groups': '/organisations',
  '/roles': '/organisations',
  '/jira-migration': '/migrations',
  '/migration/whatsapp': '/migrations',
  '/slack-migration': '/migrations',
};

// Old entries in a workspace's disabled_toolbar_paths, read as their new path.
// Slack Migration could be disabled on its own (Jira/WhatsApp are permission-
// gated instead), so it maps to its tab, not to the whole Migrations screen.
export const LEGACY_DISABLED_TOOLBAR_PATH_ALIASES: Readonly<Record<string, string>> = {
  '/slack-migration': '/migrations/slack',
};

// Rail items a workspace can't switch off as a whole, so the admin Toolbar tab
// leaves them out. Migrations' tabs are gated individually (TICKET-MIGRATION
// for Jira/WhatsApp, /migrations/slack for Slack).
export const TOOLBAR_UNMANAGED_PATHS: ReadonlySet<string> = new Set(['/migrations']);

// Toolbar-guarded screens that aren't rail items of their own but can still be
// disabled per workspace, so the admin Toolbar tab keeps listing them.
export const NON_RAIL_TOOLBAR_ITEMS: NavigationItem[] = [
  { path: '/migrations/slack', label: 'Slack Migration', icon: SwapArrowHorizontal },
  { path: '/scheduled-messages', label: 'Scheduled Messages', icon: CalendarTimer },
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
  '/browser': 'In-app browser tabs (desktop app only)',
  '/apps': 'Installed app integrations',
  '/guide': 'Product documentation and onboarding guide',
  '/knowledge-base': 'File and folder knowledge base for Ask AI',
  '/releaseManager': 'Release and deployment tracking',
  '/migrations/slack': 'Slack Migration tab under Migrations',
  '/scheduled-messages': 'Messages scheduled for later delivery (Inbox)',
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
    if (item.path === '/organisations') {
      const access = organisationsAccess(permissions, canManageOwnUserGroups);
      hasAccess = Object.values(access).some(Boolean);
    } else if (requiresAccess) {
      if (resourceName === 'SDLC' || resourceName === 'TICKETS') {
        // Any tier (READ/WRITE/ADMIN) unlocks the screen.
        hasAccess = permissions.some(p => p.resourceName === resourceName);
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
