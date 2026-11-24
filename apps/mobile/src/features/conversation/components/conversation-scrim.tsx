import { type ReactElement } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { SCRIM_COLOR } from '../constants';

type ConversationScrimProps = {
  /** What a tap does, for screen readers ("Collapse thread", "Close"). */
  label: string;
  onPress: () => void;
};

/** The 20% black under a floating card; tapping it closes the card. */
export function ConversationScrim({ label, onPress }: ConversationScrimProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      style={styles.scrim}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: SCRIM_COLOR },
});
