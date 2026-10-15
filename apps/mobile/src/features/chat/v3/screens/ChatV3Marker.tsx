import { type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Was the flag-path marker while screens hosted v2. Phase 9 mounts the real
 * list; keep the file only if a debug strip is needed later.
 */
export function ChatV3Marker({ children }: { children: ReactNode }): ReactElement {
  return (
    <View style={styles.root}>
      <View pointerEvents='none' style={styles.bar}>
        <Text style={styles.label}>Chat v3</Text>
      </View>
      <View style={styles.root}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    paddingVertical: 5,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
