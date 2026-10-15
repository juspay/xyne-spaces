import { type ReactElement } from 'react';

import { GlobalSearchScreen } from '@/src/features/global-search';

/**
 * Search as a tab, so the bar's own field can drive it without a push.
 *
 * `fieldHostedElsewhere` hands the input to the bottom bar: the screen keeps
 * owning the query and the results, and draws only the category tags and
 * filters above them. One field on screen, one source of truth.
 */
export default function SearchRoute(): ReactElement {
  return <GlobalSearchScreen fieldHostedElsewhere />;
}
