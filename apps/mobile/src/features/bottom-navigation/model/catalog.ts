import { CircleAlert } from 'lucide-react-native';

import {
  BellIcon,
  BookmarkIcon,
  ChannelsIcon,
  ChatIcon,
  DraftsIcon,
  HeadphonesIcon,
  LayersIcon,
  MorningBriefIcon,
  NotebookIcon,
  RecordingIcon,
  ThreadsIcon,
} from '../icons';
import type { Href } from 'expo-router';

import { tabRoute, type TabName } from '@/src/navigation/routes';

import { navIcon, type NavIcon } from '../components/nav-icon';

/** Which unread count feeds a destination's badge, when one does. */
export type TabBadgeKey = 'channels' | 'dms' | 'activity';

export type TabEntry = {
  id: string;
  label: string;
  icon: NavIcon;
  /**
   * Route name inside the tab navigator, for the destinations that are tab
   * screens. Absent for the ones that live elsewhere in the stack, which the
   * bar can still send you to but can never light as the active pill.
   */
  routeName?: TabName;
  /** Absolute path, for the destinations that are not tab screens. */
  externalHref?: Href;
  badge?: TabBadgeKey;
};

/**
 * Where a destination points, resolved **at call time**.
 *
 * Never store this on the entry. Expo Router eagerly requires every route file
 * at startup, so this module is evaluated once, with whatever shell was active
 * then — and a frozen href would keep sending a Spaces user into `(tabs)` for
 * the rest of the process. That is exactly what it did.
 */
export function entryHref(entry: TabEntry): Href | null {
  if (entry.routeName !== undefined) return tabRoute(entry.routeName);
  return entry.externalHref ?? null;
}

/**
 * Every destination the bottom bar can reach, in the order a fresh install
 * gets them.
 *
 * This is the one list. The pills, the more panel and the customize drawer are
 * all views onto it plus the user's saved arrangement — nothing else declares
 * a destination, so adding one here is the whole change.
 */
export const TAB_CATALOG: readonly TabEntry[] = [
  {
    id: 'channels',
    label: 'Channels',
    icon: navIcon(ChannelsIcon),
    routeName: 'channels',
    badge: 'channels',
  },
  {
    id: 'dms',
    label: 'Messages',
    icon: navIcon(ChatIcon),
    routeName: 'dms',
    badge: 'dms',
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: navIcon(BellIcon),
    routeName: 'activity',
    badge: 'activity',
  },
  {
    id: 'calls',
    label: 'Calls',
    icon: navIcon(HeadphonesIcon),
    routeName: 'calls',
  },
  {
    id: 'morning-brief',
    label: 'Morning Brief',
    icon: navIcon(MorningBriefIcon),
    routeName: 'morning-brief',
  },
  {
    id: 'threads',
    label: 'Threads',
    icon: navIcon(ThreadsIcon),
    routeName: 'threads',
  },
  {
    id: 'recordings',
    label: 'Recordings',
    icon: navIcon(RecordingIcon),
    externalHref: '/(protected)/(shortcuts)/recordings' as Href,
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    icon: navIcon(BookmarkIcon),
    routeName: 'bookmarks',
  },
  {
    id: 'drafts-sent',
    label: 'Drafts & Sent',
    icon: navIcon(DraftsIcon),
    routeName: 'drafts-sent',
  },
  {
    id: 'canvas',
    label: 'Canvas',
    icon: navIcon(NotebookIcon),
    externalHref: '/(protected)/(shortcuts)/canvas' as Href,
  },
  {
    id: 'desks',
    label: 'Desks',
    icon: navIcon(LayersIcon),
    routeName: 'xyne-desks',
  },
  {
    id: 'report-issue',
    label: 'Report issue',
    icon: CircleAlert,
    externalHref: '/(protected)/report-issue' as Href,
  },
];

const ENTRY_BY_ID = new Map(TAB_CATALOG.map(entry => [entry.id, entry]));

export const CATALOG_IDS: readonly string[] = TAB_CATALOG.map(entry => entry.id);

export function tabEntry(id: string): TabEntry | undefined {
  return ENTRY_BY_ID.get(id);
}

export function tabEntries(ids: readonly string[]): TabEntry[] {
  return ids.map(tabEntry).filter((entry): entry is TabEntry => entry !== undefined);
}

/** The catalog entry a tab-navigator route name belongs to, if any. */
export function tabEntryForRoute(routeName: string): TabEntry | undefined {
  if (!routeName) return undefined;
  return TAB_CATALOG.find(entry => entry.routeName === routeName);
}
