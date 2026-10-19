import { Platform } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

export const BODY_LINE_HEIGHT = Platform.select({ ios: 20, android: 22, default: 20 }) ?? 20;

const PRIMARY_FONT_SIZE = 16;
const ACTIVITY_FONT_SIZE = 15;
const COMPACT_ACTIVITY_FONT_SIZE = 14;
const QUOTED_FONT_SIZE = 14;
const SYSTEM_FONT_SIZE = 12;
const CODE_BLOCK_FONT_SIZE_DELTA = 3;
const TASK_LIST_CHECKED_COLOR = '#0561E2';

type Variant = 'primary' | 'activity' | 'compactActivity' | 'quoted' | 'system';

const VARIANT_FONT_SIZE: Record<Variant, number> = {
  primary: PRIMARY_FONT_SIZE,
  activity: ACTIVITY_FONT_SIZE,
  compactActivity: COMPACT_ACTIVITY_FONT_SIZE,
  quoted: QUOTED_FONT_SIZE,
  system: SYSTEM_FONT_SIZE,
};

const VARIANT_FONT_WEIGHT: Record<Variant, '400' | '500'> = {
  primary: '400',
  activity: '500',
  compactActivity: '400',
  quoted: '500',
  system: '500',
};

/** Paragraph line height for every variant's markdown body. */
export const PARAGRAPH_LINE_HEIGHT = 20;

/**
 * Canonical primary chat-body text metrics. Single source of truth so the lite
 * paint preview (`chat-paint-row-lite`) wraps and sizes identically to the rich
 * `primary` markdown body, keeping the lite-to-rich promotion free of text reflow
 * or a font-weight pop (open-jitter fix). Must stay in step with the `primary`
 * branch of `buildComposerMarkdownStyle`.
 */
export const PRIMARY_BODY_TEXT_STYLE = {
  fontSize: VARIANT_FONT_SIZE.primary,
  lineHeight: PARAGRAPH_LINE_HEIGHT,
  fontWeight: VARIANT_FONT_WEIGHT.primary,
} as const;

export const COMPACT_ACTIVITY_BODY_TEXT_STYLE = {
  fontSize: COMPACT_ACTIVITY_FONT_SIZE,
  lineHeight: 19,
  fontWeight: VARIANT_FONT_WEIGHT.compactActivity,
} as const;

type BuildArgs = {
  foreground: string;
  foregroundMuted: string;
  cardBg: string;
  brand: string;
  linkColor: string;
  inlineCodeBackground?: string;
  inlineCodeForeground?: string;
  inlineCodeBorderColor?: string;
  /**
   * Table surfaces. The native renderer defaults these to hardcoded light
   * values (`#FFFFFF` / `#F9FAFB` rows, `#F3F4F6` header, `#E5E7EB` border in
   * `normalizeMarkdownStyle.ts`), so every one of them must be supplied from a
   * theme token or the table renders light-only on a dark surface.
   */
  tableHeaderBackground?: string;
  tableBorderColor?: string;
  variant?: Variant;
};

export const buildComposerMarkdownStyle = ({
  foreground,
  foregroundMuted,
  cardBg,
  brand,
  linkColor,
  inlineCodeBackground,
  inlineCodeForeground,
  inlineCodeBorderColor,
  tableHeaderBackground,
  tableBorderColor,
  variant = 'primary',
}: BuildArgs): MarkdownStyle => {
  const baseFontSize = VARIANT_FONT_SIZE[variant];
  const paragraphColor = foreground;
  const isSystem = variant === 'system';
  const paragraphLineHeight = PARAGRAPH_LINE_HEIGHT;
  const paragraphLetterSpacing = isSystem ? -0.16 : undefined;
  const paragraphFontWeight = VARIANT_FONT_WEIGHT[variant];

  return {
    paragraph: {
      fontSize: baseFontSize,
      color: paragraphColor,
      lineHeight: paragraphLineHeight,
      fontWeight: paragraphFontWeight,
      marginTop: 0,
      marginBottom: 8,
      ...(paragraphLetterSpacing !== undefined ? { letterSpacing: paragraphLetterSpacing } : {}),
    },
    h1: { fontSize: baseFontSize, fontWeight: '500', color: foreground, marginBottom: 6 },
    h2: { fontSize: baseFontSize, fontWeight: '500', color: foreground, marginBottom: 4 },
    h3: { fontSize: baseFontSize, fontWeight: '500', color: foreground, marginBottom: 4 },
    h4: { fontSize: baseFontSize, fontWeight: '500', color: foreground, marginBottom: 4 },
    h5: { fontSize: baseFontSize, fontWeight: '500', color: foregroundMuted, marginBottom: 4 },
    h6: { fontSize: baseFontSize, fontWeight: '500', color: foregroundMuted, marginBottom: 4 },
    blockquote: {
      fontSize: Math.max(13, baseFontSize - 1),
      color: foreground,
      lineHeight: PARAGRAPH_LINE_HEIGHT,
      borderColor: brand,
      borderWidth: 3,
      backgroundColor: 'transparent',
      gapWidth: 10,
      marginBottom: 8,
    },
    list: {
      fontSize: baseFontSize,
      color: paragraphColor,
      lineHeight: BODY_LINE_HEIGHT,
      // Keep list bullets aligned with the message text instead of using the muted gray tone.
      bulletColor: paragraphColor,
      bulletSize: 4,
      markerColor: foreground,
      markerFontWeight: '500',
      markerMinWidth: 16,
      // Native renderer minimum keeps the marker close to its content without
      // changing list indentation or wrapped-line alignment.
      gapWidth: 4,
      marginLeft: 24,
      marginTop: 0,
      marginBottom: 8,
    },
    codeBlock: {
      fontFamily: MONO_FONT,
      fontSize: Math.max(12, baseFontSize - CODE_BLOCK_FONT_SIZE_DELTA),
      color: foreground,
      backgroundColor: cardBg,
      borderWidth: 0,
      borderRadius: 6,
      padding: 8,
      lineHeight: Platform.select({ ios: 17, android: 18, default: 18 }),
      marginTop: 2,
      marginBottom: 6,
    },
    code: {
      fontFamily: MONO_FONT,
      fontSize: baseFontSize - 2,
      color: inlineCodeForeground ?? foreground,
      backgroundColor: inlineCodeBackground ?? cardBg,
      borderColor: inlineCodeBorderColor ?? 'transparent',
    },
    link: { color: isSystem ? paragraphColor : linkColor, underline: !isSystem },
    strong: { fontWeight: 'bold', color: isSystem ? paragraphColor : foreground },
    em: { fontStyle: 'italic', color: isSystem ? paragraphColor : foreground },
    underline: { color: isSystem ? paragraphColor : foreground },
    thematicBreak: {
      color: foregroundMuted,
      height: 1,
      marginTop: 8,
      marginBottom: 8,
    },
    taskList: {
      checkedColor: TASK_LIST_CHECKED_COLOR,
      borderColor: foregroundMuted,
      checkmarkColor: '#ffffff',
      checkedTextColor: foreground,
      checkedStrikethrough: false,
    },
    table: {
      fontSize: Math.max(12, baseFontSize - 1),
      color: paragraphColor,
      borderColor: tableBorderColor ?? foregroundMuted,
      borderWidth: 1,
      borderRadius: 8,
      headerBackgroundColor: tableHeaderBackground ?? cardBg,
      headerTextColor: foreground,
      // Flat rows on the body's own surface — parity with the dashboard table,
      // and the only way to override the renderer's light-only row defaults.
      rowEvenBackgroundColor: cardBg,
      rowOddBackgroundColor: cardBg,
      cellPaddingHorizontal: 10,
      cellPaddingVertical: 6,
      marginTop: 2,
      marginBottom: 8,
    },
    // Sized to feel native alongside the 16px paragraph; matches dashboard's
    // `.inline-emoji { width: 1.25em }` look. Custom emojis emitted as
    // `![:name:](file://...)` markdown images render at this size inline.
    inlineImage: { size: 20 },
  };
};

/** Inline custom emoji size in message bubbles (also used by expo-image fallback). */
export const COMPOSER_INLINE_EMOJI_RENDER_SIZE = 20;

/**
 * `latexMath` is off because LaTeX rendering is compiled out of the iOS build
 * (see plugins/withEnrichedMarkdownNoMath.cjs — RaTeX needs dynamic frameworks).
 * With the flag on, math nodes would parse but render to nothing; off, `$x^2$`
 * stays literal text, matching Android which has no native math renderer either.
 */
export const COMPOSER_MD4C_FLAGS = { underline: true as const, latexMath: false as const };
