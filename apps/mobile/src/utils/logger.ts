import { v4 as uuidv4 } from 'uuid';
import { Event, LogLevel } from '@xyne/shared/logger';
import type { EventType } from '@xyne/shared/logger';
import {
  Platform,
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_VARIANT, LOGGER_CONFIG } from '@/src/config';
import DeviceInfo from 'react-native-device-info';
import {
  documentDirectory,
  writeAsStringAsync,
  readAsStringAsync,
  getInfoAsync,
  deleteAsync,
} from 'expo-file-system/legacy';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import axios from 'axios';
import { redactLogFields, redactLogString } from '@/src/observability/logging/redactLogFields';
import { canIncludeEmailInRemoteLogs } from '@/src/observability/logging/remote/canIncludeEmailInRemoteLogs';
import type { NormalizedLogFields } from '@/src/observability/logging/types';

// Re-export for convenience
export { Event, LogLevel } from '@xyne/shared/logger';
export type { EventType } from '@xyne/shared/logger';

export const NotificationSocketState = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
} as const;

export type NotificationSocketState =
  (typeof NotificationSocketState)[keyof typeof NotificationSocketState];

export const ZeroSocketState = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  NEEDS_AUTH: 'needs-auth',
  ERROR: 'error',
  CLOSED: 'closed',
} as const;

export type ZeroSocketState = (typeof ZeroSocketState)[keyof typeof ZeroSocketState];

export type NativeBuildType = 'dev' | 'release';

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
};

export function getNativeBuildType(): NativeBuildType {
  return __DEV__ ? 'dev' : 'release';
}

// Breadcrumb type for crash context
export type BreadcrumbType = 'navigation' | 'api_call' | 'state_change' | 'user_action' | 'error';

export interface Breadcrumb {
  timestamp: number;
  type: BreadcrumbType;
  message: string;
  data?: Record<string, unknown>;
}

// Storage keys
const STORAGE_KEY_SESSION_ID = '@lotus/logger_session_id';
const LEGACY_STORAGE_KEY_EMAIL = '@lotus/logger_email';
export interface LogEntry {
  logId: string;
  clientSessionId: string;
  platformName: string;
  osName: string;
  email?: string;
  timestamp: string;
  level: LogLevel;
  event: EventType;
  brand: string;
  model: string;
  systemVersion: string;
  version: string;
  buildType: NativeBuildType;
  pageViewId?: string | null;
  pageUrl?: string | null;
  zeroClientId?: string | null;
  zeroClientGroupId?: string | null;
  zeroSocketState?: ZeroSocketState;
  notificationWsId?: string | null;
  notificationSocketState?: NotificationSocketState;
  battery_level: number | null;
  network_type: string | null;
  [key: string]: unknown;
}

class LoggerService {
  private clientSessionId: string = '';
  private platformName: string;
  private osName: string;
  zeroClientId: string | null = null;
  zeroClientGroupId: string | null = null;
  private emailId: string | null = null;
  private isAuthenticatedSession = false;
  private pageViewId: string | null = null;
  private pageUrl: string | null = null;
  private notificationWsId: string | null = null;
  private notificationSocketState: NotificationSocketState = NotificationSocketState.DISCONNECTED;
  private zeroSocketState: ZeroSocketState = ZeroSocketState.DISCONNECTED;
  private logs: LogEntry[] = [];
  private preAuthBuffer: LogEntry[] = [];
  private preAuthFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly PRE_AUTH_FLUSH_TIMEOUT_MS = 90000; // 90s buffer window
  private readonly MAX_QUEUE_SIZE = 2000;
  private flushInProgress: boolean = false;
  private activeFlushPromise: Promise<boolean> | null = null;
  private flushInterval: number = LOGGER_CONFIG.flushIntervalInMs;
  private maxBatchSize: number = LOGGER_CONFIG.maxBatchSize;
  private maxRetries: number = LOGGER_CONFIG.maxRetries;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private loggerUrl: string;
  private readonly remoteLoggingEnabled = LOGGER_CONFIG.remoteLoggingEnabled;
  private readonly includeEmailInRemoteRecords =
    this.remoteLoggingEnabled &&
    canIncludeEmailInRemoteLogs(LOGGER_CONFIG.eventsEndpoint, APP_VARIANT, __DEV__);
  private isEnabled: boolean = true;
  private minLevel: LogLevel = __DEV__ ? LogLevel.DEBUG : LogLevel.INFO;
  private isInitialized: boolean = false;
  private appState: AppStateStatus = AppState.currentState;

  private cachedBrand: string = 'unknown';
  private cachedModel: string = 'unknown';
  private cachedSystemVersion: string = 'unknown';
  private cachedAppVersion: string = 'unknown';

  // Breadcrumb buffer for crash context
  private breadcrumbBuffer: Breadcrumb[] = [];
  private unsavedBreadcrumbs = 0;
  private readonly MAX_BREADCRUMBS = 100;
  private readonly BREADCRUMB_FLUSH_THRESHOLD = 10;
  private readonly BREADCRUMB_FILE = `${documentDirectory}breadcrumbs.json`;
  private appStateSubscription: NativeEventSubscription | null = null;
  private batteryLevel: number | null = null;
  private networkType: string | null = null;
  private batteryListener: ReturnType<typeof Battery.addBatteryLevelListener> | null = null;
  private deviceStateRefreshing = false;

  constructor() {
    this.platformName = 'native';
    this.osName = Platform.OS === 'ios' ? 'ios' : 'android';
    this.loggerUrl = LOGGER_CONFIG.eventsEndpoint;
    this.cachedBrand = DeviceInfo.getManufacturerSync();
    this.cachedModel = DeviceInfo.getModel();
    this.cachedSystemVersion = DeviceInfo.getSystemVersion();
    this.cachedAppVersion = DeviceInfo.getVersion();
  }

  /**
   * Initialize the logger
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;
    this.clientSessionId = await this.getOrCreateClientSessionId();
    // Remove the pre-hardening persisted identity. Remote log records never
    // contain it, and keeping it locally is unnecessary.
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY_EMAIL).catch(() => undefined);
    // Load persisted breadcrumbs
    await this.loadBreadcrumbsFromDisk();

    // Setup app state listener for breadcrumb flush
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);

    // Seed device state cache and keep battery live
    void this.refreshDeviceState();
    this.batteryListener = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      this.batteryLevel = Math.round(batteryLevel * 100);
    });

    this.startBackgroundFlush();
    this.info(Event.LOTUS_APP_LAUNCH, {
      appState: this.appState,
    });
  }

  /**
   * Get logger endpoint for crash reporter
   */
  getEndpoint(): string {
    return this.loggerUrl;
  }

  /**
   * Get current device info
   */
  getDeviceInfo(): { brand: string; model: string; systemVersion: string } {
    return {
      brand: this.cachedBrand,
      model: this.cachedModel,
      systemVersion: this.cachedSystemVersion,
    };
  }

  /**
   * Add a breadcrumb for crash context
   * Memory-first, flushes to file-system periodically
   */
  addBreadcrumb(type: BreadcrumbType, message: string, data?: Record<string, unknown>): void {
    const normalizedData = data ? this.normalizeValue(data) : undefined;
    const redactedData =
      normalizedData && typeof normalizedData === 'object' && !Array.isArray(normalizedData)
        ? (redactLogFields(normalizedData as NormalizedLogFields) as Record<string, unknown>)
        : undefined;
    const crumb: Breadcrumb = {
      timestamp: Date.now(),
      type,
      message: redactLogString(message),
      ...(redactedData !== undefined && { data: redactedData }),
    };

    this.breadcrumbBuffer.push(crumb);

    // Ring buffer - evict oldest
    if (this.breadcrumbBuffer.length > this.MAX_BREADCRUMBS) {
      this.breadcrumbBuffer.shift();
    }

    this.unsavedBreadcrumbs++;

    // Flush every N breadcrumbs
    if (this.unsavedBreadcrumbs >= this.BREADCRUMB_FLUSH_THRESHOLD) {
      void this.flushBreadcrumbsToDisk();
    }
  }

  /**
   * Get breadcrumbs for crash report (no storage read needed)
   */
  getBreadcrumbs(): Breadcrumb[] {
    return [...this.breadcrumbBuffer];
  }

  /**
   * Clear breadcrumbs after successful crash send
   */
  async clearBreadcrumbs(): Promise<void> {
    this.breadcrumbBuffer = [];
    this.unsavedBreadcrumbs = 0;
    await deleteAsync(this.BREADCRUMB_FILE, { idempotent: true });
  }

  /**
   * Generate crash signature for grouping
   * Operates on obfuscated stack - server re-hashes after symbolication
   */
  generateCrashSignature(errorMessage: string, rawStack: string): string {
    // Extract method names (survive obfuscation better than line numbers)
    const methodMatches = rawStack.match(/at\s+(\S+)\s+/g) || [];
    const methods = methodMatches
      .map(m => m.replace(/at\s+/, '').trim())
      .filter(m => !m.startsWith('[native'))
      .slice(0, 3);

    // Normalize error message
    const normalizedMessage = errorMessage
      .replace(/\d+/g, '#')
      .replace(/'[^']*'/g, "'")
      .substring(0, 100);

    // Combine and hash (FNV-1a variant)
    const input = `${normalizedMessage}|${methods.join(',')}`;
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    return `cs_${(hash >>> 0).toString(16)}`;
  }

  /**
   * Recursively convert unserializable values (Error, circular refs) into
   * plain objects so JSON.stringify retains all data.
   */
  private normalizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
    if (value instanceof Error) {
      const normalized: Record<string, unknown> = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
      const cause = (value as Error & { cause?: unknown })['cause'];
      if (cause !== undefined) {
        normalized['cause'] = this.normalizeValue(cause, seen);
      }
      return normalized;
    }

    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map(item => this.normalizeValue(item, seen));
    }

    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      normalized[key] = this.normalizeValue((value as Record<string, unknown>)[key], seen);
    }
    return normalized;
  }

  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    const previousAppState = this.appState;
    this.appState = nextAppState;

    if (nextAppState === 'background' || nextAppState === 'active') {
      void this.refreshDeviceState();
    }
    if (previousAppState !== 'background' && nextAppState === 'background') {
      this.info(Event.LOTUS_APP_BACKGROUND, {
        previousAppState,
        appState: nextAppState,
      });
    } else if (previousAppState !== 'active' && nextAppState === 'active') {
      this.info(Event.LOTUS_APP_FOREGROUND, {
        previousAppState,
        appState: nextAppState,
      });
    }
    if (nextAppState === 'background') {
      void this.flushBreadcrumbsToDisk();
      void this.flushLogs();
    }
  };

  private async flushBreadcrumbsToDisk(): Promise<void> {
    if (this.unsavedBreadcrumbs === 0) return;

    try {
      const data = JSON.stringify(this.breadcrumbBuffer);
      await writeAsStringAsync(this.BREADCRUMB_FILE, data);
      this.unsavedBreadcrumbs = 0;
    } catch (err) {
      console.warn('[Logger] Failed to persist breadcrumbs:', err);
    }
  }

  private async loadBreadcrumbsFromDisk(): Promise<void> {
    try {
      const info = await getInfoAsync(this.BREADCRUMB_FILE);
      if (!info.exists) return;

      const data = await readAsStringAsync(this.BREADCRUMB_FILE);
      const parsed = JSON.parse(data) as Breadcrumb[];

      if (Array.isArray(parsed)) {
        this.breadcrumbBuffer = parsed.slice(-this.MAX_BREADCRUMBS);
      }
    } catch {
      this.breadcrumbBuffer = [];
    }
  }

  private async refreshDeviceState(): Promise<void> {
    if (this.deviceStateRefreshing) return;
    this.deviceStateRefreshing = true;

    try {
      const [level, netState] = await Promise.all([
        Battery.getBatteryLevelAsync().catch(() => null),
        Network.getNetworkStateAsync().catch(() => ({ type: null })),
      ]);
      this.batteryLevel = level !== null ? Math.round(level * 100) : null;
      this.networkType = netState.type ?? null;

      // Backfill pending logs that were emitted before device state was ready
      for (const log of this.logs) {
        if (log.battery_level === null) log.battery_level = this.batteryLevel;
        if (log.network_type === null) log.network_type = this.networkType;
      }
      for (const log of this.preAuthBuffer) {
        if (log.battery_level === null) log.battery_level = this.batteryLevel;
        if (log.network_type === null) log.network_type = this.networkType;
      }
    } finally {
      this.deviceStateRefreshing = false;
    }
  }

  /**
   * Get or create a persistent client session ID
   */
  private async getOrCreateClientSessionId(): Promise<string> {
    const sessionId = await AsyncStorage.getItem(STORAGE_KEY_SESSION_ID);
    if (!sessionId) {
      const newId = uuidv4();
      await AsyncStorage.setItem(STORAGE_KEY_SESSION_ID, newId);
      return newId;
    }
    return sessionId;
  }

  /**
   * Get the current client session ID
   */
  getClientSessionId(): string {
    return this.clientSessionId;
  }

  /**
   * Get current email ID
   */
  getEmailId(): string | null {
    return this.emailId;
  }

  getPageViewId(): string | null {
    return this.pageViewId;
  }

  getPageUrl(): string | null {
    return this.pageUrl;
  }

  getZeroClientId(): string | null {
    return this.zeroClientId;
  }

  getZeroClientGroupId(): string | null {
    return this.zeroClientGroupId;
  }

  getZeroSocketState(): ZeroSocketState {
    return this.zeroSocketState;
  }

  getNotificationWsId(): string | null {
    return this.notificationWsId;
  }

  getNotificationSocketState(): NotificationSocketState {
    return this.notificationSocketState;
  }

  /**
   * Record the authenticated session identity. Email may be unavailable and is
   * not used as the authentication or log-delivery gate.
   */
  async setEmailId(email: string): Promise<void> {
    this.emailId = email.trim() || null;
    this.isAuthenticatedSession = true;
    this.enrichPreAuthLogs();
  }

  /**
   * Clear email ID on sign-out
   */
  async clearEmailId(): Promise<void> {
    this.emailId = null;
    this.isAuthenticatedSession = false;
    this.zeroClientId = null;
    this.zeroClientGroupId = null;
    this.zeroSocketState = ZeroSocketState.DISCONNECTED;
    this.notificationWsId = null;
    this.notificationSocketState = NotificationSocketState.DISCONNECTED;
    this.pageViewId = null;
    this.pageUrl = null;
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY_EMAIL).catch(() => undefined);
    this.flushPreAuthLogs();
  }

  setNotificationWsId(notificationWsId: string): void {
    this.notificationWsId = notificationWsId;
  }

  setNotificationSocketState(state: NotificationSocketState): void {
    this.notificationSocketState = state;
  }

  setZeroClientId(zeroClientId: string): void {
    this.zeroClientId = zeroClientId;
  }

  setZeroClientGroupId(promise: Promise<string>): void {
    promise
      .then(groupId => {
        this.zeroClientGroupId = groupId;
      })
      .catch(() => {
        this.zeroClientGroupId = null;
      });
  }

  setZeroSocketState(state: ZeroSocketState): void {
    this.zeroSocketState = state;
  }

  /**
   * Move buffered pre-auth logs to the main queue after authentication and add
   * the email only when the remote destination is an approved Godel endpoint.
   */
  private enrichPreAuthLogs(): void {
    if (this.preAuthBuffer.length === 0) return;

    for (const entry of this.preAuthBuffer) {
      if (this.includeEmailInRemoteRecords && this.emailId) {
        entry.email = this.emailId;
      }
      this.logs.push(entry);
    }

    this.preAuthBuffer = [];

    if (this.preAuthFlushTimer) {
      clearTimeout(this.preAuthFlushTimer);
      this.preAuthFlushTimer = null;
    }

    if (this.logs.length >= this.maxBatchSize && !this.flushInProgress) {
      void this.flushLogs();
    }
  }

  /**
   * Schedule a safety flush of the pre-auth buffer
   */
  private schedulePreAuthFlush(): void {
    if (this.preAuthFlushTimer) return;

    this.preAuthFlushTimer = setTimeout(() => {
      this.flushPreAuthLogs();
    }, this.PRE_AUTH_FLUSH_TIMEOUT_MS);
  }

  /**
   * Flush pre-auth buffer to main queue without user identity.
   */
  private flushPreAuthLogs(): void {
    if (this.preAuthBuffer.length === 0) return;

    this.logs.push(...this.preAuthBuffer);
    this.preAuthBuffer = [];

    if (this.preAuthFlushTimer) {
      clearTimeout(this.preAuthFlushTimer);
      this.preAuthFlushTimer = null;
    }

    if (!this.flushInProgress) {
      void this.flushLogs();
    }
  }

  /**
   * Move pre-auth entries into the send queue and flush immediately. This is
   * used by short-lived headless notification tasks before the OS tears down
   * their JavaScript runtime.
   */
  async flushAllLogs(): Promise<boolean> {
    if (this.preAuthBuffer.length > 0) {
      this.logs.push(...this.preAuthBuffer);
      this.preAuthBuffer = [];

      if (this.preAuthFlushTimer) {
        clearTimeout(this.preAuthFlushTimer);
        this.preAuthFlushTimer = null;
      }
    }

    let delivered = true;

    // A flush may already be in progress when the terminal enrollment event
    // is emitted. Drain the queue once more after that flush completes so the
    // terminal event is not left behind for the background timer.
    while (this.logs.length > 0 && delivered) {
      delivered = await this.flushLogs();
    }

    return delivered;
  }

  /**
   * Set current screen name
   */
  setScreen(screenName: string): void {
    this.pageViewId = uuidv4();
    this.pageUrl = screenName;
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Log a debug event
   */
  debug(event: EventType, extraFields?: Record<string, unknown>): void {
    this.addLog(LogLevel.DEBUG, event, extraFields);
  }

  /**
   * Log an info event
   */
  info(event: EventType, extraFields?: Record<string, unknown>): void {
    this.addLog(LogLevel.INFO, event, extraFields);
  }

  /**
   * Log a warning event
   */
  warn(event: EventType, extraFields?: Record<string, unknown>): void {
    this.addLog(LogLevel.WARN, event, extraFields);
  }

  /**
   * Log an error event
   */
  error(event: EventType, extraFields?: Record<string, unknown>): void {
    this.addLog(LogLevel.ERROR, event, extraFields);
  }

  /**
   * Log an error with exception details
   */
  logError(event: EventType, error: unknown, extraFields?: Record<string, unknown>): void {
    const errorDetails = {
      ...(extraFields || {}),
      error_message: error instanceof Error ? error.message : String(error),
      error_stack: error instanceof Error ? error.stack : undefined,
    };
    this.error(event, errorDetails);
  }

  /**
   * Add a log entry
   */
  private addLog(level: LogLevel, event: EventType, extraFields?: Record<string, unknown>): void {
    if (!this.isEnabled) {
      return;
    }

    if (LOG_LEVEL_SEVERITY[level] < LOG_LEVEL_SEVERITY[this.minLevel]) {
      return;
    }

    // Eagerly refresh device state if not yet captured (idempotent via in-flight guard)
    if (this.batteryLevel === null || this.networkType === null) {
      void this.refreshDeviceState();
    }

    const normalizedExtraFields = extraFields
      ? (this.normalizeValue(extraFields) as Record<string, unknown>)
      : undefined;
    const redactedExtraFields = normalizedExtraFields
      ? (redactLogFields(normalizedExtraFields as NormalizedLogFields) as Record<string, unknown>)
      : undefined;

    // Console logging must use the same redacted fields as the queued log.
    if (__DEV__ || level === 'ERROR') {
      const emoji = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : 'ℹ️';
      console.log(`${emoji} [${level}] ${event}`, redactedExtraFields);
    }

    // Keep local diagnostics available, but honor the build-time privacy
    // choice before anything can enter the remote queue.
    if (!this.remoteLoggingEnabled) {
      return;
    }

    const logEntry: LogEntry = {
      logId: uuidv4(),
      clientSessionId: this.clientSessionId,
      platformName: this.platformName,
      osName: this.osName,
      timestamp: new Date().toISOString(),
      level,
      brand: this.cachedBrand,
      model: this.cachedModel,
      systemVersion: this.cachedSystemVersion,
      version: this.cachedAppVersion,
      buildType: getNativeBuildType(),
      pageViewId: this.pageViewId,
      pageUrl: this.pageUrl,
      zeroClientId: this.zeroClientId,
      zeroClientGroupId: this.zeroClientGroupId,
      zeroSocketState: this.zeroSocketState,
      notificationWsId: this.notificationWsId,
      notificationSocketState: this.notificationSocketState,
      battery_level: this.batteryLevel,
      network_type: this.networkType,
      event,
      ...(redactedExtraFields || {}),
      ...(this.includeEmailInRemoteRecords && this.isAuthenticatedSession && this.emailId
        ? { email: this.emailId }
        : {}),
    };

    // Authentication is independent of email availability. An authenticated
    // account with no email should not keep its logs in the pre-auth buffer.
    if (!this.isAuthenticatedSession) {
      this.preAuthBuffer.push(logEntry);
      this.schedulePreAuthFlush();
      if (this.preAuthBuffer.length >= this.maxBatchSize) {
        this.flushPreAuthLogs();
      }
      return;
    }

    this.logs.push(logEntry);

    // Flush quickly once we have a full batch so logs show up in Grafana sooner.
    if (this.logs.length >= this.maxBatchSize && !this.flushInProgress) {
      void this.flushLogs();
    }
  }

  /**
   * Start background flush timer
   */
  private startBackgroundFlush(): void {
    this.flushTimer = setInterval(() => {
      if (!this.flushInProgress && this.logs.length > 0) {
        this.flushLogs();
      }
    }, this.flushInterval);
  }

  /**
   * Flush logs to backend
   */
  async flushLogs(): Promise<boolean> {
    if (!this.remoteLoggingEnabled) {
      this.logs = [];
      this.preAuthBuffer = [];
      return true;
    }

    if (this.flushInProgress) {
      return this.activeFlushPromise ? await this.activeFlushPromise : false;
    }

    if (this.logs.length === 0) {
      return true;
    }

    this.flushInProgress = true;
    const logsToPush = [...this.logs];
    this.logs = [];

    const flushPromise = this.sendLogsWithRetry(logsToPush)
      .then(() => true)
      .catch(error => {
        console.error('[LotusLogger] Failed to push logs after all retries:', error);
        this.logs.unshift(...logsToPush);
        if (this.logs.length > this.MAX_QUEUE_SIZE) {
          this.logs = this.logs.slice(-this.MAX_QUEUE_SIZE);
        }
        return false;
      })
      .finally(() => {
        this.flushInProgress = false;
        this.activeFlushPromise = null;
      });

    this.activeFlushPromise = flushPromise;
    return await flushPromise;
  }

  /**
   * Send logs with retry logic
   */
  private async sendLogsWithRetry(logs: LogEntry[]): Promise<void> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.sendLogs(logs);
        return;
      } catch (error) {
        lastError = error;
        console.error(`[LotusLogger] Attempt ${attempt + 1} failed:`, error);

        if (attempt < this.maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff
          await this.sleep(delayMs);
        }
      }
    }

    throw lastError;
  }

  /**
   * Send logs to backend
   */
  private async sendLogs(logs: LogEntry[]): Promise<void> {
    if (!this.remoteLoggingEnabled) {
      return;
    }

    if (__DEV__) {
      console.log(`[LotusLogger] Sending ${logs.length} logs to ${this.loggerUrl}`);
    }

    try {
      await axios.post(this.loggerUrl, logs, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 'unknown';
        const body = error.response?.data;
        const bodyText = typeof body === 'string' ? body : JSON.stringify(body ?? {});
        throw new Error(`HTTP ${status}: ${bodyText}`);
      }
      throw error;
    }

    if (__DEV__) {
      console.log('[LotusLogger] Successfully sent logs to backend');
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Shutdown logger
   */
  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushPreAuthLogs();
    // Final flush
    void this.flushLogs();
    void this.flushBreadcrumbsToDisk();
    this.appStateSubscription?.remove();
    this.batteryListener?.remove();
  }
}

// Export singleton instance
export const logger = new LoggerService();
export const initializeLogger = () => logger.initialize();
