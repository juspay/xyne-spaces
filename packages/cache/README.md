# @xyne/cache

In-memory freshness policy for Node services, written once instead of per cache. Zero runtime dependencies.

v1 ships one primitive, `createSnapshotCache`: a keyed map that always holds the whole set from its source. `init()` loads it (and throws, so boot fails loudly), a background timer reloads it every `refreshEveryMs` and replaces the snapshot atomically, `get`/`snapshot` are synchronous, a failed refresh keeps the last-good value and emits `refresh-failed`. There is no eviction on purpose: for config-shaped data a miss must mean "not in the source". Invalidation is the interval plus local `refreshNow()`; cross-process invalidation is the consumer's transport, which can simply call `refreshNow()`.

```ts
import { createSnapshotCache } from '@xyne/cache';

const encryptedFields = createSnapshotCache<string, { fields: string[] }>({
  name: 'encrypted-fields',
  refreshEveryMs: 15 * 60 * 1000,
  load: async () => (await db.encryptedFieldConfig.findMany()).map((r) => [r.tableName, { fields: r.fields }] as const),
  onEvent: (e) => (e.type === 'refresh-failed' ? logger.warn('cache refresh failed', e) : logger.debug('cache', e)),
});

await encryptedFields.init();          // at boot, before the first read
encryptedFields.get('messages');       // sync, on the hot path
```

Tests run with `node --test` against `dist/` and drive time through an injected `Clock`, so they need no fake-timer framework.
