import { containsNotificationTarget, mmkvStorageAdapter } from '@/src/services/mmkvStorageAdapter';

import type { ReadWarmWindowDeps } from './readWarmWindow';
import { EXPECTED_CHAT_CACHE_ENTITY_VERSION } from './schemaGuard';

/** Screen-edge adapter. Not used from logic tests (MMKV). */
export const productionWarmDeps = (): ReadWarmWindowDeps => {
  const ctx = mmkvStorageAdapter.getGlobalUserContext();
  const stored = mmkvStorageAdapter.getChatCacheSchemaSnapshot();
  return {
    readEntity: (kind, id, _messageId) =>
      kind === 'channel'
        ? mmkvStorageAdapter.readChannelConversationsSync(id)
        : mmkvStorageAdapter.readChatEntitySync(kind, id),
    containsTarget: containsNotificationTarget,
    schema: {
      storedSchemaVersion: stored.schemaVersion,
      expectedSchemaVersion: ctx.schemaVersion,
      storedEntityVersion: stored.entityVersion,
      expectedEntityVersion: EXPECTED_CHAT_CACHE_ENTITY_VERSION,
    },
    now: Date.now,
  };
};

export const productionStoreBytes = (): number =>
  mmkvStorageAdapter.getChatCacheStats().serializedCharacterCount;
