import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseMetricsEnabled } from '@/src/observability/metrics/config/parseMetricsEnabled';

describe('parseMetricsEnabled', () => {
  it('defaults to off for dev and debug builds', () => {
    assert.equal(
      parseMetricsEnabled(undefined, {
        isDevBuild: true,
      }),
      false,
    );
  });

  it('defaults to on for release builds', () => {
    assert.equal(
      parseMetricsEnabled(undefined, {
        isDevBuild: false,
      }),
      true,
    );
  });

  it('honours explicit true and false overrides', () => {
    assert.equal(
      parseMetricsEnabled('true', {
        isDevBuild: true,
      }),
      true,
    );

    assert.equal(
      parseMetricsEnabled('false', {
        isDevBuild: false,
      }),
      false,
    );
  });

  it('ignores case and surrounding whitespace', () => {
    assert.equal(
      parseMetricsEnabled(' TRUE ', {
        isDevBuild: true,
      }),
      true,
    );
  });
});
