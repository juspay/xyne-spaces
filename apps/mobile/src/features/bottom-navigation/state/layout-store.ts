import { observable } from '@legendapp/state';
import { ObservablePersistMMKV } from '@legendapp/state/persist-plugins/mmkv';
import { syncObservable } from '@legendapp/state/sync';

import { CATALOG_IDS } from '../model/catalog';
import { normalizeLayout, type TabLayout } from '../model/layout';

const STORAGE_KEY = '@lotus_tab_layout_v1';

/**
 * Its own MMKV instance rather than `lotusStorage`.
 *
 * `lotusStorage` routes keys between the cache and handoff stores by policy, and
 * the cache one is cleared on sign-out. A saved bar arrangement is a preference,
 * not cache, and Legend State writes through the plugin rather than that router.
 */
const MMKV_ID = 'lotus-ui';

/**
 * The user's bottom-bar arrangement.
 *
 * MMKV is synchronous, so the first render already has the saved order. The bar
 * is on screen from the first frame; a layout that arrived one commit later
 * would show the default pills and then rearrange them in front of the user.
 */
export const tabLayout$ = observable<TabLayout>(normalizeLayout(null, CATALOG_IDS));

syncObservable(tabLayout$, {
  persist: { name: STORAGE_KEY, plugin: ObservablePersistMMKV, mmkv: { id: MMKV_ID } },
});

/**
 * Reconciles whatever was restored with the catalog as it is today: destinations
 * the app has dropped disappear, ones it has gained land at the end of Visible so
 * a release never hides something the user was not told about, and Visible is
 * topped back up if it came back short.
 */
tabLayout$.set(normalizeLayout(tabLayout$.peek(), CATALOG_IDS));

/** Replaces the arrangement. Normalising here means a caller cannot store a bad one. */
export function saveTabLayout(next: TabLayout): void {
  tabLayout$.set(normalizeLayout(next, CATALOG_IDS));
}

export function resetTabLayout(): void {
  tabLayout$.set(normalizeLayout(null, CATALOG_IDS));
}

/** Current value without subscribing. For gesture code that reads once. */
export function peekTabLayout(): TabLayout {
  return tabLayout$.peek();
}
