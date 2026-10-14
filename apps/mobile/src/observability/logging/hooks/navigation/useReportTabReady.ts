import { useEffect } from 'react';

import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';

import { logger as structuredLogger } from '../../appLogger';
import { completeTabTransition, type TabName } from '../../navigation/tabTransition';

/**
 * T2 for a tab switch: this tab is focused and its content is ready
 * (list, empty state, or static screen — not a spinner).
 */
export function useReportTabReady(tabName: TabName, isContentReady: boolean): void {
  const isFocused = useTabPageIsFocused();

  useEffect(() => {
    if (!isFocused || !isContentReady) {
      return;
    }

    const completed = completeTabTransition(tabName);
    if (completed === null) {
      return;
    }

    structuredLogger.info('navigation_tab_changed', {
      fromTab: completed.fromTab,
      toTab: completed.toTab,
      durationMs: completed.durationMs,
    });
  }, [isContentReady, isFocused, tabName]);
}
