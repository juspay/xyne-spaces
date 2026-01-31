/**
 * Health monitoring types for LLM providers and models
 */

/**
 * Health status enumeration
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

/**
 * Model health status information
 */
export interface ModelHealthStatus {
  readonly provider: string;
  readonly model: string;
  readonly status: HealthStatus;
  readonly latency: number; // in milliseconds
  readonly lastChecked: Date;
  readonly error?: string;
  readonly metadata?: ModelHealthMetadata;
}

/**
 * Additional health metadata
 */
export interface ModelHealthMetadata {
  readonly region?: string;
  readonly version?: string;
  readonly capabilities?: readonly string[];
  readonly availability?: number; // percentage (0-100)
  readonly consecutiveFailures?: number;
  readonly lastSuccessfulCheck?: Date;
  readonly throttleStatus?: 'normal' | 'limited' | 'blocked';
  readonly quotaRemaining?: number;
  readonly attempts?: number;
  readonly retryCount?: number;
  readonly totalLatency?: number;
}

/**
 * Ping result for basic connectivity testing
 */
export interface PingResult {
  readonly success: boolean;
  readonly latency: number;
  readonly timestamp: Date;
  readonly error?: string;
  readonly responseMetadata?: PingResponseMetadata;
}

/**
 * Ping response metadata
 */
export interface PingResponseMetadata {
  readonly statusCode?: number;
  readonly headers?: Record<string, string>;
  readonly responseSize?: number;
  readonly model?: string;
  readonly provider?: string;
  readonly region?: string;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  readonly interval: number; // monitoring interval in milliseconds
  readonly timeout: number; // ping timeout in milliseconds
  readonly retries: number; // number of retries on failure
  readonly degradedThreshold: number; // latency threshold for degraded status (ms)
  readonly unavailableThreshold: number; // consecutive failures for unavailable
  readonly enableContinuousMonitoring: boolean;
  readonly models?: readonly string[]; // specific models to monitor
}

/**
 * Health monitor interface
 */
export interface HealthMonitor {
  ping(provider: string, model: string): Promise<PingResult>;
  checkHealth(provider: string, model: string): Promise<ModelHealthStatus>;
  getHealthStatus(provider?: string, model?: string): readonly ModelHealthStatus[];
  startMonitoring(config?: Partial<HealthCheckConfig>): void;
  stopMonitoring(): void;
  isMonitoring(): boolean;
}

/**
 * Health event types for monitoring callbacks
 */
export type HealthEventType = 
  | 'status_changed'
  | 'degraded'
  | 'unavailable'
  | 'recovered'
  | 'error'
  | 'ping_completed';

/**
 * Health event data
 */
export interface HealthEvent {
  readonly type: HealthEventType;
  readonly provider: string;
  readonly model: string;
  readonly timestamp: Date;
  readonly previousStatus?: ModelHealthStatus['status'];
  readonly currentStatus: ModelHealthStatus['status'];
  readonly latency?: number;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Health event listener
 */
export type HealthEventListener = (event: HealthEvent) => void;

/**
 * Health statistics aggregation
 */
export interface HealthStatistics {
  readonly provider: string;
  readonly model?: string;
  readonly totalChecks: number;
  readonly successfulChecks: number;
  readonly failedChecks: number;
  readonly averageLatency: number;
  readonly minLatency: number;
  readonly maxLatency: number;
  readonly uptime: number; // percentage
  readonly lastCheck: Date;
  readonly firstCheck: Date;
  readonly timeRange: number; // duration in milliseconds
}

/**
 * Health status validation
 */
export function isHealthy(status: ModelHealthStatus): boolean {
  return status.status === 'healthy';
}

export function isDegraded(status: ModelHealthStatus): boolean {
  return status.status === 'degraded';
}

export function isUnavailable(status: ModelHealthStatus): boolean {
  return status.status === 'unavailable';
}

export function isUnknown(status: ModelHealthStatus): boolean {
  return status.status === 'unknown';
}

/**
 * Health status comparison
 */
export function compareHealthStatus(
  a: ModelHealthStatus,
  b: ModelHealthStatus
): number {
  const statusOrder = { healthy: 3, degraded: 2, unavailable: 1, unknown: 0 };
  const aOrder = statusOrder[a.status];
  const bOrder = statusOrder[b.status];
  
  if (aOrder !== bOrder) {
    return bOrder - aOrder; // Higher order first
  }
  
  return a.latency - b.latency; // Lower latency first
}

/**
 * Create health check configuration with defaults
 */
export function createHealthCheckConfig(
  overrides?: Partial<HealthCheckConfig>
): HealthCheckConfig {
  return {
    interval: 300000, // 5 minutes
    timeout: 10000, // 10 seconds
    retries: 3,
    degradedThreshold: 5000, // 5 seconds
    unavailableThreshold: 3, // 3 consecutive failures
    enableContinuousMonitoring: true,
    ...overrides
  };
}

/**
 * Create a health event
 */
export function createHealthEvent(
  type: HealthEventType,
  provider: string,
  model: string,
  currentStatus: ModelHealthStatus['status'],
  options?: {
    previousStatus?: ModelHealthStatus['status'];
    latency?: number;
    error?: string;
    metadata?: Record<string, unknown>;
  }
): HealthEvent {
  return {
    type,
    provider,
    model,
    timestamp: new Date(),
    currentStatus,
    ...(options?.previousStatus !== undefined && { previousStatus: options.previousStatus }),
    ...(options?.latency !== undefined && { latency: options.latency }),
    ...(options?.error !== undefined && { error: options.error }),
    ...(options?.metadata && { metadata: options.metadata })
  };
}