import { v7 as uuidv7 } from 'uuid';

import { APP_VARIANT, LOGGER_CONFIG } from '../../config';
import { SystemClock } from './clock/SystemClock';
import { InMemoryLogContextStore } from './context/InMemoryLogContextStore';
import { ReactNativeDeviceInfo } from './device/ReactNativeDeviceInfo';
import { toStaticDeviceLogContext } from './device/toStaticDeviceLogContext';
import { DeviceEnvironmentController } from './environment/DeviceEnvironmentController';
import { ReactNativeBattery } from './environment/ReactNativeBattery';
import { ReactNativeNetwork } from './environment/ReactNativeNetwork';
import type { AppLogEventMap } from './events';
import { Logger } from './Logger';
import { LogTransportLifecycleController } from './lifecycle/LogTransportLifecycleController';
import { ReactNativeAppLifecycle } from './lifecycle/ReactNativeAppLifecycle';
import { FetchHttpClient } from './remote/http/FetchHttpClient';
import { canIncludeEmailInRemoteLogs } from './remote/canIncludeEmailInRemoteLogs';
import type { LogLevel, LogFields } from './types';
import { ConsoleTransport } from './transports/ConsoleTransport';
import { NoOpStartableLogTransport } from './transports/NoOpStartableLogTransport';
import type { LogTransport } from './transports/LogTransport';
import { RemoteLogTransport } from './transports/RemoteLogTransport';

const REMOTE_LOG_QUEUE_CAPACITY = 200;
const REMOTE_LOG_MAXIMUM_BATCH_SIZE = 20;
const IDENTITY_CONTEXT_KEYS = ['userId', 'email', 'workspaceId'] as const;

export type LogIdentity = Readonly<{
  userId?: string;
  email?: string;
  workspaceId?: string;
}>;

function reportRemoteFlushFailure(error: unknown): void {
  try {
    // eslint-disable-next-line no-console -- Last-resort diagnostics must not use the failing logger.
    console.error('[AppLogger] Remote log flush failed.', error);
  } catch {
    // Logging diagnostics must never interrupt application behavior.
  }
}

function compactIdentity(identity: LogIdentity): LogFields {
  const fields: Record<string, string> = {};
  if (identity.userId) {
    fields['userId'] = identity.userId;
  }
  if (identity.email) {
    fields['email'] = identity.email;
  }
  if (identity.workspaceId) {
    fields['workspaceId'] = identity.workspaceId;
  }
  return fields;
}

const systemClock = new SystemClock();
const consoleTransport = new ConsoleTransport();
const httpClient = new FetchHttpClient();
const logContextStore = new InMemoryLogContextStore();
const reactNativeDeviceInfo = new ReactNativeDeviceInfo();

const remoteLoggingEnabled = LOGGER_CONFIG.remoteLoggingEnabled;

const remoteLogTransport = remoteLoggingEnabled
  ? new RemoteLogTransport({
      endpoint: LOGGER_CONFIG.eventsEndpoint,
      httpClient,
      queueCapacity: REMOTE_LOG_QUEUE_CAPACITY,
      maximumBatchSize: REMOTE_LOG_MAXIMUM_BATCH_SIZE,
      onBackgroundFlushError: reportRemoteFlushFailure,
    })
  : null;

export const appLifecycle = new ReactNativeAppLifecycle();

export const appLoggerLifecycle = new LogTransportLifecycleController({
  transport: remoteLogTransport ?? new NoOpStartableLogTransport(),
  appLifecycle,
  onFlushError: reportRemoteFlushFailure,
});

export const appDeviceEnvironment = new DeviceEnvironmentController({
  battery: new ReactNativeBattery(),
  network: new ReactNativeNetwork(),
  contextStore: logContextStore,
});

const transports: readonly LogTransport[] = [
  ...(__DEV__ ? [consoleTransport] : []),
  ...(remoteLogTransport ? [remoteLogTransport] : []),
];

const minimumLevel: LogLevel = __DEV__ ? 'debug' : 'info';

export const logger = new Logger<AppLogEventMap>({
  clock: systemClock,
  minimumLevel,
  transports,
  contextStore: logContextStore,
  // Deliberately keep the authenticated email only on the first-party Godel log
  // stream. Console output and arbitrary email fields stay redacted.
  includeEmailInRemoteRecords:
    remoteLogTransport !== null &&
    canIncludeEmailInRemoteLogs(LOGGER_CONFIG.eventsEndpoint, APP_VARIANT, __DEV__),
  context: toStaticDeviceLogContext({
    serviceName: LOGGER_CONFIG.serviceName,
    osName: LOGGER_CONFIG.platform,
    fallbackOsVersion: String(LOGGER_CONFIG.platformVersion),
    fallbackAppVersion: LOGGER_CONFIG.version,
    fallbackBuildVersion: LOGGER_CONFIG.buildVersion,
    buildType: __DEV__ ? 'dev' : 'release',
    sessionId: uuidv7(),
    device: reactNativeDeviceInfo.snapshot(),
  }),
});

export function flushRemoteLogs(): Promise<void> {
  if (remoteLogTransport === null) {
    return Promise.resolve();
  }

  return remoteLogTransport.flush();
}

export function setLogIdentity(identity: LogIdentity): void {
  logContextStore.set(compactIdentity(identity));
}

export function clearLogIdentity(): void {
  logContextStore.unset(IDENTITY_CONTEXT_KEYS);
}
