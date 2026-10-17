import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { PRIMARY_FONT_SIZE } from './markdownStyle';

export type InlineCodeSurface = {
  foreground: string;
  backgroundColor: string;
};

/** v2 paints inline code on a contrasting chip (card on others, embedded tint on own bubble). */
export const inlineCodeSurfaceFor = (
  mine: boolean,
  tokens: { embeddedBgUser: string; cardBg: string },
  foreground: string,
): InlineCodeSurface => ({
  foreground,
  backgroundColor: mine ? tokens.embeddedBgUser : tokens.cardBg,
});

export const buildInlineCodeStyle = (
  { foreground, backgroundColor }: InlineCodeSurface,
  fontFamily: string,
): NonNullable<MarkdownStyle['code']> => ({
  fontFamily,
  fontSize: PRIMARY_FONT_SIZE - 2,
  color: foreground,
  backgroundColor,
  borderColor: 'transparent',
});
