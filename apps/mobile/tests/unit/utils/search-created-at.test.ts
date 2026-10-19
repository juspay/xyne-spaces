// Pin timezone so the UTC correction below is deterministic in CI.
process.env['TZ'] = 'Asia/Kolkata';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveSearchResultCreatedAtMs } from '@/src/utils/search';

const ISO = '2024-03-15T10:30:00.000Z';

describe('resolveSearchResultCreatedAtMs', () => {
  it('prefers the Vespa epoch, which needs no parsing at all', () => {
    assert.equal(
      resolveSearchResultCreatedAtMs({
        searchContext: { createdAtTimestamp: 1710498600000 },
        metadata: { timestamp: 'Mar 15, 2024 10:30:00' },
      }),
      '1710498600000',
    );
  });

  it('ignores a non-finite epoch and falls through', () => {
    assert.equal(
      resolveSearchResultCreatedAtMs({
        searchContext: { createdAtTimestamp: Number.NaN },
        createdAt: ISO,
      }),
      String(Date.parse(ISO)),
    );
  });

  it('reads the backend metadata timestamp as UTC, not device-local', () => {
    // The live path: /vespaSearch returns DisplaySearchResult verbatim, so this
    // string is all there is. Without the UTC correction it would be read in
    // Asia/Kolkata and land 5h30m early.
    assert.equal(
      resolveSearchResultCreatedAtMs({ metadata: { timestamp: 'Mar 15, 2024 10:30:00' } }),
      String(Date.parse(ISO)),
    );
  });

  it('does not double-correct a timestamp that already carries a zone', () => {
    for (const stamp of ['Mar 15, 2024 10:30:00 UTC', '2024-03-15T10:30:00Z']) {
      assert.equal(
        resolveSearchResultCreatedAtMs({ metadata: { timestamp: stamp } }),
        String(Date.parse(ISO)),
        stamp,
      );
    }
  });

  it('returns undefined rather than guessing when there is nothing usable', () => {
    assert.equal(resolveSearchResultCreatedAtMs({ metadata: {} }), undefined);
    assert.equal(resolveSearchResultCreatedAtMs({ metadata: { timestamp: 'N/A' } }), undefined);
    assert.equal(
      resolveSearchResultCreatedAtMs({ metadata: { timestamp: 'definitely-not-a-date' } }),
      undefined,
    );
  });

  it('round-trips to the correct year', () => {
    const ms = resolveSearchResultCreatedAtMs({ metadata: { timestamp: 'Mar 15, 2024 10:30:00' } });
    assert.equal(new Date(Number(ms)).getUTCFullYear(), 2024);
  });
});
