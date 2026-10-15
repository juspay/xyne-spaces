import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatSearchResultTimestamp } from '@/src/features/global-search/utils/format-search-timestamp';

// These assertions are timezone-robust: they never assert an exact localized
// string (which depends on the runner's TZ/ICU), only structural properties.

// ─── empty / missing inputs ─────────────────────────────────────────────────

test('formatSearchResultTimestamp: returns empty string when nothing is provided', () => {
  assert.equal(formatSearchResultTimestamp({}), '');
  assert.equal(
    formatSearchResultTimestamp({ createdAtTimestamp: undefined, metadataTimestamp: undefined }),
    '',
  );
});

// ─── epoch priority ─────────────────────────────────────────────────────────

test('formatSearchResultTimestamp: uses the epoch timestamp over the metadata string', () => {
  const out = formatSearchResultTimestamp({
    createdAtTimestamp: Date.UTC(2020, 5, 15, 12),
    metadataTimestamp: 'RAW_METADATA_MARKER',
  });
  assert.notEqual(out, 'RAW_METADATA_MARKER');
  assert.ok(out.length > 0);
});

test('formatSearchResultTimestamp: ignores a non-finite epoch and falls back', () => {
  assert.equal(formatSearchResultTimestamp({ createdAtTimestamp: NaN }), '');
  assert.equal(formatSearchResultTimestamp({ createdAtTimestamp: Infinity }), '');
  const out = formatSearchResultTimestamp({
    createdAtTimestamp: NaN,
    metadataTimestamp: '2024-01-15T10:30:00Z',
  });
  assert.ok(out.length > 0);
  assert.notEqual(out, '2024-01-15T10:30:00Z');
});

// ─── metadata string parsing ────────────────────────────────────────────────

test('formatSearchResultTimestamp: parses a UTC wall-clock string without an explicit zone', () => {
  const out = formatSearchResultTimestamp({ metadataTimestamp: '2024-01-15 10:30:00' });
  assert.ok(out.length > 0);
  assert.notEqual(out, '2024-01-15 10:30:00');
});

test('formatSearchResultTimestamp: parses a string that already carries a Z suffix', () => {
  const out = formatSearchResultTimestamp({ metadataTimestamp: '2024-01-15T10:30:00Z' });
  assert.ok(out.length > 0);
});

test('formatSearchResultTimestamp: returns the raw string when it cannot be parsed', () => {
  assert.equal(
    formatSearchResultTimestamp({ metadataTimestamp: 'not a real date' }),
    'not a real date',
  );
});

// ─── same-year year omission ────────────────────────────────────────────────
// Use mid-June noon UTC so no timezone offset (±14h) can shift the calendar year.

test('formatSearchResultTimestamp: omits the year for a current-year timestamp', () => {
  const currentYear = new Date().getFullYear();
  const out = formatSearchResultTimestamp({
    createdAtTimestamp: Date.UTC(currentYear, 5, 15, 12),
  });
  assert.ok(out.length > 0);
  assert.equal(out.includes(String(currentYear)), false);
});

test('formatSearchResultTimestamp: includes the year for a past-year timestamp', () => {
  const out = formatSearchResultTimestamp({ createdAtTimestamp: Date.UTC(2000, 5, 15, 12) });
  assert.ok(out.includes('2000'));
});
