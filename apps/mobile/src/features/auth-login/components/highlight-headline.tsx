import { LinearGradient } from 'expo-linear-gradient';
import { memo, type ReactElement } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_GLOW_COLORS,
  HIGHLIGHT_LOCATIONS,
  HIGHLIGHT_TEXT_INSET,
  LOGIN_GUTTER,
  loginPalette,
} from '../theme';

export type HeadlineLine = { text: string; highlighted?: boolean };

/**
 * Rough advance width of one character of the bold system face, as a fraction of the font size.
 * Used only to pick a starting size; `adjustsFontSizeToFit` is what guarantees the fit.
 */
const AVERAGE_GLYPH_RATIO = 0.455;

const MIN_FONT_SIZE = 22;
const MAX_FONT_SIZE = 40;

/**
 * The design has the longest line stopping just short of the gutter, so the headline sizes off the
 * viewport rather than off a breakpoint: a fixed size either wraps on a small phone or leaves a
 * gap on a large one.
 */
function useHeadlineFontSize(lines: readonly HeadlineLine[]): number {
  const { width } = useWindowDimensions();
  const longest = lines.reduce((max, line) => Math.max(max, line.text.length), 1);
  const budget = width - 2 * LOGIN_GUTTER - 2 * HIGHLIGHT_TEXT_INSET;
  const fitted = budget / (longest * AVERAGE_GLYPH_RATIO);
  return Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fitted)));
}

function HighlightedLine({ text, fontSize }: { text: string; fontSize: number }): ReactElement {
  return (
    <View style={styles.highlightWrapper}>
      <LinearGradient
        colors={HIGHLIGHT_GLOW_COLORS}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={styles.glow}
      />
      <LinearGradient
        colors={HIGHLIGHT_COLORS}
        locations={HIGHLIGHT_LOCATIONS}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={styles.highlight}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.line, { fontSize, lineHeight: Math.round(fontSize * 1.2) }]}
        >
          {text}
        </Text>
      </LinearGradient>
    </View>
  );
}

/** The value proposition, with one line sitting on a warm gradient block. */
export const HighlightHeadline = memo(function HighlightHeadline({
  lines,
}: {
  lines: readonly HeadlineLine[];
}): ReactElement {
  const fontSize = useHeadlineFontSize(lines);
  const lineHeight = Math.round(fontSize * 1.2);

  return (
    <View
      style={styles.container}
      accessibilityRole='header'
      accessibilityLabel={lines.map(line => line.text).join(' ')}
    >
      {lines.map(line =>
        line.highlighted === true ? (
          <HighlightedLine key={line.text} text={line.text} fontSize={fontSize} />
        ) : (
          <Text
            key={line.text}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.line, styles.plainLine, { fontSize, lineHeight }]}
          >
            {line.text}
          </Text>
        ),
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    gap: 2,
  },
  line: {
    fontWeight: '700',
    letterSpacing: -0.6,
    color: loginPalette.textPrimary,
  },
  // Stretched on purpose: `adjustsFontSizeToFit` only shrinks text that is width-constrained, and
  // a flex-start child hugs its content instead.
  plainLine: {
    alignSelf: 'stretch',
    paddingHorizontal: HIGHLIGHT_TEXT_INSET,
  },
  highlightWrapper: {
    alignSelf: 'flex-start',
  },
  // Sits a few points proud of the block on every side; the amber bleeding past the red edge is
  // what reads as the glow in the design.
  glow: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    left: -3,
    right: -3,
    borderRadius: 7,
    opacity: 0.6,
  },
  highlight: {
    borderRadius: 4,
    paddingHorizontal: HIGHLIGHT_TEXT_INSET,
    paddingVertical: 2,
  },
});
