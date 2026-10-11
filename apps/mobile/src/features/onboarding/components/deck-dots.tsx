import { memo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { deckPalette } from '../theme';

/** One dot per card; the current one stretches into a pill. */
export const DeckDots = memo(function DeckDots({
  count,
  index,
}: {
  count: number;
  index: number;
}): ReactElement {
  return (
    <View
      style={styles.row}
      accessibilityRole='progressbar'
      accessibilityLabel={`Step ${index + 1} of ${count}`}
      accessibilityValue={{ min: 1, max: count, now: index + 1 }}
    >
      {Array.from({ length: count }, (_, dot) => (
        <View key={dot} style={dot === index ? styles.active : styles.inactive} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  active: {
    width: 20,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: deckPalette.selected,
  },
  inactive: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: deckPalette.dotInactive,
  },
});
