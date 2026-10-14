/**
 * Crash Reporter - Production crash capture for Lotus
 *
 * Integrates with logger.ts (events/logs).
 * Sends crash data to /godel/events (VictoriaLogs).
 *
 * Flow:
 * 1. JS Error → ErrorUtils handler → crashReporter.captureCrash()
 * 2. Native crash → native module writes file → startup recovery → send
 *
 * Breadcrumbs: delegated entirely to logger.ts to avoid dual-write to the
 * same file (breadcrumbs.json).
 */

import { Platform } from 'react-native';
import {
  documentDirectory,
  getInfoAsync,
  readDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
  makeDirectoryAsync,
} from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import Constants from 'expo-constants';
import { logger, Event, LogLevel, getNativeBuildType } from './logger';
import { LOGGER_CONFIG } from '@/src/config';
import {
  getPendingNativeCrashes,
  clearAllPendingNativeCrashes,
} from '@/src/modules/NativeCrashReporter';
import crashlytics from '@react-native-firebase/crashlytics';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CRASH_CONFIG = {
  // Crash queue for offline/retry
  QUEUE_DIR: `${documentDirectory ?? ''}crash_queue/`,
  MAX_QUEUED_CRASHES: 10,
  MAX_CRASH_AGE_DAYS: 7,

  // Network timeout for crash send (short - don't block user)
  SEND_TIMEOUT_MS: 3000,
} as const;

// ============================================================================
// TYPES
// ============================================================================

export type CrashType =
  'javascript' | 'native_android' | 'native_ios' | 'native_ios_nse' | 'react_error_boundary';

export type BreadcrumbType = 'navigation' | 'api_call' | 'state_change' | 'user_action' | 'error';

export interface Breadcrumb {
  timestamp: number;
  type: BreadcrumbType;
  message: string;
  data?: Record<string, unknown>;
}

export interface CrashReport {
  crashId: string;
  crashType: CrashType;
  timestamp: string;
  isFatal: boolean;
  signature: string; // Client-side rough hash for grouping

  error: {
    message: string;
    rawStack: string;
  };

  device: {
    brand: string;
    model: string;
    systemVersion: string;
    totalMemoryMb?: number;
    availableMemoryMb?: number;
    batteryLevel?: number;
    appMemoryUsageMb?: number;
  };

  app: {
    version: string;
    buildNumber: string;
    bundleId: string;
    runtimeVersion: string;
    jsEngine: 'hermes' | 'jsc';
    isDevBuild: boolean;
  };

  session: {
    sessionId: string;
    screenName: string | null;
    durationMs: number;
    previousCrashesInSession: number;
  };

  breadcrumbs: Breadcrumb[];
}

// ============================================================================
// MAIN CRASH REPORTER SERVICE
// ============================================================================

class CrashReporterService {
  private initialized = false;
  private startupTime = Date.now();
  private jsCrashCount = 0;
  private sessionId = '';
  private currentScreen: string | null = null;
  private readonly remoteLoggingEnabled = LOGGER_CONFIG.remoteLoggingEnabled;

  async initialize(sessionId: string): Promise<void> {
    if (this.initialized) return;
    this.sessionId = sessionId;

    // Keep third-party and first-party crash transports behind the same
    // build-time privacy switch as structured remote logging.
    try {
      await crashlytics().setCrashlyticsCollectionEnabled(this.remoteLoggingEnabled);
    } catch (err) {
      console.warn('[CrashReporter] Failed to configure Crashlytics collection:', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Configure Crashlytics context for Lotus differentiation
    if (this.remoteLoggingEnabled) {
      try {
        await crashlytics().setUserId(sessionId);
        await crashlytics().setAttributes({
          build_type: getNativeBuildType(),
          js_engine: (global as unknown as { HermesInternal?: unknown }).HermesInternal
            ? 'hermes'
            : 'jsc',
          // Overwrite any legacy Crashlytics user_email from older installs.
          user_email: '',
        });
      } catch (err) {
        console.warn('[CrashReporter] Failed to set Crashlytics context:', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Wire up global uncaught JS error handler
    this.installGlobalErrorHandler();

    // Check for pending native crashes
    await this.recoverNativeCrashes();

    // Process any queued offline crashes
    await this.processOfflineQueue();

    this.initialized = true;

    // Breadcrumbs are owned by logger — no separate buffer here
    logger.addBreadcrumb('state_change', 'CrashReporter initialized', {
      jsEngine: (global as unknown as { HermesInternal?: unknown }).HermesInternal
        ? 'hermes'
        : 'jsc',
    });
  }

  setScreen(name: string): void {
    this.currentScreen = name;
    logger.addBreadcrumb('navigation', `Screen: ${name}`);
    if (!this.remoteLoggingEnabled) return;
    try {
      crashlytics().setAttribute('screen', name);
    } catch {
      // Ignore Crashlytics errors
    }
  }
  /**
   * Install global handler for uncaught JS exceptions.
   * Catches errors thrown outside React error boundaries (event handlers, async code, etc.).
   */
  private installGlobalErrorHandler(): void {
    const errorUtils = (
      global as unknown as {
        ErrorUtils?: {
          getGlobalHandler(): ((error: Error, isFatal?: boolean) => void) | null;
          setGlobalHandler(handler: (error: Error, isFatal?: boolean) => void): void;
        };
      }
    ).ErrorUtils;

    if (!errorUtils) {
      console.warn('[CrashReporter] ErrorUtils not available, skipping global handler');
      return;
    }

    const currentHandler = errorUtils.getGlobalHandler();
    if (!currentHandler) {
      console.warn('[CrashReporter] No existing global handler to wrap');
      return;
    }

    // Avoid double-wrapping on hot reload / re-initialization
    if ((currentHandler as unknown as { _lotusWrapped?: boolean })._lotusWrapped) {
      return;
    }

    const wrapped = (error: Error, isFatal?: boolean): void => {
      this.reportError(error, 'Uncaught JS exception', isFatal ?? false);
      // Call the chain (may include early handler -> RN original)
      currentHandler(error, isFatal);
    };
    (wrapped as unknown as { _lotusWrapped?: boolean })._lotusWrapped = true;

    errorUtils.setGlobalHandler(wrapped);
  }

  /** Delegate to logger so there is a single breadcrumb buffer/file. */
  addBreadcrumb(type: BreadcrumbType, message: string, data?: Record<string, unknown>): void {
    logger.addBreadcrumb(type, message, data);
  }

  /**
   * Manual error report for caught exceptions
   */
  reportError(error: Error, context?: string, isFatal = false): void {
    void this.captureAndSend({
      type: 'javascript',
      error,
      isFatal,
      ...(context !== undefined && { context }),
    });
  }

  /**
   * Called by React Error Boundary
   */
  reportComponentError(error: Error): void {
    void this.captureAndSend({
      type: 'react_error_boundary',
      error,
      isFatal: false,
    });
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private async captureAndSend(params: {
    type: CrashType;
    error: Error;
    isFatal: boolean;
    context?: string;
  }): Promise<void> {
    if (!this.remoteLoggingEnabled) return;

    const { type, error, isFatal, context } = params;
    this.jsCrashCount++;

    const signature = logger.generateCrashSignature(error.message, error.stack || '');
    const deviceInfo = logger.getDeviceInfo?.() ?? {
      brand: Platform.OS === 'ios' ? 'Apple' : 'Android',
      model: 'unknown',
      systemVersion: Platform.Version.toString(),
    };

    const crashReport: CrashReport = {
      crashId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      crashType: type,
      timestamp: new Date().toISOString(),
      isFatal,
      signature,
      error: {
        message: error.message,
        rawStack: error.stack || '',
      },
      device: {
        brand: deviceInfo.brand,
        model: deviceInfo.model,
        systemVersion: deviceInfo.systemVersion,
      },
      app: {
        version: Constants.expoConfig?.version ?? 'unknown',
        buildNumber:
          (Constants.expoConfig as unknown as { nativeBuildVersion?: string })
            ?.nativeBuildVersion ?? 'unknown',
        bundleId:
          Constants.expoConfig?.ios?.bundleIdentifier ??
          Constants.expoConfig?.android?.package ??
          'unknown',
        runtimeVersion:
          typeof Constants.expoConfig?.runtimeVersion === 'string'
            ? Constants.expoConfig.runtimeVersion
            : 'unknown',
        jsEngine: (global as unknown as { HermesInternal?: unknown }).HermesInternal
          ? 'hermes'
          : 'jsc',
        isDevBuild: __DEV__,
      },
      session: {
        sessionId: this.sessionId,
        screenName: this.currentScreen,
        durationMs: Date.now() - this.startupTime,
        previousCrashesInSession: this.jsCrashCount - 1,
      },
      // Use logger's breadcrumb buffer — single source of truth
      breadcrumbs: logger.getBreadcrumbs(),
    };

    void (async () => {
      try {
        // Set crash-specific attributes
        await crashlytics().setAttribute('crash_fatal', String(isFatal));
        await crashlytics().setAttribute('crash_type', type);
        await crashlytics().setAttribute(
          'session_duration_ms',
          String(Date.now() - this.startupTime),
        );

        const zeroClientId = logger.getZeroClientId();
        if (zeroClientId) {
          await crashlytics().setAttribute('zero_client_id', zeroClientId);
        }

        await crashlytics().setAttribute('zero_socket_state', logger.getZeroSocketState());
        await crashlytics().setAttribute(
          'notification_socket_state',
          logger.getNotificationSocketState(),
        );

        await crashlytics().recordError(error, context ?? 'js_crash');
      } catch {
        console.warn('[CrashReporter] Failed to log crash to Crashlytics');
      }
    })();

    // Try immediate send
    const sent = await this.sendCrashReport(crashReport);

    if (!sent) {
      await this.queueForRetry(crashReport);
    }
  }

  private async sendCrashReport(report: CrashReport): Promise<boolean> {
    if (!this.remoteLoggingEnabled) return true;

    const endpoint = logger.getEndpoint?.();
    if (!endpoint) return false;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CRASH_CONFIG.SEND_TIMEOUT_MS);

    try {
      const response = await axios.post(
        endpoint,
        [
          {
            logId: uuidv4(),
            event: Event.LOTUS_CRASH_DETECTED,
            timestamp: report.timestamp,
            clientSessionId: logger.getClientSessionId(),
            platformName: 'native',
            osName: Platform.OS === 'ios' ? 'ios' : 'android',
            crashId: report.crashId,
            crashType: report.crashType,
            crashSignature: report.signature,
            isFatal: report.isFatal,
            level: LogLevel.ERROR,
            error_message: report.error.message,
            error_stack: report.error.rawStack,
            brand: report.device.brand,
            model: report.device.model,
            systemVersion: report.device.systemVersion,
            version: report.app.version,
            buildType: getNativeBuildType(),
            pageViewId: logger.getPageViewId(),
            pageUrl: logger.getPageUrl(),
            zeroClientId: logger.getZeroClientId(),
            zeroClientGroupId: logger.getZeroClientGroupId(),
            zeroSocketState: logger.getZeroSocketState(),
            notificationWsId: logger.getNotificationWsId(),
            notificationSocketState: logger.getNotificationSocketState(),
            session_durationMs: report.session.durationMs,
            breadcrumbs: JSON.stringify(report.breadcrumbs),
          },
        ],
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Crash-Type': report.crashType,
            'X-Crash-Signature': report.signature,
          },
          signal: controller.signal,
          validateStatus: () => true,
        },
      );

      if (response.status >= 200 && response.status < 300) {
        await logger.clearBreadcrumbs();
        return true;
      }

      console.warn('[CrashReporter] Crash report rejected by server:', {
        crashId: report.crashId,
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    } catch (err) {
      console.warn('[CrashReporter] Crash report send failed:', {
        crashId: report.crashId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async queueForRetry(report: CrashReport): Promise<void> {
    try {
      const dirInfo = await getInfoAsync(CRASH_CONFIG.QUEUE_DIR);
      if (!dirInfo.exists) {
        await makeDirectoryAsync(CRASH_CONFIG.QUEUE_DIR, { intermediates: true });
      }

      await this.cleanupOldCrashes();

      const files = await readDirectoryAsync(CRASH_CONFIG.QUEUE_DIR);
      if (files.length >= CRASH_CONFIG.MAX_QUEUED_CRASHES) {
        // Drop oldest
        const sorted = files.sort();
        await deleteAsync(`${CRASH_CONFIG.QUEUE_DIR}${sorted[0]}`, { idempotent: true });
      }

      const filename = `${Date.now()}_${report.crashId}.json`;
      await writeAsStringAsync(`${CRASH_CONFIG.QUEUE_DIR}${filename}`, JSON.stringify(report));
    } catch (err) {
      console.error('[CrashReporter] Failed to queue crash:', err);
    }
  }

  private async processOfflineQueue(): Promise<void> {
    try {
      const dirInfo = await getInfoAsync(CRASH_CONFIG.QUEUE_DIR);
      if (!dirInfo.exists) return;

      const files = await readDirectoryAsync(CRASH_CONFIG.QUEUE_DIR);

      for (const file of files) {
        try {
          const content = await readAsStringAsync(`${CRASH_CONFIG.QUEUE_DIR}${file}`);
          const report = JSON.parse(content) as CrashReport;

          const sent = await this.sendCrashReport(report);
          if (sent) {
            await deleteAsync(`${CRASH_CONFIG.QUEUE_DIR}${file}`, { idempotent: true });
          }
        } catch {
          // Continue to next file
        }
      }
    } catch {
      // Ignore
    }
  }

  private async cleanupOldCrashes(): Promise<void> {
    try {
      const files = await readDirectoryAsync(CRASH_CONFIG.QUEUE_DIR);
      const cutoff = Date.now() - CRASH_CONFIG.MAX_CRASH_AGE_DAYS * 24 * 60 * 60 * 1000;

      for (const file of files) {
        const timestampStr = file.split('_')[0];
        if (!timestampStr) continue;
        const timestamp = parseInt(timestampStr, 10);
        if (timestamp < cutoff) {
          await deleteAsync(`${CRASH_CONFIG.QUEUE_DIR}${file}`, { idempotent: true });
        }
      }
    } catch {
      // Ignore
    }
  }

  // ==========================================================================
  // NATIVE CRASH RECOVERY
  // ==========================================================================

  private async recoverNativeCrashes(): Promise<void> {
    // Use native module to check for all pending crashes (local + NSE shared App Group)
    const nativeCrashes = await getPendingNativeCrashes();
    if (nativeCrashes.length === 0) return;

    console.log(`[CrashReporter] Recovering ${nativeCrashes.length} native crash(es)`);

    for (const nativeCrash of nativeCrashes) {
      try {
        // Create synthetic error from native crash data
        const syntheticError = new Error(nativeCrash.message);
        syntheticError.stack = nativeCrash.stack;

        // Build params - only include context if defined
        const crashContext = nativeCrash.context ?? nativeCrash.source;
        const params: { type: CrashType; error: Error; isFatal: boolean; context?: string } = {
          type: nativeCrash.type as CrashType,
          error: syntheticError,
          isFatal: true,
        };
        if (crashContext) {
          params.context = crashContext;
        }

        // Report as native crash with appropriate type
        await this.captureAndSend(params);

        console.log(
          `[CrashReporter] Recovered crash: ${nativeCrash.type} - ${nativeCrash.message.substring(0, 50)}`,
        );
      } catch (err) {
        console.warn('[CrashReporter] Failed to process native crash:', err);
      }
    }

    // Clear all native crash files after successful recovery
    await clearAllPendingNativeCrashes();
  }

  shutdown(): void {
    // Breadcrumb lifecycle is owned by logger
  }
}

// Singleton export
export const crashReporter = new CrashReporterService();
