import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotificationLevel } from '@xyne/shared';

import {
  nextChannelOverrideLevel,
  resolveChannelNotificationViewState,
  toNotificationLevel,
} from '@/src/features/chat/channel-settings/channel-notifications';

const GLOBAL = {
  globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
  globalMobileNotificationLevel: NotificationLevel.ALL,
  threadReplyNotificationsEnabled: true,
  channelWideMentionsEnabled: true,
} as const;

describe('toNotificationLevel', () => {
  it('keeps known levels including THREADS_ONLY and NONE', () => {
    assert.equal(toNotificationLevel(NotificationLevel.ALL), NotificationLevel.ALL);
    assert.equal(
      toNotificationLevel(NotificationLevel.MENTIONS_ONLY),
      NotificationLevel.MENTIONS_ONLY,
    );
    assert.equal(
      toNotificationLevel(NotificationLevel.THREADS_ONLY),
      NotificationLevel.THREADS_ONLY,
    );
    assert.equal(toNotificationLevel(NotificationLevel.NONE), NotificationLevel.NONE);
  });

  it('returns null for inherit, missing, or unknown values', () => {
    assert.equal(toNotificationLevel(null), null);
    assert.equal(toNotificationLevel(undefined), null);
    assert.equal(toNotificationLevel('loud'), null);
  });
});

describe('nextChannelOverrideLevel', () => {
  it('writes null to inherit when turning the channel toggle on', () => {
    assert.equal(nextChannelOverrideLevel(true), null);
  });

  it('writes NONE when turning the channel toggle off', () => {
    assert.equal(nextChannelOverrideLevel(false), NotificationLevel.NONE);
  });
});

describe('resolveChannelNotificationViewState', () => {
  it('treats a null channel override as enabled inherit, not Everything', () => {
    const state = resolveChannelNotificationViewState({
      isGroupDM: false,
      stored: {
        desktopNotificationLevel: null,
        mobileNotificationLevel: null,
      },
      global: GLOBAL,
    });

    assert.equal(state.desktopEnabled, true);
    assert.equal(state.mobileEnabled, true);
    assert.equal(state.pickedDesktopLevel, NotificationLevel.MENTIONS_ONLY);
    assert.equal(state.pickedMobileLevel, NotificationLevel.ALL);
  });

  it('does not coerce THREADS_ONLY to Everything', () => {
    const state = resolveChannelNotificationViewState({
      isGroupDM: false,
      stored: {
        desktopNotificationLevel: NotificationLevel.THREADS_ONLY,
        mobileNotificationLevel: NotificationLevel.THREADS_ONLY,
      },
      global: GLOBAL,
    });

    assert.equal(state.pickedDesktopLevel, NotificationLevel.THREADS_ONLY);
    assert.equal(state.pickedMobileLevel, NotificationLevel.THREADS_ONLY);
  });

  it('mutes only when the channel override is NONE', () => {
    const state = resolveChannelNotificationViewState({
      isGroupDM: false,
      stored: {
        desktopNotificationLevel: NotificationLevel.NONE,
        mobileNotificationLevel: NotificationLevel.MENTIONS_ONLY,
      },
      global: GLOBAL,
    });

    assert.equal(state.desktopEnabled, false);
    assert.equal(state.mobileEnabled, true);
    assert.equal(state.splitDeliveryHint, 'Mobile only');
    assert.equal(state.pickedDesktopLevel, NotificationLevel.MENTIONS_ONLY);
  });

  it('defaults GROUP_DM inherit to Everything', () => {
    const state = resolveChannelNotificationViewState({
      isGroupDM: true,
      stored: {
        desktopNotificationLevel: null,
        mobileNotificationLevel: null,
      },
      global: GLOBAL,
    });

    assert.equal(state.pickedDesktopLevel, NotificationLevel.ALL);
    assert.equal(state.pickedMobileLevel, NotificationLevel.ALL);
  });

  it('hides thread and @channel switches when both devices are muted', () => {
    const state = resolveChannelNotificationViewState({
      isGroupDM: false,
      stored: {
        desktopNotificationLevel: NotificationLevel.NONE,
        mobileNotificationLevel: NotificationLevel.NONE,
        threadReplyNotificationsEnabled: true,
        channelWideMentionsEnabled: true,
      },
      global: GLOBAL,
    });

    assert.equal(state.displayedThreadReply, false);
    assert.equal(state.displayedChannelWideMentions, false);
  });

  it('inherits global boolean toggles until the channel overrides them', () => {
    const inherited = resolveChannelNotificationViewState({
      isGroupDM: false,
      stored: {},
      global: {
        ...GLOBAL,
        threadReplyNotificationsEnabled: false,
        channelWideMentionsEnabled: true,
      },
    });
    assert.equal(inherited.displayedThreadReply, false);
    assert.equal(inherited.displayedChannelWideMentions, true);

    const overridden = resolveChannelNotificationViewState({
      isGroupDM: false,
      stored: {
        threadReplyNotificationsEnabled: true,
        channelWideMentionsEnabled: false,
      },
      global: {
        ...GLOBAL,
        threadReplyNotificationsEnabled: false,
        channelWideMentionsEnabled: true,
      },
    });
    assert.equal(overridden.displayedThreadReply, true);
    assert.equal(overridden.displayedChannelWideMentions, false);
  });
});
