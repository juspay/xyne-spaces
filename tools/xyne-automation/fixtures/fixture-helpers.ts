import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { type StoredUser, testContext } from '@/tests/shared/runtime/test-context';

export function buildRandomSuffix(length = 6): string {
  const byteLength = Math.max(length, 1);

  return randomBytes(byteLength)
    .toString('base64url')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, length)
    .padEnd(length, '0');
}

export function getStoredUser(userAlias: string): StoredUser {
  const user = testContext.storedUsers.get(userAlias);
  assert.ok(user, `Expected stored user for alias "${userAlias}".`);
  return user;
}
