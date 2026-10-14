import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { PRIMARY_FONT_SIZE } from './markdownStyle';

export type TableSurface = {
  /** Cell text colour (mine-aware body foreground). */
  foreground: string;
  /** `--color-tertiary-bg` via ChatRenderTokens.tableHeaderBg. */
  headerBackground: string;
  /** `--color-border` via ChatRenderTokens.tableBorderColor. */
  borderColor: string;
  fontSize?: number;
};

/**
 * Every colour slot is set explicitly. `react-native-enriched-markdown`
 * fills any omitted table colour with a light-only default (`#FFFFFF` /
 * `#F9FAFB` rows, `#F3F4F6` header, `#E5E7EB` border, dark text), so a
 * partial style renders a light table on a dark bubble. Mirrors the v2
 * `buildComposerMarkdownStyle` table block.
 */
export const buildTableStyle = ({
  foreground,
  headerBackground,
  borderColor,
  fontSize = PRIMARY_FONT_SIZE,
}: TableSurface): NonNullable<MarkdownStyle['table']> => ({
  fontSize: Math.max(12, fontSize - 1),
  color: foreground,
  borderColor,
  borderWidth: 1,
  borderRadius: 8,
  headerBackgroundColor: headerBackground,
  headerTextColor: foreground,
  // Transparent rows inherit the exact owning bubble/card surface. This avoids
  // a `--color-card` patch inside own-message, quoted and system variants.
  rowEvenBackgroundColor: 'transparent',
  rowOddBackgroundColor: 'transparent',
  cellPaddingHorizontal: 10,
  cellPaddingVertical: 6,
  marginTop: 2,
  marginBottom: 8,
});
