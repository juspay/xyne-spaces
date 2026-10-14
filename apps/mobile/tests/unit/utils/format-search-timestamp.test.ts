// Pin timezone so locale date/time formatting is deterministic in CI.
process.env['TZ'] = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatSearchResultTimestamp } from '@/src/features/global-search/utils/format-search-timestamp';

describe('formatSearchResultTimestamp', () => {
  it('returns empty string when there is nothing to format', () => {
    assert.equal(formatSearchResultTimestamp({}), '');
    assert.equal(
      formatSearchResultTimestamp({ createdAtTimestamp: undefined, metadataTimestamp: undefined }),
      '',
    );
  });

  it('formats an epoch-ms createdAtTimestamp (year shown when not current year)', () => {
    const out = formatSearchResultTimestamp({
      createdAtTimestamp: Date.parse('2020-06-15T08:30:00Z'),
    });
    assert.match(out, /2020/);
    assert.match(out, /Jun/);
    assert.match(out, /8:30/);
  });

  it('ignores a non-finite createdAtTimestamp and falls back to metadata', () => {
    const out = formatSearchResultTimestamp({
      createdAtTimestamp: Number.NaN,
      metadataTimestamp: '2020-06-15T08:30:00Z',
    });
    assert.match(out, /2020/);
  });

  it('parses an already-UTC-suffixed metadata timestamp', () => {
    const out = formatSearchResultTimestamp({ metadataTimestamp: 'Jun 15, 2020 08:30:00 UTC' });
    assert.match(out, /2020/);
  });

  it('returns the raw metadata string when it cannot be parsed', () => {
    assert.equal(
      formatSearchResultTimestamp({ metadataTimestamp: 'definitely-not-a-date' }),
      'definitely-not-a-date',
    );
  });
});
