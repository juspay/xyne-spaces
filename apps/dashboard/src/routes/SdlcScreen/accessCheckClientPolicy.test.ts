import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRequestAutomaticAccessCheck } from './accessCheckClientPolicy';

void test('requests checks only for missing or stale repository evidence', () => {
  assert.equal(shouldRequestAutomaticAccessCheck({ status: 'NOT_CHECKED' }), true);
  assert.equal(shouldRequestAutomaticAccessCheck({ status: 'STALE' }), true);
  assert.equal(shouldRequestAutomaticAccessCheck({ status: 'READY' }), false);
  assert.equal(shouldRequestAutomaticAccessCheck({ status: 'CHECKING' }), false);
});

void test('self-heals legacy public fallback evidence once', () => {
  assert.equal(
    shouldRequestAutomaticAccessCheck({
      status: 'READY',
      errorCode: 'CREDENTIAL_INVALID_PUBLIC_FALLBACK',
    }),
    true,
  );
});
