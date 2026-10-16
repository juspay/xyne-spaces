import { Platform } from 'react-native';

import {
  emitNotificationDisplayed,
  emitNotificationDisplayFailed,
  emitNotificationDisplaySkipped,
  emitNotificationHandlerFailed,
  emitNotificationPayloadReceived,
  flushNotificationDeliveryObservability,
} from '@/src/observability/logging/notification/emitNotificationDelivery';
import {
  getNotificationDeliveryFields,
  isIosOperatingSystemPresentedBanner,
  type NotificationDeliveryFields,
} from '@/src/observability/logging/notification/notificationDelivery';
import { prefetchActivitiesDelta } from '@/src/services/notificationCaching/activitiesPrefetch';

import { registerDeviceWithBackend, resetDeviceRegistrationState } from './backend/deviceRegistry';
import { CALL_NOTIFICATION_TYPES, REMINDER_NOTIFICATION_TYPES } from './config';
import { ensureNotificationSetup } from './display/notificationSetup';
import { presentNotification, presentReminderNotification } from './display/presentNotification';
import { isNotificationsPaused } from './pausePreference';
import { handleControlSignal } from './events/controlSignals';
import { cancelConversationTray, registerForegroundTrayEvents } from './events/trayEvents';
import {
  extractMessageContext,
  extractTicketRouteTarget,
  normalizeData,
  shouldPrefetchActivities,
} from './message/messageContext';
import { appendMessageToGroup, clearMessageGroup } from './message/messageStore';
import { addSosAlert, extractSosAlert, getOwnedSosAlert, presentSosNotification } from './sos';
import {
  warmZeroFromNotification,
  type WarmTarget,
  type WarmUserContext,
} from './warmZeroFromNotification';
import { getString, withMmkvCaller } from '@/src/services/localStorage';
import { mmkvStorageAdapter } from '@/src/services/mmkvStorageAdapter';
import {
  configureIosForegroundDelivery,
  subscribeToForegroundMessages,
  subscribeToTokenRefresh,
} from './platform/messaging';
import { requestNotificationPermission } from './platform/permissions';
import { resolvePushToken } from './platform/pushToken';
import { toRouteTargetFromMessage } from './tapCache';
import type { ChatRouteTarget, DeliveryContext, ParsedMessage, RawPushMessage } from './types';
import { subscribeToNotificationOpen } from './platform/messaging';
import {
  isAlreadyOnTarget,
  persistNavIntent,
  queueTapNavigation,
  queueNonChatNotificationNavigationFromData,
} from './tapNavigation';
import {
  getRouteSnapshotPathname,
  getRouteSnapshotTarget,
} from '@/src/features/chat/navigation/routeSnapshot';

const isReminderNotification = (data: Record<string, string>): boolean => {
  const type = data['type']?.trim().toUpperCase();
  return type ? REMINDER_NOTIFICATION_TYPES.has(type) : false;
};

/**
 * NotificationService — the single brain of push notifications.
 *
 * Mental model: it runs ONE ordered boot sequence, then listens.
 *   1. Ask permission        (no permission → stop)
 *   2. Configure iOS delivery (so foreground payloads reach us)
 *   3. Resolve the push token
 *   4. Register the device with the backend
 *   5. Start listening for payloads + token rotations
 *
 * Step 1 scope: parse → display → cache → navigate all live inside handleMessage,
 * so the whole inbound flow stays readable in this one file.
 */
class NotificationService {
  // Ensures the boot sequence runs at most once per signed-in session.
  private started = false;

  // Invalidates an in-flight boot sequence when sign-out stops the service.
  private lifecycleGeneration = 0;

  // Auth token of the current session (needed to talk to the backend).
  private authToken: string | null = null;

  // Unsubscribe functions for every listener we attach; called on stop().
  private cleanups: Array<() => void> = [];

  /** Run the full boot sequence. Call once after the user signs in. */
  async start(authToken: string): Promise<void> {
    if (this.started) {
      return;
    }
    const lifecycleGeneration = ++this.lifecycleGeneration;
    const isCurrentLifecycle = (): boolean =>
      this.started &&
      this.lifecycleGeneration === lifecycleGeneration &&
      this.authToken === authToken;

    this.started = true;
    this.authToken = authToken;

    // STEP 1 — permission. No permission, no notifications. Stop here.
    const granted = await requestNotificationPermission();
    if (!granted || !isCurrentLifecycle()) {
      return;
    }

    // STEP 2 — prepare channels / iOS categories so display is instant later.
    await ensureNotificationSetup();
    if (!isCurrentLifecycle()) return;

    // STEP 3 — make sure iOS delivers foreground payloads to us.
    await configureIosForegroundDelivery();
    if (!isCurrentLifecycle()) return;

    // STEP 3 — resolve the FCM token for this device.
    const fcmToken = await resolvePushToken();
    if (!fcmToken || !isCurrentLifecycle()) {
      return;
    }

    // STEP 4 — register the device with the backend.
    try {
      await registerDeviceWithBackend(authToken, fcmToken, {
        isCurrent: isCurrentLifecycle,
      });
    } catch {
      // Already logged in deviceRegistry. We still start listening so a later
      // token-refresh retry can recover the registration.
    }
    if (!isCurrentLifecycle()) return;

    // STEP 5 — start listening for payloads + token rotations.
    this.startListening(lifecycleGeneration);

    // Warm-up writes bounded per-entity chat keys plus chatCacheIndex. JS uses
    // this layout directly; the iOS NSE mirrors it for killed/background opens.
    // Legacy channelConversations/threadConversations blobs remain readable
    // only as a compatibility fallback for older NSE payloads.
  }

  /** Tear everything down. Call on sign-out / hook cleanup. */
  stop(): void {
    this.lifecycleGeneration += 1;
    if (!this.started) {
      this.authToken = null;
      resetDeviceRegistrationState();
      return;
    }
    this.cleanups.forEach(fn => fn());
    this.cleanups = [];
    this.started = false;
    this.authToken = null;
    resetDeviceRegistrationState();
  }

  /** Attach foreground + token-refresh listeners; remember how to remove them. */
  private startListening(lifecycleGeneration: number): void {
    this.cleanups.push(
      subscribeToForegroundMessages(message => {
        if (this.lifecycleGeneration !== lifecycleGeneration || !this.started) return;
        void this.handleMessage(message, 'foreground');
      }),
    );

    // Tray taps / dismiss / Reply / Mark as read while app is open.
    this.cleanups.push(registerForegroundTrayEvents());

    this.cleanups.push(
      subscribeToTokenRefresh(token => {
        if (this.lifecycleGeneration === lifecycleGeneration && this.started && this.authToken) {
          const refreshAuthToken = this.authToken;
          void registerDeviceWithBackend(refreshAuthToken, token, {
            isCurrent: () =>
              this.lifecycleGeneration === lifecycleGeneration &&
              this.started &&
              this.authToken === refreshAuthToken,
          }).catch(() => {});
        }
      }),
    );

    this.cleanups.push(
      subscribeToNotificationOpen(remoteMessage => {
        if (this.lifecycleGeneration !== lifecycleGeneration || !this.started) return;
        void (async (): Promise<void> => {
          const data = normalizeData(remoteMessage.data);
          const sosAlert = extractSosAlert(data);
          if (sosAlert) {
            if (sosAlert.ownerUserId) {
              addSosAlert(sosAlert);
            } else {
              getOwnedSosAlert(sosAlert.id);
            }
            return;
          }

          const message = extractMessageContext(data);
          if (!message) {
            queueNonChatNotificationNavigationFromData(data);
            return;
          }
          try {
            await queueTapNavigation(message);
          } catch {
            const target = toRouteTargetFromMessage(message);
            if (target) persistNavIntent(target);
          }
          // iOS APNS taps don't fire a tray DISMISS — clear after cache is warm.
          clearMessageGroup(message.storeKey);
          void cancelConversationTray(message.notificationId, message.storeKey).catch(() => {});
        })();
      }),
    );
  }

  /**
   * iOS only: hand a background call push to the call pipeline so a
   * CALL_DISMISS / MISSED_CALL ends the CallKit ring. Loaded lazily — the
   * call stack (machines, LiveKit) is not needed for chat pushes.
   */
  private async routeBackgroundCallMessage(
    message: RawPushMessage,
    fields: NotificationDeliveryFields,
  ): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false;
    }
    try {
      const { handleBackgroundCallRemoteMessage } = await import('./calls/callSetup');
      return await handleBackgroundCallRemoteMessage(message);
    } catch (error) {
      emitNotificationHandlerFailed({ ...fields, error });
      return false;
    }
  }

  /**
   * THE single entry point for every payload — foreground AND background.
   * Pipeline: normalize → parse → group → cache → present.
   */
  async handleMessage(message: RawPushMessage, context: DeliveryContext): Promise<void> {
    return withMmkvCaller('notification', () => this.processInboundMessage(message, context));
  }

  private async processInboundMessage(
    message: RawPushMessage,
    context: DeliveryContext,
  ): Promise<void> {
    const fields = getNotificationDeliveryFields(message, context);
    const iosApnsOwnsBanner = isIosOperatingSystemPresentedBanner(message, context, Platform.OS);
    if (!iosApnsOwnsBanner) {
      emitNotificationPayloadReceived(fields);
    }

    const data = normalizeData(message.data);
    let pendingWarm: ParsedMessage | null = null;

    // Call control pushes (ring / dismiss / missed) belong to the native call
    // pipeline. In the background on iOS nothing else would run them — a
    // CALL_DISMISS must still end the CallKit ring — so route them explicitly.
    // Android handles call pushes natively in LotusIncomingCallMessagingService.
    if (context === 'background' && CALL_NOTIFICATION_TYPES.has(data['type'] ?? '')) {
      const handled = await this.routeBackgroundCallMessage(message, fields);
      if (handled) {
        if (!iosApnsOwnsBanner) {
          emitNotificationDisplaySkipped({
            ...fields,
            category: 'call',
            reason: 'native_call_pipeline',
          });
        }
        await flushNotificationDeliveryObservability();
        return;
      }
    }

    try {
      const sosAlert = extractSosAlert(data);
      if (sosAlert) {
        const ownedAlert = addSosAlert(sosAlert);
        if (!ownedAlert) return;

        if (iosApnsOwnsBanner) {
          return;
        }

        await presentSosNotification(ownedAlert, {
          waitForAndroidAutoDisplay:
            Platform.OS === 'android' && context === 'background' && !!message.notification,
        });
        emitNotificationDisplayed({
          ...fields,
          category: 'sos',
          presentationOwner: 'app',
          trayNotificationId: sosAlert.id,
        });
        return;
      }

      // Silent control signals (read / edit / delete) mutate trays we already drew
      // instead of showing a banner. Handle + stop before the display path.
      if (await handleControlSignal(data)) {
        if (!iosApnsOwnsBanner) {
          emitNotificationDisplaySkipped({
            ...fields,
            category: 'control',
            reason: 'silent_control_signal',
          });
        }
        return;
      }

      // Warm the activities snapshot for pushes backed by an activity row (mentions,
      // reactions, ticket assignments, thread replies). Runs before the parse gate so
      // non-message pushes still refresh the feed. Fire-and-forget.
      if (shouldPrefetchActivities(data)) {
        void prefetchActivitiesDelta().catch(() => {});
      }

      // Only chat messages get a banner; calls / unknowns are ignored.
      const parsed = extractMessageContext(data);
      if (!parsed) {
        if (isReminderNotification(data)) {
          if (iosApnsOwnsBanner) {
            return;
          }
          if (isNotificationsPaused()) {
            emitNotificationDisplaySkipped({
              ...fields,
              category: 'reminder',
              reason: 'notifications_paused',
            });
            return;
          }
          const reminder = await presentReminderNotification(data, message, context);
          if (reminder.outcome === 'displayed') {
            emitNotificationDisplayed({
              ...fields,
              category: 'reminder',
              presentationOwner: reminder.owner,
              trayNotificationId: reminder.trayNotificationId,
            });
          } else {
            emitNotificationDisplayFailed({
              ...fields,
              category: 'reminder',
              error: reminder.error,
            });
          }
          return;
        }

        if (extractTicketRouteTarget(data)) {
          if (iosApnsOwnsBanner) {
            return;
          }
          // OS-presented (FCM notification+data): close the funnel as displayed.
          // Data-only tickets are still not JS-drawn — native Android presents
          // them — so skip rather than falling through as unknown.
          if (message.notification) {
            emitNotificationDisplayed({
              ...fields,
              category: 'ticket',
              presentationOwner: 'operating_system',
              trayNotificationId: fields.notificationId,
            });
            return;
          }
          emitNotificationDisplaySkipped({
            ...fields,
            category: 'ticket',
            reason: 'os_presented_ticket',
          });
          return;
        }

        if (!iosApnsOwnsBanner) {
          const usesNativeCallPipeline = CALL_NOTIFICATION_TYPES.has(data['type'] ?? '');
          emitNotificationDisplaySkipped({
            ...fields,
            category: usesNativeCallPipeline ? 'call' : 'unknown',
            reason: usesNativeCallPipeline
              ? 'native_call_pipeline'
              : 'unsupported_or_invalid_payload',
          });
        }
        return;
      }

      // Silent self-prefetch push (sender's own message from another platform).
      // Warm via warmZeroInBackground; no separate per-message MMKV blob any more.
      if (data['prefetchOnly'] === '1') {
        if (!iosApnsOwnsBanner) {
          emitNotificationDisplaySkipped({
            ...fields,
            category: 'prefetch',
            reason: 'prefetch_only',
          });
        }
        if (context === 'background') {
          pendingWarm = parsed;
        }
        return;
      }

      // Backend notificationFilterService already drops paused pushes. This
      // covers banners the app still draws itself (foreground JS / Android
      // data-only) when a payload arrives after the user paused.
      if (isNotificationsPaused()) {
        if (!iosApnsOwnsBanner) {
          emitNotificationDisplaySkipped({
            ...fields,
            category: 'chat',
            reason: 'notifications_paused',
          });
        }
        return;
      }

      // Foreground: if the user is already viewing this conversation, don't add tray
      // noise — clear the stored group + cancel any banner and stop.
      if (context === 'foreground' && (await this.isAlreadyViewingConversation(parsed))) {
        emitNotificationDisplaySkipped({
          ...fields,
          category: 'chat',
          reason: 'conversation_already_visible',
        });
        clearMessageGroup(parsed.storeKey);
        void cancelConversationTray(parsed.notificationId, parsed.storeKey).catch(() => {});
        return;
      }

      // Persist for continuous grouping (req #2).
      const group = appendMessageToGroup(parsed);

      // Chat MMKV warming is owned by warmZeroFromNotification (JS FCM / foreground).
      // NSE writes tray grouping + SOS into App Group only; it does not prefetch chat cache.

      const chatFields = {
        ...fields,
        category: 'chat' as const,
        notificationId: parsed.backendNotificationId ?? fields.notificationId,
        trayNotificationId: parsed.notificationId,
      };

      if (!iosApnsOwnsBanner) {
        await presentNotification(parsed, group, context);
        emitNotificationDisplayed({
          ...chatFields,
          presentationOwner: 'app',
        });
      }

      // Background wake ↔ warm Zero: on a killed-state FCM delivery we're about
      // to open a socket, drain deltas, and paint the chat list on next user
      // tap. Hydrate op-sqlite inside the FCM window so the *next* app open
      // paints instantly instead of waiting for Zero to boot again.
      //
      // Foreground: warm-up is fire-and-forget so the banner display is not
      // blocked. When the user taps 1-2 seconds later, the target message is
      // already in MMKV and the chat opens instantly.
      if (context === 'background') {
        pendingWarm = parsed;
      } else if (context === 'foreground') {
        void this.warmZeroInBackground(parsed);
      }
    } catch (error) {
      if (iosApnsOwnsBanner) {
        return;
      }
      const displayCategory =
        fields.category === 'chat' || fields.category === 'sos' || fields.category === 'reminder'
          ? fields.category
          : 'chat';
      emitNotificationDisplayFailed({
        ...fields,
        category: displayCategory,
        error,
      });
    } finally {
      // Flush logs + metrics before Zero warm-up so a 3MB prefetch cannot
      // eat the FCM window that Godel needs.
      await flushNotificationDeliveryObservability();
      if (pendingWarm && context === 'background') {
        await this.warmZeroInBackground(pendingWarm);
      }
    }
  }

  /** Preload the queries a returning user will hit first via the HTTP
   * fallback API — no Zero client construction, no WS, no IVM. Reads user
   * context (userID, workspaceId, role, ...) from MMKV, computes query
   * hashes locally against the module-scope schema builder, batches all
   * queries into ONE HTTP round trip, saves results to the app's persistent
   * MMKV query cache under the exact hashes `useCachedQuery` will look up on
   * foreground open.
   *
   * Bounded by warmZeroFromNotification's internal timeout so we can't
   * overrun the FCM wake window. Swallows errors — best-effort. */
  private async warmZeroInBackground(parsed: ParsedMessage): Promise<void> {
    const target: WarmTarget = {
      channelId: parsed.channelId,
      isThread: parsed.isThread,
      isDm: parsed.scopeType === 'DM' || parsed.scopeType === 'GROUP_DM',
      ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
      ...(parsed.conversationId ? { conversationId: parsed.conversationId } : {}),
      ...(parsed.threadId ? { threadId: parsed.threadId } : {}),
    };

    const ctx = this.readWarmUserContext();
    if (!ctx) {
      return;
    }

    try {
      await warmZeroFromNotification(ctx, target);
    } catch {
      // Best-effort warm; swallow errors.
    }
  }

  /** Reads the persisted user context from MMKV — set by lotus on login and
   * kept up to date by the main app. Returns null when no session is
   * persisted (logged-out state) or when required fields are missing. */
  readWarmUserContext(): WarmUserContext | null {
    const userId = getString('@lotus_user_id');
    if (!userId) return null;
    const rawUser = getString('@lotus_user_cache');
    if (!rawUser) return null;
    let parsed: Partial<{
      user_id: string;
      workspaceId: string;
      role: string;
      orgRole: string;
      memberId: string;
    }>;
    try {
      parsed = JSON.parse(rawUser);
    } catch {
      return null;
    }
    if (parsed.user_id !== userId) return null;
    if (typeof parsed.workspaceId !== 'string' || !parsed.workspaceId.trim()) return null;
    const global = mmkvStorageAdapter.getGlobalUserContext();
    if (!global.schemaVersion) return null;
    return {
      userID: userId,
      workspaceId: parsed.workspaceId,
      role: typeof parsed.role === 'string' ? parsed.role : '',
      orgRole: typeof parsed.orgRole === 'string' ? parsed.orgRole : '',
      memberId: typeof parsed.memberId === 'string' ? parsed.memberId : '',
      schemaVersion: global.schemaVersion,
    };
  }

  /**
   * True when the user is already on the chat screen this push targets. Reads the
   * globally-tracked route from the protected layout via a dynamic import to avoid a
   * static cycle (the layout imports this service's hooks). A notification is already
   * visible only when the current route also carries the exact message anchor.
   */
  private async isAlreadyViewingConversation(parsed: ParsedMessage): Promise<boolean> {
    const currentRoute = getRouteSnapshotPathname();
    if (!currentRoute) return false;

    const threadId = parsed.isThread ? (parsed.threadId ?? parsed.conversationId) : undefined;
    const target: ChatRouteTarget = {
      channelId: parsed.channelId,
      ...(threadId ? { threadId } : {}),
      ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
    };
    return isAlreadyOnTarget(currentRoute, target, getRouteSnapshotTarget());
  }
}

// One shared instance for the whole app (imported by the hook and index.js).
export const notificationService = new NotificationService();
