import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { firstKnownReleaseValue } from '@/src/observability/metrics/config/firstKnownReleaseValue';

describe('firstKnownReleaseValue', () => {
  it('prefers the first non-empty value that is not unknown', () => {
    assert.equal(firstKnownReleaseValue('unknown', '  ', '102.0.0', '1'), '102.0.0');
  });

  it('returns an empty string when nothing usable exists', () => {
    assert.equal(firstKnownReleaseValue('unknown', ''), '');
  });
});
