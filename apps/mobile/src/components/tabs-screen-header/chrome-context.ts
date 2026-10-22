import { createContext } from 'react';

export type TabsHeaderChrome = {
  /**
   * Whether this shell's header carries the search bar.
   *
   * The classic shell's does, so this defaults to `true` and every existing
   * consumer keeps the heights it had. The Spaces shell moved search into the
   * bottom bar, and a list that still reserved room for a field nobody renders
   * left a band of empty screen under the title.
   */
  hasSearchBar: boolean;
};

export const TabsHeaderChromeContext = createContext<TabsHeaderChrome>({ hasSearchBar: true });
