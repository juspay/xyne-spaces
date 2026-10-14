import { type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Expo Router still needs a file per NativeTabs trigger. Visible tab content
 * lives in TabPager; these shells stay transparent so the pager shows through
 * and ignore hits so swipes reach the pager instead of the empty route.
 */
export function TabRouteShell(): ReactElement {
  return <View collapsable={false} pointerEvents='none' style={styles.shell} />;
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
