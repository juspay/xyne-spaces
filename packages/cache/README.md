# @xyne/cache

Thin wrapper over [`lru-cache`](https://github.com/isaacs/node-lru-cache) with the defaults Xyne services want for source-of-truth lookups: bounded size, a TTL after which the stale entry is still served while `fetch` refreshes it in the background, and last-good retention when a refresh fails. Concurrent misses share one fetch.

```ts
import { createCache } from '@xyne/cache';

const encryptedFields = createCache<string, EncryptedFieldsConfig>({
  max: 1,
  ttlMs: 15 * 60 * 1000,
  fetch: async () => loadWholeTableFromDb(),
});

const cfg = await encryptedFields.get('all');
```
