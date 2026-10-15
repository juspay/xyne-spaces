import DeviceInfo from 'react-native-device-info';
import { v4 as uuidv4 } from 'uuid';

import { APP_VARIANT, LOGGER_CONFIG, TELEMETRY_CONFIG } from '../../config';
import { MetricsService } from './MetricsService';
import { ReactNativeAppLifecycle } from '../logging/lifecycle/ReactNativeAppLifecycle';
import { MetricsLifecycleController } from './MetricsLifecycleController';
import { AppHeartbeatController } from './AppHeartbeatController';

function reportMetricsError(error: unknown): void {
  try {
    // eslint-disable-next-line no-console -- Last-resort observability diagnostics.
    console.error('[AppMetrics] Metrics failure.', error);
  } catch {
    // Metrics diagnostics must never interrupt application behavior.
  }
}

function nativeAppVersion(): string {
  try {
    const version = DeviceInfo.getVersion().trim();
    return version.length > 0 ? version : LOGGER_CONFIG.version;
  } catch {
    return LOGGER_CONFIG.version;
  }
}

export const appMetrics = new MetricsService({
  endpoint: TELEMETRY_CONFIG.metricsEndpoint,
  serviceName: TELEMETRY_CONFIG.serviceName,
  exportIntervalMs: TELEMETRY_CONFIG.exportIntervalMs,

  resourceAttributes: {
    // Native versionName / CFBundleShortVersionString (e.g. 102.0.0), not
    // expoConfig.version which is still hardcoded to 1.0.0 in app.config.js.
    'service.version': nativeAppVersion(),
    'app.build.version': LOGGER_CONFIG.buildVersion,
    'deployment.environment.name': APP_VARIANT ?? (__DEV__ ? 'dev' : 'prod'),
    'os.type': LOGGER_CONFIG.platform,
  },

  onError: reportMetricsError,
});

const metricsAppLifecycle = new ReactNativeAppLifecycle();

const metricsServiceLifecycle = new MetricsLifecycleController({
  service: appMetrics,
  appLifecycle: metricsAppLifecycle,
  onError: reportMetricsError,
});

const appHeartbeat = new AppHeartbeatController({
  recorder: appMetrics,
  appLifecycle: metricsAppLifecycle,
  sessionId: uuidv4(),
  onError: reportMetricsError,
});

export const appMetricsLifecycle = {
  start(): void {
    metricsServiceLifecycle.start();
    appHeartbeat.start();
  },

  stop(): void {
    appHeartbeat.stop();
    metricsServiceLifecycle.stop();
  },
} as const;
