import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  endOfToday,
  endOfWeek,
  initialCustomTime,
  mergeDatePart,
  mergeTimePart,
  resolveTimeSelection,
} from '@/src/utils/timeSelection';

// Relative offsets keep these deterministic without stubbing the clock.
const TOLERANCE_MS = 5_000;
const IGNORED_CUSTOM = new Date(Date.now() + 86_400_000);

// ─── resolveTimeSelection ───────────────────────────────────────────────────

test('resolveTimeSelection: relative presets offset from now', () => {
  const cases: [Parameters<typeof resolveTimeSelection>[0], number][] = [
    ['30min', 30 * 60 * 1000],
    ['1hour', 60 * 60 * 1000],
    ['4hours', 4 * 60 * 60 * 1000],
  ];
  for (const [option, offset] of cases) {
    const actual = resolveTimeSelection(option, IGNORED_CUSTOM);
    assert.ok(
      Math.abs(actual - (Date.now() + offset)) < TOLERANCE_MS,
      `${option} should land ~${offset}ms out, got ${actual}`,
    );
  }
});

test("resolveTimeSelection: 'today' is the end of the local day", () => {
  const result = new Date(resolveTimeSelection('today', IGNORED_CUSTOM));
  assert.equal(result.getHours(), 23);
  assert.equal(result.getMinutes(), 59);
  assert.equal(result.getSeconds(), 59);
  assert.equal(result.getMilliseconds(), 999);
  assert.equal(result.getTime(), endOfToday().getTime());
});

test("resolveTimeSelection: 'week' lands on the upcoming Sunday, end of day", () => {
  const result = new Date(resolveTimeSelection('week', IGNORED_CUSTOM));
  assert.equal(result.getDay(), 0, 'should be a Sunday');
  assert.equal(result.getHours(), 23);
  assert.equal(result.getMilliseconds(), 999);
  assert.ok(result.getTime() >= endOfToday().getTime());
  assert.equal(result.getTime(), endOfWeek().getTime());
});

test("resolveTimeSelection: 'custom' returns the supplied instant exactly", () => {
  const chosen = new Date(Date.now() + 3 * 86_400_000);
  assert.equal(resolveTimeSelection('custom', chosen), chosen.getTime());
});

// ─── initialCustomTime ──────────────────────────────────────────────────────

test('initialCustomTime: always in the future, even late at night', () => {
  // The rollover branch: end-of-today has already passed in the final ms of the day.
  assert.ok(initialCustomTime().getTime() > Date.now());
});

// ─── mergeDatePart / mergeTimePart ──────────────────────────────────────────

test('mergeDatePart: takes y/m/d from selected, keeps h/m from current', () => {
  const current = new Date(2026, 0, 5, 14, 30, 0, 0);
  const selected = new Date(2026, 7, 20, 3, 3, 3, 3);
  const merged = mergeDatePart(current, selected);

  assert.equal(merged.getFullYear(), 2026);
  assert.equal(merged.getMonth(), 7);
  assert.equal(merged.getDate(), 20);
  assert.equal(merged.getHours(), 14);
  assert.equal(merged.getMinutes(), 30);
});

test('mergeTimePart: takes h/m from selected, keeps the date, zeroes seconds and ms', () => {
  const current = new Date(2026, 0, 5, 14, 30, 45, 678);
  const selected = new Date(2020, 5, 1, 9, 15, 59, 999);
  const merged = mergeTimePart(current, selected);

  assert.equal(merged.getFullYear(), 2026);
  assert.equal(merged.getMonth(), 0);
  assert.equal(merged.getDate(), 5);
  assert.equal(merged.getHours(), 9);
  assert.equal(merged.getMinutes(), 15);
  assert.equal(merged.getSeconds(), 0);
  assert.equal(merged.getMilliseconds(), 0);
});
