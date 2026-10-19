export { AppTabBar, TabScreens } from './components/app-tab-bar';
export { useSpacesTabBarHeight } from './hooks/use-bar-height';
export {
  TAB_CATALOG,
  CATALOG_IDS,
  entryHref,
  tabEntry,
  tabEntries,
  tabEntryForRoute,
} from './model/catalog';
export type { TabEntry, TabBadgeKey } from './model/catalog';
export {
  MIN_VISIBLE_TABS,
  BOUNDARY_ID,
  toDragOrder,
  fromDragOrder,
  moveInDragOrder,
} from './model/layout';
export type { TabLayout } from './model/layout';
export { tabLayout$, saveTabLayout, resetTabLayout, peekTabLayout } from './state/layout-store';
