import { useEffect } from 'react';

import { useOptionalTabPager } from '@/src/components/tab-pager/tab-pager-context';
import type { TabName } from '@/src/observability/logging/navigation/tabTransition';

/**
 * Lets the shell scroll this tab's list back to the top when its tab is tapped
 * again. A no-op under a shell that offers no such gesture, so the shared lists
 * render unchanged in either one.
 */
export function useRegisterTabScrollToTop(tab: TabName, scrollToTop: () => void): void {
  const register = useOptionalTabPager()?.registerScrollToTop;
  useEffect(() => register?.(tab, scrollToTop), [register, scrollToTop, tab]);
}
