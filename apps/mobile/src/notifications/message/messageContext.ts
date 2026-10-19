import {
  CALL_NOTIFICATION_TYPES,
  CONTROL_NOTIFICATION_TYPES,
  MESSAGE_NOTIFICATION_TYPES,
  isTicketNotificationType,
} from '../notificationTypeSets';
import type { ChatRouteTarget, ParsedMessage, ReplyTarget } from '../types';

// ── tiny readers ──────────────────────────────────────────────────────────────

// Returns the trimmed string, or null when empty/not a string.
export function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function flattenNestedData(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = raw['data'];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return {
      ...flattenNestedData(nested as Record<string, unknown>),
      ...raw,
    };
  }
  return raw;
}

// Coerces any record (FCM data or notifee tray data) to plain strings.
// iOS APNS tray events can carry nested payloads and object-valued metadata.
export function normalizeData(data: Record<string, unknown> | undefined): Record<string, string> {
  if (!data) return {};
  const flattened = flattenNestedData(data);
  return Object.fromEntries(
    Object.entries(flattened).map(([k, v]) => {
      if (v === null || v === undefined) return [k, ''];
      if (typeof v === 'string') return [k, v];
      if (typeof v === 'number' || typeof v === 'boolean') return [k, String(v)];
      if (k === 'metadata' && typeof v === 'object' && !Array.isArray(v)) {
        return [k, JSON.stringify(v)];
      }
      if (typeof v === 'object') return [k, JSON.stringify(v)];
      return [k, String(v)];
    }),
  );
}

// The backend ships a JSON blob under `metadata`. Parse it defensively.
export function parseMetadata(data: Record<string, string>): Record<string, unknown> {
  const raw = data['metadata'];
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // corrupt metadata → treat as empty
  }
  return {};
}

// ── thread detection ──────────────────────────────────────────────────────────

// thread deep-links look like /chat/{channelId}/{conversationId}; main/DM don't.
function isThreadFromRoutePath(
  actionUrl: string | null,
  deeplink: string | null,
  channelId: string,
  conversationId: string | undefined,
): boolean {
  if (!conversationId) return false;
  const raw = actionUrl ?? deeplink;
  if (!raw) return false;
  const path = raw.split('#')[0] ?? ''; // drop the #origin=… hash
  return path.includes(`/${channelId}/${conversationId}`);
}

function readConversationRecord(
  metadata: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const conversation = metadata['conversation'];
  if (!conversation || typeof conversation !== 'object' || Array.isArray(conversation)) {
    return undefined;
  }
  return conversation as Record<string, unknown>;
}

// Single source of truth for "is this a thread message?".
function deriveIsThread(
  data: Record<string, string>,
  metadata: Record<string, unknown>,
  channelId: string,
  conversationId: string | undefined,
  scopeType: string | undefined,
  options: { allowMentionConversationFallback?: boolean } = {},
): boolean {
  const type = readNonEmptyString(data['type']) ?? '';
  if (type === 'THREAD_REPLY' || type === 'THREAD_MENTION') return true;

  const category = readNonEmptyString(data['category']) ?? readNonEmptyString(metadata['category']);
  if (category === 'THREAD_REPLY' || category === 'THREAD_MENTION') return true;

  if (metadata['isThreadReply'] === true || metadata['isThreadReply'] === 'true') return true;
  if (data['isThreadReply'] === 'true') return true;

  const messageType =
    readNonEmptyString(data['messageType']) ?? readNonEmptyString(metadata['messageType']);
  if (messageType === 'thread_reply' || messageType === 'thread_mention') return true;

  if (
    isThreadFromRoutePath(
      readNonEmptyString(data['actionUrl']),
      readNonEmptyString(data['deeplink']),
      channelId,
      conversationId,
    )
  ) {
    return true;
  }

  // Main-channel @mentions still carry conversationId; only treat as thread when the
  // deep-link path includes /chat/{channelId}/{conversationId} (matches v3).
  if (
    (options.allowMentionConversationFallback ?? true) &&
    type === 'MENTION' &&
    conversationId &&
    scopeType !== 'DM'
  ) {
    return true;
  }

  return false;
}

// Resolve the stable tray/MMKV slot. Main #channel posts carry a unique conversationId
// per message — they must always group by channelId, never by conversationId.
function resolveGroupingSlot(params: {
  type: string;
  isThread: boolean;
  channelId: string;
  conversationId: string | undefined;
  explicitThreadId: string | null;
}): { isThread: boolean; notificationId: string; storeKey: string } {
  const { type, channelId, conversationId, explicitThreadId } = params;
  let isThread = params.isThread;

  // Backend only emits CHANNEL_MESSAGE for main-channel feed posts (not thread replies).
  if (type === 'CHANNEL_MESSAGE') {
    isThread = false;
  }

  const threadId = isThread ? (explicitThreadId ?? conversationId) : undefined;
  const notificationId = threadId ?? channelId;
  const storeKey =
    isThread && conversationId ? `notif_thread_${conversationId}` : `notif_channel_${channelId}`;

  return { isThread, notificationId, storeKey };
}

// ── body formatting (req #5) ──────────────────────────────────────────────────

// Prefix the sender name for everything except a 1:1 DM.
export function formatBodyWithSender(
  rawBody: string,
  scopeType: string | undefined,
  senderName: string | undefined,
): string {
  if (!rawBody) return '';
  if (scopeType === 'DM' || !senderName) return rawBody;
  const prefix = `${senderName}: `;
  return rawBody.startsWith(prefix) ? rawBody : `${prefix}${rawBody}`;
}

// ── timestamp ─────────────────────────────────────────────────────────────────

function readNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(readNonEmptyString(value));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function resolveTimestamp(data: Record<string, string>, metadata: Record<string, unknown>): number {
  const conversation = metadata['conversation'];
  const convTs =
    conversation && typeof conversation === 'object' && !Array.isArray(conversation)
      ? (readNumber((conversation as Record<string, unknown>)['lastActivityAt']) ??
        readNumber((conversation as Record<string, unknown>)['createdAt']))
      : undefined;

  return (
    readNumber(metadata['timestamp']) ??
    readNumber(data['timestamp']) ??
    readNumber(metadata['createdAt']) ??
    convTs ??
    Date.now()
  );
}

function resolveConversationCreatedAt(metadata: Record<string, unknown>): number | undefined {
  const conversation = metadata['conversation'];
  if (!conversation || typeof conversation !== 'object' || Array.isArray(conversation)) {
    return undefined;
  }
  return readNumber((conversation as Record<string, unknown>)['createdAt']);
}

function resolveMessageId(
  data: Record<string, string>,
  metadata: Record<string, unknown>,
): string | undefined {
  const relatedEntityType =
    readNonEmptyString(data['relatedEntityType']) ??
    readNonEmptyString(metadata['relatedEntityType']);
  const relatedMessageId =
    !relatedEntityType || relatedEntityType.toUpperCase() === 'MESSAGE'
      ? (readNonEmptyString(data['relatedEntityId']) ??
        readNonEmptyString(metadata['relatedEntityId']))
      : undefined;
  const directMessageId = readNonEmptyString(data['messageId']);
  const metadataMessageId = readNonEmptyString(metadata['messageId']);

  // A tray payload has already been normalized from the notification that was
  // displayed, so its top-level messageId is the exact tapped message. Raw FCM
  // payloads use relatedEntityId for the message identity.
  return (
    (data['_v4'] === 'true'
      ? (directMessageId ?? relatedMessageId ?? metadataMessageId)
      : (relatedMessageId ?? metadataMessageId ?? directMessageId)) ?? undefined
  );
}

// ── the core extractor ────────────────────────────────────────────────────────

/**
 * Normalize Notifee tray payloads for action events (v3 `normalizeTrayDataForEvent` parity).
 * APNS-delivered notifications only carry raw FCM keys — pre-bake `_v4` + `isThreadReply`
 * so reply/mark-read routing matches notifications we drew ourselves.
 */
export function prepareTrayDataForEvent(
  raw: Record<string, unknown> | undefined,
): Record<string, string> | null {
  const data = normalizeData(raw);
  const type = readNonEmptyString(data['type']) ?? '';
  if (!type || !MESSAGE_NOTIFICATION_TYPES.has(type)) return null;
  if (data['_v4'] === 'true') return data;

  const metadata = parseMetadata(data);
  const channelId =
    readNonEmptyString(data['channelId']) ?? readNonEmptyString(metadata['channelId']);
  const explicitThreadId =
    readNonEmptyString(data['threadId']) ?? readNonEmptyString(metadata['threadId']) ?? undefined;
  const conversationId =
    readNonEmptyString(data['conversationId']) ??
    readNonEmptyString(metadata['conversationId']) ??
    explicitThreadId ??
    undefined;
  const scopeType =
    readNonEmptyString(data['scopeType']) ?? readNonEmptyString(metadata['scopeType']) ?? undefined;
  const messageId = resolveMessageId(data, metadata);
  const backendNotificationId = readNonEmptyString(data['notificationId']);

  const isThread =
    deriveIsThread(data, metadata, channelId ?? '', conversationId, scopeType, {
      allowMentionConversationFallback: false,
    }) ||
    (channelId
      ? isThreadFromRoutePath(
          readNonEmptyString(data['actionUrl']),
          readNonEmptyString(data['deeplink']),
          channelId,
          conversationId,
        )
      : false);
  const normalizedThreadId =
    isThread && (explicitThreadId ?? conversationId) ? (explicitThreadId ?? conversationId) : null;

  return {
    ...data,
    ...(channelId ? { channelId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(normalizedThreadId ? { threadId: normalizedThreadId } : {}),
    ...(scopeType ? { scopeType } : {}),
    ...(messageId ? { messageId } : {}),
    ...(backendNotificationId ? { notificationId: backendNotificationId } : {}),
    ...(isThread ? { isThreadReply: 'true' } : {}),
    _v4: 'true',
  };
}

/**
 * Turns an FCM data record OR a notifee tray-data record into a ParsedMessage.
 * Returns null for non-chat payloads (calls, control signals, unknown types) so
 * callers can simply `if (!parsed) return;`.
 */
export function extractMessageContext(data: Record<string, string>): ParsedMessage | null {
  const type = readNonEmptyString(data['type']) ?? '';
  if (!type) return null;
  if (CALL_NOTIFICATION_TYPES.has(type)) return null;
  if (!MESSAGE_NOTIFICATION_TYPES.has(type)) return null;

  const metadata = parseMetadata(data);
  const conversationRecord = readConversationRecord(metadata);

  // Prefer metadata.channelId (authoritative from backend). Top-level data.channelId can
  // be stale/wrong on some delivery paths; relatedEntityId is the messageId, not channelId.
  const channelId =
    readNonEmptyString(metadata['channelId']) ??
    readNonEmptyString(data['channelId']) ??
    readNonEmptyString(conversationRecord?.['channelId']);
  if (!channelId) return null;

  const explicitThreadId =
    readNonEmptyString(data['threadId']) ?? readNonEmptyString(metadata['threadId']);
  const conversationId =
    readNonEmptyString(data['conversationId']) ??
    readNonEmptyString(metadata['conversationId']) ??
    explicitThreadId ??
    undefined;

  const scopeType =
    readNonEmptyString(data['scopeType']) ?? readNonEmptyString(metadata['scopeType']) ?? undefined;

  // For notifications WE drew, isThread is pre-baked (_v4) and authoritative.
  // For raw FCM (or iOS APNS), derive it from signals.
  const derivedIsThread =
    data['_v4'] === 'true'
      ? data['isThreadReply'] === 'true'
      : deriveIsThread(data, metadata, channelId, conversationId, scopeType, {
          allowMentionConversationFallback: false,
        });

  const { isThread, notificationId, storeKey } = resolveGroupingSlot({
    type,
    isThread: derivedIsThread,
    channelId,
    conversationId,
    explicitThreadId,
  });
  const threadId = isThread ? (explicitThreadId ?? conversationId) : undefined;

  const title =
    readNonEmptyString(data['msg_title']) ?? readNonEmptyString(data['title']) ?? 'New message';
  const rawBody = readNonEmptyString(data['msg_body']) ?? readNonEmptyString(data['body']) ?? '';

  const senderName =
    readNonEmptyString(metadata['senderName']) ??
    readNonEmptyString(data['senderName']) ??
    (scopeType === 'DM'
      ? (readNonEmptyString(data['msg_title']) ?? readNonEmptyString(data['title']))
      : null) ??
    undefined;
  const senderPicture = readNonEmptyString(metadata['senderPicture']) ?? undefined;
  const senderId =
    readNonEmptyString(metadata['senderId']) ?? readNonEmptyString(data['senderId']) ?? undefined;

  const messageId = resolveMessageId(data, metadata);

  const backendNotificationId =
    readNonEmptyString(data['notificationId']) ??
    readNonEmptyString(metadata['notificationId']) ??
    undefined;

  const body = formatBodyWithSender(rawBody, scopeType, senderName);
  if (!title && !body) return null;
  const conversationCreatedAt = resolveConversationCreatedAt(metadata);

  return {
    type,
    title,
    rawBody,
    body,
    channelId,
    ...(conversationId ? { conversationId } : {}),
    ...(threadId ? { threadId } : {}),
    isThread,
    ...(scopeType ? { scopeType } : {}),
    ...(messageId ? { messageId } : {}),
    ...(backendNotificationId ? { backendNotificationId } : {}),
    ...(senderId ? { senderId } : {}),
    ...(senderName ? { senderName } : {}),
    ...(senderPicture ? { senderPicture } : {}),
    timestamp: resolveTimestamp(data, metadata),
    ...(conversationCreatedAt ? { conversationCreatedAt } : {}),
    notificationId,
    storeKey,
    rawData: data,
  };
}

// ── control-signal targeting ──────────────────────────────────────────────────

/** Which tray/group a silent control signal (read/edit/delete) refers to. */
export type ControlSignalTarget = {
  channelId: string;
  conversationId?: string;
  scopeType?: string;
  isThread: boolean;
  notificationId: string; // tray id / iOS threadId for this conversation
  storeKey: string; // MMKV grouping key
  messageId?: string; // the edited/deleted message (absent for read signals)
  serverNotificationId?: string; // backend notification id (for re-baked tray data)
};

/**
 * Resolve the conversation a CHANNEL_READ / THREAD_READ / MESSAGE_EDITED /
 * MESSAGE_DELETED signal targets. These payloads carry no banner text — only
 * the ids needed to find the tray + MMKV slot we already drew. Returns null
 * when the payload is missing a channelId (nothing to act on).
 */
export function resolveControlSignalTarget(
  data: Record<string, string>,
  signalType: string,
): ControlSignalTarget | null {
  const metadata = parseMetadata(data);
  const conversationRecord = readConversationRecord(metadata);

  const channelId =
    readNonEmptyString(metadata['channelId']) ??
    readNonEmptyString(data['channelId']) ??
    readNonEmptyString(conversationRecord?.['channelId']);
  if (!channelId) return null;

  const explicitThreadId =
    readNonEmptyString(data['threadId']) ?? readNonEmptyString(metadata['threadId']);
  const conversationId =
    readNonEmptyString(data['conversationId']) ??
    readNonEmptyString(metadata['conversationId']) ??
    explicitThreadId ??
    undefined;
  const scopeType =
    readNonEmptyString(data['scopeType']) ?? readNonEmptyString(metadata['scopeType']) ?? undefined;

  // Thread-ness: READ signals say so by type; edit/delete derive it from metadata.
  const isThread =
    signalType === 'THREAD_READ'
      ? true
      : signalType === 'CHANNEL_READ'
        ? false
        : deriveIsThread(data, metadata, channelId, conversationId, scopeType, {
            allowMentionConversationFallback: false,
          });

  // type '' avoids the CHANNEL_MESSAGE special-case; isThread already decided above.
  const { notificationId, storeKey } = resolveGroupingSlot({
    type: '',
    isThread,
    channelId,
    conversationId,
    explicitThreadId: explicitThreadId ?? null,
  });

  const messageId =
    readNonEmptyString(metadata['messageId']) ??
    readNonEmptyString(data['messageId']) ??
    readNonEmptyString(data['relatedEntityId']) ??
    undefined;

  const serverNotificationId =
    readNonEmptyString(data['notificationId']) ??
    readNonEmptyString(metadata['notificationId']) ??
    undefined;

  return {
    channelId,
    ...(conversationId ? { conversationId } : {}),
    ...(scopeType ? { scopeType } : {}),
    isThread,
    notificationId,
    storeKey,
    ...(messageId ? { messageId } : {}),
    ...(serverNotificationId ? { serverNotificationId } : {}),
  };
}

// Where should a reply go? (req #3)
export function resolveReplyTarget(message: ParsedMessage): ReplyTarget | null {
  if (!message.channelId) return null;
  if (message.isThread && message.conversationId) {
    return { kind: 'thread', channelId: message.channelId, conversationId: message.conversationId };
  }
  return { kind: 'channel', channelId: message.channelId };
}

// ── ticket targeting ──────────────────────────────────────────────────────────

/**
 * Resolve the ticket a notification points at, when any.
 *
 * Chat overlays (MENTION / THREAD_REPLY with metadata.ticketId) still parse as
 * messages first; standalone TICKET_* events never enter extractMessageContext
 * and are routed via extractTicketRouteTarget instead.
 */
export function resolveTicketId(data: Record<string, string>): string | undefined {
  const metadata = parseMetadata(data);
  const relatedEntityType =
    readNonEmptyString(data['relatedEntityType']) ??
    readNonEmptyString(metadata['relatedEntityType']);
  const normalized = relatedEntityType?.toUpperCase();
  const relatedEntityId =
    normalized === 'TICKET' || normalized === 'TICKET_ACTIVITY'
      ? (readNonEmptyString(metadata['relatedEntityId']) ??
        readNonEmptyString(data['relatedEntityId']))
      : null;

  return (
    readNonEmptyString(metadata['ticketId']) ??
    readNonEmptyString(data['ticketId']) ??
    relatedEntityId ??
    undefined
  );
}

export function readNotificationType(data: Record<string, unknown>): string {
  return (
    readNonEmptyString(data['type']) ??
    readNonEmptyString(data['category']) ??
    readNonEmptyString(data['notificationType']) ??
    ''
  );
}

/**
 * Build a ticket-detail route from a standalone ticket push (not a chat overlay).
 * Returns null for chat/call/control types so MENTION+ticketId still uses the
 * message pipeline (thread tab, message highlight).
 */
export function extractTicketRouteTarget(data: Record<string, string>): ChatRouteTarget | null {
  const type = readNotificationType(data);
  if (MESSAGE_NOTIFICATION_TYPES.has(type)) return null;
  if (CALL_NOTIFICATION_TYPES.has(type)) return null;
  if (CONTROL_NOTIFICATION_TYPES.has(type)) return null;

  const ticketId = resolveTicketId(data);
  if (!ticketId) return null;

  const metadata = parseMetadata(data);
  const relatedEntityType = (
    readNonEmptyString(data['relatedEntityType']) ??
    readNonEmptyString(metadata['relatedEntityType'])
  )?.toUpperCase();
  const isStandaloneTicket =
    isTicketNotificationType(type) ||
    relatedEntityType === 'TICKET' ||
    relatedEntityType === 'TICKET_ACTIVITY';
  if (!isStandaloneTicket) return null;

  const channelId =
    readNonEmptyString(metadata['channelId']) ?? readNonEmptyString(data['channelId']) ?? undefined;
  const conversationId =
    readNonEmptyString(metadata['conversationId']) ??
    readNonEmptyString(data['conversationId']) ??
    undefined;
  const messageId =
    readNonEmptyString(metadata['messageId']) ?? readNonEmptyString(data['messageId']) ?? undefined;

  return {
    ticketId,
    ...(channelId ? { channelId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(messageId ? { messageId } : {}),
  };
}

// ── activities prefetch gating ─────────────────────────────────────────────────

/**
 * True when an inbound push should warm the activities snapshot (req: v3 parity).
 * Activities back most pushes (mentions, reactions, ticket assignments, thread
 * replies), so we prefetch the delta for those. We skip:
 *   • calls + silent control signals (no activity row)
 *   • plain DMs (a top-level DM message creates no activity row server-side; DM
 *     thread replies DO, so those still prefetch)
 */
export function shouldPrefetchActivities(data: Record<string, string>): boolean {
  const type = readNotificationType(data);
  if (!type) return false;
  if (CALL_NOTIFICATION_TYPES.has(type)) return false;
  if (CONTROL_NOTIFICATION_TYPES.has(type)) return false;

  const metadata = parseMetadata(data);
  const scopeType =
    readNonEmptyString(metadata['scopeType']) ?? readNonEmptyString(data['scopeType']) ?? undefined;

  const isDM = type === 'DIRECT_MESSAGE' || scopeType === 'DM';
  if (!isDM) return true;

  // Plain DM → no activity row. DM thread replies do create activities.
  const channelId =
    readNonEmptyString(metadata['channelId']) ?? readNonEmptyString(data['channelId']) ?? '';
  const conversationId =
    readNonEmptyString(data['conversationId']) ??
    readNonEmptyString(metadata['conversationId']) ??
    undefined;

  return deriveIsThread(data, metadata, channelId, conversationId, scopeType, {
    allowMentionConversationFallback: false,
  });
}
