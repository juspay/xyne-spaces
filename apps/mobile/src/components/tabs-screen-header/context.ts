import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import type {
  GlobalSearchTab,
  SearchSourceSurface,
} from '@/src/features/global-search/utils/search-tabs';

export type TabsScreenHeaderContextValue = {
  scrollY: SharedValue<number>;
  collapseDistance: number;
  hasSearchBar: boolean;
};

export const TabsScreenHeaderContext = createContext<TabsScreenHeaderContextValue | null>(null);

export function useTabsScreenHeader() {
  const ctx = useContext(TabsScreenHeaderContext);
  if (!ctx) throw new Error('TabsScreenHeader compound used outside root');
  return ctx;
}

export type SearchBarTriggerProps = {
  placeholder: string;
  sourceSurface: SearchSourceSurface;
  initialTab?: GlobalSearchTab;
};
