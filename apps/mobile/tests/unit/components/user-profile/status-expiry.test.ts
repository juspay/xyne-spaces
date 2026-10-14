import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateExpiryTime,
  deriveExpiryOption,
  EXPIRY_OPTIONS,
  normalizeExpiryOption,
} from '@/src/components/user-profile/status-expiry';

const CUSTOM = new Date(Date.now() + 2 * 86_400_000);

// ─── EXPIRY_OPTIONS ─────────────────────────────────────────────────────────

test('EXPIRY_OPTIONS: order and labels match the desktop list', () => {
  assert.deepEqual(
    EXPIRY_OPTIONS.map(option => [option.value, option.label]),
    [
      ['dont-clear', "Don't clear"],
      ['30min', '30 minutes'],
      ['1hour', '1 hour'],
      ['4hours', '4 hours'],
      ['today', 'Today'],
      ['week', 'This week'],
      ['custom', 'Custom'],
    ],
  );
});

// ─── calculateExpiryTime ────────────────────────────────────────────────────

test("calculateExpiryTime: 'dont-clear' never expires", () => {
  assert.equal(calculateExpiryTime('dont-clear', CUSTOM), null);
});

test("calculateExpiryTime: 'custom' returns the chosen instant exactly", () => {
  assert.equal(calculateExpiryTime('custom', CUSTOM), CUSTOM.getTime());
});

test('calculateExpiryTime: every non-dont-clear option resolves to a future number', () => {
  // Guards the exhaustive switch: a missing case would return undefined, which the Zero
  // mutator treats as "leave the field alone" rather than as a new expiry.
  for (const option of EXPIRY_OPTIONS) {
    if (option.value === 'dont-clear') continue;
    const result = calculateExpiryTime(option.value, CUSTOM);
    assert.equal(typeof result, 'number', `${option.value} should resolve to a number`);
    assert.ok((result as number) > Date.now(), `${option.value} should be in the future`);
  }
});

// ─── normalizeExpiryOption ──────────────────────────────────────────────────

test('normalizeExpiryOption: known ids pass through', () => {
  for (const option of EXPIRY_OPTIONS) {
    assert.equal(normalizeExpiryOption(option.value), option.value);
  }
});

test('normalizeExpiryOption: anything unrecognised falls back to today', () => {
  for (const value of ['nonsense', '', null, undefined, 42, {}, []]) {
    assert.equal(normalizeExpiryOption(value), 'today');
  }
});

// ─── deriveExpiryOption ─────────────────────────────────────────────────────

test('deriveExpiryOption: a missing expiry means never-clear', () => {
  assert.deepEqual(deriveExpiryOption(null), { option: 'dont-clear', customExpiryAt: null });
  assert.deepEqual(deriveExpiryOption(undefined), { option: 'dont-clear', customExpiryAt: null });
});

test('deriveExpiryOption: a stored instant round-trips losslessly as custom', () => {
  const ms = Date.now() + 5 * 86_400_000;
  const derived = deriveExpiryOption(ms);
  assert.equal(derived.option, 'custom');
  assert.equal(derived.customExpiryAt?.getTime(), ms);
  assert.equal(calculateExpiryTime(derived.option, derived.customExpiryAt as Date), ms);
});
