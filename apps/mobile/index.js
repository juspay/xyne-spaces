import 'react-native-get-random-values';
import messaging from '@react-native-firebase/messaging';
import crashlytics from '@react-native-firebase/crashlytics';
import notifee from 'react-native-notify-kit';

// EARLY CRASH CAPTURE

let fullCrashReporterInstalled = false;

// Install an early error handler to capture crashes during app startup before the full crash reporter is initialized.
const installEarlyErrorHandler = () => {
  const ErrorUtils = global.ErrorUtils;
  if (!ErrorUtils) return;

  const originalHandler = ErrorUtils.getGlobalHandler();
  if (!originalHandler || originalHandler._lotusEarlyWrapped) return;

  const earlyHandler = (error, isFatal) => {
    // Check if full crashReporter handler is now active (has _lotusWrapped flag)
    const currentHandler = ErrorUtils.getGlobalHandler();
    const fullReporterActive =
      fullCrashReporterInstalled || (currentHandler && currentHandler._lotusWrapped);

    if (fullReporterActive) {
      fullCrashReporterInstalled = true;
    } else {
      try {
        crashlytics().log('early_startup_crash');
        crashlytics().recordError(error, isFatal ? 'early_fatal_crash' : 'early_nonfatal_crash');
      } catch {
        // Crashlytics may not be ready yet - native layer will still capture fatal crashes
        console.warn('[EarlyCrashHandler] Crashlytics not ready');
      }
    }
    originalHandler(error, isFatal);
  };
  earlyHandler._lotusEarlyWrapped = true;

  ErrorUtils.setGlobalHandler(earlyHandler);
};

/** Track unhandled promise rejections and report them to Crashlytics.*/
const installPromiseRejectionHandler = () => {
  // Hermes-specific tracking (preferred - more reliable)
  const HermesInternal = global.HermesInternal;
  if (HermesInternal?.enablePromiseRejectionTracker) {
    HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (id, error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        console.warn('[PromiseRejection] Unhandled rejection:', err.message);
        try {
          crashlytics().log(`unhandled_promise_rejection:${id}`);
          crashlytics().recordError(err, 'unhandled_promise_rejection');
        } catch {
          console.warn('[PromiseRejection] Crashlytics not ready');
        }
      },
      onHandled: () => {
        // Promise was handled later - no action needed
      },
    });
    return;
  }

  // Fallback for JSC or older Hermes: use global rejection event
  if (global.addEventListener) {
    global.addEventListener('unhandledrejection', event => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      console.warn('[PromiseRejection] Unhandled rejection (fallback):', error.message);
      try {
        crashlytics().log('unhandled_promise_rejection_fallback');
        crashlytics().recordError(error, 'unhandled_promise_rejection');
      } catch {
        console.warn('[PromiseRejection] Crashlytics not ready');
      }
    });
  }
};

installEarlyErrorHandler();
installPromiseRejectionHandler();

// BACKGROUND HANDLERS

// Report errors thrown in background/headless notification handlers.
const reportBackgroundError = (e, context) => {
  try {
    const err = e instanceof Error ? e : new Error(String(e));
    crashlytics().log(context);
    crashlytics().recordError(err, context);
  } catch (reportErr) {
    console.warn('[Crashlytics] failed to record background error:', reportErr);
  }
};

// Tray tap / dismiss / Reply / Mark as read.
// Foreground must be subscribed here — before React mounts — so a MainActivity
// restart from a tray tap does not drop EventBus PRESS (no JS subscriber yet).
const handleNotifeeTrayEvent = async (event, context) => {
  try {
    const { handleTrayEvent } = await import('./src/notifications/events/trayEvents');
    await handleTrayEvent(event);
  } catch (e) {
    console.warn(`[NotifV3][Action] ${context} event error:`, e);
    reportBackgroundError(e, `notifee_${context}_event`);
  }
};

notifee.onBackgroundEvent(event => handleNotifeeTrayEvent(event, 'background'));
notifee.onForegroundEvent(event => handleNotifeeTrayEvent(event, 'foreground'));

// Incoming data pushes while the app is backgrounded or killed.
messaging().setBackgroundMessageHandler(async remoteMessage => {
  global.__XYNE_HEADLESS__ = true;
  let deliveryFields = null;

  try {
    const { getNotificationDeliveryFields } = await import(
      './src/observability/logging/notification/notificationDelivery'
    );
    deliveryFields = getNotificationDeliveryFields(remoteMessage, 'background');

    const { notificationService } = await import('./src/notifications/NotificationService');
    await notificationService.handleMessage(remoteMessage, 'background');
  } catch (e) {
    console.warn('[NotifV3][Inbound] background handler error:', e);
    reportBackgroundError(e, 'fcm_background_message');
    try {
      const { emitNotificationHandlerFailed } = await import(
        './src/observability/logging/notification/emitNotificationDelivery'
      );
      const { getNotificationDeliveryFields } = await import(
        './src/observability/logging/notification/notificationDelivery'
      );
      emitNotificationHandlerFailed({
        ...(deliveryFields ?? getNotificationDeliveryFields(remoteMessage, 'background')),
        error: e,
      });
    } catch {
      // Observability must never hide the original handler failure.
    }
  } finally {
    try {
      const { flushNotificationDeliveryObservability } = await import(
        './src/observability/logging/notification/emitNotificationDelivery'
      );
      await flushNotificationDeliveryObservability();
    } catch {
      // Headless teardown must still resolve.
    }
  }
});

// Bridge shared's sync storage abstraction to MMKV before anything imports
// `@xyne/shared/machines` — the state machine reads drafts synchronously at
// module init and would otherwise miss the persisted value on cold start.
import './src/services/registerSyncStorage';
import 'expo-router/entry';
import './src/mtlsBootstrap';
