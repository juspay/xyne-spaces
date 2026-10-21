import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAttachmentCacheRelativePath,
  buildAttachmentInflightKey,
  buildAttachmentResourceUrl,
  createAttachmentCacheScope,
  encodeCachePathSegment,
  isSameAttachmentCacheScope,
  isValidAttachmentId,
} from '@/src/hooks/attachmentCachePolicy';

const NONCE_A = '11111111-1111-4111-8111-111111111111';
const NONCE_B = '22222222-2222-4222-8222-222222222222';

describe('attachment cache session isolation', () => {
  it('refuses a cache scope without user, workspace, nonce, or a valid generation', () => {
    assert.equal(createAttachmentCacheScope('', 'ws-1', 1, NONCE_A), null);
    assert.equal(createAttachmentCacheScope('user-1', '  ', 1, NONCE_A), null);
    assert.equal(createAttachmentCacheScope('user-1', 'ws-1', -1, NONCE_A), null);
    assert.equal(createAttachmentCacheScope('user-1', 'ws-1', 1.5, NONCE_A), null);
    assert.equal(createAttachmentCacheScope('user-1', 'ws-1', 1, 'not-a-nonce'), null);
    assert.deepEqual(createAttachmentCacheScope(' user-1 ', ' ws-1 ', 0, NONCE_A), {
      userId: 'user-1',
      workspaceId: 'ws-1',
      generation: 0,
      cacheNonce: NONCE_A,
    });
  });

  it('rejects unsafe attachment ids instead of collapsing them', () => {
    assert.equal(isValidAttachmentId('att-1'), true);
    assert.equal(isValidAttachmentId('a/b'), false);
    assert.equal(isValidAttachmentId('a_b'), true);
    assert.equal(isValidAttachmentId('../secret'), false);
    assert.equal(isValidAttachmentId('.'), false);
    assert.equal(isValidAttachmentId('..'), false);
    assert.equal(isValidAttachmentId('id with space'), false);
    assert.equal(
      buildAttachmentCacheRelativePath(
        createAttachmentCacheScope('user-1', 'ws-1', 1, NONCE_A)!,
        'a/b',
        'invoice.pdf',
      ),
      null,
    );
    assert.equal(createAttachmentCacheScope('.', 'ws-1', 1, NONCE_A), null);
    assert.equal(createAttachmentCacheScope('user-1', '..', 1, NONCE_A), null);
    assert.equal(
      buildAttachmentCacheRelativePath(
        createAttachmentCacheScope('user-1', 'ws-1', 1, NONCE_A)!,
        'att-1',
        '..',
      ),
      null,
    );
  });

  it('encodes cache path segments without colliding distinct identities', () => {
    assert.notEqual(encodeCachePathSegment('user/a'), encodeCachePathSegment('user_a'));
    assert.notEqual(encodeCachePathSegment('ws:1'), encodeCachePathSegment('ws_1'));

    const userA = createAttachmentCacheScope('user/a', 'ws-1', 3, NONCE_A);
    const userB = createAttachmentCacheScope('user_a', 'ws-1', 3, NONCE_A);
    assert.ok(userA && userB);
    assert.notEqual(
      buildAttachmentCacheRelativePath(userA, 'att-1', 'invoice.pdf'),
      buildAttachmentCacheRelativePath(userB, 'att-1', 'invoice.pdf'),
    );
  });

  it('keeps user, workspace, nonce, and generation in cache paths and in-flight keys', () => {
    const userA = createAttachmentCacheScope('user-a', 'ws-1', 3, NONCE_A);
    const userB = createAttachmentCacheScope('user-b', 'ws-1', 3, NONCE_A);
    const nextSession = createAttachmentCacheScope('user-a', 'ws-1', 4, NONCE_A);
    const rotatedNonce = createAttachmentCacheScope('user-a', 'ws-1', 3, NONCE_B);
    assert.ok(userA && userB && nextSession && rotatedNonce);

    assert.equal(
      buildAttachmentCacheRelativePath(userA, 'att-1', 'invoice.pdf'),
      `user-a/ws-1/${NONCE_A}/g3/att-1-invoice.pdf`,
    );
    assert.notEqual(
      buildAttachmentCacheRelativePath(userA, 'att-1', 'invoice.pdf'),
      buildAttachmentCacheRelativePath(userB, 'att-1', 'invoice.pdf'),
    );
    assert.notEqual(
      buildAttachmentCacheRelativePath(userA, 'att-1', 'invoice.pdf'),
      buildAttachmentCacheRelativePath(nextSession, 'att-1', 'invoice.pdf'),
    );
    assert.notEqual(
      buildAttachmentCacheRelativePath(userA, 'att-1', 'invoice.pdf'),
      buildAttachmentCacheRelativePath(rotatedNonce, 'att-1', 'invoice.pdf'),
    );

    const inflightA = buildAttachmentInflightKey(userA, 'att-1', 'invoice.pdf');
    const collidingUser = createAttachmentCacheScope('user-a:ws-1', 'extra', 3, NONCE_A);
    assert.ok(collidingUser);
    assert.notEqual(inflightA, buildAttachmentInflightKey(collidingUser, 'att-1', 'invoice.pdf'));
    assert.notEqual(inflightA, buildAttachmentInflightKey(userB, 'att-1', 'invoice.pdf'));
    assert.equal(JSON.parse(inflightA)[4], 'att-1');
  });

  it('treats a replaced account as a different cache scope', () => {
    const beforeLogout = createAttachmentCacheScope('user-a', 'ws-1', 8, NONCE_A);
    const afterLogout = createAttachmentCacheScope('user-b', 'ws-2', 9, NONCE_B);
    assert.equal(isSameAttachmentCacheScope(beforeLogout, afterLogout), false);
    assert.equal(isSameAttachmentCacheScope(beforeLogout, beforeLogout), true);
    assert.equal(isSameAttachmentCacheScope(beforeLogout, null), false);
  });

  it('encodes attachment ids in resource URLs and rejects unsafe ids', () => {
    assert.equal(
      buildAttachmentResourceUrl('https://api.example', 'att-1', 'download'),
      'https://api.example/attachments/att-1/download',
    );
    assert.throws(() => buildAttachmentResourceUrl('https://api.example', 'att/1', 'download'));
    assert.throws(() => buildAttachmentResourceUrl('https://api.example', '../x', 'stream'));
  });
});
