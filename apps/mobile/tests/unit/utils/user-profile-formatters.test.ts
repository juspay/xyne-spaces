// Pin timezone so toLocaleDateString output is deterministic in CI.
process.env['TZ'] = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDate, formatRelativeYears } from '@/src/components/user-profile/utils/formatters';

const DAY_MS = 1000 * 60 * 60 * 24;

describe('formatDate', () => {
  it('returns empty string for missing values', () => {
    assert.equal(formatDate(null), '');
    assert.equal(formatDate(undefined), '');
    assert.equal(formatDate(0), '');
  });

  it('formats a timestamp as "Mon D YYYY" (comma stripped)', () => {
    assert.equal(formatDate(Date.parse('2020-06-15T00:00:00Z')), 'Jun 15 2020');
  });
});

describe('formatRelativeYears', () => {
  it('returns empty string for missing values', () => {
    assert.equal(formatRelativeYears(null), '');
    assert.equal(formatRelativeYears(undefined), '');
    assert.equal(formatRelativeYears(0), '');
  });

  it('describes sub-month distances as "(this month)"', () => {
    assert.equal(formatRelativeYears(Date.now() - 5 * DAY_MS), '(this month)');
  });

  it('describes month-level distances with singular/plural', () => {
    assert.equal(formatRelativeYears(Date.now() - 32 * DAY_MS), '(1 month ago)');
    assert.equal(formatRelativeYears(Date.now() - 60 * DAY_MS), '(2 months ago)');
  });

  it('describes year-level distances with singular/plural', () => {
    assert.equal(formatRelativeYears(Date.now() - 366 * DAY_MS), '(1 year ago)');
    assert.equal(formatRelativeYears(Date.now() - 3 * 365.25 * DAY_MS), '(3 years ago)');
  });
});
