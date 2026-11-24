import type { MentionListItem } from '@/src/components/input-composer/utils/mentions';

import {
  MENTIONS_CARD_GAP,
  MENTIONS_CARD_MAX_ROWS,
  MENTIONS_CARD_MAX_SHARE,
  MENTIONS_CARD_PADDING,
  MENTIONS_CARD_ROW_HEIGHT,
  MENTIONS_CARD_SIDE_INSET,
} from '../constants';

/** What leads a row: the person's face, or an icon in a circle. */
export type MentionLeading =
  'avatar' | 'group' | 'everyone' | 'here' | 'channel' | 'privateChannel';

export function mentionLeading(item: MentionListItem): MentionLeading {
  switch (item.type) {
    case 'channel':
      return item.isPrivate === true ? 'privateChannel' : 'channel';
    case 'group':
      return 'group';
    case 'special':
      return item.mentionType === 'here' ? 'here' : 'everyone';
    case 'user':
      return 'avatar';
  }
}

/** The row's title, worded as the classic list words it. */
export function mentionTitle(item: MentionListItem): string {
  switch (item.type) {
    case 'channel':
      return `#${item.name}`;
    case 'group':
      return `@${item.alias || item.name}`;
    case 'special':
      return `@${item.name}`;
    case 'user':
      return item.name;
  }
}

/** A person's email; a group's or a special mention's description. */
export function mentionSubtitle(item: MentionListItem): string | null {
  if (item.type === 'channel') return null;
  const subtitle = item.type === 'user' ? item.email : item.description;
  return subtitle ? subtitle : null;
}

export function mentionAccessibilityLabel(item: MentionListItem): string {
  const subtitle = mentionSubtitle(item);
  const title = mentionTitle(item);
  return subtitle === null ? title : `${title}, ${subtitle}`;
}

type TitleMatch = Readonly<{ before: string; match: string; after: string }>;

/** The title cut around the first case-insensitive occurrence of the typed query. */
export function splitTitleMatch(title: string, query: string): TitleMatch {
  const needle = query.trim().toLowerCase();
  const start = needle.length === 0 ? -1 : title.toLowerCase().indexOf(needle);
  if (start < 0) return { before: title, match: '', after: '' };
  const end = start + needle.length;
  return { before: title.slice(0, start), match: title.slice(start, end), after: title.slice(end) };
}

export function mentionsCardEmptyLabel(isChannelMode: boolean): string {
  return isChannelMode ? 'No channels' : 'No matches';
}

/** What a screen reader hears as the result count changes. */
export function mentionsCardAnnouncement(count: number, isChannelMode: boolean): string {
  if (count === 0) return mentionsCardEmptyLabel(isChannelMode);
  const noun = isChannelMode ? 'channel' : 'suggestion';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The list's height: a row per result (the empty row counts as one), at most
 * four and a half, within the card's share of the space above the keyboard.
 * It never drops below one row, so a short landscape window still shows one.
 */
export function mentionsCardListHeight(count: number, maxCardHeight: number): number {
  const rows = Math.min(Math.max(count, 1), MENTIONS_CARD_MAX_ROWS);
  const room = maxCardHeight - MENTIONS_CARD_PADDING * 2;
  return Math.max(MENTIONS_CARD_ROW_HEIGHT, Math.min(rows * MENTIONS_CARD_ROW_HEIGHT, room));
}

export type WindowRect = Readonly<{ x: number; y: number; width: number; height: number }>;

export function sameWindowRect(a: WindowRect, b: WindowRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

type MentionsCardPlacement = Readonly<{
  left: number;
  width: number;
  /** Where the card's bottom edge sits, from the top of the layer it draws in. */
  bottomEdge: number;
  maxHeight: number;
}>;

/**
 * Where the card goes in its layer, from the bar's and the layer's rects in
 * the window: 8 above the bar, inside the bar's side padding, and no taller
 * than its share of what the keyboard leaves of the layer.
 */
export function mentionsCardPlacement(
  bar: WindowRect,
  layer: WindowRect,
  keyboardHeight: number,
): MentionsCardPlacement {
  return {
    left: bar.x - layer.x + MENTIONS_CARD_SIDE_INSET,
    width: Math.max(0, bar.width - MENTIONS_CARD_SIDE_INSET * 2),
    bottomEdge: Math.max(0, bar.y - layer.y - MENTIONS_CARD_GAP),
    maxHeight: Math.max(0, layer.height - keyboardHeight) * MENTIONS_CARD_MAX_SHARE,
  };
}
