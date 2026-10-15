import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDeskTypeLabel } from '@/src/features/xyne-desks/list/utils/format-desk-type-label';

describe('formatDeskTypeLabel', () => {
  it('maps known desk types to their human labels', () => {
    assert.equal(formatDeskTypeLabel('EMAIL'), 'Email desk');
    assert.equal(formatDeskTypeLabel('SLACK'), 'Slack desk');
    assert.equal(formatDeskTypeLabel('APP'), 'App desk');
  });

  it('falls back to "Desk" for unknown types', () => {
    assert.equal(formatDeskTypeLabel('WEBHOOK'), 'Desk');
    assert.equal(formatDeskTypeLabel(''), 'Desk');
  });

  it('is case-sensitive and does not match lowercase variants', () => {
    assert.equal(formatDeskTypeLabel('email'), 'Desk');
  });
});
