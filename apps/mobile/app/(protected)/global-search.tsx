import { type ReactElement } from 'react';

import { GlobalSearchScreen } from '@/src/features/global-search';
import { GlobalSearchScreen as NewGlobalSearchScreen } from '@/src/features/global-search-next';
import { useFlag } from '@/src/flags';

export default function GlobalSearchRoute(): ReactElement {
  if (useFlag('ui.global_search')) {
    return <NewGlobalSearchScreen />;
  }

  return <GlobalSearchScreen />;
}
