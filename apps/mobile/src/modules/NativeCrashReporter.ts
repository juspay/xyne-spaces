/**
 * Native Crash Reporter Bridge
 *
 * TypeScript interface to the native crash reporter modules.
 * Provides methods to check for and recover native crashes on app startup.
 */

import { NativeModules, Platform } from 'react-native';

interface NativeCrashReporterModule {
  /**
   * Get all pending crashes from local storage and NSE shared App Group.
   */
  getPendingCrashes?: () => Promise<NativeCrashData[] | null>;

  /**
   * Legacy Android API. Older installed binaries expose one local crash.
   */
  getPendingCrash?: () => Promise<NativeCrashData | null>;

  /**
   * Clear all pending crashes from local storage and NSE shared App Group.
   */
  clearAllPendingCrashes?: () => Promise<boolean>;

  /**
   * Legacy Android API.
   */
  clearPendingCrash?: () => Promise<boolean>;

  /**
   * Simulate a native crash (DEBUG builds only).
   * Useful for testing the crash reporting pipeline.
   */
  simulateNativeCrash(): void;

  /**
   * Get native app info for crash context.
   */
  getNativeAppInfo(): Promise<NativeAppInfo>;
}

export interface NativeCrashData {
  type: 'native_android' | 'native_ios' | 'native_ios_nse';
  message: string;
  stack: string;
  timestamp: string;
  // Android specific
  thread?: string;
  exceptionClass?: string;
  // iOS specific
  name?: string;
  userInfo?: Record<string, unknown>;
  // NSE specific
  source?: 'notification_service_extension';
  context?: string;
}

interface NativeAppInfo {
  bundleIdentifier: string;
  version: string;
  buildNumber: string;
  isDebug: boolean;
  timestamp: number;
  // Android specific
  packageName?: string;
  versionCode?: number;
  buildType?: string;
}

const { LotusCrashReporter } = NativeModules as {
  LotusCrashReporter?: NativeCrashReporterModule;
};

// Debug: Log available native modules in dev mode
if (__DEV__) {
  console.log('[NativeCrashReporter] Available native modules:', Object.keys(NativeModules));
  console.log('[NativeCrashReporter] LotusCrashReporter available:', LotusCrashReporter != null);
}

/**
 * Check if the native crash reporter module is available.
 * Returns false if the native module isn't linked yet.
 */
export function isCrashReporterAvailable(): boolean {
  return LotusCrashReporter != null;
}

/**
 * Get diagnostic info about why the native module might not be available.
 * Useful for debugging setup issues.
 */
export function getDiagnosticInfo(): {
  platform: string;
  isDev: boolean;
  availableModules: string[];
  crashReporterAvailable: boolean;
  possibleIssues: string[];
} {
  const possibleIssues: string[] = [];

  if (!LotusCrashReporter) {
    possibleIssues.push('Native module not found in NativeModules');

    if (Platform.OS === 'ios') {
      possibleIssues.push('iOS: Run "cd ios && pod install" and rebuild');
    } else if (Platform.OS === 'android') {
      possibleIssues.push('Android: Run "cd android && ./gradlew clean" and rebuild');
    }

    possibleIssues.push(
      'Metro may be caching old native modules - try restarting with "--reset-cache"',
    );
    possibleIssues.push('Ensure native code changes have been compiled into the app binary');
  }

  return {
    platform: Platform.OS,
    isDev: __DEV__,
    availableModules: Object.keys(NativeModules).sort(),
    crashReporterAvailable: LotusCrashReporter != null,
    possibleIssues,
  };
}

/**
 * Get all pending native crashes from local storage and NSE shared App Group.
 * Should be called on app startup to recover crashes that occurred
 * while the app was terminating, including NSE crashes.
 */
export async function getPendingNativeCrashes(): Promise<NativeCrashData[]> {
  if (!LotusCrashReporter) {
    console.warn('[NativeCrashReporter] Module not available');
    return [];
  }

  try {
    if (typeof LotusCrashReporter.getPendingCrashes === 'function') {
      const crashes = await LotusCrashReporter.getPendingCrashes();
      return crashes ?? [];
    }

    if (typeof LotusCrashReporter.getPendingCrash === 'function') {
      const crash = await LotusCrashReporter.getPendingCrash();
      return crash ? [crash] : [];
    }

    console.warn('[NativeCrashReporter] Pending-crash API not available');
    return [];
  } catch (error) {
    console.error('[NativeCrashReporter] Failed to get pending crashes:', error);
    return [];
  }
}

/**
 * Clear all pending crashes from local storage and NSE shared App Group.
 */
export async function clearAllPendingNativeCrashes(): Promise<void> {
  if (!LotusCrashReporter) return;

  try {
    if (typeof LotusCrashReporter.clearAllPendingCrashes === 'function') {
      await LotusCrashReporter.clearAllPendingCrashes();
    } else if (typeof LotusCrashReporter.clearPendingCrash === 'function') {
      await LotusCrashReporter.clearPendingCrash();
    }
  } catch (error) {
    console.error('[NativeCrashReporter] Failed to clear all pending crashes:', error);
  }
}

/**
 * Simulate a native crash (DEBUG builds only).
 * Throws if called in release builds.
 */
export function simulateNativeCrash(): void {
  if (!LotusCrashReporter) {
    console.warn('[NativeCrashReporter] Module not available');
    return;
  }
  LotusCrashReporter.simulateNativeCrash();
}

/**
 * Get native app info for crash context.
 */
export async function getNativeAppInfo(): Promise<NativeAppInfo | null> {
  if (!LotusCrashReporter) return null;

  try {
    return await LotusCrashReporter.getNativeAppInfo();
  } catch (error) {
    console.error('[NativeCrashReporter] Failed to get native app info:', error);
    return null;
  }
}

/**
 * Initialize native crash recovery on app startup.
 * Checks for pending crashes and reports them.
 */
export async function initializeNativeCrashRecovery(
  onCrashRecovered?: (crash: NativeCrashData) => void,
): Promise<void> {
  if (!LotusCrashReporter) {
    console.log('[NativeCrashReporter] Module not available, skipping native crash recovery');
    return;
  }

  const pendingCrashes = await getPendingNativeCrashes();
  if (pendingCrashes.length === 0) return;

  console.log(
    `[NativeCrashReporter] Recovered ${pendingCrashes.length} native crash(es) from previous session`,
  );

  for (const crash of pendingCrashes) {
    console.log('[NativeCrashReporter] Crash:', {
      type: crash.type,
      message: crash.message.substring(0, 100),
    });
    onCrashRecovered?.(crash);
  }

  // Clear all crash files after reporting
  await clearAllPendingNativeCrashes();
}
