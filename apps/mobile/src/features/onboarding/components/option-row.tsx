import { Check } from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { deckMetrics, deckPalette } from '../theme';

/** A single-choice row: white with a tick once picked, dark otherwise. */
export const OptionRow = memo(function OptionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole='radio'
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.rowSelected : null,
        pressed && !selected ? styles.rowPressed : null,
      ]}
    >
      <Text style={[styles.label, selected ? styles.labelSelected : null]} numberOfLines={2}>
        {label}
      </Text>
      {selected ? (
        <View style={styles.check}>
          <Check size={18} color={deckPalette.selectedText} strokeWidth={2.4} />
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: deckMetrics.rowHeight,
    borderRadius: deckMetrics.rowRadius,
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: deckPalette.row,
  },
  rowSelected: {
    backgroundColor: deckPalette.selected,
  },
  rowPressed: {
    backgroundColor: '#303030',
  },
  label: {
    flex: 1,
    fontSize: 15,
    color: deckPalette.textPrimary,
  },
  labelSelected: {
    color: deckPalette.selectedText,
    fontWeight: '500',
  },
  check: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
