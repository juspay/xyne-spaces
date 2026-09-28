import test from 'node:test';
import assert from 'node:assert/strict';

import { addSlaHours, computeSlaDueDates } from '../dist/utils/slaCalculator.js';

// 2026-09-25 is a Friday, 2026-09-28 is the following Monday.
const utcPolicy = {
  businessHoursOnly: true,
  timezone: 'UTC',
  workdayStart: 9,
  workdayEnd: 18,
};

const due = (start, hours, policy = utcPolicy) =>
  addSlaHours(new Date(start), hours, policy).toISOString();

test('counts business hours within a single workday', () => {
  assert.equal(due('2026-09-28T10:00:00Z', 2), '2026-09-28T12:00:00.000Z');
});

test('rolls over to the next morning after workday end', () => {
  assert.equal(due('2026-09-28T17:00:00Z', 2), '2026-09-29T10:00:00.000Z');
});

test('starts counting on Monday for a Friday-evening start', () => {
  assert.equal(due('2026-09-25T19:00:00Z', 1), '2026-09-28T10:00:00.000Z');
});

test('continues on Monday when the window runs past Friday close', () => {
  assert.equal(due('2026-09-25T17:00:00Z', 2), '2026-09-28T10:00:00.000Z');
});

test('starts counting on Monday for a weekend start during daytime hours', () => {
  assert.equal(due('2026-09-26T10:00:00Z', 1), '2026-09-28T10:00:00.000Z');
  assert.equal(due('2026-09-27T20:00:00Z', 1), '2026-09-28T10:00:00.000Z');
});

test('starts counting on Monday for a weekend start before workday start', () => {
  assert.equal(due('2026-09-26T03:00:00Z', 1), '2026-09-28T10:00:00.000Z');
});

test('skips the weekend in a non-UTC timezone', () => {
  const istPolicy = { ...utcPolicy, timezone: 'Asia/Kolkata' };
  // Saturday 2026-09-26 12:00 IST -> Monday 2026-09-28 10:00 IST (04:30 UTC).
  assert.equal(due('2026-09-26T06:30:00Z', 1, istPolicy), '2026-09-28T04:30:00.000Z');
});

test('computeSlaDueDates applies business hours to both deadlines', () => {
  const { slaResponseDue, slaResolutionDue } = computeSlaDueDates(
    new Date('2026-09-26T10:00:00Z'),
    { ...utcPolicy, responseHours: 1, resolutionHours: 9 },
  );
  assert.equal(slaResponseDue?.toISOString(), '2026-09-28T10:00:00.000Z');
  assert.equal(slaResolutionDue?.toISOString(), '2026-09-28T18:00:00.000Z');
});

test('uses calendar hours when business hours are disabled', () => {
  const policy = { ...utcPolicy, businessHoursOnly: false };
  assert.equal(due('2026-09-26T10:00:00Z', 1, policy), '2026-09-26T11:00:00.000Z');
});
