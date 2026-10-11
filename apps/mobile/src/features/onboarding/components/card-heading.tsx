import { memo, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { deckPalette } from '../theme';

/** The question at the top of a card, with optional supporting line. */
export const CardHeading = memo(function CardHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): ReactElement {
  return (
    <View style={styles.block}>
      <Text style={styles.title} accessibilityRole='header'>
        {title}
      </Text>
      {subtitle !== undefined ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  block: {
    gap: 8,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: -0.6,
    color: deckPalette.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: deckPalette.textSecondary,
  },
});
