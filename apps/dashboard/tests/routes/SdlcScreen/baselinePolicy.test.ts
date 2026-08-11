import assert from 'node:assert/strict';
import test from 'node:test';
import { baselineApprovalAction } from '../../../src/routes/SdlcScreen/baselinePolicy.ts';

void test('requires first approval when no approval timestamp exists', () => {
  assert.equal(baselineApprovalAction({ lastEditedAt: 100 }), 'APPROVE');
});

void test('enables reapproval only after a content edit', () => {
  const approvedAt = '2026-08-05T07:00:00.000Z';
  assert.equal(
    baselineApprovalAction({ approvedAt, lastEditedAt: Date.parse(approvedAt) }),
    'UP_TO_DATE',
  );
  assert.equal(
    baselineApprovalAction({ approvedAt, lastEditedAt: Date.parse(approvedAt) + 1 }),
    'REAPPROVE',
  );
});
