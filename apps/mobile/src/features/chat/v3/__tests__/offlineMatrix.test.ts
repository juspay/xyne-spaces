import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OFFLINE_COLD_COPY,
  OFFLINE_UNAVAILABLE_COPY,
  offlineCopy,
  offlineSurface,
  type OfflineCapability,
} from '../machine/offlineMatrix';

const TABLE: { capability: OfflineCapability; kind: ReturnType<typeof offlineSurface>['kind'] }[] =
  [
    { capability: 'read-warm', kind: 'allow' },
    { capability: 'read-cold', kind: 'error' },
    { capability: 'send', kind: 'queue' },
    { capability: 'edit', kind: 'queue' },
    { capability: 'delete', kind: 'queue' },
    { capability: 'react', kind: 'queue' },
    { capability: 'paginate', kind: 'boundary' },
    { capability: 'attach', kind: 'queue-upload' },
    { capability: 'open-cached-attachment', kind: 'allow' },
    { capability: 'open-uncached-attachment', kind: 'unavailable' },
    { capability: 'link-preview-fetch', kind: 'defer' },
    { capability: 'jump-outside-warm', kind: 'error' },
  ];

describe('§12.1 offline matrix', (): void => {
  it('maps every capability to the documented surface', (): void => {
    for (const row of TABLE) {
      assert.equal(offlineSurface(row.capability).kind, row.kind, row.capability);
    }
  });

  it('never uses a skeleton or an empty state for a blocked capability', (): void => {
    for (const row of TABLE) {
      const surface = offlineSurface(row.capability);
      assert.notEqual(surface.kind, undefined, row.capability);
      if (surface.kind === 'error') {
        assert.equal(surface.reason, 'offline-cold');
        assert.equal(offlineCopy(surface), OFFLINE_COLD_COPY);
      }
      if (surface.kind === 'unavailable') {
        assert.equal(offlineCopy(surface), OFFLINE_UNAVAILABLE_COPY);
      }
    }
  });

  it('does not explain allow/queue paths — those are silent success', (): void => {
    assert.equal(offlineCopy({ kind: 'allow' }), null);
    assert.equal(offlineCopy({ kind: 'queue' }), null);
    assert.equal(offlineCopy({ kind: 'queue-upload' }), null);
    assert.equal(offlineCopy({ kind: 'boundary' }), null);
    assert.equal(offlineCopy({ kind: 'defer' }), null);
  });
});
