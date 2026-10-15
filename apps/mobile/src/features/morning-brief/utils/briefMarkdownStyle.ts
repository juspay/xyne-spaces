import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { buildComposerMarkdownStyle } from '@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle';

import { BRIEF_TICKET_SCHEME } from './citations';
import { MENTION_CHANNEL_SCHEME, MENTION_USER_SCHEME } from './briefText';

export interface BriefPalette {
  foreground: string;
  foregroundMuted: string;
  cardBg: string;
  brand: string;
  linkColor: string;
  /** Web tokens: --mention-color / --mention-bg. */
  mentionColor: string;
  mentionBg: string;
  /** Web's `bg-muted` chip fill. */
  chipBg: string;
}

/** Mention palette matching the dashboard's global.css tokens. */
export const BRIEF_MENTION_COLORS = {
  light: { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  dark: { color: '#88c2ff', bg: 'rgba(82,156,232,0.11)' },
} as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Markdown style for a single brief line: the web spec's 15px/22.5 body with
 * `strong` at weight 500 (not bold), zero paragraph margins (the section
 * layout owns spacing), and link variants for the five brief link schemes —
 * mentions render as the blue mention tint, citation chips and ticket ids as
 * quiet muted text on the chip fill.
 */
export function buildBriefLineMarkdownStyle(palette: BriefPalette): MarkdownStyle {
  const base = buildComposerMarkdownStyle({
    foreground: palette.foreground,
    foregroundMuted: palette.foregroundMuted,
    cardBg: palette.cardBg,
    brand: palette.brand,
    linkColor: palette.linkColor,
    variant: 'activity',
  });

  return {
    ...base,
    paragraph: {
      ...base.paragraph,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '400',
      marginTop: 0,
      marginBottom: 0,
    },
    list: {
      ...base.list,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 0,
    },
    linkVariants: {
      [`^${escapeRegex(MENTION_USER_SCHEME)}`]: {
        color: palette.mentionColor,
        backgroundColor: palette.mentionBg,
        underline: false,
      },
      [`^${escapeRegex(MENTION_CHANNEL_SCHEME)}`]: {
        color: palette.mentionColor,
        backgroundColor: palette.mentionBg,
        underline: false,
      },
      [`^${escapeRegex(BRIEF_TICKET_SCHEME)}`]: {
        color: palette.foregroundMuted,
        backgroundColor: palette.chipBg,
        underline: false,
      },
    },
  };
}
