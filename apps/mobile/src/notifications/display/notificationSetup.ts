import notifee, { AndroidImportance, AndroidVisibility } from 'react-native-notify-kit';
import { Platform } from 'react-native';

import { lotusStorage } from '@/src/services/localStorage';
import {
  ACTION_MARK_AS_READ,
  ACTION_REPLY,
  ACTION_SOS_ACKNOWLEDGE,
  CHANNELS_READY_KEY,
  MESSAGE_CATEGORY_ID,
  MESSAGE_CHANNEL_ID,
  SILENT_CHANNEL_ID,
  SOS_ALERT_CATEGORY_ID,
  SOS_ALERT_CHANNEL_ID,
  SOS_ALERT_NOTIFICATION_SOUND_ID,
} from '../config';

import { androidChannelIdFor, type NotificationSoundId } from '../soundMetadata';

const PER_SOUND_CHANNEL_READY_PREFIX = '@notif_v3_ch_ready__';
const perProcessReady = new Set<string>();

// Skip the native calls once per process after the first successful setup.
let setupDoneInProcess = false;

// Android: the loud chat channel + a silent one used for edit/delete rewrites.
async function ensureAndroidChannel(): Promise<void> {
  if (lotusStorage.getBoolean(CHANNELS_READY_KEY)) return;

  await notifee.createChannel({
    id: MESSAGE_CHANNEL_ID,
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    // Chat notifications are PRIVATE with a generic lock-screen placeholder
    // (patches/react-native-notify-kit). The channel matches, so existing
    // channel settings are not reset or changed.
    visibility: AndroidVisibility.PRIVATE,
    vibration: true,
    sound: 'default',
  });

  // Silent channel: LOW importance, no sound/vibration. Rewriting a banner on
  // this channel updates it in place without buzzing the user again.
  await notifee.createChannel({
    id: SILENT_CHANNEL_ID,
    name: 'Silent updates',
    importance: AndroidImportance.LOW,
    visibility: AndroidVisibility.PRIVATE,
    vibration: false,
  });

  lotusStorage.set(CHANNELS_READY_KEY, true);
}

// Android: dedicated high-importance channel for SOS alerts. Android owns the
// channel lifecycle, so its current state must be checked instead of trusting a
// persistent app flag (channels can be deleted while app storage survives).
export async function ensureSosAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const existingChannel = await notifee.getChannel(SOS_ALERT_CHANNEL_ID);
  if (existingChannel) {
    return;
  }

  await notifee.createChannel({
    id: SOS_ALERT_CHANNEL_ID,
    name: 'SOS alerts',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    vibration: true,
    sound: SOS_ALERT_NOTIFICATION_SOUND_ID,
  });

  // createChannel resolving only means the bridge accepted the call. Confirm
  // that Android retained it before an SOS is allowed to use the channel.
  const createdChannel = await notifee.getChannel(SOS_ALERT_CHANNEL_ID);
  const androidApiLevel = Number(Platform.Version);
  if (!createdChannel && androidApiLevel >= 26) {
    throw new Error(`Android did not retain notification channel ${SOS_ALERT_CHANNEL_ID}`);
  }
}

// iOS: register chat quick actions and SOS quick actions once.
async function ensureIosCategories(): Promise<void> {
  await notifee.setNotificationCategories([
    {
      id: MESSAGE_CATEGORY_ID,
      actions: [
        {
          id: ACTION_REPLY,
          title: 'Reply',
          input: { placeholderText: 'Send a message…', buttonText: 'Send' },
        },
        { id: ACTION_MARK_AS_READ, title: 'Mark as read' },
      ],
      // When iOS previews are disabled, never substitute the sender or body
      // into the lock-screen placeholder.
      hiddenPreviewsShowTitle: false,
      hiddenPreviewsShowSubtitle: false,
      hiddenPreviewsBodyPlaceholder: 'New Xyne Spaces message',
    },
    {
      id: SOS_ALERT_CATEGORY_ID,
      actions: [{ id: ACTION_SOS_ACKNOWLEDGE, title: 'Acknowledge', destructive: true }],
    },
  ]);
}

// Idempotent: prepare whatever the current platform needs before displaying.
export async function ensureNotificationSetup(): Promise<void> {
  if (setupDoneInProcess) return;
  try {
    if (Platform.OS === 'android') {
      await ensureAndroidChannel();
      await ensureSosAndroidChannel();
    } else if (Platform.OS === 'ios') {
      await ensureIosCategories();
    }
    setupDoneInProcess = true;
  } catch {
    // Setup failed; display path remains best-effort.
  }
}

/**
 * Idempotently create a HIGH-importance channel for a custom sound and return
 * its id. For `'default'` returns the existing `MESSAGE_CHANNEL_ID` (no work).
 * iOS: no-op, returns the platform-default channel id (unused on iOS).
 */
export async function ensureMessageChannelForSound(soundId: NotificationSoundId): Promise<string> {
  if (Platform.OS !== 'android') return MESSAGE_CHANNEL_ID;
  if (soundId === 'default') {
    await ensureAndroidChannel(); // existing default-sound channel
    return MESSAGE_CHANNEL_ID;
  }

  const channelId = androidChannelIdFor(soundId, MESSAGE_CHANNEL_ID);
  if (perProcessReady.has(channelId)) return channelId;

  const readyKey = `${PER_SOUND_CHANNEL_READY_PREFIX}${soundId}`;
  if (lotusStorage.getBoolean(readyKey)) {
    perProcessReady.add(channelId);
    return channelId;
  }

  await notifee.createChannel({
    id: channelId,
    name: `Messages (${soundId})`,
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PRIVATE,
    vibration: true,
    sound: soundId,
  });

  lotusStorage.set(readyKey, true);
  perProcessReady.add(channelId);
  return channelId;
}
