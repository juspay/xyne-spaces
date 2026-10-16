import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';

// The raw FCM message, re-exported under a friendly name so the rest of the
// service never imports firebase types directly (keeps swapping SDKs easy).
export type RawPushMessage = FirebaseMessagingTypes.RemoteMessage;

// Where a payload was received. Later steps will branch on this (e.g. only
// draw a banner in the background), so we track it from day one.
export type DeliveryContext = 'foreground' | 'background';

/**
 * One chat push, fully normalized. EVERYTHING downstream (store, display,
 * events) reads this shape — never raw FCM strings.
 */
export type ParsedMessage = {
  type: string; // FCM type, e.g. DIRECT_MESSAGE
  title: string; // tray title (channel name / sender name)
  rawBody: string; // message text WITHOUT sender prefix
  body: string; // message text WITH sender prefix when not a 1:1 DM
  channelId: string; // parent channel (or DM channel) — always present
  conversationId?: string; // thread root (threads) or message conversation (DM)
  threadId?: string; // set only when this is a thread message
  isThread: boolean; // true → reply/route to the thread, not the channel
  scopeType?: string; // DM | GROUP_DM | DEFAULT … (drives prefix + grouping)
  messageId?: string; // backend message id
  backendNotificationId?: string; // server notification id (for mark-as-read)
  senderId?: string;
  senderName?: string;
  senderPicture?: string;
  timestamp: number; // display timestamp
  /** Parent conversation cursor; distinct from the notification/message timestamp. */
  conversationCreatedAt?: number;
  notificationId: string; // notifee tray id = grouping slot (threadId or channelId)
  storeKey: string; // MMKV grouping key (notif_thread_* or notif_channel_*)
  rawData: Record<string, string>; // original FCM data (re-attached to the tray)
};

/** One message bubble persisted in a conversation's group. */
export type StoredMessage = {
  messageId?: string;
  text: string; // raw text, no sender prefix
  timestamp: number;
  person: { name: string; icon?: string };
  senderId?: string;
};

/** All bubbles currently stacked for one conversation. */
export type MessageGroup = {
  title: string;
  scopeType?: string;
  messages: StoredMessage[];
};

/** Where a reply should be sent. */
export type ReplyTarget =
  | { kind: 'thread'; channelId: string; conversationId: string }
  | { kind: 'channel'; channelId: string };

/** Flat string payload we attach to every notifee notification we draw. */
export type TrayData = Record<string, string>;

/** Where expo-router opens after a chat or ticket notification tap. */
export type ChatRouteTarget = {
  channelId?: string;
  threadId?: string;
  conversationId?: string;
  messageId?: string;
  createdAt?: string;
  scopeType?: string;
  ticketId?: string; // standalone TICKET_* taps and chat overlays open /ticket/[ticketId]
  /** Server FCM `notificationId` — log identity only, not used for routing. */
  notificationId?: string;
  /** FCM `type` — log identity only, not used for routing. */
  notificationType?: string;
  /** Raw FCM `data.metadata` JSON string — log identity only, not used for routing. */
  metadata?: string;
};
