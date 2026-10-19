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
const QUOTED_FONT_SIZE = 14;
const SYSTEM_FONT_SIZE = 12;
const TASK_LIST_CHECKED_COLOR = '#0561E2';
type Variant = 'primary' | 'activity' | 'quoted' | 'system';

const VARIANT_FONT_SIZE: Record<Variant, number> = {
  primary: PRIMARY_FONT_SIZE,
  activity: ACTIVITY_FONT_SIZE,
  quoted: QUOTED_FONT_SIZE,
  system: SYSTEM_FONT_SIZE,
};

const VARIANT_FONT_WEIGHT: Record<Variant, '500' | '600'> = {
  primary: '600',
  activity: '500',
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

type BuildArgs = {
  foreground: string;
  foregroundMuted: string;
  cardBg: string;
  brand: string;
  linkColor: string;
  inlineCodeBackground?: string;
  inlineCodeForeground?: string;
  inlineCodeBorderColor?: string;
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
      fontSize: baseFontSize,
      color: foregroundMuted,
      lineHeight: BODY_LINE_HEIGHT,
      borderColor: brand,
      borderWidth: 3,
      backgroundColor: cardBg,
      gapWidth: 10,
      marginBottom: 6,
    },
    list: {
      fontSize: baseFontSize,
      color: paragraphColor,
      lineHeight: BODY_LINE_HEIGHT,
      bulletColor: foregroundMuted,
      bulletSize: 4,
      markerColor: foreground,
      markerFontWeight: '500',
      markerMinWidth: 16,
      gapWidth: 6,
      marginLeft: 16,
      marginTop: 0,
      marginBottom: 8,
    },
    codeBlock: {
      fontFamily: MONO_FONT,
      fontSize: baseFontSize - 2,
      color: foreground,
      backgroundColor: cardBg,
      borderWidth: 0,
      borderRadius: 8,
      padding: 12,
      lineHeight: Platform.select({ ios: 18, android: 20, default: 20 }),
      marginTop: 4,
      marginBottom: 8,
    },
    code: {
      fontFamily: MONO_FONT,
      fontSize: baseFontSize - 2,
      color: inlineCodeForeground ?? foreground,
      backgroundColor: inlineCodeBackground ?? cardBg,
      borderColor: inlineCodeBorderColor ?? 'transparent',
    },
    link: { color: isSystem ? paragraphColor : linkColor, underline: false },
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
