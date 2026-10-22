import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidStyle,
  AndroidVisibility,
  type AndroidAction,
} from 'react-native-notify-kit';
import { Platform } from 'react-native';

import {
  ACTION_MARK_AS_READ,
  ACTION_REPLY,
  MESSAGE_CATEGORY_ID,
  MESSAGE_CHANNEL_ID,
  SILENT_CHANNEL_ID,
} from '../config';
import { formatBodyWithSender, parseMetadata, readNonEmptyString } from '../message/messageContext';
import { resolveNotificationAvatarUri } from './resolveNotificationAvatar';
import type {
  DeliveryContext,
  MessageGroup,
  ParsedMessage,
  RawPushMessage,
  StoredMessage,
  TrayData,
} from '../types';
import { ensureMessageChannelForSound } from './notificationSetup';
import { ensureNotificationSetup } from './notificationSetup';
import { readNotificationSoundPreference } from '../soundPreference';
import { iosSoundFor } from '../soundMetadata';

// Android action buttons attached to every chat notification.
const ANDROID_ACTIONS: AndroidAction[] = [
  { title: 'Reply', pressAction: { id: ACTION_REPLY }, input: true },
  { title: 'Mark as read', pressAction: { id: ACTION_MARK_AS_READ } },
];

const ANDROID_RICH_DISPLAY_TIMEOUT_MS = 4500;

// Public picture URLs pass through; protected storage paths are skipped for now
// (mTLS avatar fetching can be added later — kept out to keep step 2 lean).
function resolveAvatar(picture: string | undefined): string | undefined {
  if (!picture) return undefined;
  return /^(https?:|file:)/i.test(picture) ? picture : undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// The flat payload we bake onto the notification so tray events can re-read it
// without guessing. `_v4` marks it as "we drew this".
function buildTrayData(message: ParsedMessage): TrayData {
  return {
    ...message.rawData, // keep actionUrl/deeplink/metadata for navigation later
    _v4: 'true',
    type: message.type,
    channelId: message.channelId,
    conversationId: message.conversationId ?? '',
    threadId: message.threadId ?? '',
    isThreadReply: message.isThread ? 'true' : '',
    messageId: message.messageId ?? '',
    notificationId: message.backendNotificationId ?? '', // server id for mark-as-read
    scopeType: message.scopeType ?? '',
    ...(message.senderName ? { senderName: message.senderName } : {}),
  };
}

const REMINDER_THREAD_ID = 'reminders';

const getReminderMessageId = (data: Record<string, string>): string | undefined => {
  const metadata = parseMetadata(data);
  return (
    readNonEmptyString(metadata['messageId']) ??
    readNonEmptyString(data['messageId']) ??
    readNonEmptyString(data['relatedEntityId']) ??
    readNonEmptyString(metadata['relatedEntityId']) ??
    readNonEmptyString(metadata['entityId']) ??
    undefined
  );
};

const getReminderTitle = (data: Record<string, string>): string =>
  readNonEmptyString(data['msg_title']) ??
  readNonEmptyString(data['title']) ??
  readNonEmptyString(parseMetadata(data)['title']) ??
  'Reminder';

const getReminderBody = (data: Record<string, string>): string =>
  readNonEmptyString(data['msg_body']) ??
  readNonEmptyString(data['body']) ??
  readNonEmptyString(data['message']) ??
  readNonEmptyString(parseMetadata(data)['messagePreview']) ??
  'You asked to be reminded about this message.';

// Android MessagingStyle draw — one notification per conversation (same id → it
// updates in place and stacks bubbles → continuous grouping, req #2). `silent`
// routes it to the LOW-importance channel so edit/delete rewrites never re-alert.
type AndroidGroupInput = {
  notificationId: string;
  title: string;
  scopeType?: string;
  messages: StoredMessage[];
  trayData: TrayData;
  context: DeliveryContext;
  silent: boolean;
  fallbackBody?: string;
  channelIdOverride?: string;
};

async function drawAndroidGroup(input: AndroidGroupInput): Promise<void> {
  const { notificationId, title, scopeType, messages, trayData, context, silent } = input;
  const last = messages[messages.length - 1];
  // Collapsed line shows the sender prefix for non-DM (req #5).
  const lastBody = formatBodyWithSender(
    last?.text ?? input.fallbackBody ?? '',
    scopeType,
    last?.person.name,
  );
  // Skip remote avatars in the background / for silent rewrites so the banner is instant.
  const allowRemoteIcons = context !== 'background' && !silent;
  const largeIcon = allowRemoteIcons ? resolveAvatar(last?.person.icon) : undefined;
  const isGroup = scopeType !== 'DM';

  await notifee.displayNotification({
    id: notificationId,
    title,
    body: lastBody,
    data: trayData,
    android: {
      channelId: silent ? SILENT_CHANNEL_ID : (input.channelIdOverride ?? MESSAGE_CHANNEL_ID),
      smallIcon: 'notification_icon',
      category: AndroidCategory.MESSAGE,
      importance: silent ? AndroidImportance.LOW : AndroidImportance.HIGH,
      // Chat text is sensitive. PRIVATE plus the notify-kit patch shows a
      // generic "New message" on a secure lock screen; the sender and text
      // appear only after unlock.
      visibility: AndroidVisibility.PRIVATE,
      pressAction: { id: 'default' },
      actions: ANDROID_ACTIONS,
      ...(largeIcon ? { largeIcon } : {}),
      circularLargeIcon: true,
      timestamp: last?.timestamp ?? Date.now(),
      showTimestamp: true,
      // Quiet update when restacking an existing conversation or rewriting silently.
      ...(silent || messages.length > 1 ? { onlyAlertOnce: true } : {}),
      style: {
        type: AndroidStyle.MESSAGING,
        ...(isGroup ? { title } : {}), // group title shown only for non-DM
        group: isGroup, // MessagingStyle labels each line with its sender
        person: { name: 'You', important: true },
        messages: messages.map(m => {
          const icon = allowRemoteIcons ? resolveAvatar(m.person.icon) : undefined;
          return {
            text: m.text, // raw text; Android prefixes the sender itself
            timestamp: m.timestamp,
            person: icon ? { name: m.person.name, icon } : { name: m.person.name },
          };
        }),
      },
    },
  });
}

async function drawAndroidGroupWithTimeout(input: AndroidGroupInput): Promise<void> {
  const displayPromise = drawAndroidGroup(input);
  if (input.context !== 'background' || input.silent) {
    await displayPromise;
    return;
  }

  await withTimeout(
    displayPromise,
    ANDROID_RICH_DISPLAY_TIMEOUT_MS,
    'android messaging notification display',
  );
}

type AndroidSimpleInput = {
  notificationId: string;
  title: string;
  body: string;
  trayData: TrayData;
  channelId: string;
  timestamp: number;
};

async function drawAndroidSimpleNotification(input: AndroidSimpleInput): Promise<void> {
  await notifee.displayNotification({
    id: input.notificationId,
    title: input.title,
    body: input.body,
    data: input.trayData,
    android: {
      channelId: input.channelId,
      smallIcon: 'notification_icon',
      category: AndroidCategory.MESSAGE,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PRIVATE,
      pressAction: { id: 'default' },
      timestamp: input.timestamp,
      showTimestamp: true,
    },
  });
}

// iOS communication bubble draw — one per message, grouped by threadId. `silent`
// drops the sound so an edit rewrite slips in without re-alerting.
type IosBubbleInput = {
  notificationId: string;
  bubbleId: string;
  title: string;
  body: string;
  scopeType?: string;
  senderId?: string;
  senderName?: string;
  senderPicture?: string;
  trayData: TrayData;
  silent: boolean;
  soundOverride?: string;
};

async function drawIosBubble(input: IosBubbleInput): Promise<void> {
  // iOS communication notifications show the sender avatar like Messages. Public URLs
  // pass through; protected storage paths are fetched via mTLS and cached locally.
  const avatar = await resolveNotificationAvatarUri(input.senderId, input.senderPicture);
  const isGroup = input.scopeType !== 'DM';

  await notifee.displayNotification({
    id: input.bubbleId,
    title: input.title,
    body: input.body, // already prefixed for non-DM
    data: input.trayData,
    ios: {
      categoryId: MESSAGE_CATEGORY_ID,
      threadId: input.notificationId, // native stacking per conversation
      ...(input.silent
        ? { silent: true, interruptionLevel: 'passive' as const }
        : { sound: input.soundOverride ?? 'default' }),
      communicationInfo: {
        conversationId: input.notificationId,
        body: input.body,
        ...(isGroup ? { groupName: input.title } : {}),
        sender: {
          id: input.senderId ?? input.senderName ?? input.title,
          displayName: input.senderName || input.title,
          ...(avatar ? { avatar } : {}),
        },
      },
    },
  });
}

/**
 * Draw (or update) the tray notification for one chat push.
 * `group` is the stacked history for this conversation; when null we fall back
 * to just this message.
 */
export async function presentNotification(
  message: ParsedMessage,
  group: MessageGroup | null,
  context: DeliveryContext,
): Promise<void> {
  await ensureNotificationSetup();

  const messages: StoredMessage[] = group?.messages ?? [
    {
      text: message.rawBody,
      timestamp: message.timestamp,
      person: {
        name: message.senderName || message.title,
        ...(message.senderPicture ? { icon: message.senderPicture } : {}),
      },
      ...(message.messageId ? { messageId: message.messageId } : {}),
    },
  ];

  const title = group?.title || message.title;
  const scopeType = group?.scopeType ?? message.scopeType;
  const trayData = buildTrayData(message);
  const soundId = readNotificationSoundPreference();
  const displayedNotificationId =
    Platform.OS === 'ios'
      ? message.messageId?.trim() || `${message.notificationId}-${message.timestamp}`
      : message.notificationId;

  if (Platform.OS === 'ios') {
    await drawIosBubble({
      notificationId: message.notificationId,
      bubbleId: displayedNotificationId,
      title,
      body: message.body,
      ...(scopeType ? { scopeType } : {}),
      ...(message.senderId ? { senderId: message.senderId } : {}),
      ...(message.senderName ? { senderName: message.senderName } : {}),
      ...(message.senderPicture ? { senderPicture: message.senderPicture } : {}),
      trayData,
      soundOverride: iosSoundFor(soundId),
      silent: false,
    });
    return;
  }

  const channelIdOverride = await ensureMessageChannelForSound(soundId);
  const androidGroupInput: AndroidGroupInput = {
    notificationId: message.notificationId,
    title,
    ...(scopeType ? { scopeType } : {}),
    messages,
    trayData,
    context,
    channelIdOverride,
    silent: false,
    fallbackBody: message.rawBody,
  };

  try {
    await drawAndroidGroupWithTimeout(androidGroupInput);
  } catch {
    const last = messages[messages.length - 1];
    await drawAndroidSimpleNotification({
      notificationId: message.notificationId,
      title,
      body: formatBodyWithSender(last?.text ?? message.rawBody, scopeType, last?.person.name),
      trayData,
      channelId: channelIdOverride,
      timestamp: last?.timestamp ?? message.timestamp,
    });
  }
}

export type ReminderPresentationResult =
  | { outcome: 'displayed'; owner: 'app' | 'operating_system'; trayNotificationId: string }
  | { outcome: 'failed'; error: unknown };

export async function presentReminderNotification(
  data: Record<string, string>,
  message: RawPushMessage,
  context: DeliveryContext,
): Promise<ReminderPresentationResult> {
  const messageId = getReminderMessageId(data);
  const notificationId =
    data['notificationId']?.trim() ||
    data['relatedEntityId']?.trim() ||
    messageId ||
    `reminder-${Date.now()}`;
  const trayNotificationId = `reminder-${notificationId}`;

  const iosApnsAlreadyDisplayed =
    Platform.OS === 'ios' && context === 'background' && !!message.notification;
  if (iosApnsAlreadyDisplayed) {
    return {
      outcome: 'displayed',
      owner: 'operating_system',
      trayNotificationId,
    };
  }

  const title = getReminderTitle(data);
  const body = getReminderBody(data);
  const soundId = readNotificationSoundPreference();
  const trayData: TrayData = {
    ...data,
    _v4: 'true',
    notificationKind: 'reminder',
    ...(messageId ? { messageId } : {}),
  };

  try {
    await ensureNotificationSetup();

    if (Platform.OS === 'ios') {
      await notifee.displayNotification({
        id: trayNotificationId,
        title,
        body,
        data: trayData,
        ios: {
          threadId: REMINDER_THREAD_ID,
          sound: iosSoundFor(soundId),
        },
      });
    } else {
      const channelId = await ensureMessageChannelForSound(soundId);

      await notifee.displayNotification({
        id: trayNotificationId,
        title,
        body,
        data: trayData,
        android: {
          channelId,
          smallIcon: 'notification_icon',
          category: AndroidCategory.REMINDER,
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PRIVATE,
          pressAction: { id: 'default' },
          timestamp: Date.now(),
          showTimestamp: true,
        },
      });
    }

    return {
      outcome: 'displayed',
      owner: 'app',
      trayNotificationId,
    };
  } catch (error) {
    return { outcome: 'failed', error };
  }
}

// ── silent rewrites (edit/delete control signals) ─────────────────────────────

/** Android: rewrite a conversation's MessagingStyle banner in place, no sound. */
export async function presentSilentAndroidGroup(input: {
  notificationId: string;
  title: string;
  scopeType?: string;
  messages: StoredMessage[];
  trayData: TrayData;
}): Promise<void> {
  await ensureNotificationSetup();
  try {
    await drawAndroidGroup({ ...input, context: 'background', silent: true });
  } catch {
    // Silent rewrite failed; best-effort.
  }
}

/** iOS: redraw a single bubble with new content, no sound (edit rewrite). */
export async function presentSilentIosBubble(input: {
  notificationId: string;
  bubbleId: string;
  title: string;
  body: string;
  scopeType?: string;
  senderId?: string;
  senderName?: string;
  senderPicture?: string;
  trayData: TrayData;
}): Promise<void> {
  await ensureNotificationSetup();
  try {
    await drawIosBubble({ ...input, silent: true });
  } catch {
    // Silent rewrite failed; best-effort.
  }
}
