import type { MarkdownStyle } from 'react-native-enriched-markdown';

import type { MentionKind } from './text/parseInlineRich';
import {
  MENTION_BROADCAST_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_USER_SCHEME,
} from './text/mentionSchemes';

export type MentionPalette = {
  otherBg: string;
  otherText: string;
  currentOtherBg: string;
  currentOtherText: string;
  mentionedYouBg: string;
  mentionedYouText: string;
  currentSelfBg: string;
  currentSelfText: string;
};

const decodeMentionId = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export const mentionFromUrl = (
  url: string,
): { mentionKind: MentionKind; mentionId: string } | null => {
  const schemes: readonly [MentionKind, string][] = [
    ['user', MENTION_USER_SCHEME],
    ['channel', MENTION_CHANNEL_SCHEME],
    ['group', MENTION_GROUP_SCHEME],
    ['broadcast', MENTION_BROADCAST_SCHEME],
  ];
  for (const [mentionKind, scheme] of schemes) {
    if (url.startsWith(scheme)) {
      return { mentionKind, mentionId: decodeMentionId(url.slice(scheme.length)) };
    }
  }
  return null;
};

export const mentionTargetsViewer = (
  mentionKind: MentionKind,
  mentionId: string,
  viewerId: string,
  isOwnMessage: boolean,
): boolean =>
  (mentionKind === 'user' && viewerId.length > 0 && mentionId === viewerId) ||
  (mentionKind === 'broadcast' && !isOwnMessage);

export const resolveMentionColors = ({
  mentionKind,
  mentionId,
  palette,
  viewerId,
  isOwnMessage,
}: {
  mentionKind: MentionKind;
  mentionId: string;
  palette: MentionPalette;
  viewerId: string;
  isOwnMessage: boolean;
}): { backgroundColor: string; color: string } => {
  const isSelfMention = mentionKind === 'user' && viewerId.length > 0 && mentionId === viewerId;
  if (isOwnMessage) {
    return isSelfMention || mentionKind === 'broadcast'
      ? { backgroundColor: palette.currentSelfBg, color: palette.currentSelfText }
      : { backgroundColor: palette.currentOtherBg, color: palette.currentOtherText };
  }
  return mentionTargetsViewer(mentionKind, mentionId, viewerId, false)
    ? { backgroundColor: palette.mentionedYouBg, color: palette.mentionedYouText }
    : { backgroundColor: palette.otherBg, color: palette.otherText };
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mentionVariant = (
  backgroundColor: string,
  color: string,
): NonNullable<MarkdownStyle['linkVariants']>[string] => ({
  backgroundColor,
  color,
  underline: false,
});

export const buildMentionLinkVariants = ({
  palette,
  viewerId,
  isOwnMessage,
}: {
  palette: MentionPalette;
  viewerId: string;
  isOwnMessage: boolean;
}): NonNullable<MarkdownStyle['linkVariants']> => {
  const self = isOwnMessage
    ? mentionVariant(palette.currentSelfBg, palette.currentSelfText)
    : mentionVariant(palette.mentionedYouBg, palette.mentionedYouText);
  const other = isOwnMessage
    ? mentionVariant(palette.currentOtherBg, palette.currentOtherText)
    : mentionVariant(palette.otherBg, palette.otherText);
  const broadcast = isOwnMessage
    ? mentionVariant(palette.currentSelfBg, palette.currentSelfText)
    : mentionVariant(palette.mentionedYouBg, palette.mentionedYouText);
  return {
    ...(viewerId
      ? {
          [`^${escapeRegex(MENTION_USER_SCHEME)}${escapeRegex(viewerId)}$`]: self,
          [`^${escapeRegex(MENTION_USER_SCHEME)}${escapeRegex(encodeURIComponent(viewerId))}$`]:
            self,
        }
      : {}),
    [`^${escapeRegex(MENTION_BROADCAST_SCHEME)}`]: broadcast,
    [`^${escapeRegex(MENTION_USER_SCHEME)}`]: other,
    [`^${escapeRegex(MENTION_CHANNEL_SCHEME)}`]: other,
    [`^${escapeRegex(MENTION_GROUP_SCHEME)}`]: other,
  };
};
