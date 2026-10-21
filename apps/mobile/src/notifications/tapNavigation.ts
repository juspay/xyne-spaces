import messaging from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import notifee from 'react-native-notify-kit';
import { NativeModules } from 'react-native';
import { router } from 'expo-router';

import { deleteKeys, getJson, getString, setJson } from '@/src/services/localStorage';
import { triggerActivitySync } from '@/src/features/activity/sync/activitySyncCoordinator';
import { restorePersistedChatWindow } from '@/src/features/chat/navigation/restorePersistedChatWindow';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';

import { notificationService } from './NotificationService';
import { TICKET_ROUTE } from './config';
import { resolveBaseConversationSurface } from '@/src/features/chat/baseConversationSurface';
import { warmZeroFromNotification, type WarmTarget } from './warmZeroFromNotification';
import {
  extractMessageContext,
  extractTicketRouteTarget,
  normalizeData,
  parseMetadata,
  readNonEmptyString,
  readNotificationType,
  resolveTicketId,
} from './message/messageContext';
import { launchIntentExtrasToNavData } from './launchIntentNav';
import { matchesChatRouteTarget } from './navigation/navReadiness';
import { toRouteTargetFromMessage } from './tapCache';
import type { ChatRouteTarget, ParsedMessage } from './types';

// ── Intent store (memory + MMKV for headless → main handoff) ─────────────────

const INTENT_KEY = '@notif_v3_pending_nav';
const BOOKMARK_INTENT_KEY = '@notif_v3_pending_bookmark_nav';
const CONSUMED_LAUNCH_IDS_KEY = '@notif_v3_consumed_launch_ids';
const MAX_CONSUMED_LAUNCH_IDS = 24;
let memoryIntent: ChatRouteTarget | null = null;
let memoryBookmarkIntent: BookmarkRouteTarget | null = null;
let persistedIntentRaw: string | null | undefined;
let persistedIntentSnapshot: ChatRouteTarget | null = null;
let persistedBookmarkIntentRaw: string | null | undefined;
let persistedBookmarkIntentSnapshot: BookmarkRouteTarget | null = null;
const intentListeners = new Set<() => void>();

let recovered = false;
/** Set when tray/FCM-open handler queues a tap so recoverInitialTap won't duplicate it. */
let tapQueuedThisBoot = false;
let lastRecoveryAttemptAt = 0;
let memoryConsumedLaunchIds: string[] | null = null;

function launchDataSignature(data: Record<string, string>): string | null {
  const notificationId = readNonEmptyString(data['notificationId']);
  if (notificationId) return notificationId;

  const type = readNotificationType(data);
  const fallback = [
    type,
    resolveTicketId(data) ?? '',
    readNonEmptyString(data['channelId']) ?? '',
    readNonEmptyString(data['messageId']) ?? '',
  ].join('|');
  return fallback.replace(/\|/g, '') ? fallback : null;
}

function readConsumedLaunchIds(): string[] {
  if (memoryConsumedLaunchIds) return memoryConsumedLaunchIds;
  const stored = getJson<unknown>(CONSUMED_LAUNCH_IDS_KEY);
  memoryConsumedLaunchIds = Array.isArray(stored)
    ? stored.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  return memoryConsumedLaunchIds;
}

function wasLaunchAlreadyConsumed(data: Record<string, string>): boolean {
  const sig = launchDataSignature(data);
  return sig ? readConsumedLaunchIds().includes(sig) : false;
}

function rememberConsumedLaunchData(data: Record<string, string>): void {
  const sig = launchDataSignature(data);
  if (!sig) return;
  const ids = readConsumedLaunchIds().filter(id => id !== sig);
  ids.push(sig);
  while (ids.length > MAX_CONSUMED_LAUNCH_IDS) ids.shift();
  memoryConsumedLaunchIds = ids;
  setJson(CONSUMED_LAUNCH_IDS_KEY, ids);
}

export type BookmarkRouteTarget = {
  kind: 'bookmarks';
  messageId?: string;
};

function readPersistedIntent(): ChatRouteTarget | null {
  const raw = getString(INTENT_KEY);
  if (raw === persistedIntentRaw) return persistedIntentSnapshot;
  persistedIntentRaw = raw;
  if (!raw) {
    persistedIntentSnapshot = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ChatRouteTarget;
    persistedIntentSnapshot = isPersistableNavIntent(parsed) ? parsed : null;
  } catch {
    deleteKeys([INTENT_KEY]);
    persistedIntentRaw = null;
    persistedIntentSnapshot = null;
  }
  return persistedIntentSnapshot;
}

function readPersistedBookmarkIntent(): BookmarkRouteTarget | null {
  const raw = getString(BOOKMARK_INTENT_KEY);
  if (raw === persistedBookmarkIntentRaw) return persistedBookmarkIntentSnapshot;
  persistedBookmarkIntentRaw = raw;
  if (!raw) {
    persistedBookmarkIntentSnapshot = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as BookmarkRouteTarget;
    persistedBookmarkIntentSnapshot = parsed?.kind === 'bookmarks' ? parsed : null;
  } catch {
    deleteKeys([BOOKMARK_INTENT_KEY]);
    persistedBookmarkIntentRaw = null;
    persistedBookmarkIntentSnapshot = null;
  }
  return persistedBookmarkIntentSnapshot;
}

function isPersistableNavIntent(
  target: ChatRouteTarget | null | undefined,
): target is ChatRouteTarget {
  if (!target) return false;
  if (target.ticketId?.trim()) return true;
  return Boolean(target.channelId?.trim());
}

export function persistNavIntent(target: ChatRouteTarget): void {
  memoryIntent = target;
  setJson(INTENT_KEY, target);
  persistedIntentRaw = JSON.stringify(target);
  persistedIntentSnapshot = target;
  intentListeners.forEach(l => l());
}

export function persistBookmarkNavIntent(target: BookmarkRouteTarget): void {
  memoryBookmarkIntent = target;
  setJson(BOOKMARK_INTENT_KEY, target);
  persistedBookmarkIntentRaw = JSON.stringify(target);
  persistedBookmarkIntentSnapshot = target;
  intentListeners.forEach(l => l());
}

export function getNavIntentSnapshot(): ChatRouteTarget | null {
  return memoryIntent ?? readPersistedIntent();
}

export function getBookmarkNavIntentSnapshot(): BookmarkRouteTarget | null {
  return memoryBookmarkIntent ?? readPersistedBookmarkIntent();
}

export function clearNavIntent(): void {
  memoryIntent = null;
  deleteKeys([INTENT_KEY]);
  persistedIntentRaw = null;
  persistedIntentSnapshot = null;
  intentListeners.forEach(l => l());
}

export function clearBookmarkNavIntent(): void {
  memoryBookmarkIntent = null;
  deleteKeys([BOOKMARK_INTENT_KEY]);
  persistedBookmarkIntentRaw = null;
  persistedBookmarkIntentSnapshot = null;
  intentListeners.forEach(l => l());
}

/** Clear all persisted and in-memory notification navigation handoff state. */
export function clearNotificationNavigationState(): void {
  clearNavIntent();
  clearBookmarkNavIntent();
  memoryConsumedLaunchIds = null;
  deleteKeys([CONSUMED_LAUNCH_IDS_KEY]);
}

export function subscribeNavIntent(listener: () => void): () => void {
  intentListeners.add(listener);
  return () => intentListeners.delete(listener);
}

// ── Router ───────────────────────────────────────────────────────────────────

type NavigateOptions = {
  /** Use replace on cold-start deferred nav to avoid stacking duplicate screens. */
  mode?: 'push' | 'replace';
};

export function performChatNavigation(
  target: ChatRouteTarget,
  options: NavigateOptions = {},
): void {
  triggerActivitySync('push_opened');

  if (target.ticketId) {
    const channelId = target.channelId?.trim() ?? '';
    if (channelId) {
      restorePersistedChatWindow({
        channelId,
        ...(target.threadId ? { threadId: target.threadId } : {}),
        ...(target.messageId ? { messageId: target.messageId } : {}),
      });
    }
    (options.mode === 'replace' ? router.replace : router.push)({
      pathname: TICKET_ROUTE,
      params: {
        ticketId: target.ticketId,
        selectedTab: target.threadId ? 'thread' : 'activity',
        ...(channelId ? { channelId } : {}),
        ...(target.threadId ? { threadId: target.threadId } : {}),
        ...(target.messageId ? { messageId: target.messageId } : {}),
        from: 'notification',
        source: 'notification',
      },
    });
    return;
  }

  const surface = resolveBaseConversationSurface(target.scopeType);

  const channelId = target.channelId?.trim() ?? '';
  if (!channelId) return;

  const chatIntent = createChatOpenIntent(
    {
      channelId,
      ...(target.threadId ? { threadId: target.threadId } : {}),
      ...(target.conversationId ? { origin: target.conversationId } : {}),
      ...(target.messageId ? { messageId: target.messageId } : {}),
      ...(target.createdAt && Number.isFinite(Number(target.createdAt))
        ? { createdAt: Number(target.createdAt) }
        : {}),
      surface,
      ...(target.scopeType ? { scopeType: target.scopeType } : {}),
      openStartedAtMs: Date.now(),
    },
    'notification',
  );
  if (!chatIntent) return;
  executeChatOpenIntent(router, chatIntent, options.mode ? { mode: options.mode } : {});

  // Safety-net warm: fire-and-forget so the target message lands in MMKV.
  // After warm completes, drain fresh MMKV data into the queryCacheActor so
  // the mounted chat screen picks it up via its subscribeMessages listener.
  void (async () => {
    try {
      const ctx = notificationService.readWarmUserContext();
      if (!ctx) {
        return;
      }
      const warmTarget: WarmTarget = {
        channelId,
        isThread: !!target.threadId,
        isDm: target.scopeType === 'DM' || target.scopeType === 'GROUP_DM',
        ...(target.messageId ? { messageId: target.messageId } : {}),
        ...(target.conversationId ? { conversationId: target.conversationId } : {}),
        ...(target.threadId ? { threadId: target.threadId } : {}),
      };
      // The tap path only needs the destination chat. The background receive
      // path still performs the full startup warm, but repeating that large
      // users/channels/activity batch here can delay the target chat entity
      // reaching the mounted screen and leave it behind the open shimmer.
      const summary = await warmZeroFromNotification(ctx, warmTarget, { scope: 'chat' });
      if (summary.outcomes.some(o => o.ok)) {
        restorePersistedChatWindow({
          channelId,
          ...(target.threadId
            ? { threadId: target.threadId, kind: 'thread' as const }
            : { kind: 'channel' as const }),
          ...(target.messageId ? { messageId: target.messageId } : {}),
        });
      }
    } catch {
      // Safety-net warm failed; navigation still proceeds.
    }
  })();
}

export function performBookmarkNavigation(
  target: BookmarkRouteTarget,
  options: NavigateOptions = {},
): void {
  triggerActivitySync('push_opened');
  (options.mode === 'replace' ? router.replace : router.push)({
    pathname: '/(protected)/(shortcuts)/bookmarks',
    params: {
      ...(target.messageId ? { messageId: target.messageId } : {}),
      source: 'notification',
      from: 'notification',
    },
  });
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toBookmarkRouteTargetFromData(data: Record<string, string>): BookmarkRouteTarget | null {
  const metadata = parseMetadata(data);
  const relatedEntityType = (
    readNonEmptyString(data['relatedEntityType']) ??
    readNonEmptyString(metadata['relatedEntityType'])
  )?.toLowerCase();
  if (relatedEntityType !== 'bookmark') return null;

  const messageId =
    readNonEmptyString(metadata['messageId']) ??
    readNonEmptyString(data['messageId']) ??
    readNonEmptyString(data['relatedEntityId']) ??
    readNonEmptyString(metadata['relatedEntityId']) ??
    getStringValue(metadata['entityId']);
  return messageId ? { kind: 'bookmarks', messageId } : { kind: 'bookmarks' };
}

export function queueBookmarkNotificationNavigationFromData(data: Record<string, string>): boolean {
  const target = toBookmarkRouteTargetFromData(data);
  if (!target) return false;
  if (wasLaunchAlreadyConsumed(data)) return false;

  tapQueuedThisBoot = true;
  persistBookmarkNavIntent(target);
  rememberConsumedLaunchData(data);
  return true;
}

export function queueTicketNotificationNavigationFromData(data: Record<string, string>): boolean {
  const target = extractTicketRouteTarget(data);
  if (!target) return false;
  if (wasLaunchAlreadyConsumed(data)) return false;

  tapQueuedThisBoot = true;
  persistNavIntent(target);
  rememberConsumedLaunchData(data);
  return true;
}

/** Bookmark and standalone ticket taps — used when the payload is not a chat message. */
export function queueNonChatNotificationNavigationFromData(data: Record<string, string>): boolean {
  if (queueBookmarkNotificationNavigationFromData(data)) return true;
  return queueTicketNotificationNavigationFromData(data);
}

export function isAlreadyOnTarget(
  pathname: string | null | undefined,
  target: ChatRouteTarget,
  routeParams: {
    channelId?: string | undefined;
    threadId?: string | undefined;
    conversationId?: string | undefined;
    messageId?: string | undefined;
    createdAt?: string | undefined;
  } = {},
): boolean {
  return matchesChatRouteTarget(pathname, target, routeParams);
}

function navSignature(target: ChatRouteTarget): string {
  return [
    target.ticketId ?? '',
    target.channelId ?? '',
    target.threadId ?? '',
    target.conversationId ?? '',
    target.messageId ?? '',
  ].join('|');
}

// ── Tap entry (tray + FCM open) ──────────────────────────────────────────────

/** Called from trayEvents / messaging — never calls router directly. */
export async function queueTapNavigation(message: ParsedMessage): Promise<void> {
  const target = toRouteTargetFromMessage(message);
  if (!target) {
    return;
  }

  tapQueuedThisBoot = true;
  persistNavIntent(target);
  rememberConsumedLaunchData(message.rawData);
}

// ── Cold-start recovery ──────────────────────────────────────────────────────

const RECOVERY_RETRY_COOLDOWN_MS = 1200;

async function queueChatOrTicketFromNotificationData(
  data: Record<string, string>,
): Promise<boolean> {
  if (wasLaunchAlreadyConsumed(data)) return false;

  const message = extractMessageContext(data);
  if (message) {
    await queueTapNavigation(message);
    return true;
  }
  return queueTicketNotificationNavigationFromData(data);
}

async function recoverTapFromSystemNotificationApis(): Promise<boolean> {
  const fcm = await messaging().getInitialNotification();
  if (tapQueuedThisBoot) return false;

  if (fcm) {
    const data = normalizeData(fcm.data);
    if (queueBookmarkNotificationNavigationFromData(data)) return true;
    if (await queueChatOrTicketFromNotificationData(data)) return true;
  }

  if (tapQueuedThisBoot) return false;

  const initial = await notifee.getInitialNotification();
  const initialData = normalizeData(initial?.notification?.data as Record<string, unknown>);
  if (queueBookmarkNotificationNavigationFromData(initialData)) return true;
  if (await queueChatOrTicketFromNotificationData(initialData)) return true;

  const expoResponse = await Notifications.getLastNotificationResponseAsync();
  const expoData = normalizeData(
    expoResponse?.notification.request.content.data as Record<string, unknown> | undefined,
  );
  if (queueBookmarkNotificationNavigationFromData(expoData)) return true;
  if (await queueChatOrTicketFromNotificationData(expoData)) return true;

  return false;
}

type LaunchIntentModule = {
  getLaunchIntent?: () => Promise<{ extras?: Record<string, unknown> } | null>;
  clearLaunchIntent?: () => Promise<void>;
};

async function clearConsumedLaunchIntentExtras(): Promise<void> {
  const launchModule = (NativeModules as Record<string, unknown>)['LotusLaunchIntentModule'] as
    LaunchIntentModule | undefined;
  if (typeof launchModule?.clearLaunchIntent !== 'function') return;
  try {
    await launchModule.clearLaunchIntent();
  } catch {
    // Native extras cleanup must never crash launch recovery.
  }
}

async function recoverTapFromLaunchIntentExtras(): Promise<boolean> {
  const launchModule = (NativeModules as Record<string, unknown>)['LotusLaunchIntentModule'] as
    LaunchIntentModule | undefined;
  if (typeof launchModule?.getLaunchIntent !== 'function') {
    return false;
  }

  try {
    const intent = await launchModule.getLaunchIntent();
    const data = launchIntentExtrasToNavData(intent?.extras);
    if (!data) {
      return false;
    }

    const queued =
      queueBookmarkNotificationNavigationFromData(data) ||
      (await queueChatOrTicketFromNotificationData(data));
    if (queued) {
      await clearConsumedLaunchIntentExtras();
    }
    return queued;
  } catch {
    return false;
  }
}

async function consumeStickyLaunchNotificationResponse(): Promise<void> {
  try {
    const clearLastResponse = (
      Notifications as {
        clearLastNotificationResponseAsync?: () => Promise<void>;
      }
    ).clearLastNotificationResponseAsync;

    if (typeof clearLastResponse === 'function') {
      await clearLastResponse();
    }
  } catch {
    // Sticky-response cleanup must never crash launch recovery.
  }
}

export async function recoverInitialTap(): Promise<boolean> {
  lastRecoveryAttemptAt = Date.now();

  try {
    if (getNavIntentSnapshot() || getBookmarkNavIntentSnapshot()) {
      recovered = true;
      return true;
    }

    // FCM / Notifee / Expo initial APIs are one-shot per JS process. Android
    // often destroys MainActivity while JS stays alive; a later tray tap only
    // shows up on launch extras. Always re-read those extras.
    if (!recovered && !tapQueuedThisBoot) {
      recovered = true;
      if (await recoverTapFromSystemNotificationApis()) {
        return true;
      }
    } else {
      recovered = true;
    }

    return await recoverTapFromLaunchIntentExtras();
  } catch {
    recovered = true;
    return false;
  } finally {
    await consumeStickyLaunchNotificationResponse();
  }
}

/**
 * iOS can occasionally surface initial-notification payloads slightly after the
 * first cold-start recovery attempt. Allow a guarded retry on app-active.
 * Android also uses this after MainActivity is recreated for a new tray tap.
 */
export async function retryRecoverInitialTap(
  options: { ignoreCooldown?: boolean } = {},
): Promise<boolean> {
  if (getNavIntentSnapshot() || getBookmarkNavIntentSnapshot()) return false;

  const now = Date.now();
  if (!options.ignoreCooldown && now - lastRecoveryAttemptAt < RECOVERY_RETRY_COOLDOWN_MS) {
    return false;
  }
  lastRecoveryAttemptAt = now;

  try {
    // Launch extras must stay first: Android can remount MainActivity while JS
    // stays alive, so tapQueuedThisBoot from an earlier tap must not hide a new
    // extras payload. Dedup is notificationId + MMKV + native clear after consume.
    if (await recoverTapFromLaunchIntentExtras()) {
      return true;
    }
    if (tapQueuedThisBoot) return false;
    return await recoverTapFromSystemNotificationApis();
  } catch {
    return false;
  }
}

// Dedup state shared with the hook. The route identity is supplied by the
// mounted Expo Router tree, so a later intentional open after leaving the
// destination is not suppressed by a wall-clock timeout.
let lastSig: string | null = null;
let lastRouteIdentity: string | null = null;

export function shouldSuppressNav(target: ChatRouteTarget, routeIdentity = ''): boolean {
  const sig = navSignature(target);
  if (lastSig === sig && lastRouteIdentity === routeIdentity) return true;
  lastSig = sig;
  lastRouteIdentity = routeIdentity;
  return false;
}

export function resetNavDedup(): void {
  lastSig = null;
  lastRouteIdentity = null;
}
