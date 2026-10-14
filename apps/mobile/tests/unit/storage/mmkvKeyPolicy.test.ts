import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isHandoffKey,
  isLegacyAuthHandoffKey,
  isSharedCacheImportKey,
} from '@/src/storage/mmkv/keyPolicy';

describe('mmkv keyPolicy', () => {
  it('routes non-secret NSE/heartbeat/settings keys to the App Group handoff store', () => {
    assert.equal(isHandoffKey('@lotus_user_id'), true);
    assert.equal(isHandoffKey('@lotus_user_cache'), true);
    assert.equal(isHandoffKey('lotus_auth_token'), false);
    assert.equal(isLegacyAuthHandoffKey('lotus_auth_token'), true);
    assert.equal(isHandoffKey('xyne-global:userId'), true);
    assert.equal(isHandoffKey('xyne-global:schemaVersion'), true);
    assert.equal(isHandoffKey('xyne-global:workspaceId'), true);
    assert.equal(isHandoffKey('xyne-global:authToken'), false);
    assert.equal(isLegacyAuthHandoffKey('xyne-global:authToken'), true);
    assert.equal(isHandoffKey('xyne-global:notificationSoundId'), true);
    assert.equal(isHandoffKey('@lotus_zero_connected_at'), true);
    assert.equal(isHandoffKey('settings:v1'), true);
    assert.equal(isHandoffKey('lotus_auth_token_secure_store_migration'), false);
    assert.equal(isHandoffKey('lotus_auth_token_signed_out'), true);
    assert.equal(isHandoffKey('@notif_v3_group:user-1:notif_channel'), true);
    assert.equal(isHandoffKey('@notif_v3_sos_alerts:pending'), true);
    assert.equal(isHandoffKey('@notif_v3_sos_alerts:user-1'), true);
  });

  it('does not treat query-cache and shadow blobs as handoff keys', () => {
    assert.equal(isHandoffKey('xyne-state-machine:user:chan:abc'), false);
    assert.equal(isHandoffKey('warm_shadow:getUsersV2'), false);
    assert.equal(isHandoffKey('@lotus_activity_rows:ws'), false);
    assert.equal(isHandoffKey('@notif_v3_pending_nav'), false);
    assert.equal(isHandoffKey('xyne-global:warmCacheDirty'), false);
  });

  it('marks leftover NSE cache prefixes for foreground import cleanup', () => {
    assert.equal(isSharedCacheImportKey('xyne-state-machine:user:chan:abc'), true);
    assert.equal(isSharedCacheImportKey('warm_shadow:getUsersV2'), true);
    assert.equal(isSharedCacheImportKey('@lotus_activity_rows:ws'), true);
    assert.equal(isSharedCacheImportKey('@lotus_channel_messages:1'), true);
    assert.equal(isSharedCacheImportKey('@lotus_thread_messages:1'), true);
    assert.equal(isSharedCacheImportKey('@lotus_user_id'), false);
    assert.equal(isSharedCacheImportKey('@notif_v3_group:user-1:x'), false);
    assert.equal(isSharedCacheImportKey('@notif_v3_sos_alerts:pending'), false);
  });
});
