import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose (see agentCardFlowSchema.test.mjs).
import { captureNeedsRedo, isRecordingRepairReason } from '../dist/recording/manifest.js';

const base = {
  version: 2,
  callId: 'call',
  captureId: '00000000-0000-4000-8000-000000000000',
  startedAt: 0,
  endedAt: 1,
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 48_000,
  offlineAtStart: false,
  hadOutage: false,
  byteLength: 10,
  completed: true,
};

test('a fully online capture needs no redo', () => {
  assert.equal(captureNeedsRedo(base), false);
});

test('an outage, an offline start, or an owner request each trigger the redo', () => {
  assert.equal(captureNeedsRedo({ ...base, hadOutage: true }), true);
  assert.equal(captureNeedsRedo({ ...base, offlineAtStart: true }), true);
  assert.equal(captureNeedsRedo({ ...base, redoRequestedByUser: true }), true);
  assert.equal(captureNeedsRedo({ ...base, redoRequestedByUser: false }), false);
});

test('user_requested is a known repair reason', () => {
  assert.equal(isRecordingRepairReason('user_requested'), true);
  assert.equal(isRecordingRepairReason('nope'), false);
});
