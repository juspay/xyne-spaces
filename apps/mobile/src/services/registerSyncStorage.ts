import { registerSyncStorage } from '@xyne/shared/platform';
import { lotusStorage } from './localStorage';

/**
 * Bridges shared's synchronous key-value abstraction to MMKV.
 *
 * Must be imported for its side effect BEFORE any module that touches
 * `@xyne/shared/machines`, because the shared state machine reads draft
 * storage synchronously at module init. `lotus/index.js` imports this
 * ahead of the app boot chain.
 */
registerSyncStorage({
  getItem: key => lotusStorage.getString(key) ?? null,
  setItem: (key, value) => lotusStorage.set(key, value),
  removeItem: key => lotusStorage.remove(key),
});
