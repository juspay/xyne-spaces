import { ObservablePersistMMKV } from '@legendapp/state/persist-plugins/mmkv';
import { configureSynced } from '@legendapp/state/sync';

/**
 * The same MMKV instance as the tab layout, not `lotusStorage`
 * `lotusStorage` routes keys between a cache store and a handoff store and clears the cache one on sign-out. A chosen theme is a preference, not cache.
 */
const MMKV_ID = 'lotus-ui';

/**
 * Preset so every design-system store declares only its key
 *
 * `configureSynced` is Legend Stat's own way to avoid repeating plugin
 * config; the alternative is the same two lines copied into each store.
 */
export const persistedToUi = configureSynced({
  persist: {
    plugin: ObservablePersistMMKV,
    mmkv: {
      id: MMKV_ID,
    },
  },
});
