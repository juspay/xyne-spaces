/**
 * The tabs and their labels. Call search sends `from:` chips as a participant filter,
 * so there the same chip reads "With" — in the dropdown badge and in the search pill.
 * Both derive from one table so they cannot drift.
 */

import type { Href } from 'expo-router';

import { tabRoute } from '@/src/navigation/routes';

import type { SearchFilterChip, SearchFilterPrefix } from '../types';

export type GlobalSearchTab = 'messages' | 'chats' | 'channels' | 'calls' | 'tickets' | 'files';

export type SearchTabDefinition = {
  id: GlobalSearchTab;
  label: string;
  /**
   * What the From filter is called here. Call search sends `from:` chips as
   * `withUser` — a participant filter, not a sender one — so the same chips ask
   * a different question on that category.
   */
  fromFilterLabel: 'From' | 'With';
};

export const SEARCH_TABS: readonly SearchTabDefinition[] = [
  // Messages leads: it is the broadest category, and the only one that returns
  // message hits now that DMs/Channels are people- and channel-browse only.
  { id: 'messages', label: 'Messages', fromFilterLabel: 'From' },
  { id: 'chats', label: 'DMs', fromFilterLabel: 'From' },
  { id: 'channels', label: 'Channels', fromFilterLabel: 'From' },
  { id: 'calls', label: 'Calls', fromFilterLabel: 'With' },
  { id: 'tickets', label: 'Tickets', fromFilterLabel: 'From' },
  { id: 'files', label: 'Files', fromFilterLabel: 'From' },
] as const;

export type SearchSourceSurface = 'dms' | 'channels' | 'calls';

export type SearchSourceSurfaceHref = Href;

export function initialTabForSurface(surface: SearchSourceSurface): GlobalSearchTab {
  switch (surface) {
    case 'dms':
      return 'chats';
    case 'channels':
      return 'channels';
    case 'calls':
      return 'calls';
  }
}

export function tabHrefForSurface(surface: SearchSourceSurface): SearchSourceSurfaceHref {
  switch (surface) {
    case 'channels':
      return tabRoute('channels');
    case 'calls':
      return tabRoute('calls');
    case 'dms':
      return tabRoute('dms');
  }
}

export function placeholderForTab(tab: GlobalSearchTab): string {
  switch (tab) {
    case 'messages':
      return 'Search messages';
    case 'chats':
      return 'Search people and chats';
    case 'channels':
      return 'Search channels';
    case 'calls':
      return 'Search calls';
    case 'tickets':
      return 'Search tickets';
    case 'files':
      return 'Search files';
  }
}

export const IN_CHIP_EMPTY_LABEL = 'In';
export const ONLY_MY_CHANNELS_CHIP_LABEL = 'Only my channels';

/**
 * What to call the From filter on a given category. Reads the SEARCH_TABS table
 * rather than special-casing calls here, so a future category with the same
 * participant semantics declares it once alongside its label.
 */
export function fromFilterTitleForTab(tab: GlobalSearchTab): string {
  return SEARCH_TABS.find(definition => definition.id === tab)?.fromFilterLabel ?? 'From';
}

/**
 * Chip text for a multi-select filter. Bare while empty (`From`), and once
 * something is picked the filter keeps naming itself — `From: Alice`,
 * `From: Alice +2` — so a badge read on its own still says which filter it is.
 * The leading name is the first chip, so the sheets must commit selections in
 * the order the user made them.
 */
export function multiSelectChipLabel(chips: readonly SearchFilterChip[], fallback: string): string {
  const first = chips[0];
  if (!first) return fallback;
  if (chips.length === 1) return `${fallback}: ${first.label}`;
  return `${fallback}: ${first.label} +${chips.length - 1}`;
}

/**
 * What a committed chip calls its filter inline in the search pill — the same
 * word the dropdown badge uses, so `From: Alice` reads identically whichever
 * of the two the user is looking at. Tab-dependent because call search asks
 * `With` rather than `From`.
 */
export function filterChipTitle(prefix: SearchFilterPrefix, tab: GlobalSearchTab): string {
  return prefix === 'from:' ? fromFilterTitleForTab(tab) : IN_CHIP_EMPTY_LABEL;
}
