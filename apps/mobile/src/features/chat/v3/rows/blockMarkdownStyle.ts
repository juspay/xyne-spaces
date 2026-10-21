import { Platform } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { buildInlineCodeStyle } from '../model/text/inlineCodeChrome';
import { buildTableStyle } from '../model/text/tableChrome';

/**
 * Faithful port of v2 `buildComposerMarkdownStyle` ('primary' variant) block
 * styles (see v2 `conversation-composer/utils/markdownStyle.ts`). v3 previously
 * passed only `paragraph` + `link` to `EnrichedMarkdownText`, so lists,
 * blockquotes, code blocks, headings and task lists fell back to library
 * defaults and diverged visibly from v2. Colours are driven off ChatRenderTokens
 * (mine-aware `foreground`/`link` resolved by the caller) so the two stacks
 * cannot drift.
 */

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

const PRIMARY_FONT_SIZE = 16;
const QUOTED_FONT_SIZE = 14;
const SYSTEM_FONT_SIZE = 12;
const PARAGRAPH_LINE_HEIGHT = 20;
// iOS/Android split matches v2 BODY_LINE_HEIGHT so list rows wrap identically.
const LIST_LINE_HEIGHT = Platform.select({ ios: 20, android: 22, default: 20 }) ?? 20;
const CODE_BLOCK_LINE_HEIGHT = Platform.select({ ios: 17, android: 18, default: 18 });
const CODE_BLOCK_FONT_SIZE_DELTA = 3;
const TASK_LIST_CHECKED_COLOR = '#0561E2';

export type { InlineCodeSurface } from '../model/text/inlineCodeChrome';
export { buildInlineCodeStyle, inlineCodeSurfaceFor } from '../model/text/inlineCodeChrome';

export type BlockMarkdownColors = {
  /** Mine-aware body text colour (rootTextUser | rootTextOther). */
  foreground: string;
  foregroundMuted: string;
  cardBg: string;
  brand: string;
  /** Mine-aware link colour (linkColorUser | linkColor). */
  link: string;
  inlineCodeBackground?: string;
  inlineCodeForeground?: string;
  /**
   * Required (not optional) on purpose: if omitted, the native renderer falls
   * back to light-only table colours and the table ignores dark theme.
   * Pass `tokens.tableHeaderBg` / `tokens.tableBorderColor`.
   */
  tableHeaderBackground: string;
  tableBorderColor: string;
};

export type BlockMarkdownVariant = 'primary' | 'quoted' | 'system';

export const buildBlockMarkdownStyle = ({
  foreground,
  foregroundMuted,
  cardBg,
  brand,
  link,
  inlineCodeBackground,
  inlineCodeForeground,
  tableHeaderBackground,
  tableBorderColor,
  variant = 'primary',
}: BlockMarkdownColors & { variant?: BlockMarkdownVariant }): MarkdownStyle => {
  const fontSize =
    variant === 'system'
      ? SYSTEM_FONT_SIZE
      : variant === 'quoted'
        ? QUOTED_FONT_SIZE
        : PRIMARY_FONT_SIZE;
  const fontWeight = variant === 'primary' ? '400' : '500';
  const system = variant === 'system';

  return {
    paragraph: {
      fontSize,
      color: foreground,
      lineHeight: PARAGRAPH_LINE_HEIGHT,
      fontWeight,
      marginTop: 0,
      marginBottom: 8,
      ...(system ? { letterSpacing: -0.16 } : {}),
    },
    h1: { fontSize, fontWeight: '500', color: foreground, marginBottom: 6 },
    h2: { fontSize, fontWeight: '500', color: foreground, marginBottom: 4 },
    h3: { fontSize, fontWeight: '500', color: foreground, marginBottom: 4 },
    h4: { fontSize, fontWeight: '500', color: foreground, marginBottom: 4 },
    h5: { fontSize, fontWeight: '500', color: foregroundMuted, marginBottom: 4 },
    h6: { fontSize, fontWeight: '500', color: foregroundMuted, marginBottom: 4 },
    blockquote: {
      fontSize: Math.max(13, fontSize - 1),
      color: foreground,
      lineHeight: PARAGRAPH_LINE_HEIGHT,
      borderColor: brand,
      borderWidth: 3,
      backgroundColor: 'transparent',
      gapWidth: 10,
      marginBottom: 8,
    },
    list: {
      fontSize,
      color: foreground,
      lineHeight: LIST_LINE_HEIGHT,
      // Bullets track the message text colour instead of the muted grey default.
      bulletColor: foreground,
      bulletSize: 4,
      markerColor: foreground,
      markerFontWeight: '500',
      markerMinWidth: 16,
      gapWidth: 4,
      marginLeft: 24,
      marginTop: 0,
      marginBottom: 8,
    },
    codeBlock: {
      fontFamily: MONO_FONT,
      fontSize: Math.max(10, fontSize - CODE_BLOCK_FONT_SIZE_DELTA),
      color: foreground,
      backgroundColor: cardBg,
      borderWidth: 0,
      borderRadius: 6,
      padding: 8,
      lineHeight: CODE_BLOCK_LINE_HEIGHT,
      marginTop: 2,
      marginBottom: 6,
    },
    code: buildInlineCodeStyle(
      {
        foreground: inlineCodeForeground ?? foreground,
        backgroundColor: inlineCodeBackground ?? cardBg,
      },
      MONO_FONT,
    ),
    link: { color: system ? foreground : link, underline: !system },
    strong: { fontWeight: 'bold', color: foreground },
    em: { fontStyle: 'italic', color: foreground },
    underline: { color: foreground },
    thematicBreak: { color: foregroundMuted, height: 1, marginTop: 8, marginBottom: 8 },
    taskList: {
      checkedColor: TASK_LIST_CHECKED_COLOR,
      borderColor: foregroundMuted,
      checkmarkColor: '#ffffff',
      checkedTextColor: foreground,
      checkedStrikethrough: false,
    },
    table: buildTableStyle({
      foreground,
      headerBackground: tableHeaderBackground,
      borderColor: tableBorderColor,
      fontSize,
    }),
    // Matches v2 inline custom-emoji render size (![:name:](file://...)).
    inlineImage: { size: 20 },
  };
};
