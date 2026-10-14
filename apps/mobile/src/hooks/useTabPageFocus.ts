import { useContext, useEffect } from 'react';
import { useIsFocused } from 'expo-router/react-navigation';

import { TabPageFocusContext } from '@/src/components/tab-pager/tab-pager-context';

export function useTabPageIsFocused(): boolean {
  const page = useContext(TabPageFocusContext);

  const navFocused = useIsFocused();
  return page !== null ? page.isFocused : navFocused;
}

/**
 * Same contract as React Navigation's `useFocusEffect`.
 *
 * Runs `effect` when the tab page (or navigator screen) gains focus, and
 * runs the optional cleanup when focus is lost or before the effect re-runs.
 *
 * Pass a memoized callback (`useCallback`). If `effect`'s identity changes
 * while the page stays focused, the previous cleanup runs and the new
 * effect runs — so subscriptions stay in sync with the latest deps.
 */
export function useTabPageFocusEffect(effect: () => void | (() => void)): void {
  const isFocused = useTabPageIsFocused();

  useEffect(() => {
    if (!isFocused) return;
    return effect();
  }, [effect, isFocused]);
}
