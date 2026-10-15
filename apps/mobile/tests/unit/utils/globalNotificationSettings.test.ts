import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotificationLevel } from '@xyne/shared';

import {
  hasGlobalNotificationSettingsCaughtUp,
  resolveDisplayedGlobalNotificationSettings,
} from '@/src/utils/globalNotificationSettings';

describe('resolveDisplayedGlobalNotificationSettings', () => {
  it('defaults to Mentions & DMs with both switches on when nothing is stored', () => {
    assert.deepEqual(resolveDisplayedGlobalNotificationSettings(null, null), {
      globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
      globalMobileNotificationLevel: NotificationLevel.MENTIONS_ONLY,
      threadReplyNotificationsEnabled: true,
      channelWideMentionsEnabled: true,
    });
  });

  it('prefers pending writes over the live row until Zero catches up', () => {
    const displayed = resolveDisplayedGlobalNotificationSettings(
      {
        globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
        globalMobileNotificationLevel: NotificationLevel.MENTIONS_ONLY,
        threadReplyNotificationsEnabled: true,
        channelWideMentionsEnabled: true,
      },
      {
        globalDesktopNotificationLevel: NotificationLevel.ALL,
        channelWideMentionsEnabled: false,
      },
    );

    assert.equal(displayed.globalDesktopNotificationLevel, NotificationLevel.ALL);
    assert.equal(displayed.globalMobileNotificationLevel, NotificationLevel.MENTIONS_ONLY);
    assert.equal(displayed.threadReplyNotificationsEnabled, true);
    assert.equal(displayed.channelWideMentionsEnabled, false);
  });
});

describe('hasGlobalNotificationSettingsCaughtUp', () => {
  it('is true only when every pending field matches the live row', () => {
    const pending = {
      globalDesktopNotificationLevel: NotificationLevel.ALL,
      channelWideMentionsEnabled: false,
    };

    assert.equal(
      hasGlobalNotificationSettingsCaughtUp(pending, {
        globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
        channelWideMentionsEnabled: false,
      }),
      false,
    );
    assert.equal(
      hasGlobalNotificationSettingsCaughtUp(pending, {
        globalDesktopNotificationLevel: NotificationLevel.ALL,
        channelWideMentionsEnabled: false,
      }),
      true,
    );
  });
});
