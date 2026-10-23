import type { Href, Router } from 'expo-router';

import type { GlobalSearchTab } from '@/src/features/global-search';

/** The search screen the header button and the pull-down gesture both open. */
export function openGlobalSearch(router: Router, tab: GlobalSearchTab): void {
  router.push({
    pathname: '/(protected)/global-search',
    params: { initialTab: tab },
  } as unknown as Href);
}
