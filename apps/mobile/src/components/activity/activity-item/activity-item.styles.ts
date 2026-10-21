import { Platform } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

/** Resolved CSS vars from `global.css` — pass from component via `useCSSVariable`. */
export type ActivityMarkdownTheme = {
  foreground: string;
  muted: string;
  tertiary: string;
  border: string;
  accent: string;
  input: string;
  brand: string;
  codeForeground: string;
  strong: string;
  em: string;
  link: string;
};

/**
 * Compact markdown styles for activity items - matches message styling
 * with basic formatting (no special colors for bold/italic).
 */
export const activityItemMarkdownStyle = ({
  isUnread,
  theme,
}: {
  isUnread: boolean;
  theme: ActivityMarkdownTheme;
}): MarkdownStyle => {
  const fg = isUnread ? theme.foreground : theme.muted;
  const muted = theme.muted;
  const tertiary = theme.tertiary;
  const border = theme.border;
  const accent = theme.accent;
  const inputBg = theme.input;
  const brand = theme.brand;
  const linkColor = theme.link || '#058ced';

  return {
    paragraph: {
      fontSize: 13,
      color: fg,
      lineHeight: Platform.select({ ios: 18, android: 20, default: 20 }) ?? 18,
      marginBottom: 0,
    },
    h1: {
      fontSize: 13,
      fontWeight: '600',
      color: fg,
      lineHeight: Platform.select({ ios: 18, android: 20, default: 20 }),
      marginBottom: 2,
    },
    h2: {
      fontSize: 13,
      fontWeight: '600',
      color: fg,
      lineHeight: Platform.select({ ios: 18, android: 20, default: 20 }),
      marginBottom: 2,
    },
    h3: {
      fontSize: 13,
      fontWeight: '600',
      color: fg,
      marginBottom: 2,
    },
    h4: {
      fontSize: 13,
      fontWeight: '600',
      color: fg,
      marginBottom: 2,
    },
    h5: {
      fontSize: 12,
      fontWeight: '600',
      color: fg,
      marginBottom: 2,
    },
    h6: {
      fontSize: 12,
      fontWeight: '600',
      color: isUnread ? '#374151' : '#6b7280',
      marginBottom: 2,
    },
    blockquote: {
      fontSize: 13,
      color: muted,
      lineHeight: Platform.select({ ios: 18, android: 20, default: 20 }),
      borderColor: brand,
      borderWidth: 2,
      backgroundColor: inputBg,
      gapWidth: 8,
      marginBottom: 4,
    },
    list: {
      fontSize: 13,
      color: fg,
      lineHeight: Platform.select({ ios: 18, android: 20, default: 20 }),
      bulletColor: tertiary,
      bulletSize: 4,
      markerColor: tertiary,
      markerFontWeight: '500',
      gapWidth: 6,
      marginLeft: 16,
      marginBottom: 4,
    },
    codeBlock: {
      fontFamily: mono,
      fontSize: 12,
      color: theme.codeForeground,
      backgroundColor: accent,
      borderColor: brand,
      borderWidth: 1,
      borderRadius: 6,
      padding: 8,
      lineHeight: Platform.select({ ios: 16, android: 18, default: 18 }),
      marginTop: 2,
      marginBottom: 4,
    },
    code: {
      fontFamily: mono,
      fontSize: 12,
      color: fg,
      backgroundColor: accent,
      borderColor: border,
    },
    link: {
      color: linkColor,
      underline: false,
    },
    // Basic bold - no special color, just bold weight
    strong: {
      fontWeight: 'bold',
      color: fg,
    },
    // Basic italic - no special color
    em: {
      fontStyle: 'italic',
      color: fg,
    },
    // Underline support
    underline: {
      color: fg,
    },
    thematicBreak: {
      color: border,
      height: 1,
      marginTop: 8,
      marginBottom: 8,
    },
  };
};
