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
  /** What the page holds, as for NavigationItem.description; apps the user added have none. */
  description?: string;
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
    description: 'Start a direct or group message',
    replace: true,
  },
  {
    key: 'threads',
    label: 'Threads',
    to: '/chat/dir/threads',
    icon: Subtask,
    trackName: 'OPEN_THREADS',
    description: 'Threads you follow and their replies',
  },
  {
    key: 'unreads',
    label: 'Unreads',
    to: '/chat/dir/unreads',
    icon: ChatTyping,
    trackName: 'OPEN_UNREADS',
    description: 'Conversations with unread messages',
  },
  {
    key: 'bookmarks',
    label: 'Bookmarks',
    to: '/chat/bookmarks',
    icon: BookmarkDefault,
    trackName: 'OPEN_BOOKMARKS',
    description: 'Messages you saved',
  },
  {
    key: 'drafts-sent',
    label: 'Drafts & Sent',
    to: '/chat/drafts-sent',
    icon: SendPlaneSlant,
    trackName: 'OPEN_DRAFTS_AND_SENT',
    description: 'Messages you are writing or sent',
  },
  {
    key: 'scheduled-messages',
    label: 'Scheduled Messages',
    to: '/scheduled-messages',
    icon: CalendarTimer,
    trackName: 'OPEN_SCHEDULED_MESSAGES',
    description: 'Messages set to send later',
    toolbarPath: '/scheduled-messages',
  },
  {
    key: 'recap',
    label: 'Recap',
    to: '/chat/dir/recap',
    icon: ListAiGenerated,
    trackName: 'OPEN_RECAP',
    description: 'AI summary of what you missed',
  },
  {
    key: 'radar',
    label: 'Radar',
    to: '/chat/dir/radar',
    icon: RadarNavIcon,
    trackName: 'OPEN_RADAR',
    description: 'Items that need your attention',
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
  /**
   * What the page holds and other names people call it, in a few nouns ("Also called the Desk or
   * Xyne Desk"). Shown in the admin Toolbar tab and read by screen readers and the assistant, which
   * understands verbs and synonyms itself, so no verbs and nothing another page holds.
   */
  description: string;
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
  {
    path: '/ai',
    label: 'Xyne AI',
    description: 'Also called Ask AI: AI chats, agents and knowledge',
    icon: XyneAINavIcon,
    popout: true,
  },
  {
    path: '/chat/dir',
    label: 'Chat',
    description: 'The inbox: channels, threads, unreads, bookmarks, drafts and recap',
    icon: Hashtag,
    popout: true,
  },
  {
    path: '/chat/dm',
    label: 'DMs',
    description: 'Direct and group conversations',
    icon: ChatDefault,
    popout: true,
  },
  {
    path: '/chat/activity',
    label: 'Activity',
    description: 'Notifications: mentions, replies and reactions',
    icon: NotificationBellOn,
    popout: true,
  },
  {
    path: '/streams',
    label: 'Streams',
    description: 'Xyne pages side by side in columns',
    icon: LayoutGridTwoVertical,
    popout: true,
  },
  {
    path: '/calls',
    label: 'Calls',
    description: 'Call history and upcoming calls',
    icon: PhoneDefault,
    popout: true,
  },
  {
    path: '/recordings',
    label: 'Recordings',
    description: 'Also called Xyne Scribe: meeting recordings and transcripts',
    icon: AudioWaveIcon,
    popout: true,
  },
  {
    path: '/projects',
    label: 'Tickets',
    description: 'Ticket boards, views and my tickets',
    icon: TicketToken,
    popout: true,
  },
  {
    path: '/sdlc',
    label: 'SDLC',
    description: 'Development hubs: tracks, wikis and repositories',
    icon: Atom,
    popout: true,
  },
  {
    path: '/support',
    label: 'Support',
    description: 'Also called the Desk or Xyne Desk',
    icon: Troubleshoot,
    popout: true,
  },
  {
    path: '/chat/canvas',
    label: 'My Canvas',
    description: 'Your canvas documents',
    icon: FileText,
    popout: true,
  },
  {
    path: '/automations',
    label: 'Automations',
    description: 'Automation rules, runs and approvals',
    icon: LightningThunderElectricOn,
    popout: true,
  },
  {
    path: '/workflows',
    label: 'Workflows',
    description: 'Workflows, their runs and variables',
    icon: GitBranch,
    popout: true,
  },
  // Administration (the /organisations module) holds Workspace Management,
  // Members (formerly User Management), User Groups, Roles and Organisations.
  {
    path: '/organisations',
    label: 'Administration',
    description: 'Workspace settings, members, invitations, guest users, user groups and roles',
    icon: BuildingApartmentTwo,
    popout: true,
  },
  {
    path: '/tag-review',
    label: 'Tag Review',
    description: 'Proposed thread tags awaiting review',
    icon: Tag,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/analytics',
    label: 'Analytics',
    description: 'Workspace usage metrics',
    icon: GraphTrendLine,
    popout: true,
  },
  {
    path: '/forms',
    label: 'Forms',
    description: 'Forms and their responses',
    icon: ClipboardDefault,
    popout: true,
  },
  {
    path: '/browser',
    label: 'Browser',
    description: 'Web pages in tabs (desktop app only)',
    icon: Globe,
    popout: true,
  },
  {
    path: '/apps',
    label: 'Apps',
    description: 'Also called Xyne Apps: installed apps, integrations and marketplace',
    icon: Grid02,
    popout: true,
  },
  {
    path: '/guide',
    label: 'User Guide',
    description: 'Product docs, feature guides and keyboard shortcuts',
    icon: QuestionMarkCircle,
    popout: true,
  },
  {
    path: '/knowledge-base',
    label: 'Knowledge Base',
    description: 'Files and folders Ask AI can search',
    icon: Notebook,
    popout: true,
  },
  {
    path: '/dashboards',
    label: 'Dashboards',
    description: 'Charts and reports built from data sources',
    icon: GridDashboard01,
    popout: true,
  },
  {
    path: '/listProjects',
    label: 'List Projects',
    description: 'Projects and their release tickets',
    icon: FolderDefault,
    popout: true,
  },
  {
    path: '/releaseManager',
    label: 'Release Manager',
    description: 'Release projects and repositories',
    icon: RocketShip,
    popout: true,
  },
  {
    path: '/migrations',
    label: 'Migrations',
    description: 'Data moved in from Jira, WhatsApp and Slack',
    icon: SwapArrowHorizontal,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/migration/confluence',
    label: 'Confluence Migration',
    description: 'Confluence spaces moved into channels',
    icon: Notebook,
    iconSize: 18,
    popout: true,
  },
  {
    path: '/team-intelligence',
    label: 'Team Intelligence',
    description: 'Also called Founder Brief: team goals and blockers',
    icon: Atom,
    popout: true,
  },
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
  {
    path: '/migrations/slack',
    label: 'Slack Migration',
    description: 'Slack channels and messages moved in',
    icon: SwapArrowHorizontal,
  },
  {
    path: '/scheduled-messages',
    label: 'Scheduled Messages',
    description: 'Messages set to send later',
    icon: CalendarTimer,
  },
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
      if (resourceName === 'SDLC') {
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
