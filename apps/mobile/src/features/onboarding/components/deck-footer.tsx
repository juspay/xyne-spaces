import { ArrowRight } from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { deckMetrics, deckPalette } from '../theme';

export interface DeckFooterProps {
  onBack: () => void;
  onNext: () => void;
  canGoBack: boolean;
  canGoNext: boolean;
  /** The forward button spins while the last card's choices are being committed. */
  isBusy?: boolean;
  nextLabel: string;
}

/** Back on the left, the forward disc on the right. */
export const DeckFooter = memo(function DeckFooter({
  onBack,
  onNext,
  canGoBack,
  canGoNext,
  isBusy = false,
  nextLabel,
}: DeckFooterProps): ReactElement {
  return (
    <View style={styles.row}>
      {canGoBack ? (
        <Pressable
          onPress={onBack}
          disabled={isBusy}
          accessibilityRole='button'
          accessibilityLabel='Back'
          hitSlop={16}
          style={({ pressed }) => [styles.back, pressed ? styles.backPressed : null]}
        >
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      ) : (
        <View />
      )}

      <Pressable
        onPress={onNext}
        disabled={!canGoNext || isBusy}
        accessibilityRole='button'
        accessibilityLabel={nextLabel}
        accessibilityState={{ disabled: !canGoNext || isBusy, busy: isBusy }}
        style={({ pressed }) => [
          styles.next,
          !canGoNext || isBusy ? styles.nextDisabled : null,
          pressed && canGoNext && !isBusy ? styles.nextPressed : null,
        ]}
      >
        {isBusy ? (
          <ActivityIndicator color={deckPalette.selectedText} />
        ) : (
          <ArrowRight size={24} color={deckPalette.selectedText} strokeWidth={2} />
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: deckMetrics.gutter,
  },
  back: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  backPressed: {
    opacity: 0.6,
  },
  backLabel: {
    fontSize: 16,
    color: deckPalette.textSecondary,
  },
  next: {
    width: deckMetrics.nextButtonSize,
    height: deckMetrics.nextButtonSize,
    borderRadius: deckMetrics.nextButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: deckPalette.selected,
  },
  nextDisabled: {
    opacity: 0.35,
  },
  nextPressed: {
    opacity: 0.8,
  },
});
