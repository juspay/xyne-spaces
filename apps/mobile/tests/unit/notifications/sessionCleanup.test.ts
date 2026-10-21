import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getUserNotificationStorageKeys } from '@/src/notifications/notificationStorageKeys';

describe('notification session cleanup', () => {
  it('selects user-scoped notification handoff keys without deleting unrelated state', () => {
    assert.deepEqual(
      getUserNotificationStorageKeys([
        '@notif_v3_group:user-a:notif_channel_1',
        '@notif_v3_sos_alerts:user-a',
        '@notif_v3_sos_alerts:pending',
        '@notif_v3_pending_nav',
        'xyne-global:authToken',
      ]),
      [
        '@notif_v3_group:user-a:notif_channel_1',
        '@notif_v3_sos_alerts:user-a',
        '@notif_v3_sos_alerts:pending',
      ],
    );
  });
});
