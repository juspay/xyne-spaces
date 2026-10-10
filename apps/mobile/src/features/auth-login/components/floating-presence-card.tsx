import { memo, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { loginPalette } from '../theme';

/**
 * The small card that floats over the top-right corner of the feed: a reaction, the teammate who
 * left it, and a typing indicator spilling out of the lower-left corner. Purely decorative.
 */
export const FloatingPresenceCard = memo(function FloatingPresenceCard(): ReactElement {
  return (
    <View style={styles.card} pointerEvents='none'>
      <View style={styles.reaction}>
        <View style={[styles.heart, styles.heartBack]} />
        <View style={[styles.heart, styles.heartFront]} />
      </View>

      <View style={styles.presence}>
        <Text style={styles.presenceInitials}>DK</Text>
      </View>

      <View style={styles.typing}>
        {[0, 1, 2].map(index => (
          <View key={index} style={styles.typingDot} />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 0,
    right: 4,
    width: 66,
    height: 74,
    borderRadius: 18,
    backgroundColor: loginPalette.surface,
  },
  reaction: {
    position: 'absolute',
    left: 6,
    top: 8,
    width: 34,
    height: 30,
  },
  heart: {
    position: 'absolute',
    borderRadius: 999,
  },
  heartBack: {
    width: 20,
    height: 20,
    left: 0,
    top: 2,
    backgroundColor: '#C9303E',
  },
  heartFront: {
    width: 22,
    height: 22,
    left: 10,
    top: 0,
    backgroundColor: '#FF5A6E',
  },
  presence: {
    position: 'absolute',
    right: -14,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4C5BD4',
  },
  presenceInitials: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  typing: {
    position: 'absolute',
    left: -22,
    bottom: -8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: loginPalette.surfaceRaised,
  },
  typingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: loginPalette.textSecondary,
  },
});
